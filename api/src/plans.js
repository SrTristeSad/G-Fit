// Catalogo administrativo de planos. Nenhuma rota cria cobrancas ou confirma pagamentos.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';

const validId = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const planFields = 'id, name, description, price_cents AS "priceCents", ' +
  'billing_cycle AS "billingCycle", max_students AS "maxStudents", ' +
  'is_active AS "isActive", created_at AS "createdAt"';

function validatePlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const { name, description = '', priceCents, billingCycle, maxStudents } = input;
  if (typeof name !== 'string' || name.trim().length < 3 || name.trim().length > 80 ||
      typeof description !== 'string' || description.length > 300 ||
      !Number.isInteger(priceCents) || priceCents < 0 || priceCents > 10000000 ||
      !['monthly', 'yearly'].includes(billingCycle) ||
      !Number.isInteger(maxStudents) || maxStudents < 0 || maxStudents > 10000) return null;
  return { name: name.trim(), description: description.trim(), priceCents, billingCycle, maxStudents };
}

async function audit(client, actor, target, action, changes) {
  await client.query(
    'INSERT INTO admin_audit_logs (id, actor_id, target_teacher_id, action, changes) ' +
    'VALUES ($1,$2,$3,$4,$5::jsonb)',
    [randomUUID(), actor, target, action, JSON.stringify(changes)],
  );
}

export function registerPlanRoutes(app, requireTeacher, requireAdmin) {
  // A conta ve somente seu proprio plano. Precos aqui sao configuracao, nao uma fatura.
  app.get('/api/account/plan', requireTeacher, async (req, res) => {
    const result = await db.query(
      'SELECT p.' + planFields.split(', ').map(field => field.startsWith('id') ? field : field).join(', p.') +
      ' FROM teacher_plan_assignments a JOIN plans p ON p.id=a.plan_id WHERE a.teacher_id=$1',
      [req.teacher.id],
    );
    res.json({ plan: result.rows[0] ?? null, assignment: result.rows.length ? 'manual' : null, billingConnected: false });
  });

  app.get('/api/admin/plans', requireTeacher, requireAdmin, async (_req, res) => {
    const result = await db.query(
      'SELECT p.id, p.name, p.description, p.price_cents AS "priceCents", ' +
      'p.billing_cycle AS "billingCycle", p.max_students AS "maxStudents", ' +
      'p.is_active AS "isActive", p.created_at AS "createdAt", ' +
      'COUNT(a.teacher_id)::INTEGER AS "assignedTeachers" ' +
      'FROM plans p LEFT JOIN teacher_plan_assignments a ON a.plan_id=p.id ' +
      'GROUP BY p.id ORDER BY p.created_at DESC, p.name',
    );
    res.json({ plans: result.rows, billingConnected: false });
  });

  app.post('/api/admin/plans', requireTeacher, requireAdmin, async (req, res) => {
    const value = validatePlan(req.body);
    if (!value) return res.status(400).json({ error: 'Revise nome, descrição, preço, periodicidade e limite do plano.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'INSERT INTO plans (id,name,description,price_cents,billing_cycle,max_students) ' +
        'VALUES ($1,$2,$3,$4,$5,$6) RETURNING ' + planFields,
        [randomUUID(), value.name, value.description, value.priceCents, value.billingCycle, value.maxStudents],
      );
      await audit(client, req.teacher.id, null, 'plan.created', { planId: result.rows[0].id, ...value });
      await client.query('COMMIT');
      res.status(201).json({ plan: result.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'Já existe um plano com esse nome.' });
      throw error;
    } finally { client.release(); }
  });

  // Planos publicados preservam definicoes de preco/cota. Para alteracoes comerciais, crie novo plano.
  app.patch('/api/admin/plans/:id', requireTeacher, requireAdmin, async (req, res) => {
    if (!validId(req.params.id) || typeof req.body?.isActive !== 'boolean') {
      return res.status(400).json({ error: 'Informe um plano e situação válidos.' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT is_active FROM plans WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!current.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Plano não encontrado.' });
      }
      const updated = await client.query(
        'UPDATE plans SET is_active=$2 WHERE id=$1 RETURNING ' + planFields,
        [req.params.id, req.body.isActive],
      );
      if (current.rows[0].is_active !== req.body.isActive) {
        await audit(client, req.teacher.id, null, 'plan.status.updated', {
          planId: req.params.id, before: current.rows[0].is_active, after: req.body.isActive,
        });
      }
      await client.query('COMMIT');
      res.json({ plan: updated.rows[0] });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });

  // Atribuicao manual nao significa pagamento nem assinatura confirmada.
  app.put('/api/admin/teachers/:id/plan', requireTeacher, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const planId = req.body?.planId;
    if (!validId(id) || !validId(planId)) {
      return res.status(400).json({ error: 'Identificador do professor ou plano inválido.' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const teacher = await client.query(
        'SELECT id,is_admin,max_students FROM teachers WHERE id=$1 FOR UPDATE', [id],
      );
      if (!teacher.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Professor não encontrado.' });
      }
      if (teacher.rows[0].is_admin) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Planos comerciais são destinados a professores, não a administradores.' });
      }
      const plan = await client.query('SELECT id,max_students,is_active FROM plans WHERE id=$1 FOR SHARE', [planId]);
      if (!plan.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Plano não encontrado.' });
      }
      if (!plan.rows[0].is_active) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Plano desativado: não é possível atribuí-lo a novas contas.' });
      }
      const existing = await client.query(
        'SELECT plan_id FROM teacher_plan_assignments WHERE teacher_id=$1', [id],
      );
      if (existing.rows[0]?.plan_id === planId) {
        await client.query('COMMIT');
        return res.json({ planId, maxStudents: teacher.rows[0].max_students, unchanged: true, assignment: 'manual' });
      }
      await client.query(
        'INSERT INTO teacher_plan_assignments (teacher_id,plan_id,assigned_by) VALUES ($1,$2,$3) ' +
        'ON CONFLICT (teacher_id) DO UPDATE SET plan_id=EXCLUDED.plan_id, assigned_by=EXCLUDED.assigned_by, assigned_at=NOW()',
        [id, planId, req.teacher.id],
      );
      await client.query('UPDATE teachers SET max_students=$2 WHERE id=$1', [id, plan.rows[0].max_students]);
      await audit(client, req.teacher.id, id, 'teacher.plan.assigned', {
        previousPlanId: existing.rows[0]?.plan_id ?? null,
        planId, previousMaxStudents: teacher.rows[0].max_students,
        maxStudents: plan.rows[0].max_students, assignment: 'manual',
      });
      await client.query('COMMIT');
      res.json({ planId, maxStudents: plan.rows[0].max_students, assignment: 'manual', unchanged: false });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });

  app.delete('/api/admin/teachers/:id/plan', requireTeacher, requireAdmin, async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const teacher = await client.query(
        'SELECT id,max_students FROM teachers WHERE id=$1 FOR UPDATE', [req.params.id],
      );
      if (!teacher.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Professor não encontrado.' });
      }
      const old = await client.query(
        'DELETE FROM teacher_plan_assignments WHERE teacher_id=$1 RETURNING plan_id',
        [req.params.id],
      );
      if (!old.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'O professor não tem plano atribuído.' });
      }
      await audit(client, req.teacher.id, req.params.id, 'teacher.plan.removed', {
        previousPlanId: old.rows[0].plan_id,
        retainedMaxStudents: teacher.rows[0].max_students,
      });
      await client.query('COMMIT');
      res.json({ ok: true, maxStudents: teacher.rows[0].max_students });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
}
