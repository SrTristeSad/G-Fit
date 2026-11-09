import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { db, initDatabase } from './db.js';
import { registerAdminReadRoutes } from './admin.js';
import { registerPlanRoutes } from './plans.js';
import {
  hashPassword, hashToken, newSessionToken, validEmail, validPassword, verifyPassword,
} from './security.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // API acessível apenas atrás do nginx do Compose.
app.use(helmet());
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('sec-fetch-site') === 'cross-site') {
    return res.status(403).json({ error: 'Origem não autorizada.' });
  }
  next();
});
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
  return {
    id: row.id, name: row.full_name, email: row.email,
    isAdmin: row.is_admin, isActive: row.is_active, maxStudents: row.max_students,
  };
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
      'SELECT t.id, t.full_name, t.email, t.is_admin, t.is_active, t.max_students ' +
      'FROM sessions s JOIN teachers t ON t.id = s.teacher_id ' +
      'WHERE s.token_hash = $1 AND s.expires_at > NOW()',
      [hashToken(token)],
    );
    if (!result.rows.length) return res.status(401).json({ error: 'Sessão expirada.' });
    if (!result.rows[0].is_active) return res.status(403).json({ error: 'Conta desativada pelo administrador.' });
    req.teacher = result.rows[0];
    next();
  } catch (error) { next(error); }
}
function requireAdmin(req, res, next) {
  if (!req.teacher.is_admin) return res.status(403).json({ error: 'Acesso exclusivo da administração.' });
  next();
}
function validId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function optionalText(value, limit) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > limit) throw new Error('INVALID_FIELD');
  return value.trim() || null;
}
function dateOfBirth(value) {
  if (!value) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value ||
      value > new Date().toISOString().slice(0, 10) || value < '1900-01-01') throw new Error('INVALID_FIELD');
  return value;
}
function validStudentName(value) {
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 120;
}
const studentSelect = 'id, full_name AS name, preferred_name AS "preferredName", ' +
  'date_of_birth AS "dateOfBirth", phone, emergency_contact AS "emergencyContact", ' +
  'emergency_phone AS "emergencyPhone", goals, notes, is_active AS active, created_at AS "createdAt"';

app.get('/api/health', async (_req, res) => {
  await db.query('SELECT 1');
  res.json({ status: 'ok', app: 'G Fit' });
});
app.post('/api/auth/register', authRateLimit, async (req, res) => {
  const { name, email, password } = req.body ?? {};
  if (!validStudentName(name) || !validEmail(email) || !validPassword(password)) {
    return res.status(400).json({ error: 'Informe nome, e-mail válido e senha de 10 a 128 caracteres.' });
  }
  try {
    const passwordHash = await hashPassword(password);
    const result = await db.query(
      'INSERT INTO teachers (id, full_name, email, password_hash) ' +
      'VALUES ($1, $2, $3, $4) RETURNING id, full_name, email, is_admin, is_active, max_students',
      [randomUUID(), name.trim(), email.trim().toLowerCase(), passwordHash],
    );
    res.status(201).json({ teacher: await issueSession(res, result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    throw error;
  }
});
app.post('/api/auth/login', authRateLimit, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!validEmail(email) || typeof password !== 'string') {
    return res.status(400).json({ error: 'E-mail ou senha inválidos.' });
  }
  const result = await db.query(
    'SELECT id, full_name, email, password_hash, is_admin, is_active, max_students ' +
    'FROM teachers WHERE email = $1',
    [email.trim().toLowerCase()],
  );
  if (!result.rows.length || !(await verifyPassword(password, result.rows[0].password_hash))) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }
  if (!result.rows[0].is_active) return res.status(403).json({ error: 'Conta desativada pelo administrador.' });
  res.json({ teacher: await issueSession(res, result.rows[0]) });
});
app.get('/api/auth/me', requireTeacher, (req, res) => res.json({ teacher: publicTeacher(req.teacher) }));
app.post('/api/auth/logout', async (req, res) => {
  const token = req.cookies.gfit_session;
  if (typeof token === 'string') await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  res.clearCookie('gfit_session', cookieOptions);
  res.json({ ok: true });
});
app.patch('/api/auth/password', requireTeacher, authRateLimit, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || !validPassword(newPassword)) {
    return res.status(400).json({ error: 'Informe a senha atual e uma nova senha de 10 a 128 caracteres.' });
  }
  const result = await db.query('SELECT password_hash FROM teachers WHERE id = $1', [req.teacher.id]);
  if (!result.rows.length || !(await verifyPassword(currentPassword, result.rows[0].password_hash))) {
    return res.status(403).json({ error: 'Senha atual incorreta.' });
  }
  await db.query('UPDATE teachers SET password_hash = $1 WHERE id = $2', [await hashPassword(newPassword), req.teacher.id]);
  // Revoga os demais dispositivos e exige nova autenticação.
  await db.query('DELETE FROM sessions WHERE teacher_id = $1', [req.teacher.id]);
  res.clearCookie('gfit_session', cookieOptions);
  res.json({ ok: true });
});

