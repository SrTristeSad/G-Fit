// Cobranças Pix via Asaas SANDBOX. Nenhum navegador pode marcar pagamentos como recebidos.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { registerBillingLifecycleRoutes, handleLifecycleEvent } from './billing-lifecycle.js';
import { registerBillingMonitoringRoutes, recordWebhookAttempt, recordWebhookOutcome } from './billing-monitor.js';
import {
  asaasConfigured, validCustomerId, validPaymentId, validBillDate,
  validWebhookToken, createAsaasCharge, getAsaasPayment, getAsaasPixQr,
  matchesPaidCharge, findAsaasPaymentsByReference,
} from './asaas.js';

const uuid = x => typeof x === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const chargeSelect =
  'c.id, c.teacher_id AS "teacherId", t.full_name AS "teacherName", ' +
  'p.name AS "planName", c.plan_id AS "planId", c.amount_cents AS "amountCents", ' +
  'c.billing_cycle AS "billingCycle", to_char(c.due_date, \'YYYY-MM-DD\') AS "dueDate", ' +
  'c.status, c.provider_payment_id AS "providerPaymentId", c.created_at AS "createdAt", ' +
  'c.paid_at AS "paidAt", c.cancelled_at AS "cancelledAt", ' +
  'c.refund_state AS "refundState", c.refunded_cents AS "refundedCents", ' +
  '(c.status=\'pending\' AND c.due_date<CURRENT_DATE) AS overdue ';

async function listCharges(where, args = []) {
  const result = await db.query(
    'SELECT ' + chargeSelect + ' FROM pix_charges c ' +
    'JOIN teachers t ON t.id=c.teacher_id JOIN plans p ON p.id=c.plan_id ' +
    where + ' ORDER BY c.created_at DESC LIMIT 100', args,
  );
  return result.rows;
}

function providerUnavailable(res) {
  return res.status(503).json({
    error: 'Pix indisponível: configure a chave e o token de webhook do Asaas Sandbox no servidor.',
    sandbox: true,
  });
}

