// Catálogo autoral do professor e prescrições semanais individuais.
// A biblioteca não é uma importação do openGym e não prescreve exercícios automaticamente.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';

const validId = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const textField = (v, min, max) => typeof v === 'string' &&
  v.trim().length >= min && v.trim().length <= max;
const textOrNull = (v, max) => (v === undefined || v === null || v === '') ? null :
  (typeof v === 'string' && v.length <= max ? (v.trim() || null) : undefined);
const intRange = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isOptionalDuration = v => v === undefined || v === null || v === '' || intRange(v, 1, 240);

export function weekdaysToMask(value) {
  if (value === undefined || value === null) return 0;
  if (!Array.isArray(value) || value.length > 7 ||
    value.some(day => !intRange(day, 1, 7)) ||
    new Set(value).size !== value.length) return null;
  return value.reduce((mask, day) => mask | (1 << (day - 1)), 0);
}
export function maskToWeekdays(mask) {
  if (!intRange(mask, 0, 127)) return [];
  return [1, 2, 3, 4, 5, 6, 7].filter(day => mask & (1 << (day - 1)));
}
function normalizeDuration(v) {
  return (v === undefined || v === null || v === '') ? null : v;
}
function libraryInput(body) {
  if (!body || !textField(body.title, 2, 120) ||
      !textField(body.category, 2, 60) ||
      !intRange(body.defaultSets, 1, 30) ||
      !intRange(body.defaultRepetitions, 1, 500) ||
      !isOptionalDuration(body.defaultDurationMinutes)) return null;
  const description = textOrNull(body.description, 1000);
  if (description === undefined) return null;
  return {
    title: body.title.trim(), category: body.category.trim(),
    description, sets: body.defaultSets, repetitions: body.defaultRepetitions,
    duration: normalizeDuration(body.defaultDurationMinutes),
  };
}
const fields = 'id, title, category, description, default_sets AS "defaultSets", ' +
  'default_repetitions AS "defaultRepetitions", ' +
  'default_duration_minutes AS "defaultDurationMinutes", ' +
  'is_active AS active, created_at AS "createdAt", updated_at AS "updatedAt"';

function validateNewPrescription(body, catalog) {
  const title = catalog ? catalog.title : body?.title;
  const sets = body?.sets ?? catalog?.default_sets;
  const repetitions = body?.repetitions ?? catalog?.default_repetitions;
  const duration = body?.durationMinutes ?? catalog?.default_duration_minutes ?? null;
  const weekdaysMask = weekdaysToMask(body?.weekdays);
  const instructions = textOrNull(body?.instructions, 1000);
  const schedule = textOrNull(body?.schedule, 120);
  if (!textField(title, 2, 120) || !intRange(sets, 1, 30) ||
      !intRange(repetitions, 1, 500) || !isOptionalDuration(duration) ||
      weekdaysMask === null || instructions === undefined || schedule === undefined) return null;
  return {
    title: title.trim(), sets, repetitions, duration: normalizeDuration(duration),
    schedule, instructions: instructions ?? catalog?.description ?? null, weekdaysMask,
  };
}

