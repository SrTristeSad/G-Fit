// Diagnóstico LOCAL de webhooks e cobranças Pix Sandbox.
// Não consulta o estado da fila no Asaas e não prova que a fila remota está ativa.
import { db } from './db.js';

const SAFE_ERROR_CODES = new Set([
  'PAYMENT_NOT_CONFIRMED_BY_PROVIDER', 'PAYMENT_LOOKUP_FAILED',
  'LIFECYCLE_RECONCILIATION_FAILED', 'DB_PROCESSING_FAILED',
]);

export async function recordWebhookAttempt(event) {
  await db.query(
    'INSERT INTO asaas_webhook_attempts ' +
    '(event_id,event_type,provider_payment_id) VALUES ($1,$2,$3) ' +
    'ON CONFLICT (event_id) DO UPDATE SET ' +
    'attempts=asaas_webhook_attempts.attempts + 1, last_received_at=NOW(), ' +
    'last_http_status=NULL,last_error_code=NULL',
    [event.id, event.event, event.payment?.id ?? null],
  );
}

export async function recordWebhookOutcome(eventId, httpStatus, errorCode = null) {
  const safeCode = SAFE_ERROR_CODES.has(errorCode) ? errorCode : null;
  await db.query(
    'UPDATE asaas_webhook_attempts SET last_http_status=$2,last_error_code=$3, ' +
    'failure_count=failure_count + CASE WHEN $2 >= 400 THEN 1 ELSE 0 END ' +
    'WHERE event_id=$1',
    [eventId, httpStatus, safeCode],
  );
}

export function registerBillingMonitoringRoutes(app, requireTeacher, requireAdmin) {
  app.get('/api/admin/billing/operations', requireTeacher, requireAdmin, async (_req, res) => {
    const [stats, events, charges, anomalies] = await Promise.all([
      db.query([
        'SELECT COUNT(*)::INTEGER AS "uniqueEvents",',
        'COALESCE(SUM(attempts),0)::INTEGER AS "deliveryAttempts",',
        'COALESCE(SUM(failure_count),0)::INTEGER AS "failedAttempts",',
        'COUNT(*) FILTER (WHERE last_http_status >= 400)::INTEGER AS "currentlyFailed",',
        'COUNT(*) FILTER (WHERE attempts > 1)::INTEGER AS "retriedEvents",',
        'COUNT(*) FILTER (WHERE last_received_at >= NOW() - INTERVAL \'24 hours\')::INTEGER AS "seenLast24h",',
        'MAX(last_received_at) AS "lastWebhookAt"',
        'FROM asaas_webhook_attempts',
      ].join(' ')),
      db.query(
        'SELECT event_id AS "eventId", event_type AS "eventType", ' +
        'attempts,failure_count AS "failureCount",last_http_status AS "lastHttpStatus", ' +
        'last_error_code AS "lastErrorCode",last_received_at AS "lastReceivedAt" ' +
        'FROM asaas_webhook_attempts ORDER BY last_received_at DESC LIMIT 30',
      ),
      db.query(
        'SELECT c.id AS "chargeId",t.full_name AS "teacherName", ' +
        'c.status,to_char(c.due_date,\'YYYY-MM-DD\') AS "dueDate", ' +
        'c.created_at AS "createdAt",c.updated_at AS "updatedAt", ' +
        'CASE WHEN c.status=\'creating\' AND c.created_at < NOW() - INTERVAL \'15 minutes\' ' +
        'THEN \'creation_stuck\' ' +
        'WHEN c.status=\'pending\' AND c.due_date < CURRENT_DATE THEN \'overdue\' ' +
        'WHEN c.status=\'pending\' AND c.created_at < NOW() - INTERVAL \'48 hours\' ' +
        'THEN \'pending_48h\' ' +
        'WHEN c.status=\'review\' THEN \'manual_review\' ELSE NULL END AS reason ' +
        'FROM pix_charges c JOIN teachers t ON t.id=c.teacher_id ' +
        'WHERE (c.status=\'creating\' AND c.created_at < NOW() - INTERVAL \'15 minutes\') ' +
        'OR (c.status=\'pending\' AND ' +
        '(c.due_date < CURRENT_DATE OR c.created_at < NOW() - INTERVAL \'48 hours\')) ' +
        'OR c.status=\'review\' ' +
        'ORDER BY c.created_at ASC LIMIT 30',
      ),
      db.query(
        'SELECT event_id AS "eventId",event_type AS "eventType", ' +
        'provider_payment_id AS "providerPaymentId",resolution,created_at AS "createdAt" ' +
        "FROM asaas_webhook_events WHERE resolution IN ('mismatch','unmatched','review_status','ignored_status','manual_review','unpaid_charge') " +
        'ORDER BY created_at DESC LIMIT 30',
      ),
    ]);
    const summary = stats.rows[0];
    res.json({
      sandbox: true,
      monitoringScope: 'local_only',
      webhook: summary,
      recentAttempts: events.rows,
      chargesToReview: charges.rows,
      eventsToReview: anomalies.rows,
      warning: 'A ausência de eventos não confirma falha nem interrupção da fila do Asaas. Consulte também os Logs de Webhooks do provedor.',
    });
  });
}