async function settleVerifiedPayment(eventId, eventType, remote) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      'INSERT INTO asaas_webhook_events (event_id,event_type,provider_payment_id,resolution) ' +
      "VALUES ($1,$2,$3,'processing') ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
      [eventId, eventType, remote.id],
    );
    if (!inserted.rows.length) {
      await client.query('COMMIT');
      return { duplicate: true };
    }

    const record = await client.query(
      'SELECT c.* FROM pix_charges c WHERE c.id=$1 FOR UPDATE',
      [remote.externalReference && uuid(remote.externalReference) ? remote.externalReference : '00000000-0000-0000-0000-000000000000'],
    );
    if (!record.rows.length) {
      await client.query(
        "UPDATE asaas_webhook_events SET resolution='unmatched' WHERE event_id=$1", [eventId],
      );
      await client.query('COMMIT');
      return { matched: false };
    }
    const charge = record.rows[0];
    if (!matchesPaidCharge(remote, charge)) {
      await client.query(
        "UPDATE asaas_webhook_events SET resolution='mismatch' WHERE event_id=$1", [eventId],
      );
      await client.query('COMMIT');
      return { matched: false, review: true };
    }
    if (charge.status === 'paid') {
      await client.query(
        "UPDATE asaas_webhook_events SET resolution='already_paid' WHERE event_id=$1", [eventId],
      );
      await client.query('COMMIT');
      return { matched: true, duplicatePayment: true };
    }
    if (!['pending', 'creating'].includes(charge.status)) {
      await client.query(
        "UPDATE asaas_webhook_events SET resolution='ignored_status' WHERE event_id=$1", [eventId],
      );
      await client.query('COMMIT');
      return { matched: true, settled: false };
    }

    // Serializa o professor antes de verificar plano e renovar acesso.
    const teacher = await client.query(
      'SELECT id FROM teachers WHERE id=$1 FOR UPDATE', [charge.teacher_id],
    );
    if (!teacher.rows.length) throw new Error('CHARGE_TEACHER_MISSING');

    await client.query(
      "UPDATE pix_charges SET status='paid', provider_payment_id=$2, paid_at=NOW(), updated_at=NOW() WHERE id=$1",
      [charge.id, remote.id],
    );

    const assignment = await client.query(
      'SELECT plan_id FROM teacher_plan_assignments WHERE teacher_id=$1',
      [charge.teacher_id],
    );
    let access = 'manual_review';
    if (assignment.rows[0]?.plan_id === charge.plan_id) {
      const term = await client.query(
        'SELECT revoked_at, starts_on, ends_on FROM teacher_access_terms WHERE teacher_id=$1 FOR UPDATE',
        [charge.teacher_id],
      );
      if (!term.rows[0]?.revoked_at) {
        const months = charge.billing_cycle === 'yearly' ? 12 : 1;
        let updated;
        if (!term.rows.length) {
          updated = await client.query(
            'INSERT INTO teacher_access_terms (teacher_id,starts_on,ends_on,updated_by) ' +
            "VALUES ($1,CURRENT_DATE,(CURRENT_DATE + make_interval(months=>$2) - INTERVAL '1 day')::DATE,$3) " +
            'RETURNING ends_on',
            [charge.teacher_id, months, charge.created_by],
          );
        } else {
          updated = await client.query(
            'UPDATE teacher_access_terms SET ' +
            'starts_on=CASE WHEN ends_on < CURRENT_DATE THEN CURRENT_DATE ELSE starts_on END, ' +
            "ends_on=(GREATEST(ends_on + 1,CURRENT_DATE) + make_interval(months=>$2) - INTERVAL '1 day')::DATE, " +
            'updated_by=$3,updated_at=NOW() WHERE teacher_id=$1 ' +
            "AND (GREATEST(ends_on + 1,CURRENT_DATE) + make_interval(months=>$2) - INTERVAL '1 day')::DATE " +
            '<= CURRENT_DATE + 732 RETURNING ends_on',
            [charge.teacher_id, months, charge.created_by],
          );
        }
        access = updated.rows.length ? 'extended' : 'manual_review';
      }
    }
    await client.query(
      "UPDATE asaas_webhook_events SET resolution=$2 WHERE event_id=$1",
      [eventId, access],
    );
    await client.query(
      'INSERT INTO admin_audit_logs (id,actor_id,target_teacher_id,action,changes) ' +
      'VALUES ($1,$2,$3,$4,$5::jsonb)',
      [randomUUID(), charge.created_by, charge.teacher_id, 'billing.pix.verified', JSON.stringify({
        chargeId: charge.id, providerPaymentId: remote.id, amountCents: charge.amount_cents,
        access, source: 'asaas_sandbox_verified',
      })],
    );
    await client.query('COMMIT');
    return { matched: true, settled: true, access };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function processEvent(eventId, eventType, providerPaymentId) {
  // Nunca usar apenas o valor e o status enviados no webhook.
  const remote = await getAsaasPayment(providerPaymentId);
  if (remote.id !== providerPaymentId || !['RECEIVED', 'CONFIRMED'].includes(remote.status)) {
    const error = new Error('PAYMENT_NOT_CONFIRMED_BY_PROVIDER');
    error.status = 503;
    throw error;
  }
  return settleVerifiedPayment(eventId, eventType, remote);
}

