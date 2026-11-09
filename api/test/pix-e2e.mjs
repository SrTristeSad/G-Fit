// Fluxo Pix de ponta a ponta usando mock do Asaas em Docker Compose CI.
// Nenhum dinheiro real, chaves reais ou endpoints de produção.
import assert from 'node:assert/strict';

const base = 'http://localhost:8080';
const mock = 'http://127.0.0.1:3333';
const webhookToken = 'test_webhook_token_supersecret_12345678';
const password = process.env.ADMIN_PASSWORD;
if (!password) throw new Error('ADMIN_PASSWORD ausente');

async function request(path, { method = 'GET', cookie, body, headers = {} } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function mockPaid(providerId, overrideValue) {
  const response = await fetch(mock + '/_test/mark-paid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: providerId, ...(overrideValue !== undefined ? { overrideValue } : {}) }),
  });
  assert.equal(response.status, 200);
}
async function webhook(eventId, providerId, token = webhookToken, eventType = 'PAYMENT_RECEIVED') {
  return request('/api/webhooks/asaas', {
    method: 'POST',
    body: { id: eventId, event: eventType, payment: { id: providerId } },
    headers: { 'asaas-access-token': token },
  });
}

const admin = await request('/api/auth/login', {
  method: 'POST',
  body: { email: 'admin@example.com', password },
});
assert.equal(admin.status, 200);
const ca = admin.cookie;
const teacher = await request('/api/auth/login', {
  method: 'POST',
  body: { email: 'um@example.com', password: 'senha-primeira-123' },
});
assert.equal(teacher.status, 200);
const ct = teacher.cookie;
const teacherId = teacher.data.teacher.id;

assert.equal((await request('/api/admin/billing', { cookie: ct })).status, 403);
const initial = await request('/api/admin/billing', { cookie: ca });
assert.equal(initial.status, 200);
assert.equal(initial.data.sandbox, true);
assert.equal(initial.data.configured, true);
assert.deepEqual(initial.data.charges, []);
const plans = await request('/api/admin/plans', { cookie: ca });
const plan = plans.data.plans.find(p => p.name === 'Profissional 30');
assert.ok(plan);
assert.equal((await request('/api/admin/plans/' + plan.id, {
  method: 'PATCH', cookie: ca, body: { isActive: true },
})).status, 200);
assert.equal((await request('/api/admin/teachers/' + teacherId + '/plan', {
  method: 'PUT', cookie: ca, body: { planId: plan.id },
})).status, 200);
assert.equal((await request('/api/admin/teachers/' + teacherId + '/asaas-customer', {
  method: 'PUT', cookie: ct, body: { customerId: 'cus_TEST_00001' },
})).status, 403);
assert.equal((await request('/api/admin/teachers/' + teacherId + '/asaas-customer', {
  method: 'PUT', cookie: ca, body: { customerId: 'cus_TEST_00001' },
})).status, 200);

const today = new Date().toISOString().slice(0, 10);
const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
const firstGrant = await request('/api/admin/teachers/' + teacherId + '/access', {
  method: 'PUT', cookie: ca, body: { startsOn: today, endsOn: future },
});
assert.equal(firstGrant.status, 200);
const first = await request('/api/account/pix-charge', {
  method: 'POST', cookie: ct, body: {},
});
assert.equal(first.status, 201, JSON.stringify(first.data));
assert.equal(first.data.sandbox, true);
assert.equal(first.data.status, 'pending');
const billId = first.data.chargeId;
const providerId = first.data.providerPaymentId;

assert.equal((await request('/api/account/pix-charge', {
  method: 'POST', cookie: ct, body: {},
})).status, 409);
const qr = await request('/api/billing/charges/' + billId + '/pix', { cookie: ct });
assert.equal(qr.status, 200, JSON.stringify(qr.data));
assert.ok(qr.data.payload.includes(providerId));
assert.ok(qr.data.imageBase64.length > 30);
assert.equal((await request('/api/billing/charges/' + billId + '/pix')).status, 401);
assert.equal((await webhook('evt_wrong_token_000001', providerId, 'wrong-token')).status, 401);

