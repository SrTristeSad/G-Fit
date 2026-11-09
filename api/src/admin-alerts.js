// Alertas INTERNOS do G-Fit Sandbox. Não enviam e-mail/SMS e não consultam a fila remota.
// O scanner é idempotente, usa bloqueio transacional e não altera pagamentos ou vigências.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';

const validId = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const candidateSql = [
  'SELECT \'charge_attention\'::varchar AS alert_type,c.id::text AS source_key,',
  'CASE WHEN c.status=\'creating\' OR (c.status=\'pending\' AND c.due_date<CURRENT_DATE)',
  'THEN \'critical\' ELSE \'warning\' END::varchar AS severity,',
  'jsonb_build_object(\'reason\',',
  ' CASE WHEN c.status=\'creating\' THEN \'creation_stuck\'',
  ' WHEN c.status=\'review\' THEN \'manual_review\'',
  ' WHEN c.due_date<CURRENT_DATE THEN \'overdue\' ELSE \'pending_48h\' END,',
  ' \'chargeId\',c.id) AS details',
  'FROM pix_charges c WHERE',
  '(c.status=\'creating\' AND c.created_at < NOW() - INTERVAL \'15 minutes\') OR',
  '(c.status=\'pending\' AND (c.due_date<CURRENT_DATE OR c.created_at < NOW() - INTERVAL \'48 hours\')) OR',
  'c.status=\'review\'',
  'UNION ALL',
  'SELECT \'webhook_failure\'::varchar,e.event_id::text,\'critical\'::varchar,',
  'jsonb_build_object(\'eventId\',e.event_id,\'lastHttpStatus\',e.last_http_status) ',
  'FROM asaas_webhook_attempts e WHERE e.last_http_status>=400',
  'UNION ALL',
  'SELECT \'webhook_divergence\'::varchar,e.event_id::text,\'warning\'::varchar,',
  'jsonb_build_object(\'eventId\',e.event_id,\'resolution\',e.resolution)',
  'FROM asaas_webhook_events e',
  'WHERE e.resolution IN (\'mismatch\',\'unmatched\',\'review_status\',\'ignored_status\',\'manual_review\',\'unpaid_charge\')',
  'UNION ALL',
  'SELECT \'refund_review\'::varchar,c.id::text,\'warning\'::varchar,',
  'jsonb_build_object(\'chargeId\',c.id,\'refundState\',c.refund_state)',
  'FROM pix_charges c WHERE c.status=\'paid\' AND c.refund_state IN (\'review\',\'pending\')',
].join(' ');

/**
 * Reconciles alert state from local database records; never calls an external service.
 * Acknowledged alerts stay acknowledged while the condition persists.
 * Once it disappears, the alert resolves; a recurrence opens it again.
 */
export async function scanAdminAlerts() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Só um scanner por vez, mesmo com múltiplas réplicas do servidor.
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(20261110) AS acquired');
    if (!lock.rows[0].acquired) {
      await client.query('ROLLBACK');
      return { skipped: true };
    }
    const candidates = await client.query(candidateSql);
    const keep = [];
    let opened = 0;
    for (const candidate of candidates.rows) {
      const result = await client.query(
        'INSERT INTO admin_alerts (id,alert_type,source_key,severity,details) ' +
        'VALUES ($1,$2,$3,$4,$5::jsonb) ' +
        'ON CONFLICT(alert_type,source_key) DO UPDATE SET ' +
        'severity=EXCLUDED.severity,details=EXCLUDED.details,last_detected_at=NOW(), ' +
        'status=CASE WHEN admin_alerts.status=\'resolved\' THEN \'open\' ELSE admin_alerts.status END, ' +
        'resolved_at=NULL, ' +
        'acknowledged_at=CASE WHEN admin_alerts.status=\'resolved\' THEN NULL ELSE admin_alerts.acknowledged_at END, ' +
        'acknowledged_by=CASE WHEN admin_alerts.status=\'resolved\' THEN NULL ELSE admin_alerts.acknowledged_by END ' +
        'RETURNING id,status',
        [randomUUID(),candidate.alert_type,candidate.source_key,candidate.severity,
          JSON.stringify(candidate.details)],
      );
      keep.push(result.rows[0].id);
      if (result.rows[0].status === 'open') opened += 1;
    }
    const resolved = await client.query(
      'UPDATE admin_alerts SET status=\'resolved\',resolved_at=NOW() ' +
      'WHERE status<>\'resolved\' AND NOT (id=ANY($1::uuid[])) RETURNING id',
      [keep],
    );
    await client.query('UPDATE admin_alert_scanner SET last_success_at=NOW() WHERE id=1');
    await client.query('COMMIT');
    return { scanned: candidates.rows.length, openDetected: opened, resolved: resolved.rowCount };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // Erros locais não devem interromper o atendimento da API.
    db.query('UPDATE admin_alert_scanner SET last_error_at=NOW() WHERE id=1').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function startAdminAlertScanner() {
  const run = () => scanAdminAlerts().catch(error => {
    console.error('G Fit alert scanner failed:', error.code || 'unknown');
  });
  void run();
  const interval = setInterval(run, 15 * 60 * 1000);
  interval.unref?.();
  return interval;
}