// Administração: só lista informações agregadas, não expõe fichas particulares de alunos.
app.get('/api/admin/teachers', requireTeacher, requireAdmin, async (_req, res) => {
  const result = await db.query(
    'SELECT t.id, t.full_name AS name, t.email, t.is_admin AS "isAdmin", ' +
    't.is_active AS "isActive", t.max_students AS "maxStudents", t.created_at AS "createdAt", ' +
    'COUNT(s.id) FILTER (WHERE s.is_active) ::INTEGER AS "activeStudents", ' +
    'a.plan_id AS "planId", p.name AS "planName" ' +
    'FROM teachers t LEFT JOIN students s ON s.teacher_id = t.id ' +
    'LEFT JOIN teacher_plan_assignments a ON a.teacher_id=t.id ' +
    'LEFT JOIN plans p ON p.id=a.plan_id ' +
    'GROUP BY t.id, a.plan_id, p.name ORDER BY t.created_at DESC',
  );
  res.json({ teachers: result.rows });
});
app.patch('/api/admin/teachers/:id', requireTeacher, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { maxStudents, isActive } = req.body ?? {};
  if (!validId(id) || (maxStudents === undefined && isActive === undefined) ||
      (maxStudents !== undefined && (!Number.isInteger(maxStudents) || maxStudents < 0 || maxStudents > 10000)) ||
      (isActive !== undefined && typeof isActive !== 'boolean')) {
    return res.status(400).json({ error: 'Informe limite de 0 a 10.000 ou situação válida.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const previous = await client.query(
      'SELECT id, is_admin, is_active, max_students FROM teachers WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!previous.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Professor não encontrado.' });
    }
    const before = previous.rows[0];
    // Nenhuma conta administrativa pode ser desativada por este fluxo.
    if (before.is_admin && isActive === false) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Não é permitido desativar uma conta administrativa.' });
    }
    const nextMax = maxStudents ?? before.max_students;
    const nextActive = isActive ?? before.is_active;
    const changed = nextMax !== before.max_students || nextActive !== before.is_active;
    const updated = await client.query(
      'UPDATE teachers SET max_students=$2, is_active=$3 WHERE id=$1 ' +
      'RETURNING id, full_name AS name, email, is_active AS "isActive", max_students AS "maxStudents"',
      [id, nextMax, nextActive],
    );
    if (changed) {
      // Mesma transação: não se confirma alteração sem registrar seu autor.
      await client.query(
        'INSERT INTO admin_audit_logs (id, actor_id, target_teacher_id, action, changes) ' +
        'VALUES ($1, $2, $3, $4, $5::jsonb)',
        [randomUUID(), req.teacher.id, id, 'teacher.settings.updated', JSON.stringify({
          before: { maxStudents: before.max_students, isActive: before.is_active },
          after: { maxStudents: nextMax, isActive: nextActive },
        })],
      );
    }
    await client.query('COMMIT');
    res.json({ teacher: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

registerAdminReadRoutes(app, requireTeacher, requireAdmin);
registerPlanRoutes(app, requireTeacher, requireAdmin);

// O professor só vê os próprios alunos.
app.get('/api/students', requireTeacher, async (req, res) => {
  const result = await db.query(
    'SELECT ' + studentSelect + ' FROM students WHERE teacher_id = $1 ORDER BY created_at DESC',
    [req.teacher.id],
  );
  const activeStudents = result.rows.filter(row => row.active).length;
  res.json({ students: result.rows, quota: { activeStudents, maxStudents: req.teacher.max_students } });
});
app.post('/api/students', requireTeacher, async (req, res) => {
  if (!validStudentName(req.body?.name)) {
    return res.status(400).json({ error: 'Informe nome do aluno (2 a 120 caracteres).' });
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT max_students FROM teachers WHERE id = $1 AND is_active FOR UPDATE', [req.teacher.id]);
    if (!locked.rows.length) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Conta desativada.' }); }
    const count = await client.query('SELECT COUNT(*)::INTEGER AS total FROM students WHERE teacher_id = $1 AND is_active', [req.teacher.id]);
    if (count.rows[0].total >= locked.rows[0].max_students) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Limite de alunos ativos atingido. Solicite ajuste ao administrador.' });
    }
    const result = await client.query(
      'INSERT INTO students (id, teacher_id, full_name) VALUES ($1, $2, $3) RETURNING ' + studentSelect,
      [randomUUID(), req.teacher.id, req.body.name.trim()],
    );
    await client.query('COMMIT');
    res.status(201).json({ student: result.rows[0] });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});
app.get('/api/students/:id', requireTeacher, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
  const student = await db.query(
    'SELECT ' + studentSelect + ' FROM students WHERE id = $1 AND teacher_id = $2',
    [req.params.id, req.teacher.id],
  );
  if (!student.rows.length) return res.status(404).json({ error: 'Aluno não encontrado.' });
  const exercises = await db.query(
    'SELECT e.id, e.title, e.sets, e.repetitions, e.schedule, e.instructions, ' +
    'COUNT(c.id)::INTEGER AS "completedCount", MAX(c.completed_at) AS "lastCompletedAt" ' +
    'FROM student_exercises e LEFT JOIN exercise_completions c ON c.exercise_id = e.id ' +
    'WHERE e.student_id = $1 AND e.teacher_id = $2 GROUP BY e.id ORDER BY e.created_at DESC',
    [req.params.id, req.teacher.id],
  );
  res.json({
    student: student.rows[0],
    exercises: exercises.rows,
    summary: {
      assignedExercises: exercises.rows.length,
      loggedCompletions: exercises.rows.reduce((n, e) => n + e.completedCount, 0),
    },
  });
});
app.put('/api/students/:id', requireTeacher, async (req, res) => {
  if (!validId(req.params.id) || !validStudentName(req.body?.name)) {
    return res.status(400).json({ error: 'Identificador ou nome inválido.' });
  }
  try {
    const b = req.body;
    const values = [
      req.params.id, req.teacher.id, b.name.trim(),
      optionalText(b.preferredName, 80), dateOfBirth(b.dateOfBirth),
      optionalText(b.phone, 30), optionalText(b.emergencyContact, 120),
      optionalText(b.emergencyPhone, 30), optionalText(b.goals, 1000),
      optionalText(b.notes, 1000),
    ];
    const result = await db.query(
      'UPDATE students SET full_name=$3, preferred_name=$4, date_of_birth=$5, phone=$6, ' +
      'emergency_contact=$7, emergency_phone=$8, goals=$9, notes=$10, updated_at=NOW() ' +
      'WHERE id=$1 AND teacher_id=$2 RETURNING ' + studentSelect,
      values,
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Aluno não encontrado.' });
    res.json({ student: result.rows[0] });
  } catch (error) {
    if (error.message === 'INVALID_FIELD') return res.status(400).json({ error: 'Revise os dados da ficha do aluno.' });
    throw error;
  }
});
app.patch('/api/students/:id/status', requireTeacher, async (req, res) => {
  const { active } = req.body ?? {};
  if (!validId(req.params.id) || typeof active !== 'boolean') {
    return res.status(400).json({ error: 'Informe uma situação válida.' });
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const teacher = await client.query('SELECT max_students FROM teachers WHERE id=$1 FOR UPDATE', [req.teacher.id]);
    const student = await client.query(
      'SELECT id, is_active FROM students WHERE id=$1 AND teacher_id=$2 FOR UPDATE',
      [req.params.id, req.teacher.id],
    );
    if (!student.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Aluno não encontrado.' }); }
    if (active && !student.rows[0].is_active) {
      const count = await client.query('SELECT COUNT(*)::INTEGER AS total FROM students WHERE teacher_id=$1 AND is_active', [req.teacher.id]);
      if (count.rows[0].total >= teacher.rows[0].max_students) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Limite de alunos ativos atingido.' });
      }
    }
    const result = await client.query(
      'UPDATE students SET is_active=$3, updated_at=NOW() WHERE id=$1 AND teacher_id=$2 RETURNING ' + studentSelect,
      [req.params.id, req.teacher.id, active],
    );
    await client.query('COMMIT');
    res.json({ student: result.rows[0] });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});
app.post('/api/students/:id/exercises', requireTeacher, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
  const { title, sets, repetitions, schedule, instructions } = req.body ?? {};
  if (!validStudentName(title) || !Number.isInteger(sets) || sets < 1 || sets > 30 ||
      !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 500) {
    return res.status(400).json({ error: 'Informe exercício, séries (1–30) e repetições (1–500).' });
  }
  let scheduleValue, instructionsValue;
  try {
    scheduleValue = optionalText(schedule, 120);
    instructionsValue = optionalText(instructions, 1000);
  } catch (_error) { return res.status(400).json({ error: 'Texto do exercício é muito longo.' }); }
  const student = await db.query(
    'SELECT id FROM students WHERE id=$1 AND teacher_id=$2 AND is_active',
    [req.params.id, req.teacher.id],
  );
  if (!student.rows.length) return res.status(404).json({ error: 'Aluno ativo não encontrado.' });
  const result = await db.query(
    'INSERT INTO student_exercises (id, teacher_id, student_id, title, sets, repetitions, schedule, instructions) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, title, sets, repetitions, schedule, instructions',
    [randomUUID(), req.teacher.id, req.params.id, title.trim(), sets, repetitions, scheduleValue, instructionsValue],
  );
  res.status(201).json({ exercise: result.rows[0] });
});
app.delete('/api/students/:id/exercises/:exerciseId', requireTeacher, async (req, res) => {
  if (!validId(req.params.id) || !validId(req.params.exerciseId)) return res.status(400).json({ error: 'Identificador inválido.' });
  const result = await db.query(
    'DELETE FROM student_exercises WHERE id=$1 AND student_id=$2 AND teacher_id=$3 RETURNING id',
    [req.params.exerciseId, req.params.id, req.teacher.id],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Exercício não encontrado.' });
  res.json({ ok: true });
});
app.post('/api/students/:id/exercises/:exerciseId/complete', requireTeacher, async (req, res) => {
  if (!validId(req.params.id) || !validId(req.params.exerciseId)) return res.status(400).json({ error: 'Identificador inválido.' });
  const result = await db.query(
    'INSERT INTO exercise_completions (id, teacher_id, student_id, exercise_id) ' +
    'SELECT $1, $2, $3, e.id FROM student_exercises e ' +
    'JOIN students s ON s.id=e.student_id ' +
    'WHERE e.id=$4 AND e.student_id=$3 AND e.teacher_id=$2 AND s.is_active ' +
    'RETURNING id, completed_at AS "completedAt"',
    [randomUUID(), req.teacher.id, req.params.id, req.params.exerciseId],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Exercício de aluno ativo não encontrado.' });
  res.status(201).json({ completion: result.rows[0] });
});

app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((error, _req, res, _next) => {
  console.error('API error:', error);
  if (!res.headersSent) res.status(500).json({ error: 'Erro interno do servidor.' });
});

await initDatabase();
const port = Number(process.env.PORT || 3001);
app.listen(port, '0.0.0.0', () => console.log('G Fit API iniciada na porta', port));