const premature = await webhook('evt_before_paid_000001', providerId);
assert.equal(premature.status, 503);
assert.equal((await request('/api/account/charges', { cookie: ct })).data.charges[0].status, 'pending');

const revokeBeforePayment = await request('/api/admin/teachers/' + teacherId + '/access/revoke', {
  method: 'POST', cookie: ca,
});
assert.equal(revokeBeforePayment.status, 200);
assert.equal((await request('/api/account/pix-charge', {
  method: 'POST', cookie: ct, body: {},
})).status, 409);
await mockPaid(providerId);
const paid = await webhook('evt_paid_000001', providerId);
assert.equal(paid.status, 200, JSON.stringify(paid.data));
assert.equal(paid.data.settled, true);
assert.equal(paid.data.access, 'manual_review'); // a vigencia foi revogada no e2e anterior
const paidAgain = await webhook('evt_paid_000001', providerId);
assert.equal(paidAgain.status, 200);
assert.equal(paidAgain.data.duplicate, true);
assert.equal((await request('/api/account/charges', { cookie: ct })).data.charges[0].status, 'paid');
assert.equal((await request('/api/account/access', { cookie: ct })).data.access.status, 'revoked');

const grant = await request('/api/admin/teachers/' + teacherId + '/access', {
  method: 'PUT', cookie: ca, body: { startsOn: today, endsOn: future },
});
assert.equal(grant.status, 200);
const second = await request('/api/account/pix-charge', {
  method: 'POST', cookie: ct, body: {},
});
assert.equal(second.status, 201, JSON.stringify(second.data));
const stillPending = await request('/api/admin/billing/charges/' + second.data.chargeId + '/check', {
  method: 'POST', cookie: ca,
});
assert.equal(stillPending.status, 200);
assert.equal(stillPending.data.paid, false);

await mockPaid(second.data.providerPaymentId);
const secondPaid = await webhook('evt_paid_000002', second.data.providerPaymentId);
assert.equal(secondPaid.status, 200, JSON.stringify(secondPaid.data));
assert.equal(secondPaid.data.access, 'extended');
const newTerm = await request('/api/account/access', { cookie: ct });
assert.equal(newTerm.status, 200);
assert.equal(newTerm.data.access.status, 'active');
assert.ok(newTerm.data.access.endsOn > future);
const againNewEvent = await webhook('evt_paid_repeated_000002', second.data.providerPaymentId);
assert.equal(againNewEvent.status, 200);
assert.equal(againNewEvent.data.duplicatePayment, true);
assert.equal((await request('/api/account/access', { cookie: ct })).data.access.endsOn, newTerm.data.access.endsOn);
assert.equal((await request('/api/admin/billing/charges/' + second.data.chargeId + '/check', {
  method: 'POST', cookie: ca,
})).data.alreadyPaid, true);

const third = await request('/api/account/pix-charge', {
  method: 'POST', cookie: ct, body: {},
});
assert.equal(third.status, 201);
await mockPaid(third.data.providerPaymentId, 999.99); // valor adulterado no mock
const mismatch = await webhook('evt_mismatch_000003', third.data.providerPaymentId);
assert.equal(mismatch.status, 200);
assert.equal(mismatch.data.review, true);
assert.equal((await request('/api/account/charges', { cookie: ct })).data.charges[0].status, 'pending');
assert.equal((await request('/api/account/access', { cookie: ct })).data.access.endsOn, newTerm.data.access.endsOn);

