import { timingSafeEqual } from 'node:crypto';

const SANDBOX = 'https://api-sandbox.asaas.com/v3';
const MOCK = 'http://mock-asaas:3333/v3';

export const asaasConfigured = () =>
  typeof process.env.ASAAS_API_KEY === 'string' && process.env.ASAAS_API_KEY.length > 15 &&
  typeof process.env.ASAAS_WEBHOOK_TOKEN === 'string' && process.env.ASAAS_WEBHOOK_TOKEN.length >= 32;

export function validWebhookToken(header) {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN || '';
  if (!asaasConfigured() || typeof header !== 'string') return false;
  const actualBytes = Buffer.from(header);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function validCustomerId(value) {
  return typeof value === 'string' && /^cus_[A-Za-z0-9_-]{3,96}$/.test(value);
}
export function validPaymentId(value) {
  return typeof value === 'string' && /^pay_[A-Za-z0-9_-]{3,96}$/.test(value);
}
export function validBillDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function matchesPaidCharge(remote, charge) {
  return !!remote && !!charge && remote.billingType === 'PIX' &&
    ['RECEIVED', 'CONFIRMED'].includes(remote.status) &&
    remote.externalReference === charge.id &&
    remote.customer === charge.asaas_customer_id &&
    Number.isFinite(Number(remote.value)) &&
    Math.round(Number(remote.value) * 100) === charge.amount_cents &&
    validPaymentId(remote.id) &&
    (!charge.provider_payment_id || remote.id === charge.provider_payment_id);
}
export function centsToValue(cents) {
  if (!Number.isInteger(cents) || cents <= 0 || cents > 10000000) throw new Error('INVALID_AMOUNT');
  return Number((cents / 100).toFixed(2));
}

export async function asaasRequest(path, options = {}) {
  if (!asaasConfigured()) throw new Error('ASAAS_NOT_CONFIGURED');
  const base = process.env.NODE_ENV === 'test' &&
    process.env.ASAAS_TEST_BASE_URL === MOCK ? MOCK : SANDBOX;
  const response = await fetch(base + path, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'G-Fit/0.1',
      access_token: process.env.ASAAS_API_KEY,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(9000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const error = new Error('ASAAS_REQUEST_FAILED');
    error.status = response.status;
    throw error;
  }
  return result;
}
export function createAsaasCharge({ customerId, chargeId, priceCents, dueDate }) {
  return asaasRequest('/payments', {
    method: 'POST', body: {
      customer: customerId,
      billingType: 'PIX',
      value: centsToValue(priceCents),
      dueDate,
      externalReference: chargeId,
      description: 'G Fit - assinatura de professor',
    },
  });
}
export function getAsaasPayment(id) {
  if (!validPaymentId(id)) throw new Error('INVALID_PAYMENT_ID');
  return asaasRequest('/payments/' + encodeURIComponent(id));
}
export function findAsaasPaymentsByReference(referenceId) {
  if (typeof referenceId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9-]{27,36}$/i.test(referenceId)) {
    throw new Error('INVALID_REFERENCE');
  }
  return asaasRequest('/payments?externalReference=' + encodeURIComponent(referenceId) + '&limit=100');
}

export function getAsaasPixQr(id) {
  if (!validPaymentId(id)) throw new Error('INVALID_PAYMENT_ID');
  return asaasRequest('/payments/' + encodeURIComponent(id) + '/pixQrCode');
}
