import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validCustomerId, validPaymentId, validBillDate, centsToValue,
  matchesPaidCharge, matchesChargeIdentity, summarizeRefunds, isDeletedPayment,
  validWebhookToken, createAsaasCharge,
} from '../src/asaas.js';

test('validacao de identificadores, datas e valores monetarios em centavos', () => {
  assert.equal(validCustomerId('cus_000005219613'), true);
  assert.equal(validCustomerId('https://example.com/'), false);
  assert.equal(validPaymentId('pay_test_000001'), true);
  assert.equal(validPaymentId('bad_name'), false);
  assert.equal(validBillDate('2026-11-09'), true);
  assert.equal(validBillDate('2026-02-30'), false);
  assert.equal(centsToValue(2990), 29.9);
  assert.throws(() => centsToValue(0));
  assert.throws(() => centsToValue(-100));
});

test('o pagamento deve coincidir integralmente com o registro do G Fit', () => {
  const charge = {
    id: 'fcaa0e03-44fa-4601-b844-8f129e9e5011',
    provider_payment_id: 'pay_test_000001',
    amount_cents: 2990,
    asaas_customer_id: 'cus_0000001',
  };
  const verified = {
    id: 'pay_test_000001', billingType: 'PIX',
    status: 'RECEIVED', externalReference: charge.id,
    value: 29.9, customer: charge.asaas_customer_id,
  };
  assert.equal(matchesPaidCharge(verified, charge), true);
  for (const change of [
    { value: 99.9 }, { billingType: 'BOLETO' }, { status: 'PENDING' },
    { externalReference: 'wrong' }, { customer: 'cus_wrong' }, { id: 'pay_wrong' },
  ]) assert.equal(matchesPaidCharge({ ...verified, ...change }, charge), false);
});

test('token do webhook usa comparacao estrita e chave da API nao chega ao navegador', async () => {
  const beforeApi = process.env.ASAAS_API_KEY;
  const beforeToken = process.env.ASAAS_WEBHOOK_TOKEN;
  const beforeEnv = process.env.NODE_ENV;
  const beforeMock = process.env.ASAAS_TEST_BASE_URL;
  const beforeFetch = globalThis.fetch;
  try {
    process.env.ASAAS_API_KEY = 'test_api_key_secure_for_mock_only';
    process.env.ASAAS_WEBHOOK_TOKEN = 'test_webhook_token_supersecret_12345678';
    process.env.NODE_ENV = 'test';
    process.env.ASAAS_TEST_BASE_URL = 'http://mock-asaas:3333/v3';
    assert.equal(validWebhookToken('test_webhook_token_supersecret_12345678'), true);
    assert.equal(validWebhookToken('test_webhook_token_supersecret_1234567'), false);
    let captured = null;
    globalThis.fetch = async (url, args) => {
      captured = { url, args };
      return { ok: true, status: 200, json: async () => ({
        id: 'pay_test_000001', externalReference: 'uuid_1',
      }) };
    };
    const outcome = await createAsaasCharge({
      customerId: 'cus_TEST_1', chargeId: 'uuid_1', priceCents: 1990,
      dueDate: '2027-01-01',
    });
    assert.equal(outcome.id, 'pay_test_000001');
    assert.equal(captured.url, 'http://mock-asaas:3333/v3/payments');
    assert.equal(captured.args.headers.access_token, 'test_api_key_secure_for_mock_only');
    const requestBody = JSON.parse(captured.args.body);
    assert.equal(requestBody.billingType, 'PIX');
    assert.equal(requestBody.value, 19.9);
    assert.equal(requestBody.externalReference, 'uuid_1');
  } finally {
    globalThis.fetch = beforeFetch;
    if (beforeApi === undefined) delete process.env.ASAAS_API_KEY;
    else process.env.ASAAS_API_KEY = beforeApi;
    if (beforeToken === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
    else process.env.ASAAS_WEBHOOK_TOKEN = beforeToken;
    if (beforeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = beforeEnv;
    if (beforeMock === undefined) delete process.env.ASAAS_TEST_BASE_URL;
    else process.env.ASAAS_TEST_BASE_URL = beforeMock;
  }
});


test('reembolsos somam apenas devoluções DONE e não geram crédito duplicado', () => {
  const base = { status: 'RECEIVED', refunds: [] };
  assert.deepEqual(summarizeRefunds(base, 2990), { state: 'none', refundedCents: 0 });
  assert.deepEqual(summarizeRefunds({
    refunds: [{ status: 'PENDING', value: 9.9 }],
  }, 2990), { state: 'pending', refundedCents: 0 });
  assert.deepEqual(summarizeRefunds({
    refunds: [{ status: 'DONE', value: 9.9 }, { status: 'PENDING', value: 20 }],
  }, 2990), { state: 'partial', refundedCents: 990 });
  assert.deepEqual(summarizeRefunds({
    refunds: [{ status: 'DONE', value: 9.9 }, { status: 'DONE', value: 20 }],
  }, 2990), { state: 'full', refundedCents: 2990 });
  assert.equal(summarizeRefunds({ refunds: [{ status: 'DONE', value: 300 }] }, 2990).state, 'review');
  assert.equal(summarizeRefunds({ status: 'REFUNDED' }, 2990).state, 'review');
  assert.equal(summarizeRefunds({ refunds: [{ status: 'DONE', value: 1.001 }] }, 2990).state, 'review');
});

test('exclusão remota e identidade são distintas de pagamento confirmado', () => {
  const charge = {
    id: 'fcaa0e03-44fa-4601-b844-8f129e9e5011',
    provider_payment_id: 'pay_test_000001',
    amount_cents: 2990,
    asaas_customer_id: 'cus_0000001',
  };
  const remote = {
    id: charge.provider_payment_id, externalReference: charge.id,
    customer: charge.asaas_customer_id, value: 29.9, billingType: 'PIX',
    status: 'DELETED', deleted: true,
  };
  assert.equal(matchesChargeIdentity(remote, charge), true);
  assert.equal(matchesPaidCharge(remote, charge), false);
  assert.equal(isDeletedPayment(remote), true);
  assert.equal(matchesChargeIdentity({ ...remote, value: 29.91 }, charge), false);
  assert.equal(isDeletedPayment({ ...remote, status: 'PENDING', deleted: false }), false);
});
