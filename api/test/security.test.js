import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword, hashToken, newSessionToken, validEmail, validPassword, verifyPassword,
} from '../src/security.js';

test('hash de senha com salt e verificação', async () => {
  const a = await hashPassword('uma-senha-muito-forte');
  const b = await hashPassword('uma-senha-muito-forte');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('uma-senha-muito-forte', a), true);
  assert.equal(await verifyPassword('outra-senha', a), false);
  assert.equal(await verifyPassword('senha', 'dados-corrompidos'), false);
});
test('validação de credenciais', () => {
  assert.equal(validEmail('professor@exemplo.com'), true);
  assert.equal(validEmail('invalido'), false);
  assert.equal(validPassword('123456789'), false);
  assert.equal(validPassword('1234567890'), true);
});
test('tokens são aleatórios e persistidos somente como hash', () => {
  const t1 = newSessionToken();
  const t2 = newSessionToken();
  assert.equal(t1.length, 64);
  assert.notEqual(t1, t2);
  assert.notEqual(hashToken(t1), t1);
});
