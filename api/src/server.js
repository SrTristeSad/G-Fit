import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { db, initDatabase } from './db.js';
import {
  hashPassword, hashToken, newSessionToken, validEmail, validPassword, verifyPassword,
} from './security.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Somente atrás do nginx do docker-compose.
app.use(helmet());
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

const cookieOptions = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: 'lax',
  path: '/api',
};
const sessionMs = 7 * 24 * 60 * 60 * 1000;
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente mais tarde.' },
});

function publicTeacher(row) {
  return { id: row.id, name: row.full_name, email: row.email };
}
async function issueSession(res, teacher) {
  const token = newSessionToken();
  await db.query(
    "INSERT INTO sessions (token_hash, teacher_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days')",
    [hashToken(token), teacher.id],
  );
  res.cookie('gfit_session', token, { ...cookieOptions, maxAge: sessionMs });
  return publicTeacher(teacher);
}
async function requireTeacher(req, res, next) {
  try {
    const token = req.cookies.gfit_session;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(401).json({ error: 'Faça login para continuar.' });
    }
    const result = await db.query(
      'SELECT t.id, t.full_name, t.email FROM sessions s ' +
      'JOIN teachers t ON t.id = s.teacher_id ' +
      'WHERE s.token_hash = $1 AND s.expires_at > NOW()',
      [hashToken(token)],
    );
    if (!result.rows.length) return res.status(401).json({ error: 'Sessão expirada.' });
    req.teacher = result.rows[0];
    next();
  } catch (error) { next(error); }
}

app.get('/api/health', async (_req, res) => {
  await db.query('SELECT 1');
  res.json({ status: 'ok', app: 'G Fit' });
});

app.post('/api/auth/register', authRateLimit, async (req, res) => {
  const { name, email, password } = req.body ?? {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120 ||
      !validEmail(email) || !validPassword(password)) {
    return res.status(400).json({
      error: 'Informe nome, e-mail válido e senha de 10 a 128 caracteres.',
    });
  }
  try {
    const passwordHash = await hashPassword(password);
    const result = await db.query(
      'INSERT INTO teachers (id, full_name, email, password_hash) ' +
      'VALUES ($1, $2, $3, $4) RETURNING id, full_name, email',
      [randomUUID(), name.trim(), email.trim().toLowerCase(), passwordHash],
    );
    res.status(201).json({ teacher: await issueSession(res, result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    }
    throw error;
  }
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!validEmail(email) || typeof password !== 'string') {
    return res.status(400).json({ error: 'E-mail ou senha inválidos.' });
  }
  const result = await db.query(
    'SELECT id, full_name, email, password_hash FROM teachers WHERE email = $1',
    [email.trim().toLowerCase()],
  );
  if (!result.rows.length || !(await verifyPassword(password, result.rows[0].password_hash))) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }
  res.json({ teacher: await issueSession(res, result.rows[0]) });
});

app.get('/api/auth/me', requireTeacher, (req, res) => {
  res.json({ teacher: publicTeacher(req.teacher) });
});
app.post('/api/auth/logout', async (req, res) => {
  const token = req.cookies.gfit_session;
  if (typeof token === 'string') {
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  }
  res.clearCookie('gfit_session', cookieOptions);
  res.json({ ok: true });
});
app.get('/api/students', requireTeacher, async (req, res) => {
  const result = await db.query(
    'SELECT id, full_name AS name, created_at FROM students ' +
    'WHERE teacher_id = $1 ORDER BY created_at DESC',
    [req.teacher.id],
  );
  res.json({ students: result.rows });
});
app.post('/api/students', requireTeacher, async (req, res) => {
  const name = req.body?.name;
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) {
    return res.status(400).json({ error: 'Informe nome do aluno (2 a 120 caracteres).' });
  }
  const result = await db.query(
    'INSERT INTO students (id, teacher_id, full_name) ' +
    'VALUES ($1, $2, $3) RETURNING id, full_name AS name, created_at',
    [randomUUID(), req.teacher.id, name.trim()],
  );
  res.status(201).json({ student: result.rows[0] });
});

app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((error, _req, res, _next) => {
  console.error('API error:', error);
  if (!res.headersSent) res.status(500).json({ error: 'Erro interno do servidor.' });
});

await initDatabase();
const port = Number(process.env.PORT || 3001);
app.listen(port, '0.0.0.0', () => console.log('G Fit API iniciada na porta', port));
