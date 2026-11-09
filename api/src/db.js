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
  await db.query(
    'CREATE TABLE IF NOT EXISTS teachers (' +
      'id UUID PRIMARY KEY, full_name VARCHAR(120) NOT NULL, ' +
      'email VARCHAR(254) NOT NULL UNIQUE, password_hash TEXT NOT NULL, ' +
      'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());' +
    'CREATE TABLE IF NOT EXISTS sessions (' +
      'token_hash CHAR(64) PRIMARY KEY, ' +
      'teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE, ' +
      'expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());' +
    'CREATE INDEX IF NOT EXISTS sessions_teacher_idx ON sessions(teacher_id);' +
    'CREATE TABLE IF NOT EXISTS students (' +
      'id UUID PRIMARY KEY, ' +
      'teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE, ' +
      'full_name VARCHAR(120) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());' +
    'CREATE INDEX IF NOT EXISTS students_teacher_idx ON students(teacher_id);'
  );
}
