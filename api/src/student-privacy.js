// Exportação delimitada aos dados de UM aluno do professor autenticado.
// Protótipo: sem armazenar cópia do arquivo no servidor; somente metadados da exportação.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';

const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const maxArchiveBytes = 10 * 1024 * 1024;
const privateResponse = (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
};

const studentProjection = [
  'id,full_name AS name,preferred_name AS "preferredName",',
  "to_char(date_of_birth,'YYYY-MM-DD') AS \"dateOfBirth\",",
  'phone,emergency_contact AS "emergencyContact",',
  'emergency_phone AS "emergencyPhone",goals,notes,',
  'is_active AS active,created_at AS "createdAt",updated_at AS "updatedAt"',
].join(' ');

async function getOwnedStudent(client, id, teacherId) {
  const found = await client.query(
    'SELECT ' + studentProjection + ' FROM students WHERE id=$1 AND teacher_id=$2',
    [id,teacherId],
  );
  return found.rows[0] || null;
}

async function buildArchive(client, student, teacherId) {
  const args=[student.id,teacherId];
  // Nenhuma das consultas retorna dados de outro aluno. Anotações de aulas
  // compartilhadas não são exportadas para evitar expor informações de terceiros.
  const [exercises, completions, enrollments, attendance, assessments, revisions] =
    await Promise.all([
      client.query(
        'SELECT e.id,e.library_exercise_id AS "libraryExerciseId",e.title,' +
        'e.sets,e.repetitions,e.schedule,e.instructions,' +
        'e.weekdays_mask AS "weekdaysMask",e.duration_minutes AS "durationMinutes",' +
        'e.created_at AS "createdAt",e.updated_at AS "updatedAt" ' +
        'FROM student_exercises e WHERE e.student_id=$1 AND e.teacher_id=$2 ' +
        'ORDER BY e.created_at,e.id',args,
      ),
      client.query(
        'SELECT id,exercise_id AS "exerciseId",completed_at AS "completedAt" ' +
        'FROM exercise_completions WHERE student_id=$1 AND teacher_id=$2 ' +
        'ORDER BY completed_at,id',args,
      ),
      client.query(
        'SELECT e.class_id AS "classId",c.name AS "className",' +
        'c.weekdays_mask AS "weekdaysMask",' +
        "to_char(c.start_time,'HH24:MI') AS \"startTime\"," +
        'c.duration_minutes AS "durationMinutes",e.is_active AS active,' +
        'e.joined_at AS "joinedAt",e.updated_at AS "updatedAt" ' +
        'FROM class_enrollments e JOIN fitness_classes c ON c.id=e.class_id ' +
        'WHERE e.student_id=$1 AND e.teacher_id=$2 AND c.teacher_id=$2 ' +
        'ORDER BY e.joined_at,e.class_id',args,
      ),
      client.query(
        'SELECT a.session_id AS "sessionId",se.class_id AS "classId",' +
        'c.name AS "className",' +
        "to_char(se.session_date,'YYYY-MM-DD') AS \"sessionDate\"," +
        'a.status,a.recorded_at AS "recordedAt" ' +
        'FROM class_attendance a JOIN class_sessions se ON se.id=a.session_id ' +
        'JOIN fitness_classes c ON c.id=se.class_id ' +
        'WHERE a.student_id=$1 AND se.teacher_id=$2 AND c.teacher_id=$2 ' +
        'ORDER BY se.session_date,a.session_id',args,
      ),
      client.query(
        'SELECT a.id,' +
        "to_char(a.assessment_date,'YYYY-MM-DD') AS date," +
        'a.category,a.test_name AS "testName",a.protocol,' +
        'a.result_value::float8 AS value,a.unit,a.notes,' +
        'a.is_void AS "voided",a.voided_at AS "voidedAt",' +
        'a.created_at AS "createdAt",a.updated_at AS "updatedAt" ' +
        'FROM functional_assessments a WHERE a.student_id=$1 AND a.teacher_id=$2 ' +
        'ORDER BY a.assessment_date,a.created_at,a.id',args,
      ),
      client.query(
        'SELECT h.id,h.assessment_id AS "assessmentId",h.action,' +
        'h.previous_values AS "previousValues",h.created_at AS "changedAt" ' +
        'FROM functional_assessment_changes h ' +
        'JOIN functional_assessments a ON a.id=h.assessment_id ' +
        'WHERE a.student_id=$1 AND a.teacher_id=$2 AND h.teacher_id=$2 ' +
        'ORDER BY h.created_at,h.id',args,
      ),
    ]);

  const sections={
    exercises:exercises.rows,exerciseCompletions:completions.rows,
    classEnrollments:enrollments.rows,attendance:attendance.rows,
    functionalAssessments:assessments.rows,assessmentCorrections:revisions.rows,
  };
  return {
    format:'gfit.student.export',
    schemaVersion:1,
    exportedAt:new Date().toISOString(),
    student,
    ...sections,
    counts:Object.fromEntries(Object.entries(sections).map(([key,rows])=>[key,rows.length])),
    limitations:[
      'Aulas compartilhadas não incluem observações sobre terceiros.',
      'Itens excluídos fisicamente em versões anteriores não podem ser recuperados.',
      'Avaliações retiradas da lista visível e correções anteriores estão incluídas e identificadas.',
      'O arquivo contém dados pessoais. Guarde-o com cuidado e não compartilhe sem autorização.',
    ],
  };
}

