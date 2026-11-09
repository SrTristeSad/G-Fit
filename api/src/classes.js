// Turmas e presenças gerenciadas somente pelo professor responsável.
// Não há confirmação automática de presença, prontuários clínicos ou check-in de alunos.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { weekdaysToMask, maskToWeekdays } from './weekday.js';

const validId = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      value < '2020-01-01' || value > '2100-12-31') return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
const validTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const optionalNotes = (v, max) => {
  if (v === undefined || v === null || v === '') return null;
  return typeof v === 'string' && v.length <= max ? (v.trim() || null) : undefined;
};
const validClass = input => {
  const mask = weekdaysToMask(input?.weekdays);
  const description = optionalNotes(input?.description,500);
  if (!input || typeof input.name !== 'string' ||
      input.name.trim().length < 2 || input.name.trim().length > 100 ||
      mask === null || mask === 0 ||
      !validTime(input.startTime) ||
      !Number.isInteger(input.durationMinutes) ||
      input.durationMinutes < 15 || input.durationMinutes > 240 ||
      !Number.isInteger(input.maxStudents) ||
      input.maxStudents < 1 || input.maxStudents > 200 ||
      description === undefined) return null;
  return { name: input.name.trim(), description, mask,
    time: input.startTime, duration: input.durationMinutes, capacity: input.maxStudents };
};

const classSelect = [
  'c.id,c.name,c.description,c.weekdays_mask AS "weekdaysMask",',
  "to_char(c.start_time,'HH24:MI') AS \"startTime\",",
  'c.duration_minutes AS "durationMinutes",c.max_students AS "maxStudents",',
  'c.is_active AS active,c.created_at AS "createdAt",',
  'COUNT(e.student_id) FILTER (WHERE e.is_active AND st.is_active)::INTEGER AS "enrolledCount"',
].join(' ');
function serializeGroup(row) {
  return { ...row, weekdays: maskToWeekdays(row.weekdaysMask) };
}

