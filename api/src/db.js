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
      'CREATE TABLE IF NOT EXISTS exercise_library (id UUID PRIMARY KEY, teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE, title VARCHAR(120) NOT NULL, category VARCHAR(60) NOT NULL, description VARCHAR(1000), default_sets INTEGER NOT NULL CHECK(default_sets BETWEEN 1 AND 30), default_repetitions INTEGER NOT NULL CHECK(default_repetitions BETWEEN 1 AND 500), default_duration_minutes INTEGER CHECK(default_duration_minutes BETWEEN 1 AND 240), is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());',
      'CREATE INDEX IF NOT EXISTS exercise_library_teacher_idx ON exercise_library(teacher_id,is_active,title);',
      'ALTER TABLE student_exercises ADD COLUMN IF NOT EXISTS library_exercise_id UUID REFERENCES exercise_library(id) ON DELETE SET NULL;',
      'ALTER TABLE student_exercises ADD COLUMN IF NOT EXISTS weekdays_mask INTEGER NOT NULL DEFAULT 0;',
      'ALTER TABLE student_exercises ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;',
      'ALTER TABLE student_exercises ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();',
      'CREATE INDEX IF NOT EXISTS student_exercises_teacher_library_idx ON student_exercises(teacher_id,library_exercise_id);',
      'CREATE TABLE IF NOT EXISTS exercise_completions (id UUID PRIMARY KEY, teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE, student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE, exercise_id UUID NOT NULL REFERENCES student_exercises(id) ON DELETE CASCADE, completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());',
      'CREATE INDEX IF NOT EXISTS completions_student_idx ON exercise_completions(student_id, teacher_id);',
      'CREATE TABLE IF NOT EXISTS admin_audit_logs (id UUID PRIMARY KEY, actor_id UUID NOT NULL REFERENCES teachers(id), target_teacher_id UUID REFERENCES teachers(id), action VARCHAR(60) NOT NULL, changes JSONB NOT NULL DEFAULT \'{}\'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());',
      'CREATE INDEX IF NOT EXISTS admin_audit_recent_idx ON admin_audit_logs(created_at DESC);',
      'CREATE TABLE IF NOT EXISTS plans (id UUID PRIMARY KEY, name VARCHAR(80) NOT NULL, description VARCHAR(300) NOT NULL DEFAULT \'\', price_cents INTEGER NOT NULL CHECK (price_cents >= 0 AND price_cents <= 10000000), billing_cycle VARCHAR(10) NOT NULL CHECK (billing_cycle IN (\'monthly\', \'yearly\')), max_students INTEGER NOT NULL CHECK (max_students BETWEEN 0 AND 10000), is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());',
      'CREATE UNIQUE INDEX IF NOT EXISTS plans_unique_name_ci ON plans (LOWER(name));',
      'CREATE TABLE IF NOT EXISTS teacher_plan_assignments (teacher_id UUID PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE, plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT, assigned_by UUID NOT NULL REFERENCES teachers(id), assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), source VARCHAR(12) NOT NULL DEFAULT \'manual\' CHECK (source=\'manual\'));',
      'CREATE INDEX IF NOT EXISTS teacher_plan_assignments_plan_idx ON teacher_plan_assignments(plan_id);',
      'CREATE TABLE IF NOT EXISTS teacher_access_terms (teacher_id UUID PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE, starts_on DATE NOT NULL, ends_on DATE NOT NULL, revoked_at TIMESTAMPTZ, updated_by UUID NOT NULL REFERENCES teachers(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK (ends_on >= starts_on));',
      'CREATE INDEX IF NOT EXISTS teacher_access_terms_ends_idx ON teacher_access_terms(ends_on) WHERE revoked_at IS NULL;',
      'CREATE TABLE IF NOT EXISTS asaas_customers (teacher_id UUID PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE, customer_id VARCHAR(100) NOT NULL, updated_by UUID NOT NULL REFERENCES teachers(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());',
      'CREATE TABLE IF NOT EXISTS pix_charges (id UUID PRIMARY KEY, teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE, plan_id UUID NOT NULL REFERENCES plans(id), created_by UUID NOT NULL REFERENCES teachers(id), asaas_customer_id VARCHAR(100) NOT NULL, provider_payment_id VARCHAR(100) UNIQUE, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), billing_cycle VARCHAR(10) NOT NULL CHECK(billing_cycle IN (\'monthly\',\'yearly\')), due_date DATE NOT NULL, status VARCHAR(20) NOT NULL DEFAULT \'creating\' CHECK(status IN (\'creating\',\'pending\',\'paid\',\'cancelled\',\'review\')), paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());',
      'CREATE UNIQUE INDEX IF NOT EXISTS pix_one_open_per_teacher ON pix_charges(teacher_id) WHERE status IN (\'creating\',\'pending\');',
      'CREATE INDEX IF NOT EXISTS pix_charges_teacher_idx ON pix_charges(teacher_id,created_at DESC);',
      'ALTER TABLE pix_charges ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;',
      'ALTER TABLE pix_charges ADD COLUMN IF NOT EXISTS refund_state VARCHAR(20) NOT NULL DEFAULT \'none\';',
      'ALTER TABLE pix_charges ADD COLUMN IF NOT EXISTS refunded_cents INTEGER NOT NULL DEFAULT 0;',
      'CREATE INDEX IF NOT EXISTS pix_charges_due_idx ON pix_charges(due_date) WHERE status=\'pending\';',
      'CREATE TABLE IF NOT EXISTS asaas_webhook_events (event_id VARCHAR(180) PRIMARY KEY, event_type VARCHAR(90) NOT NULL, provider_payment_id VARCHAR(100), resolution VARCHAR(24) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());',
      'CREATE TABLE IF NOT EXISTS asaas_webhook_attempts (event_id VARCHAR(180) PRIMARY KEY, event_type VARCHAR(90) NOT NULL, provider_payment_id VARCHAR(100), attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts > 0), failure_count INTEGER NOT NULL DEFAULT 0, first_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_http_status SMALLINT, last_error_code VARCHAR(48));',
      'CREATE INDEX IF NOT EXISTS webhook_attempts_last_seen_idx ON asaas_webhook_attempts(last_received_at DESC);',
      'CREATE TABLE IF NOT EXISTS admin_alerts (id UUID PRIMARY KEY, alert_type VARCHAR(40) NOT NULL, source_key VARCHAR(180) NOT NULL, severity VARCHAR(10) NOT NULL CHECK (severity IN (\'warning\',\'critical\')), status VARCHAR(16) NOT NULL DEFAULT \'open\' CHECK (status IN (\'open\',\'acknowledged\',\'resolved\')), details JSONB NOT NULL DEFAULT \'{}\'::jsonb, first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), acknowledged_at TIMESTAMPTZ, acknowledged_by UUID REFERENCES teachers(id), resolved_at TIMESTAMPTZ, UNIQUE(alert_type,source_key));',
      'CREATE INDEX IF NOT EXISTS admin_alerts_status_idx ON admin_alerts(status,last_detected_at DESC);',
      'CREATE TABLE IF NOT EXISTS admin_alert_scanner (id SMALLINT PRIMARY KEY CHECK(id=1), last_success_at TIMESTAMPTZ, last_error_at TIMESTAMPTZ);',
      'INSERT INTO admin_alert_scanner (id) VALUES (1) ON CONFLICT(id) DO NOTHING;',
    ].join('\n'));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
