// Reconciliação de ciclo de vida de cobranças Pix apenas no Asaas Sandbox.
// Excluir uma cobrança NÃO é estornar. Estornos são observados e sinalizados para análise.
// A vigência do professor nunca é reduzida automaticamente por esta camada.
import { randomUUID, createHash } from 'node:crypto';
import { db } from './db.js';
import {
  asaasConfigured, validPaymentId, getAsaasPayment, deleteAsaasPayment,
  matchesChargeIdentity, isDeletedPayment, summarizeRefunds,
} from './asaas.js';

const validId = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function audit(client, charge, action, details, actorId) {
  await client.query(
    'INSERT INTO admin_audit_logs (id,actor_id,target_teacher_id,action,changes) ' +
    'VALUES ($1,$2,$3,$4,$5::jsonb)',
    [randomUUID(), actorId || charge.created_by, charge.teacher_id, action,
      JSON.stringify({ chargeId: charge.id, providerPaymentId: charge.provider_payment_id,
        source: 'asaas_sandbox_verified', ...details })],
  );
}

async function updateCancelledCharge(remote, { eventId, eventType, actorId } = {}) {
  if (!validId(remote?.externalReference) || !isDeletedPayment(remote)) {
    throw new Error('REMOTE_NOT_CONFIRMED_DELETED');
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (eventId) {
      const inserted = await client.query(
        "INSERT INTO asaas_webhook_events (event_id,event_type,provider_payment_id,resolution) " +
        "VALUES ($1,$2,$3,'processing') ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
        [eventId, eventType, remote.id],
      );
      if (!inserted.rows.length) {
        await client.query('COMMIT');
        return { duplicate: true };
      }
    }
    const result = await client.query(
      'SELECT * FROM pix_charges WHERE id=$1 FOR UPDATE', [remote.externalReference],
    );
    const charge = result.rows[0];
    let resolution = 'unmatched';
    let cancelled = false;
    if (charge && matchesChargeIdentity(remote, charge)) {
      if (['pending', 'creating'].includes(charge.status)) {
        await client.query(
          "UPDATE pix_charges SET status='cancelled',cancelled_at=NOW(),updated_at=NOW() WHERE id=$1",
          [charge.id],
        );
        await audit(client, charge, 'billing.pix.cancelled',
          { previousStatus: charge.status }, actorId);
        resolution = 'cancelled';
        cancelled = true;
      } else if (charge.status === 'cancelled') {
        resolution = 'already_cancelled';
        cancelled = true;
      } else {
        // Não reverte pagamento já registrado, mesmo diante de um evento tardio.
        resolution = 'review_status';
      }
    } else if (charge) {
      resolution = 'mismatch';
    }
    if (eventId) {
      await client.query('UPDATE asaas_webhook_events SET resolution=$2 WHERE event_id=$1',
        [eventId, resolution]);
    }
    await client.query('COMMIT');
    return { matched: !!charge && resolution !== 'mismatch', cancelled, resolution };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function updateRefundReport(remote, { eventId, eventType, actorId } = {}) {
  if (!validId(remote?.externalReference)) throw new Error('INVALID_REFUND_REFERENCE');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (eventId) {
      const inserted = await client.query(
        "INSERT INTO asaas_webhook_events (event_id,event_type,provider_payment_id,resolution) " +
        "VALUES ($1,$2,$3,'processing') ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
        [eventId, eventType, remote.id],
      );
      if (!inserted.rows.length) {
        await client.query('COMMIT');
        return { duplicate: true };
      }
    }
    const result = await client.query(
      'SELECT * FROM pix_charges WHERE id=$1 FOR UPDATE', [remote.externalReference],
    );
    const charge = result.rows[0];
    let resolution = 'unmatched';
    let summary = null;
    if (charge && matchesChargeIdentity(remote, charge)) {
      if (charge.status === 'paid') {
        summary = summarizeRefunds(remote, charge.amount_cents);
        if (charge.refund_state !== summary.state ||
            charge.refunded_cents !== summary.refundedCents) {
          await client.query(
            'UPDATE pix_charges SET refund_state=$2,refunded_cents=$3,updated_at=NOW() WHERE id=$1',
            [charge.id, summary.state, summary.refundedCents],
          );
          await audit(client, charge, 'billing.pix.refund.observed', {
            refundState: summary.state, refundedCents: summary.refundedCents,
            priorState: charge.refund_state, priorRefundedCents: charge.refunded_cents,
          }, actorId);
        }
        resolution = summary.state;
      } else {
        resolution = 'unpaid_charge';
      }
    } else if (charge) {
      resolution = 'mismatch';
    }
    if (eventId) {
      await client.query('UPDATE asaas_webhook_events SET resolution=$2 WHERE event_id=$1',
        [eventId, resolution]);
    }
    await client.query('COMMIT');
    return { matched: !!charge && resolution !== 'mismatch', resolution,
      ...(summary ? { refundState: summary.state, refundedCents: summary.refundedCents } : {}) };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function handleLifecycleEvent(eventId, eventType, paymentId) {
  if (!validPaymentId(paymentId)) throw new Error('INVALID_PAYMENT_ID');
  const remote = await getAsaasPayment(paymentId);
  if (remote.id !== paymentId) throw new Error('PROVIDER_ID_MISMATCH');
  if (eventType === 'PAYMENT_DELETED') {
    if (!isDeletedPayment(remote)) throw new Error('PROVIDER_DELETION_NOT_CONFIRMED');
    return updateCancelledCharge(remote, { eventId, eventType });
  }
  if ([
    'PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED',
    'PAYMENT_REFUND_IN_PROGRESS', 'PAYMENT_REFUND_DENIED',
  ].includes(eventType)) {
    return updateRefundReport(remote, { eventId, eventType });
  }
  throw new Error('UNSUPPORTED_LIFECYCLE_EVENT');
}

export function registerBillingLifecycleRoutes(app, requireTeacher, requireAdmin, limited) {
  app.post('/api/admin/billing/charges/:id/cancel',
    requireTeacher, requireAdmin, limited, async (req, res) => {
      if (!asaasConfigured()) {
        return res.status(503).json({ error: 'Asaas Sandbox não configurado.' });
      }
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Cobrança inválida.' });
      const result = await db.query('SELECT * FROM pix_charges WHERE id=$1', [req.params.id]);
      const charge = result.rows[0];
      if (!charge) return res.status(404).json({ error: 'Cobrança não encontrada.' });
      if (charge.status === 'cancelled') return res.json({ cancelled: true, alreadyCancelled: true, sandbox: true });
      if (charge.status !== 'pending' || !validPaymentId(charge.provider_payment_id)) {
        return res.status(409).json({
          error: 'Só é possível cancelar cobranças pendentes já identificadas pelo Asaas. ' +
            'Um pagamento recebido exige tratamento de estorno separado.',
        });
      }
      try {
        const before = await getAsaasPayment(charge.provider_payment_id);
        if (!matchesChargeIdentity(before, charge)) {
          return res.status(409).json({ error: 'Divergência com a cobrança do Asaas; revisão necessária.' });
        }
        if (!isDeletedPayment(before)) {
          if (!['PENDING', 'OVERDUE'].includes(before.status)) {
            return res.status(409).json({
              error: 'O Asaas não confirma cobrança pendente. Não foi enviado cancelamento.',
              providerStatus: before.status,
            });
          }
          await deleteAsaasPayment(charge.provider_payment_id);
        }
        // Confirma exclusão no próprio provedor; uma resposta de DELETE não basta.
        const after = await getAsaasPayment(charge.provider_payment_id);
        if (!matchesChargeIdentity(after, charge) || !isDeletedPayment(after)) {
          return res.status(502).json({ error: 'Exclusão ainda não confirmada pelo Asaas; cobrança permanece em conciliação.' });
        }
        const result = await updateCancelledCharge(after, { actorId: req.teacher.id });
        if (!result.cancelled) {
          return res.status(409).json({
            error: 'A cobrança foi alterada durante a conciliação. Consulte o histórico.',
            resolution: result.resolution,
          });
        }
        return res.json({ cancelled: true, sandbox: true, resolution: result.resolution });
      } catch (_error) {
        return res.status(502).json({
          error: 'Não foi possível concluir o cancelamento no Asaas Sandbox; verifique o provedor antes de tentar novamente.',
        });
      }
    });

  app.post('/api/admin/billing/charges/:id/refunds/check',
    requireTeacher, requireAdmin, limited, async (req, res) => {
      if (!asaasConfigured()) return res.status(503).json({ error: 'Asaas Sandbox não configurado.' });
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Cobrança inválida.' });
      const found = await db.query('SELECT * FROM pix_charges WHERE id=$1', [req.params.id]);
      const charge = found.rows[0];
      if (!charge) return res.status(404).json({ error: 'Cobrança não encontrada.' });
      if (charge.status !== 'paid' || !validPaymentId(charge.provider_payment_id)) {
        return res.status(409).json({ error: 'Somente pagamentos verificados podem ter estornos conciliados.' });
      }
      try {
        const remote = await getAsaasPayment(charge.provider_payment_id);
        if (!matchesChargeIdentity(remote, charge)) {
          return res.status(409).json({ error: 'Divergência nos dados da cobrança do provedor.' });
        }
        const result = await updateRefundReport(remote, { actorId: req.teacher.id });
        return res.json({ sandbox: true, ...result,
          warning: 'Estornos não alteram automaticamente a vigência do professor.' });
      } catch (_error) {
        return res.status(502).json({ error: 'Não foi possível conferir o estorno no Asaas Sandbox.' });
      }
    });
}