// Caso critico: Asaas criou a cobranca, mas a resposta de criacao foi perdida.
const accounts = await request('/api/admin/teachers', { cookie: ca });
const teacher2 = accounts.data.teachers.find(t => t.email === 'dois@example.com');
assert.ok(teacher2);
assert.equal((await request('/api/admin/teachers/' + teacher2.id, {
  method: 'PATCH', cookie: ca, body: { isActive: true },
})).status, 200);
assert.equal((await request('/api/admin/teachers/' + teacher2.id + '/plan', {
  method: 'PUT', cookie: ca, body: { planId: plan.id },
})).status, 200);
assert.equal((await request('/api/admin/teachers/' + teacher2.id + '/asaas-customer', {
  method: 'PUT', cookie: ca, body: { customerId: 'cus_FAIL_ONCE' },
})).status, 200);
const failedCreation = await request('/api/admin/teachers/' + teacher2.id + '/pix-charge', {
  method: 'POST', cookie: ca, body: { dueDate: future },
});
assert.equal(failedCreation.status, 502, JSON.stringify(failedCreation.data));
assert.equal(failedCreation.data.status, 'creating');
const stuckId = failedCreation.data.chargeId;
assert.equal((await request('/api/admin/teachers/' + teacher2.id + '/pix-charge', {
  method: 'POST', cookie: ca, body: { dueDate: future },
})).status, 409);
const recovered = await request('/api/admin/billing/charges/' + stuckId + '/recover', {
  method: 'POST', cookie: ca,
});
assert.equal(recovered.status, 200, JSON.stringify(recovered.data));
assert.equal(recovered.data.status, 'pending');
assert.ok(recovered.data.providerPaymentId);
await mockPaid(recovered.data.providerPaymentId);
const recoveredPaid = await webhook('evt_recovered_000004', recovered.data.providerPaymentId);
assert.equal(recoveredPaid.status, 200);
assert.equal(recoveredPaid.data.settled, true);
const teacher2Bill = await request('/api/admin/billing', { cookie: ca });
assert.equal(teacher2Bill.data.charges.find(c => c.id === stuckId).status, 'paid');

const final = await request('/api/admin/billing', { cookie: ca });
assert.equal(final.data.charges.length, 4);
assert.equal(final.data.charges.filter(c => c.status === 'paid').length, 3);
const audit = await request('/api/admin/audit', { cookie: ca });
assert.equal(audit.status, 200);
assert.equal(audit.data.events.filter(e => e.action === 'billing.pix.verified').length, 3);

// Ciclo da cobrança: cancelar não paga e não estorna.
const setNewCustomer = await request('/api/admin/teachers/' + teacher2.id + '/asaas-customer', {
  method: 'PUT', cookie: ca, body: { customerId: 'cus_TEST_00002' },
});
assert.equal(setNewCustomer.status, 200);
const removable = await request('/api/admin/teachers/' + teacher2.id + '/pix-charge', {
  method: 'POST', cookie: ca, body: { dueDate: future },
});
assert.equal(removable.status, 201, JSON.stringify(removable.data));
const removableId = removable.data.chargeId;
const unauthorizedCancel = await request('/api/admin/billing/charges/' + removableId + '/cancel', {
  method: 'POST', cookie: ct,
});
assert.equal(unauthorizedCancel.status, 403);
const cancelled = await request('/api/admin/billing/charges/' + removableId + '/cancel', {
  method: 'POST', cookie: ca,
});
assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
assert.equal(cancelled.data.cancelled, true);
const againCancelled = await request('/api/admin/billing/charges/' + removableId + '/cancel', {
  method: 'POST', cookie: ca,
});
assert.equal(againCancelled.status, 200);
assert.equal(againCancelled.data.alreadyCancelled, true);
const deletionEvent = await webhook('evt_deleted_000005', removable.data.providerPaymentId,
  webhookToken, 'PAYMENT_DELETED');
assert.equal(deletionEvent.status, 200);
assert.equal(deletionEvent.data.resolution, 'already_cancelled');
const repeatDeletion = await webhook('evt_deleted_000005', removable.data.providerPaymentId,
  webhookToken, 'PAYMENT_DELETED');
assert.equal(repeatDeletion.status, 200);
assert.equal(repeatDeletion.data.duplicate, true);
assert.equal((await request('/api/admin/billing', { cookie: ca }))
  .data.charges.find(c => c.id === removableId).status, 'cancelled');

// A cobrança cancelada não ocupa vaga de cobranças abertas.
const refundCharge = await request('/api/admin/teachers/' + teacher2.id + '/pix-charge', {
  method: 'POST', cookie: ca, body: { dueDate: future },
});
assert.equal(refundCharge.status, 201, JSON.stringify(refundCharge.data));
await mockPaid(refundCharge.data.providerPaymentId);
const refundPaid = await webhook('evt_paid_000006', refundCharge.data.providerPaymentId);
assert.equal(refundPaid.status, 200, JSON.stringify(refundPaid.data));
assert.equal(refundPaid.data.settled, true);
const accessBeforeRefund = await request('/api/account/access', {
  cookie: (await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'dois@example.com', password: 'senha-segunda-123' },
  })).cookie,
});
assert.equal(accessBeforeRefund.status, 200);

