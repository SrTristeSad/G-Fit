import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
export function validPassword(password) {
  return typeof password === 'string' && password.length >= 10 && password.length <= 128;
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return 'scrypt:' + salt + ':' + hash.toString('hex');
}
export async function verifyPassword(password, encoded) {
  if (typeof encoded !== 'string' || typeof password !== 'string') return false;
  const parts = encoded.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt' ||
      !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const actual = Buffer.from(parts[2], 'hex');
  const expected = await scrypt(password, parts[1], actual.length);
  return timingSafeEqual(actual, expected);
}
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
export function newSessionToken() {
  return randomBytes(32).toString('hex');
}
