import pg from 'pg';

const { Pool } = pg;
if (!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD ausente');
export const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'gfit',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'gfit',
  max: 10,
});

export async function initDatabase() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Migrações aditivas: preservam dados da primeira versão.
    await client.query([
      'CREATE TABLE IF NOT EXISTS teachers (id UUID PRIMARY KEY, full_name VARCHAR(120) NOT NULL, email VARCHAR(254) NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());',
      'ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;',
      'ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;',
      'ALTER TABLE teachers ADD COLUMN IF NOT EXISTS max_students INTEGER NOT NULL DEFAULT 20;',
      'CREATE TABLE IF NOT EXISTS sessions (token_hash CHAR(64) PRIMARY KEY, teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());',
      'CREATE INDEX IF NOT EXISTS sessions_teacher_idx ON sessions(teacher_id);',
      'CREATE TABLE IF NOT EXISTS students (id UUID PRIMARY KEY, teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE, full_name VARCHAR(120) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());',
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS preferred_name VARCHAR(80);',
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS date_of_birth DATE;',
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS phone VARCHAR(30);',
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(120);',
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_phone VARCHAR(30);',
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS goals VARCHAR(1000);',
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS notes VARCHAR(1000);',
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;',
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();',
      'CREATE INDEX IF NOT EXISTS students_teacher_idx ON students(teacher_id);',
      'CREATE TABLE IF NOT EXISTS student_exercises (id UUID PRIMARY KEY, teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE, student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE, title VARCHAR(120) NOT NULL, sets INTEGER NOT NULL, repetitions INTEGER NOT NULL, schedule VARCHAR(120), instructions VARCHAR(1000), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());',
      'CREATE INDEX IF NOT EXISTS exercise_student_idx ON student_exercises(student_id, teacher_id);',
      'CREATE TABLE IF NOT EXISTS exercise_completions (id UUID PRIMARY KEY, teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE, student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE, exercise_id UUID NOT NULL REFERENCES student_exercises(id) ON DELETE CASCADE, completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());',
      'CREATE INDEX IF NOT EXISTS completions_student_idx ON exercise_completions(student_id, teacher_id);',
    ].join('\n'));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