export function registerClassRoutes(app, requireTeacher, requireAccessForNewActivity) {
  app.get('/api/classes', requireTeacher, async (req,res) => {
    const result = await db.query(
      'SELECT ' + classSelect + ' FROM fitness_classes c ' +
      'LEFT JOIN class_enrollments e ON e.class_id=c.id ' +
      'LEFT JOIN students st ON st.id=e.student_id ' +
      'WHERE c.teacher_id=$1 GROUP BY c.id ' +
      'ORDER BY c.is_active DESC,c.created_at DESC LIMIT 200',
      [req.teacher.id],
    );
    res.json({ classes: result.rows.map(serializeGroup) });
  });

  app.post('/api/classes', requireTeacher, requireAccessForNewActivity, async (req,res) => {
    const input = validClass(req.body);
    if (!input) return res.status(400).json({
      error: 'Informe nome, dias, horário, duração (15–240 min) e capacidade (1–200).',
    });
    const inserted = await db.query(
      'INSERT INTO fitness_classes ' +
      '(id,teacher_id,name,description,weekdays_mask,start_time,duration_minutes,max_students) ' +
      'VALUES ($1,$2,$3,$4,$5,$6::time,$7,$8) RETURNING id',
      [randomUUID(),req.teacher.id,input.name,input.description,input.mask,
        input.time,input.duration,input.capacity],
    );
    res.status(201).json({ classId: inserted.rows[0].id });
  });

  app.get('/api/classes/:id', requireTeacher, async (req,res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
    const classResult = await db.query(
      'SELECT ' + classSelect + ' FROM fitness_classes c ' +
      'LEFT JOIN class_enrollments e ON e.class_id=c.id ' +
      'LEFT JOIN students st ON st.id=e.student_id ' +
      'WHERE c.id=$1 AND c.teacher_id=$2 GROUP BY c.id',
      [req.params.id,req.teacher.id],
    );
    if (!classResult.rows.length) return res.status(404).json({ error: 'Turma não encontrada.' });

    const [roster,sessions,attendance] = await Promise.all([
      db.query(
        'SELECT st.id,st.full_name AS name,st.preferred_name AS "preferredName", ' +
        'e.joined_at AS "joinedAt" ' +
        'FROM class_enrollments e JOIN students st ON st.id=e.student_id ' +
        'WHERE e.class_id=$1 AND e.teacher_id=$2 AND e.is_active AND st.is_active ' +
        'ORDER BY st.full_name,st.id',
        [req.params.id,req.teacher.id],
      ),
      db.query(
        'SELECT se.id,to_char(se.session_date,\'YYYY-MM-DD\') AS date, ' +
        'se.notes,se.created_at AS "createdAt" ' +
        'FROM class_sessions se WHERE se.class_id=$1 AND se.teacher_id=$2 ' +
        'ORDER BY se.session_date DESC LIMIT 60',
        [req.params.id,req.teacher.id],
      ),
      db.query(
        'SELECT a.session_id AS "sessionId",a.student_id AS "studentId", ' +
        'st.full_name AS "studentName",a.status,a.recorded_at AS "recordedAt" ' +
        'FROM class_attendance a JOIN class_sessions se ON se.id=a.session_id ' +
        'JOIN students st ON st.id=a.student_id ' +
        'WHERE se.class_id=$1 AND se.teacher_id=$2 AND ' +
        'se.id IN (SELECT id FROM class_sessions WHERE class_id=$1 AND teacher_id=$2 ' +
        'ORDER BY session_date DESC LIMIT 60) ' +
        'ORDER BY a.recorded_at DESC',
        [req.params.id,req.teacher.id],
      ),
    ]);
    const attendanceBySession = new Map();
    for (const entry of attendance.rows) {
      const previous = attendanceBySession.get(entry.sessionId) || [];
      previous.push(entry);
      attendanceBySession.set(entry.sessionId,previous);
    }
    res.json({
      class: serializeGroup(classResult.rows[0]),
      students: roster.rows,
      sessions: sessions.rows.map(row => ({
        ...row, attendance: attendanceBySession.get(row.id) || [],
      })),
      attendanceIsManual: true,
    });
  });

  app.put('/api/classes/:id', requireTeacher, requireAccessForNewActivity, async (req,res) => {
    if (!validId(req.params.id) || typeof req.body?.active !== 'boolean') {
      return res.status(400).json({ error: 'Identificador ou situação inválida.' });
    }
    const input = validClass(req.body);
    if (!input) return res.status(400).json({ error: 'Dados da turma inválidos.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        'SELECT id FROM fitness_classes WHERE id=$1 AND teacher_id=$2 FOR UPDATE',
        [req.params.id,req.teacher.id],
      );
      if (!current.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Turma não encontrada.' });
      }
      const count = await client.query(
        'SELECT COUNT(*)::INTEGER AS total FROM class_enrollments e ' +
        'JOIN students s ON s.id=e.student_id ' +
        'WHERE e.class_id=$1 AND e.is_active AND s.is_active',
        [req.params.id],
      );
      if (input.capacity < count.rows[0].total) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'O limite é menor que a quantidade atual de alunos da turma.',
        });
      }
      await client.query(
        'UPDATE fitness_classes SET name=$3,description=$4,weekdays_mask=$5, ' +
        'start_time=$6::time,duration_minutes=$7,max_students=$8,is_active=$9,updated_at=NOW() ' +
        'WHERE id=$1 AND teacher_id=$2',
        [req.params.id,req.teacher.id,input.name,input.description,input.mask,input.time,
          input.duration,input.capacity,req.body.active],
      );
      await client.query('COMMIT');
      res.json({ ok:true });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });

  app.post('/api/classes/:id/enrollments', requireTeacher, requireAccessForNewActivity,
    async (req,res) => {
      const studentId = req.body?.studentId;
      if (!validId(req.params.id) || !validId(studentId)) {
        return res.status(400).json({ error: 'Identificador da turma ou aluno inválido.' });
      }
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        // Serialize simultaneous signups on class row; protect capacity.
        const group = await client.query(
          'SELECT id,max_students,is_active FROM fitness_classes ' +
          'WHERE id=$1 AND teacher_id=$2 FOR UPDATE',
          [req.params.id,req.teacher.id],
        );
        if (!group.rows.length || !group.rows[0].is_active) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Turma ativa não encontrada.' });
        }
        const student = await client.query(
          'SELECT id FROM students WHERE id=$1 AND teacher_id=$2 AND is_active FOR UPDATE',
          [studentId,req.teacher.id],
        );
        if (!student.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Aluno ativo não encontrado.' });
        }
        const membership = await client.query(
          'SELECT is_active FROM class_enrollments WHERE class_id=$1 AND student_id=$2',
          [req.params.id,studentId],
        );
        if (membership.rows[0]?.is_active) {
          await client.query('COMMIT');
          return res.json({ enrolled:true,unchanged:true });
        }
        const count = await client.query(
          'SELECT COUNT(*)::INTEGER AS total FROM class_enrollments e ' +
          'JOIN students s ON s.id=e.student_id ' +
          'WHERE e.class_id=$1 AND e.is_active AND s.is_active',
          [req.params.id],
        );
        if (count.rows[0].total >= group.rows[0].max_students) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'A turma atingiu o limite de vagas.' });
        }
        await client.query(
          'INSERT INTO class_enrollments (class_id,student_id,teacher_id) VALUES ($1,$2,$3) ' +
          'ON CONFLICT(class_id,student_id) DO UPDATE SET is_active=TRUE,updated_at=NOW()',
          [req.params.id,studentId,req.teacher.id],
        );
        await client.query('COMMIT');
        res.status(201).json({ enrolled:true,unchanged:false });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    });

  app.delete('/api/classes/:id/enrollments/:studentId', requireTeacher, async (req,res) => {
    if (!validId(req.params.id) || !validId(req.params.studentId)) {
      return res.status(400).json({ error: 'Identificador inválido.' });
    }
    const row = await db.query(
      'UPDATE class_enrollments e SET is_active=FALSE,updated_at=NOW() ' +
      'FROM fitness_classes c WHERE c.id=e.class_id AND c.teacher_id=$1 ' +
      'AND e.class_id=$2 AND e.student_id=$3 AND e.teacher_id=$1 AND e.is_active ' +
      'RETURNING e.student_id',
      [req.teacher.id,req.params.id,req.params.studentId],
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Matrícula ativa não encontrada.' });
    res.json({ ok:true });
  });

  app.post('/api/classes/:id/sessions', requireTeacher, requireAccessForNewActivity,
    async (req,res) => {
      if (!validId(req.params.id) || !validDate(req.body?.date)) {
        return res.status(400).json({ error: 'Identificador ou data inválida.' });
      }
      const notes = optionalNotes(req.body?.notes,500);
      if (notes === undefined) return res.status(400).json({ error: 'Observações muito longas.' });
      try {
        const row = await db.query(
          'INSERT INTO class_sessions (id,class_id,teacher_id,session_date,notes) ' +
          'SELECT $1,c.id,$2,$3::date,$4 FROM fitness_classes c ' +
          'WHERE c.id=$5 AND c.teacher_id=$2 AND c.is_active RETURNING id',
          [randomUUID(),req.teacher.id,req.body.date,notes,req.params.id],
        );
        if (!row.rows.length) return res.status(404).json({ error: 'Turma ativa não encontrada.' });
        return res.status(201).json({ sessionId:row.rows[0].id });
      } catch (error) {
        if (error.code === '23505') return res.status(409).json({
          error: 'Já existe uma aula registrada para esta data nesta turma.',
        });
        throw error;
      }
    });

  app.put('/api/classes/:id/sessions/:sessionId/attendance', requireTeacher, async (req,res) => {
    if (!validId(req.params.id) || !validId(req.params.sessionId) ||
        !Array.isArray(req.body?.records) || req.body.records.length < 1 ||
        req.body.records.length > 200 ||
        req.body.records.some(r => !validId(r?.studentId) ||
          ![null,'present','absent','excused'].includes(r.status)) ||
        new Set(req.body.records.map(r => r.studentId)).size !== req.body.records.length) {
      return res.status(400).json({ error: 'Informe até 200 alunos únicos e presenças válidas.' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query(
        'SELECT se.id FROM class_sessions se JOIN fitness_classes c ON c.id=se.class_id ' +
        'WHERE se.id=$1 AND se.class_id=$2 AND se.teacher_id=$3 AND c.teacher_id=$3 FOR UPDATE OF se',
        [req.params.sessionId,req.params.id,req.teacher.id],
      );
      if (!session.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Aula não encontrada.' });
      }
      const ids = req.body.records.map(r => r.studentId);
      const allowed = await client.query(
        'SELECT e.student_id FROM class_enrollments e JOIN students st ON st.id=e.student_id ' +
        'WHERE e.class_id=$1 AND e.teacher_id=$2 AND e.is_active AND st.is_active ' +
        'AND e.student_id = ANY($3::uuid[])',
        [req.params.id,req.teacher.id,ids],
      );
      if (allowed.rows.length !== ids.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Uma ou mais matrículas não estão ativas nesta turma.',
        });
      }
      for (const record of req.body.records) {
        if (record.status === null) {
          await client.query(
            'DELETE FROM class_attendance WHERE session_id=$1 AND student_id=$2',
            [req.params.sessionId,record.studentId],
          );
        } else {
          await client.query(
            'INSERT INTO class_attendance ' +
            '(session_id,student_id,status,recorded_by) VALUES ($1,$2,$3,$4) ' +
            'ON CONFLICT(session_id,student_id) DO UPDATE SET ' +
            'status=EXCLUDED.status,recorded_by=EXCLUDED.recorded_by,recorded_at=NOW()',
            [req.params.sessionId,record.studentId,record.status,req.teacher.id],
          );
        }
      }
      await client.query('COMMIT');
      res.json({ saved:ids.length });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
}