export function registerAdminAlertRoutes(app, requireTeacher, requireAdmin, rateLimit) {
  const limit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10,
    standardHeaders: 'draft-8', legacyHeaders: false });

  app.get('/api/admin/alerts', requireTeacher, requireAdmin, async (_req,res) => {
    const [alerts, summary, lastScan] = await Promise.all([
      db.query(
        'SELECT a.id,a.alert_type AS "alertType",a.source_key AS "sourceKey", ' +
        'a.severity,a.status,a.details,a.first_detected_at AS "firstDetectedAt", ' +
        'a.last_detected_at AS "lastDetectedAt",a.acknowledged_at AS "acknowledgedAt", ' +
        'a.resolved_at AS "resolvedAt",t.full_name AS "acknowledgedBy" ' +
        'FROM admin_alerts a LEFT JOIN teachers t ON t.id=a.acknowledged_by ' +
        'ORDER BY CASE a.status WHEN \'open\' THEN 0 WHEN \'acknowledged\' THEN 1 ELSE 2 END, ' +
        'a.last_detected_at DESC LIMIT 100',
      ),
      db.query(
        'SELECT COUNT(*) FILTER (WHERE status=\'open\')::INTEGER AS "open", ' +
        'COUNT(*) FILTER (WHERE status=\'acknowledged\')::INTEGER AS "acknowledged", ' +
        'COUNT(*) FILTER (WHERE status=\'resolved\')::INTEGER AS "resolved" FROM admin_alerts',
      ),
      db.query('SELECT last_success_at AS "lastSuccessAt",last_error_at AS "lastErrorAt" FROM admin_alert_scanner WHERE id=1'),
    ]);
    res.json({
      alerts: alerts.rows, summary: summary.rows[0],
      scanner: lastScan.rows[0] || null,
      sandbox: true, delivery: 'in_app_only',
    });
  });

  app.post('/api/admin/alerts/scan', requireTeacher, requireAdmin, limit, async (_req,res) => {
    const result = await scanAdminAlerts();
    res.json({ ...result, sandbox: true });
  });

  app.patch('/api/admin/alerts/:id/acknowledge', requireTeacher, requireAdmin, async (req,res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const alert = await client.query(
        'SELECT id,status,alert_type,source_key FROM admin_alerts WHERE id=$1 FOR UPDATE',
        [req.params.id],
      );
      if (!alert.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Alerta não encontrado.' });
      }
      const current = alert.rows[0];
      if (current.status === 'resolved') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Alerta já resolvido.' });
      }
      if (current.status === 'open') {
        await client.query(
          'UPDATE admin_alerts SET status=\'acknowledged\',acknowledged_at=NOW(), ' +
          'acknowledged_by=$2 WHERE id=$1',
          [current.id,req.teacher.id],
        );
        await client.query(
          'INSERT INTO admin_audit_logs (id,actor_id,target_teacher_id,action,changes) ' +
          'VALUES ($1,$2,NULL,$3,$4::jsonb)',
          [randomUUID(),req.teacher.id,'billing.alert.acknowledged',
            JSON.stringify({ alertId:current.id,alertType:current.alert_type,sourceKey:current.source_key })],
        );
      }
      await client.query('COMMIT');
      res.json({ acknowledged: true, unchanged: current.status === 'acknowledged' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });
}