export function registerBillingRoutes(app, requireTeacher, requireAdmin, rateLimit) {
  // As rotas administrativas compartilham o limitador; o bloqueio de cobranças duplicadas continua no banco.
  const limited = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });
  registerBillingLifecycleRoutes(app, requireTeacher, requireAdmin, limited);
  registerBillingMonitoringRoutes(app, requireTeacher, requireAdmin);

  app.get('/api/admin/billing', requireTeacher, requireAdmin, async (_req, res) => {
    const [charges, customers, metrics] = await Promise.all([
      listCharges(''),
      db.query('SELECT teacher_id AS "teacherId", customer_id AS "customerId" FROM asaas_customers'),
      db.query([
        'SELECT',
        'COUNT(*) FILTER (WHERE status=\'pending\')::INTEGER AS "pendingCount",',
        'COUNT(*) FILTER (WHERE status=\'pending\' AND due_date<CURRENT_DATE)::INTEGER AS "overdueCount",',
        'COUNT(*) FILTER (WHERE status=\'creating\')::INTEGER AS "reconciliationCount",',
        'COUNT(*) FILTER (WHERE status=\'paid\')::INTEGER AS "paidCount",',
        'COUNT(*) FILTER (WHERE status=\'cancelled\')::INTEGER AS "cancelledCount",',
        'COUNT(*) FILTER (WHERE refund_state<>\'none\')::INTEGER AS "refundReviewCount",',
        'COALESCE(SUM(amount_cents) FILTER (WHERE status=\'paid\'),0)::BIGINT AS "grossPaidCents",',
        'COALESCE(SUM(refunded_cents),0)::BIGINT AS "confirmedRefundedCents"',
        'FROM pix_charges',
      ].join(' ')),
    ]);
    res.json({
      sandbox: true, configured: asaasConfigured(),
      charges, customers: customers.rows, summary: metrics.rows[0],
    });
  });

  app.get('/api/account/charges', requireTeacher, async (req, res) => {
    const charges = await listCharges('WHERE c.teacher_id=$1', [req.teacher.id]);
    res.json({ sandbox: true, charges });
  });

  app.put('/api/admin/teachers/:id/asaas-customer', requireTeacher, requireAdmin, limited, async (req, res) => {
    const teacherId = req.params.id;
    const customerId = req.body?.customerId;
    if (!uuid(teacherId) || !validCustomerId(customerId)) {
      return res.status(400).json({ error: 'Informe um ID válido de professor e cliente Asaas (cus_...).' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const teacher = await client.query('SELECT id,is_admin FROM teachers WHERE id=$1 FOR UPDATE', [teacherId]);
      if (!teacher.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Professor não encontrado.' }); }
      if (teacher.rows[0].is_admin) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Conta administrativa não pode ser pagadora.' });
      }
      await client.query(
        'INSERT INTO asaas_customers (teacher_id,customer_id,updated_by) VALUES ($1,$2,$3) ' +
        'ON CONFLICT (teacher_id) DO UPDATE SET customer_id=EXCLUDED.customer_id,updated_by=EXCLUDED.updated_by,updated_at=NOW()',
        [teacherId, customerId, req.teacher.id],
      );
      await client.query(
        'INSERT INTO admin_audit_logs (id,actor_id,target_teacher_id,action,changes) VALUES ($1,$2,$3,$4,$5::jsonb)',
        [randomUUID(), req.teacher.id, teacherId, 'billing.customer.configured', JSON.stringify({ customerId })],
      );
      await client.query('COMMIT');
      res.json({ teacherId, customerId, sandbox: true });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });

  const issuePixCharge = async (req, res) => {
    if (!asaasConfigured()) return providerUnavailable(res);
    const { id } = req.params;
    const { dueDate } = req.body ?? {};
    const today = new Date().toISOString().slice(0, 10);
    const max = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    if (!uuid(id) || !validBillDate(dueDate) || dueDate < today || dueDate > max) {
      return res.status(400).json({ error: 'Vencimento inválido: escolha entre hoje e os próximos 30 dias.' });
    }
    const client = await db.connect();
    const chargeId = randomUUID();
    let charge;
    try {
      await client.query('BEGIN');
      const row = await client.query(
        'SELECT t.id,t.is_admin,t.is_active, a.plan_id, p.price_cents,p.billing_cycle,p.is_active AS plan_active, ' +
        'c.customer_id, term.revoked_at AS term_revoked_at ' +
        'FROM teachers t LEFT JOIN teacher_plan_assignments a ON a.teacher_id=t.id ' +
        'LEFT JOIN plans p ON p.id=a.plan_id LEFT JOIN asaas_customers c ON c.teacher_id=t.id ' +
        'LEFT JOIN teacher_access_terms term ON term.teacher_id=t.id ' +
        'WHERE t.id=$1 FOR UPDATE OF t', [id],
      );
      const v = row.rows[0];
      if (!v || v.is_admin || !v.is_active) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Professor ativo não encontrado.' });
      }
      if (v.term_revoked_at) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'O prazo de acesso foi revogado. A administração deve autorizar novamente antes de emitir cobrança.',
        });
      }
      if (!v.plan_id || !v.plan_active || !v.price_cents || !v.customer_id) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Vincule um plano pago ativo e um cliente Asaas ao professor.' });
      }
      const existing = await client.query(
        "SELECT id,status FROM pix_charges WHERE teacher_id=$1 AND status IN ('creating','pending') ORDER BY created_at DESC LIMIT 1",
        [id],
      );
      if (existing.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Já existe uma cobrança aberta ou em conciliação. Não crie outra até resolver a anterior.',
          chargeId: existing.rows[0].id,
        });
      }
      charge = {
        id: chargeId, teacherId: id, planId: v.plan_id,
        priceCents: v.price_cents, billingCycle: v.billing_cycle, customerId: v.customer_id,
      };
      await client.query(
        'INSERT INTO pix_charges (id,teacher_id,plan_id,created_by,asaas_customer_id,amount_cents,billing_cycle,due_date) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [chargeId, id, charge.planId, req.teacher.id, charge.customerId, charge.priceCents, charge.billingCycle, dueDate],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'Cobrança aberta já existente.' });
      throw error;
    } finally { client.release(); }

    try {
      const created = await createAsaasCharge({
        customerId: charge.customerId, chargeId,
        priceCents: charge.priceCents, dueDate,
      });
      if (!validPaymentId(created.id) || created.externalReference !== chargeId) throw new Error('INVALID_ASAAS_RESPONSE');
      const update = await db.query(
        "UPDATE pix_charges SET provider_payment_id=$2,status='pending',updated_at=NOW() " +
        "WHERE id=$1 AND status='creating' RETURNING status",
        [chargeId, created.id],
      );
      const status = update.rows[0]?.status || (await db.query(
        'SELECT status FROM pix_charges WHERE id=$1', [chargeId],
      )).rows[0]?.status || 'creating';
      res.status(201).json({ chargeId, providerPaymentId: created.id, status, sandbox: true });
    } catch (_error) {
      // Uma resposta perdida nao garante que a cobranca nao foi criada.
      // O registro permanece "creating" para conciliacao manual, evitando cobranca duplicada.
      res.status(502).json({
        error: 'Não foi possível confirmar a criação da cobrança no Asaas. ' +
          'A cobrança permanece em conciliação; não repita a operação.',
        chargeId, status: 'creating', sandbox: true,
      });
    }
  };
  app.post('/api/admin/teachers/:id/pix-charge', requireTeacher, requireAdmin, limited, issuePixCharge);
  app.post('/api/account/pix-charge', requireTeacher, limited, (req, res) => {
    if (req.teacher.is_admin) {
      return res.status(403).json({ error: 'Administradores não podem solicitar cobrança de professor.' });
    }
    req.params.id = req.teacher.id;
    req.body = { dueDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) };
    return issuePixCharge(req, res);
  });

  app.get('/api/billing/charges/:id/pix', requireTeacher, limited, async (req, res) => {
    if (!asaasConfigured()) return providerUnavailable(res);
    if (!uuid(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
    const charges = await db.query(
      'SELECT id,teacher_id,status,provider_payment_id FROM pix_charges WHERE id=$1', [req.params.id],
    );
    const charge = charges.rows[0];
    if (!charge || (!req.teacher.is_admin && charge.teacher_id !== req.teacher.id)) {
      return res.status(404).json({ error: 'Cobrança não encontrada.' });
    }
    if (!charge.provider_payment_id || !['pending','paid'].includes(charge.status)) {
      return res.status(409).json({ error: 'QR Code indisponível para esta cobrança.' });
    }
    try {
      const qr = await getAsaasPixQr(charge.provider_payment_id);
      if (typeof qr.payload !== 'string' || qr.payload.length > 2000 ||
          typeof qr.encodedImage !== 'string' || qr.encodedImage.length > 300000 ||
          !/^[A-Za-z0-9+/=]+$/.test(qr.encodedImage)) throw new Error('INVALID_QR');
      res.json({
        chargeId: charge.id, status: charge.status, sandbox: true,
        payload: qr.payload, imageBase64: qr.encodedImage, expirationDate: qr.expirationDate || null,
      });
    } catch (_error) {
      res.status(502).json({ error: 'Não foi possível consultar o QR Code no Asaas Sandbox.' });
    }
  });

  app.post('/api/webhooks/asaas', async (req, res) => {
    if (!asaasConfigured()) return providerUnavailable(res);
    if (!validWebhookToken(req.get('asaas-access-token'))) {
      return res.status(401).json({ error: 'Webhook não autorizado.' });
    }
    const event = req.body;
    if (!event || typeof event.id !== 'string' || event.id.length < 4 || event.id.length > 180 ||
        /[\u0000-\u001f]/.test(event.id) ||
        typeof event.event !== 'string' || !event.event.length || event.event.length > 90) {
      return res.status(400).json({ error: 'Evento inválido.' });
    }
    const providerId = event.payment?.id;
    try {
      await recordWebhookAttempt({
        id: event.id,
        event: event.event,
        payment: { id: validPaymentId(providerId) ? providerId : null },
      });
    } catch (_error) {
      // Falha no diagnóstico nunca permite confirmar eventos sem persistência.
      return res.status(503).json({ error: 'Não foi possível registrar a tentativa de webhook.' });
    }

    let httpStatus = 200;
    let response = null;
    let errorCode = null;
    try {
      if ([
        'PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED',
        'PAYMENT_REFUND_IN_PROGRESS', 'PAYMENT_REFUND_DENIED',
      ].includes(event.event)) {
        if (!validPaymentId(providerId)) {
          httpStatus = 400;
          response = { error: 'Pagamento inválido.' };
        } else {
          const result = await handleLifecycleEvent(event.id, event.event, providerId);
          response = { received: true, ...result };
        }
      } else if (['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(event.event)) {
        if (!validPaymentId(providerId)) {
          httpStatus = 400;
          response = { error: 'Pagamento inválido.' };
        } else {
          const result = await processEvent(event.id, event.event, providerId);
          response = { received: true, ...result };
        }
      } else {
        await db.query(
          'INSERT INTO asaas_webhook_events (event_id,event_type,provider_payment_id,resolution) ' +
          "VALUES ($1,$2,$3,'ignored') ON CONFLICT (event_id) DO NOTHING",
          [event.id, event.event, validPaymentId(providerId) ? providerId : null],
        );
        response = { received: true, ignored: true };
      }
    } catch (_error) {
      // Asaas considera somente HTTP 200 como entregue; falhas podem ser reenviadas.
      httpStatus = 503;
      errorCode = 'DB_PROCESSING_FAILED';
      response = { error: 'Conciliação indisponível; evento pode ser reenviado.' };
    }
    try {
      await recordWebhookOutcome(event.id, httpStatus, errorCode);
    } catch (_error) {
      return res.status(503).json({ error: 'Falha no registro do resultado; tente entregar novamente.' });
    }
    return res.status(httpStatus).json(response);
  });

  // Recupera uma criacao inconclusiva sem jamais criar outra cobranca.
  app.post('/api/admin/billing/charges/:id/recover', requireTeacher, requireAdmin, limited, async (req, res) => {
    if (!asaasConfigured()) return providerUnavailable(res);
    if (!uuid(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
    const result = await db.query('SELECT * FROM pix_charges WHERE id=$1', [req.params.id]);
    const charge = result.rows[0];
    if (!charge) return res.status(404).json({ error: 'Cobrança não encontrada.' });
    if (charge.provider_payment_id) {
      return res.status(409).json({ error: 'Cobrança já possui ID Asaas. Utilize Conferir no Asaas.' });
    }
    if (charge.status !== 'creating') {
      return res.status(409).json({ error: 'Somente cobranças em conciliação podem ser recuperadas.' });
    }
    try {
      const list = await findAsaasPaymentsByReference(charge.id);
      if (!Array.isArray(list.data) || list.hasMore || list.data.length !== 1) {
        return res.status(409).json({
          error: 'Consulta inconclusiva no Asaas. A cobrança permanece bloqueada para evitar duplicidade.',
          matches: Array.isArray(list.data) ? list.data.length : null,
        });
      }
      const remoteId = list.data[0]?.id;
      if (!validPaymentId(remoteId)) throw new Error('INVALID_PAYMENT_ID');
      const remote = await getAsaasPayment(remoteId);
      if (remote.id !== remoteId || remote.externalReference !== charge.id ||
          remote.customer !== charge.asaas_customer_id || remote.billingType !== 'PIX' ||
          Math.round(Number(remote.value) * 100) !== charge.amount_cents) {
        return res.status(409).json({ error: 'Cobrança remota não corresponde ao registro local. Revisão necessária.' });
      }
      const update = await db.query(
        "UPDATE pix_charges SET provider_payment_id=$2,status='pending',updated_at=NOW() " +
        "WHERE id=$1 AND status='creating' AND provider_payment_id IS NULL RETURNING id",
        [charge.id, remote.id],
      );
      if (!update.rows.length) return res.status(409).json({ error: 'Cobrança já atualizada. Recarregue o painel.' });
      if (['RECEIVED','CONFIRMED'].includes(remote.status)) {
        const outcome = await settleVerifiedPayment('recover_' + charge.id, 'ADMIN_RECOVERY', remote);
        return res.json({ chargeId: charge.id, status: 'paid', outcome, sandbox: true });
      }
      res.json({ chargeId: charge.id, status: 'pending', providerPaymentId: remote.id, sandbox: true });
    } catch (_error) {
      res.status(502).json({ error: 'Falha ao reconciliar com o Asaas. A cobrança não foi duplicada.' });
    }
  });

  // Conciliação manual de cobranças conhecidas, sem receber IDs arbitrários do navegador.
  app.post('/api/admin/billing/charges/:id/check', requireTeacher, requireAdmin, limited, async (req, res) => {
    if (!asaasConfigured()) return providerUnavailable(res);
    if (!uuid(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
    const rows = await db.query('SELECT id,status,provider_payment_id FROM pix_charges WHERE id=$1', [req.params.id]);
    const charge = rows.rows[0];
    if (!charge) return res.status(404).json({ error: 'Cobrança não encontrada.' });
    if (!charge.provider_payment_id) {
      return res.status(409).json({ error: 'Cobrança sem ID do provedor. Concilie manualmente no Asaas usando o ID G-Fit.' });
    }
    if (charge.status === 'paid') return res.json({ paid: true, alreadyPaid: true });
    try {
      const remote = await getAsaasPayment(charge.provider_payment_id);
      if (!['RECEIVED','CONFIRMED'].includes(remote.status)) return res.json({ paid: false, providerStatus: remote.status });
      const outcome = await settleVerifiedPayment('check_' + charge.id, 'ADMIN_RECONCILIATION', remote);
      res.json({ paid: !!outcome.settled || !!outcome.duplicatePayment, ...outcome });
    } catch (_error) {
      res.status(502).json({ error: 'Não foi possível conferir a cobrança no Asaas.' });
    }
  });
}