export function registerStudentPrivacyRoutes(app,requireTeacher,rateLimit) {
  const exportLimit=rateLimit({
    windowMs:15*60*1000,limit:6,
    standardHeaders:'draft-8',legacyHeaders:false,
    message:{error:'Limite de exportações atingido. Tente mais tarde.'},
  });
  const prefix='/api/students/:id';

  app.get(prefix+'/privacy',requireTeacher,privateResponse,async(req,res)=>{
    if (!idPattern.test(req.params.id))return res.status(400).json({error:'Aluno inválido.'});
    const student=await getOwnedStudent(db,req.params.id,req.teacher.id);
    if (!student)return res.status(404).json({error:'Aluno não encontrado.'});
    const args=[req.params.id,req.teacher.id];
    const [counts,exports]=await Promise.all([
      db.query(
        'SELECT ' +
        '(SELECT COUNT(*)::integer FROM student_exercises WHERE student_id=$1 AND teacher_id=$2) AS exercises,' +
        '(SELECT COUNT(*)::integer FROM exercise_completions WHERE student_id=$1 AND teacher_id=$2) AS "exerciseCompletions",' +
        '(SELECT COUNT(*)::integer FROM class_enrollments WHERE student_id=$1 AND teacher_id=$2) AS "classEnrollments",' +
        '(SELECT COUNT(*)::integer FROM class_attendance a JOIN class_sessions s ON s.id=a.session_id ' +
        'WHERE a.student_id=$1 AND s.teacher_id=$2) AS attendance,' +
        '(SELECT COUNT(*)::integer FROM functional_assessments WHERE student_id=$1 AND teacher_id=$2) AS "functionalAssessments",' +
        '(SELECT COUNT(*)::integer FROM functional_assessment_changes h ' +
        'JOIN functional_assessments a ON a.id=h.assessment_id ' +
        'WHERE a.student_id=$1 AND a.teacher_id=$2 AND h.teacher_id=$2) AS "assessmentCorrections"',
        args,
      ),
      db.query(
        'SELECT id,exported_at AS "exportedAt",exported_bytes AS bytes,' +
        'schema_version AS "schemaVersion" FROM student_data_exports ' +
        'WHERE student_id=$1 AND teacher_id=$2 ORDER BY exported_at DESC,id DESC LIMIT 10',
        args,
      ),
    ]);
    res.json({
      studentId:student.id,counts:counts.rows[0],recentExports:exports.rows,
      exportFormat:'JSON UTF-8',retentionPolicy:'not_automated',
      note:'Não há descarte automático nem exclusão definitiva nesta versão. Exportações registram metadados, não uma cópia do conteúdo.',
    });
  });

  app.post(prefix+'/export',requireTeacher,privateResponse,exportLimit,async(req,res)=>{
    if (!idPattern.test(req.params.id))return res.status(400).json({error:'Aluno inválido.'});
    if (req.body?.confirmation !== 'EXPORT_SENSITIVE_DATA') {
      return res.status(400).json({error:'Confirme a exportação de dados pessoais.'});
    }
    let archive;
    const client=await db.connect();
    try {
      // A leitura inteira usa o mesmo snapshot para impedir exportações inconsistentes.
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const student=await getOwnedStudent(client,req.params.id,req.teacher.id);
      if (!student) {
        await client.query('ROLLBACK');
        return res.status(404).json({error:'Aluno não encontrado.'});
      }
      archive=await buildArchive(client,student,req.teacher.id);
      await client.query('COMMIT');
    } catch(error) {
      await client.query('ROLLBACK').catch(()=>{});
      throw error;
    } finally {
      client.release();
    }
    const payload=JSON.stringify(archive,null,2);
    const size=Buffer.byteLength(payload,'utf8');
    if (size>maxArchiveBytes) {
      return res.status(413).json({
        error:'Arquivo muito grande para esta exportação (limite 10 MiB). Procure o administrador.',
      });
    }
    // A operação não é confirmada sem deixar uma trilha de auditoria.
    await db.query(
      'INSERT INTO student_data_exports ' +
      '(id,teacher_id,student_id,exported_bytes,schema_version) VALUES ($1,$2,$3,$4,1)',
      [randomUUID(),req.teacher.id,req.params.id,size],
    );
    res.set('Content-Type','application/json; charset=utf-8');
    res.set('Content-Disposition','attachment; filename="gfit-aluno-'+req.params.id+'.json"');
    res.set('X-GFit-Export-Schema','1');
    res.status(200).send(payload);
  });
}
