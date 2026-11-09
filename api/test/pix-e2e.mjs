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
async function webhook(eventId, providerId, token = webhookToken) {
  return request('/api/webhooks/asaas', {
    method: 'POST',
    body: { id: eventId, event: 'PAYMENT_RECEIVED', payment: { id: providerId } },
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

const today = new Date().toISOString().slice(0, 10);
const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
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
console.log('Pix Sandbox: criação, QR, autenticação, conciliação, duplicatas e vigências validados.');