const partialRemote = await fetch(mock + '/_test/refund', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: refundCharge.data.providerPaymentId, value: 9.9, status: 'DONE' }),
});
assert.equal(partialRemote.status, 200);
const partial = await webhook('evt_partial_000007', refundCharge.data.providerPaymentId,
  webhookToken, 'PAYMENT_PARTIALLY_REFUNDED');
assert.equal(partial.status, 200, JSON.stringify(partial.data));
assert.equal(partial.data.refundState, 'partial');
assert.equal(partial.data.refundedCents, 990);
const partialRepeat = await webhook('evt_partial_000007', refundCharge.data.providerPaymentId,
  webhookToken, 'PAYMENT_PARTIALLY_REFUNDED');
assert.equal(partialRepeat.data.duplicate, true);
const firstRefundCheck = await request(
  '/api/admin/billing/charges/' + refundCharge.data.chargeId + '/refunds/check',
  { method: 'POST', cookie: ca },
);
assert.equal(firstRefundCheck.status, 200);
assert.equal(firstRefundCheck.data.refundState, 'partial');

const restRefund = await fetch(mock + '/_test/refund', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: refundCharge.data.providerPaymentId, value: 20, status: 'DONE' }),
});
assert.equal(restRefund.status, 200);
const fullRefund = await webhook('evt_full_000008', refundCharge.data.providerPaymentId,
  webhookToken, 'PAYMENT_REFUNDED');
assert.equal(fullRefund.status, 200, JSON.stringify(fullRefund.data));
assert.equal(fullRefund.data.refundState, 'full');
assert.equal(fullRefund.data.refundedCents, 2990);
const refunded = (await request('/api/admin/billing', { cookie: ca }))
  .data.charges.find(c => c.id === refundCharge.data.chargeId);
assert.equal(refunded.status, 'paid'); // histórico de recebimento continua registrado
assert.equal(refunded.refundState, 'full');
assert.equal(refunded.refundedCents, 2990);
assert.equal((await request('/api/admin/billing/charges/' + refundCharge.data.chargeId + '/cancel',
  { method: 'POST', cookie: ca })).status, 409);
const afterRefund = await request('/api/admin/access', { cookie: ca });
assert.equal(afterRefund.status, 200);
assert.equal(afterRefund.data.accessTerms.find(t => t.teacherId === teacher2.id).status, 'active');
const financeSummary = await request('/api/admin/billing', { cookie: ca });
assert.equal(financeSummary.data.summary.cancelledCount, 1);
assert.equal(financeSummary.data.summary.refundReviewCount, 1);
assert.equal(Number(financeSummary.data.summary.confirmedRefundedCents), 2990);
assert.ok(financeSummary.data.summary.paidCount >= 4);
assert.equal(financeSummary.data.summary.pendingCount, 1); // cobrança divergente continua em revisão
console.log('Pix Sandbox: cancelamento, estornos parciais e totais, idempotência e revisão manual OK.');

assert.equal((await request('/api/admin/billing/operations', { cookie: ct })).status, 403);
assert.equal((await request('/api/admin/billing/operations')).status, 401);
const operations = await request('/api/admin/billing/operations', { cookie: ca });
assert.equal(operations.status, 200, JSON.stringify(operations.data));
assert.equal(operations.data.monitoringScope, 'local_only');
assert.equal(operations.data.sandbox, true);
assert.ok(operations.data.webhook.uniqueEvents >= 8);
assert.ok(operations.data.webhook.deliveryAttempts > operations.data.webhook.uniqueEvents);
assert.ok(operations.data.webhook.failedAttempts >= 1);
assert.ok(operations.data.webhook.retriedEvents >= 2);
assert.equal(operations.data.webhook.currentlyFailed >= 1, true);
const failedDelivery = operations.data.recentAttempts.find(e => e.eventId === 'evt_before_paid_000001');
assert.ok(failedDelivery);
assert.equal(failedDelivery.lastHttpStatus, 503);
assert.equal(failedDelivery.failureCount, 1);
const redelivery = operations.data.recentAttempts.find(e => e.eventId === 'evt_paid_000001');
assert.ok(redelivery);
assert.equal(redelivery.attempts, 2);
assert.equal(redelivery.lastHttpStatus, 200);
assert.ok(operations.data.eventsToReview.some(e => e.resolution === 'mismatch'));
assert.ok(Array.isArray(operations.data.chargesToReview));
console.log('Monitoramento: acesso administrativo, falhas HTTP, tentativas repetidas e divergências OK.');

