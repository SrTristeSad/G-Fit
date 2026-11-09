// Prazo opcional de acesso concedido pela administracao.
// NAO e um recibo, assinatura paga, fatura ou confirmacao Pix.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';

const validId = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function validAccessDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      value < '2000-01-01' || value > '2100-12-31') return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validAccessWindow(start, end) {
  if (!validAccessDate(start) || !validAccessDate(end) || end < start) return false;
  const span = (Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000;
  return span <= 732;
}

const selectAccess = [
  'SELECT to_char(starts_on, \'YYYY-MM-DD\') AS "startsOn",',
  'to_char(ends_on, \'YYYY-MM-DD\') AS "endsOn",',
  'revoked_at AS "revokedAt", updated_at AS "updatedAt",',
  'CASE WHEN revoked_at IS NOT NULL THEN \'revoked\'',
  'WHEN starts_on > CURRENT_DATE THEN \'scheduled\'',
  'WHEN ends_on < CURRENT_DATE THEN \'expired\'',
  'ELSE \'active\' END AS status',
  'FROM teacher_access_terms WHERE teacher_id=$1',
].join(' ');

async function readAccess(connection, teacherId) {
  const result = await connection.query(selectAccess, [teacherId]);
  return result.rows[0] ?? null;
}

export async function requireAccessForNewActivity(req, res, next) {
  try {
    if (req.teacher.is_admin) return next();
    const access = await readAccess(db, req.teacher.id);
    if (!access || access.status === 'active') return next();
    return res.status(403).json({
      error: 'O prazo de acesso da conta não está ativo. Consulte a administração.',
      accessStatus: access.status,
    });
  } catch (error) { next(error); }
}

async function audit(client, actor, target, action, changes) {
  await client.query(
    'INSERT INTO admin_audit_logs (id, actor_id, target_teacher_id, action, changes) VALUES ($1,$2,$3,$4,$5::jsonb)',
    [randomUUID(), actor, target, action, JSON.stringify(changes)],
  );
}

function serializeAccess(access) {
  return access ?? { startsOn: null, endsOn: null, revokedAt: null, status: 'legacy' };
}

export function registerAccessRoutes(app, requireTeacher, requireAdmin) {
  app.get('/api/account/access', requireTeacher, async (req, res) => {
    const access = await readAccess(db, req.teacher.id);
    res.json({ access: serializeAccess(access), source: 'admin_manual', billingConnected: false });
  });

  app.get('/api/admin/access', requireTeacher, requireAdmin, async (_req, res) => {
    const result = await db.query(
      'SELECT teacher_id AS "teacherId", to_char(starts_on, \'YYYY-MM-DD\') AS "startsOn", ' +
      'to_char(ends_on, \'YYYY-MM-DD\') AS "endsOn", revoked_at AS "revokedAt", ' +
      'CASE WHEN revoked_at IS NOT NULL THEN \'revoked\' WHEN starts_on > CURRENT_DATE THEN \'scheduled\' ' +
      'WHEN ends_on < CURRENT_DATE THEN \'expired\' ELSE \'active\' END AS status ' +
      'FROM teacher_access_terms ORDER BY ends_on ASC',
    );
    res.json({ accessTerms: result.rows, billingConnected: false });
  });

  app.put('/api/admin/teachers/:id/access', requireTeacher, requireAdmin, async (req, res) => {
    if (!validId(req.params.id) || !validAccessWindow(req.body?.startsOn, req.body?.endsOn)) {
      return res.status(400).json({ error: 'Informe datas válidas e um período máximo de 733 dias corridos.' });
    }
    const { startsOn, endsOn } = req.body;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const account = await client.query(
        'SELECT id,is_admin FROM teachers WHERE id=$1 FOR UPDATE', [req.params.id],
      );
      if (!account.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Professor não encontrado.' });
      }
      if (account.rows[0].is_admin) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Acesso temporário não se aplica a administradores.' });
      }
      const plan = await client.query(
        'SELECT plan_id FROM teacher_plan_assignments WHERE teacher_id=$1', [req.params.id],
      );
      if (!plan.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Atribua um plano ao professor antes de definir sua vigência.' });
      }
      const previous = await readAccess(client, req.params.id);
      await client.query(
        'INSERT INTO teacher_access_terms (teacher_id,starts_on,ends_on,updated_by,revoked_at) ' +
        'VALUES ($1,$2,$3,$4,NULL) ON CONFLICT (teacher_id) DO UPDATE SET ' +
        'starts_on=EXCLUDED.starts_on,ends_on=EXCLUDED.ends_on,updated_by=EXCLUDED.updated_by,revoked_at=NULL,updated_at=NOW()',
        [req.params.id, startsOn, endsOn, req.teacher.id],
      );
      const current = await readAccess(client, req.params.id);
      if (!previous || previous.startsOn !== current.startsOn ||
          previous.endsOn !== current.endsOn || previous.revokedAt) {
        await audit(client, req.teacher.id, req.params.id, 'teacher.access.granted', {
          before: previous, after: current, source: 'admin_manual',
        });
      }
      await client.query('COMMIT');
      res.json({ access: current, billingConnected: false });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });

  // Renovacao MANUAL: prorrogacao do prazo nao atesta pagamento.
  app.post('/api/admin/teachers/:id/access/renew', requireTeacher, requireAdmin, async (req, res) => {
    if (!validId(req.params.id) || !Number.isInteger(req.body?.months) ||
        req.body.months < 1 || req.body.months > 12) {
      return res.status(400).json({ error: 'Informe de 1 a 12 meses de renovação manual.' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const teacher = await client.query(
        'SELECT id FROM teachers WHERE id=$1 FOR UPDATE', [req.params.id],
      );
      if (!teacher.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Professor não encontrado.' });
      }
      const current = await readAccess(client, req.params.id);
      if (!current) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Defina primeiro a vigência inicial do professor.' });
      }
      if (current.revokedAt) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Acesso revogado: conceda nova vigência antes de renovar.' });
      }
      // Prorroga a partir do fim vigente, ou de hoje quando ja expirou.
      const updated = await client.query(
        'UPDATE teacher_access_terms SET ends_on = ' +
        '(GREATEST(ends_on,CURRENT_DATE) + make_interval(months => $2))::DATE, ' +
        'updated_by=$3, updated_at=NOW() WHERE teacher_id=$1 ' +
        'AND (GREATEST(ends_on,CURRENT_DATE) + make_interval(months => $2))::DATE <= ' +
        'GREATEST(starts_on,CURRENT_DATE) + 732 ' +
        'RETURNING teacher_id',
        [req.params.id, req.body.months, req.teacher.id],
      );
      if (!updated.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'O prazo resultante ultrapassaria o máximo permitido.' });
      }
      const after = await readAccess(client, req.params.id);
      await audit(client, req.teacher.id, req.params.id, 'teacher.access.renewed', {
        before: current, after, months: req.body.months, source: 'admin_manual',
      });
      await client.query('COMMIT');
      res.json({ access: after, billingConnected: false });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });

  app.post('/api/admin/teachers/:id/access/revoke', requireTeacher, requireAdmin, async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const teacher = await client.query('SELECT id FROM teachers WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!teacher.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Professor não encontrado.' });
      }
      const previous = await readAccess(client, req.params.id);
      if (!previous) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'A conta não possui vigência configurada.' });
      }
      if (!previous.revokedAt) {
        await client.query(
          'UPDATE teacher_access_terms SET revoked_at=NOW(),updated_by=$2,updated_at=NOW() WHERE teacher_id=$1',
          [req.params.id, req.teacher.id],
        );
        await audit(client, req.teacher.id, req.params.id, 'teacher.access.revoked', {
          before: previous, source: 'admin_manual',
        });
      }
      const current = await readAccess(client, req.params.id);
      await client.query('COMMIT');
      res.json({ access: current, billingConnected: false });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
}