export function registerWorkoutRoutes(app, requireTeacher, requireAccessForNewActivity) {
  app.get('/api/exercises/library', requireTeacher, async (req, res) => {
    const rows = await db.query(
      'SELECT ' + fields + ' FROM exercise_library WHERE teacher_id=$1 ' +
      'ORDER BY is_active DESC, title ASC, created_at DESC',
      [req.teacher.id],
    );
    res.json({ exercises: rows.rows, source: 'teacher_authored' });
  });

  app.post('/api/exercises/library', requireTeacher, requireAccessForNewActivity, async (req, res) => {
    const input = libraryInput(req.body);
    if (!input) return res.status(400).json({ error: 'Revise os dados do exercício (nome, categoria, séries, repetições e duração).' });
    const row = await db.query(
      'INSERT INTO exercise_library ' +
      '(id,teacher_id,title,category,description,default_sets,default_repetitions,default_duration_minutes) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ' + fields,
      [randomUUID(), req.teacher.id,input.title,input.category,input.description,
        input.sets,input.repetitions,input.duration],
    );
    res.status(201).json({ exercise: row.rows[0] });
  });

  app.put('/api/exercises/library/:id', requireTeacher, requireAccessForNewActivity, async (req, res) => {
    const input = libraryInput(req.body);
    if (!validId(req.params.id) || !input || typeof req.body.active !== 'boolean') {
      return res.status(400).json({ error: 'Revise os dados do exercício e sua situação.' });
    }
    const result = await db.query(
      'UPDATE exercise_library SET title=$3,category=$4,description=$5,default_sets=$6, ' +
      'default_repetitions=$7,default_duration_minutes=$8,is_active=$9,updated_at=NOW() ' +
      'WHERE id=$1 AND teacher_id=$2 RETURNING ' + fields,
      [req.params.id,req.teacher.id,input.title,input.category,input.description,
        input.sets,input.repetitions,input.duration,req.body.active],
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Exercício não encontrado.' });
    res.json({ exercise: result.rows[0] });
  });

  app.post('/api/students/:id/exercises', requireTeacher, requireAccessForNewActivity, async (req,res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Aluno inválido.' });
    const libraryId = req.body?.libraryExerciseId ?? null;
    if (libraryId !== null && !validId(libraryId)) {
      return res.status(400).json({ error: 'Identificador de exercício inválido.' });
    }
    let catalog = null;
    if (libraryId) {
      const found = await db.query(
        'SELECT * FROM exercise_library WHERE id=$1 AND teacher_id=$2 AND is_active',
        [libraryId,req.teacher.id],
      );
      catalog = found.rows[0];
      if (!catalog) return res.status(404).json({ error: 'Exercício ativo não encontrado no seu catálogo.' });
    }
    const input = validateNewPrescription(req.body,catalog);
    if (!input) return res.status(400).json({ error: 'Revise séries, repetições, duração e dias da semana.' });
    const result = await db.query(
      'INSERT INTO student_exercises ' +
      '(id,teacher_id,student_id,title,sets,repetitions,schedule,instructions,library_exercise_id,weekdays_mask,duration_minutes) ' +
      'SELECT $1,$2,s.id,$4,$5,$6,$7,$8,$9,$10,$11 FROM students s ' +
      'WHERE s.id=$3 AND s.teacher_id=$2 AND s.is_active ' +
      'RETURNING id,title,sets,repetitions,schedule,instructions,weekdays_mask AS "weekdaysMask", ' +
      'duration_minutes AS "durationMinutes",library_exercise_id AS "libraryExerciseId"',
      [randomUUID(),req.teacher.id,req.params.id,input.title,input.sets,input.repetitions,
        input.schedule,input.instructions,libraryId,input.weekdaysMask,input.duration],
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Aluno ativo não encontrado.' });
    res.status(201).json({ exercise: {
      ...result.rows[0], weekdays: maskToWeekdays(result.rows[0].weekdaysMask),
    } });
  });

  // O professor pode editar a prescrição; registros de execução anteriores são preservados.
  app.patch('/api/students/:id/exercises/:exerciseId', requireTeacher, requireAccessForNewActivity,
    async (req,res) => {
      if (!validId(req.params.id) || !validId(req.params.exerciseId)) {
        return res.status(400).json({ error: 'Identificador inválido.' });
      }
      // Atualização completa dos parâmetros; não altera o título quando o catálogo muda.
      const input = validateNewPrescription(req.body,null);
      if (!input) return res.status(400).json({ error: 'Revise os dados da prescrição semanal.' });
      const result = await db.query(
        'UPDATE student_exercises e SET title=$4,sets=$5,repetitions=$6,schedule=$7, ' +
        'instructions=$8,weekdays_mask=$9,duration_minutes=$10,updated_at=NOW() ' +
        'FROM students s WHERE e.id=$1 AND e.student_id=$2 AND e.teacher_id=$3 ' +
        'AND s.id=e.student_id AND s.teacher_id=$3 AND s.is_active ' +
        'RETURNING e.id,e.title,e.sets,e.repetitions,e.schedule,e.instructions, ' +
        'e.weekdays_mask AS "weekdaysMask",e.duration_minutes AS "durationMinutes"',
        [req.params.exerciseId,req.params.id,req.teacher.id,input.title,input.sets,
          input.repetitions,input.schedule,input.instructions,input.weekdaysMask,input.duration],
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Prescrição de aluno ativo não encontrada.' });
      res.json({ exercise: {
        ...result.rows[0],weekdays:maskToWeekdays(result.rows[0].weekdaysMask),
      } });
    });
}