// Alertas automáticos: são internos e não alteram pagamentos.
assert.equal((await request('/api/admin/alerts', { cookie: ct })).status, 403);
assert.equal((await request('/api/admin/alerts/scan', { method: 'POST', cookie: ct })).status, 403);
const scan = await request('/api/admin/alerts/scan', { method: 'POST', cookie: ca });
assert.equal(scan.status, 200, JSON.stringify(scan.data));
assert.equal(scan.data.sandbox, true);
let inbox = await request('/api/admin/alerts', { cookie: ca });
assert.equal(inbox.status, 200, JSON.stringify(inbox.data));
assert.equal(inbox.data.delivery, 'in_app_only');
assert.ok(inbox.data.scanner.lastSuccessAt);
assert.ok(inbox.data.summary.open >= 2);
const failure = inbox.data.alerts.find(a => a.alertType === 'webhook_failure' &&
  a.sourceKey === 'evt_before_paid_000001');
assert.ok(failure);
assert.equal(failure.status, 'open');
const divergence = inbox.data.alerts.find(a => a.alertType === 'webhook_divergence' &&
  a.sourceKey === 'evt_mismatch_000003');
assert.ok(divergence);
assert.equal(divergence.status, 'open');
const alertId = failure.id;
const acknowledge = await request('/api/admin/alerts/' + alertId + '/acknowledge', {
  method: 'PATCH', cookie: ca,
});
assert.equal(acknowledge.status, 200, JSON.stringify(acknowledge.data));
assert.equal(acknowledge.data.acknowledged, true);
assert.equal((await request('/api/admin/alerts/' + alertId + '/acknowledge', {
  method: 'PATCH', cookie: ca,
})).data.unchanged, true);
assert.equal((await request('/api/admin/alerts/' + alertId + '/acknowledge', {
  method: 'PATCH', cookie: ct,
})).status, 403);
const scanAgain = await request('/api/admin/alerts/scan', { method: 'POST', cookie: ca });
assert.equal(scanAgain.status, 200);
inbox = await request('/api/admin/alerts', { cookie: ca });
assert.equal(inbox.data.alerts.find(a => a.id === alertId).status, 'acknowledged');
assert.equal(inbox.data.alerts.filter(a => a.sourceKey === 'evt_mismatch_000003' &&
  a.alertType === 'webhook_divergence').length, 1);

// Resolve a falha da última tentativa ao reentregar o mesmo evento, agora com pagamento confirmado.
const retryOldEvent = await webhook('evt_before_paid_000001', providerId);
assert.equal(retryOldEvent.status, 200, JSON.stringify(retryOldEvent.data));
const resolveScan = await request('/api/admin/alerts/scan', { method: 'POST', cookie: ca });
assert.equal(resolveScan.status, 200);
inbox = await request('/api/admin/alerts', { cookie: ca });
const resolvedAlert = inbox.data.alerts.find(a => a.id === alertId);
assert.equal(resolvedAlert.status, 'resolved');
assert.ok(resolvedAlert.resolvedAt);
assert.equal((await request('/api/admin/alerts/' + alertId + '/acknowledge', {
  method: 'PATCH', cookie: ca,
})).status, 409);
assert.ok(inbox.data.summary.resolved >= 1);
assert.ok(inbox.data.summary.open >= 1);
const auditAlerts = await request('/api/admin/audit', { cookie: ca });
assert.ok(auditAlerts.data.events.some(e => e.action === 'billing.alert.acknowledged'));
console.log('Alertas: deduplicação, reconhecimento, resolução e permissões OK.');



