// Execute apenas no servidor: docker compose exec api node src/bootstrap-admin.js admin@exemplo.com
import { randomBytes, randomUUID } from 'node:crypto';
import { db, initDatabase } from './db.js';
import { hashPassword, validEmail } from './security.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!validEmail(email)) {
  console.error('Uso: node src/bootstrap-admin.js admin@exemplo.com');
  process.exitCode = 1;
} else {
  try {
    await initDatabase();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(20261109)');
      const admins = await client.query('SELECT id FROM teachers WHERE is_admin LIMIT 1');
      if (admins.rows.length) throw new Error('Já existe administrador. Inicialização bloqueada.');
      const existing = await client.query('SELECT id FROM teachers WHERE email=$1', [email]);
      if (existing.rows.length) throw new Error('Este e-mail já pertence a uma conta. Escolha outro.');
      const password = randomBytes(24).toString('base64url');
      await client.query(
        'INSERT INTO teachers (id, full_name, email, password_hash, is_admin, max_students) VALUES ($1,$2,$3,$4,TRUE,0)',
        [randomUUID(), 'Administrador G Fit', email, await hashPassword(password)],
      );
      await client.query('COMMIT');
      console.log('Administrador criado com sucesso.');
      console.log('Email: ' + email);
      console.log('Password: ' + password);
      console.log('Guarde esta senha com segurança e altere-a no primeiro acesso.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
await db.end();
