// Serviço exclusivamente para o GitHub Actions em docker-compose.ci.yml.
// Nunca carregar no ambiente normal de produção.
import { createServer } from 'node:http';

const payments = new Map();
let sequence = 0;
const qrPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/0QAAAABJRU5ErkJggg==';

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 12000) throw new Error('TOO_LARGE');
  }
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
    if (req.method === 'POST' && path === '/v3/payments') {
      if (body.billingType !== 'PIX' || !body.customer || !body.externalReference || !body.value) {
        return send(res, 400, { errors: [{ description: 'Invalid sandbox test payment.' }] });
      }
      const id = 'pay_test_' + String(++sequence).padStart(6, '0');
      const record = {
        id, externalReference: body.externalReference, billingType: 'PIX',
        customer: body.customer, value: body.value, dueDate: body.dueDate,
        status: 'PENDING',
      };
      payments.set(id, record);
      return send(res, 200, record);
    }
    if (req.method === 'GET' && /^\/v3\/payments\/pay_[A-Za-z0-9_-]+$/.test(path)) {
      const id = path.split('/')[3];
      return payments.has(id) ? send(res, 200, payments.get(id)) :
        send(res, 404, { error: 'Not found' });
    }
    if (req.method === 'GET' && /^\/v3\/payments\/pay_[A-Za-z0-9_-]+\/pixQrCode$/.test(path)) {
      const id = path.split('/')[3];
      if (!payments.has(id)) return send(res, 404, { error: 'Not found' });
      return send(res, 200, {
        encodedImage: qrPng,
        payload: '000201TEST-' + id,
        expirationDate: '2027-01-01T00:00:00Z',
      });
    }
    if (req.method === 'POST' && path === '/_test/mark-paid') {
      const record = payments.get(body.id);
      if (!record) return send(res, 404, { error: 'Not found' });
      record.status = 'RECEIVED';
      if (body.overrideValue !== undefined) record.value = body.overrideValue;
      return send(res, 200, record);
    }
    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    return send(res, 500, { error: 'Test mock failure' });
  }
});
server.listen(3333, '0.0.0.0', () => console.log('Mock Asaas for CI on port 3333'));
