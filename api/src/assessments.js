// Registros descritivos de avaliação funcional por profissional.
// Não há diagnóstico, classificação de risco ou interpretação de melhora/piora.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { buildAssessmentComparisons, normalizeAssessment } from './assessment-utils.js';

const validId = value => typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

const fields = [
  'id,student_id AS "studentId",',
  "to_char(assessment_date,'YYYY-MM-DD') AS date,",
  'category,test_name AS "testName",protocol,',
  'result_value::float8 AS value,unit,notes,',
  'created_at AS "createdAt",updated_at AS "updatedAt"',
].join(' ');

function previousSnapshot(record) {
  return {
    date: record.date, category: record.category, testName: record.testName,
    protocol: record.protocol, notes: record.notes,
    value: record.value, unit: record.unit,
  };
}
async function findStudent(id, teacherId, activeOnly = false) {
  const result = await db.query(
    'SELECT id FROM students WHERE id=$1 AND teacher_id=$2 ' +
    (activeOnly ? 'AND is_active' : ''),
    [id,teacherId],
  );
  return result.rows[0] || null;
}

export function registerAssessmentRoutes(app, requireTeacher, requireAccessForNewActivity) {
  app.get('/api/students/:id/assessments', requireTeacher, async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Aluno inválido.' });
    if (!await findStudent(req.params.id,req.teacher.id)) {
      return res.status(404).json({ error: 'Aluno não encontrado.' });
    }
    const [history, total] = await Promise.all([
      db.query(
        'SELECT ' + fields + ' FROM functional_assessments ' +
        'WHERE student_id=$1 AND teacher_id=$2 AND NOT is_void ' +
        'ORDER BY assessment_date DESC,created_at DESC,id DESC LIMIT 200',
        [req.params.id,req.teacher.id],
      ),
      db.query(
        'SELECT COUNT(*)::integer AS total FROM functional_assessments ' +
        'WHERE student_id=$1 AND teacher_id=$2 AND NOT is_void',
        [req.params.id,req.teacher.id],
      ),
    ]);
    res.json({
      assessments: history.rows, comparisons: buildAssessmentComparisons(history.rows),
      total: total.rows[0].total, truncated: total.rows[0].total > history.rows.length,
      clinicalInterpretation: false,
      comparisonNote: 'Diferença numérica entre datas distintas do mesmo teste e protocolo, sem interpretação clínica.',
    });
  });

  app.post('/api/students/:id/assessments',
    requireTeacher, requireAccessForNewActivity, async (req,res) => {
      if (!validId(req.params.id)) return res.status(400).json({ error:'Aluno inválido.' });
      const input = normalizeAssessment(req.body);
      if (!input) return res.status(400).json({
        error:'Revise a data, categoria, nome, unidade, valor e observações da avaliação.',
      });
      const id=randomUUID();
      const result=await db.query(
        'INSERT INTO functional_assessments ' +
        '(id,teacher_id,student_id,assessment_date,category,test_name,protocol,result_value,unit,notes) ' +
        'SELECT $1,$2,s.id,$4::date,$5,$6,$7,$8,$9,$10 FROM students s ' +
        'WHERE s.id=$3 AND s.teacher_id=$2 AND s.is_active RETURNING '+fields,
        [id,req.teacher.id,req.params.id,input.date,input.category,input.testName,
          input.protocol,input.value,input.unit,input.notes],
      );
      if (!result.rows.length) return res.status(404).json({error:'Aluno ativo não encontrado.'});
      res.status(201).json({assessment:result.rows[0]});
    });

  app.put('/api/students/:id/assessments/:assessmentId',
    requireTeacher, requireAccessForNewActivity, async (req,res) => {
      if (!validId(req.params.id) || !validId(req.params.assessmentId)) {
        return res.status(400).json({error:'Identificador inválido.'});
      }
      const input=normalizeAssessment(req.body);
      if (!input) return res.status(400).json({
        error:'Revise os dados da avaliação antes de salvar.',
      });
      const client=await db.connect();
      try {
        await client.query('BEGIN');
        const current=await client.query(
          'SELECT '+fields+' FROM functional_assessments a ' +
          'WHERE a.id=$1 AND a.student_id=$2 AND a.teacher_id=$3 ' +
          'AND NOT a.is_void AND EXISTS (SELECT 1 FROM students s ' +
          'WHERE s.id=a.student_id AND s.teacher_id=a.teacher_id AND s.is_active) ' +
          'FOR UPDATE OF a',
          [req.params.assessmentId,req.params.id,req.teacher.id],
        );
        if (!current.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({error:'Avaliação de aluno ativo não encontrada.'});
        }
        const old=current.rows[0];
        const changed=JSON.stringify(previousSnapshot(old))!==JSON.stringify(input);
        if (!changed) {
          await client.query('COMMIT');
          return res.json({assessment:old,unchanged:true});
        }
        await client.query(
          'INSERT INTO functional_assessment_changes ' +
          '(id,assessment_id,teacher_id,action,previous_values) ' +
          "VALUES ($1,$2,$3,'corrected',$4::jsonb)",
          [randomUUID(),old.id,req.teacher.id,JSON.stringify(previousSnapshot(old))],
        );
        const updated=await client.query(
          'UPDATE functional_assessments SET assessment_date=$4::date,category=$5,' +
          'test_name=$6,protocol=$7,result_value=$8,unit=$9,notes=$10,updated_at=NOW() ' +
          'WHERE id=$1 AND student_id=$2 AND teacher_id=$3 RETURNING '+fields,
          [old.id,req.params.id,req.teacher.id,input.date,input.category,
            input.testName,input.protocol,input.value,input.unit,input.notes],
        );
        await client.query('COMMIT');
        res.json({assessment:updated.rows[0],unchanged:false});
      } catch(error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {client.release();}
    });

  // Cancelamento lógico: não apaga o registro anterior nem suas correções auditáveis.
  app.delete('/api/students/:id/assessments/:assessmentId',requireTeacher,async(req,res)=>{
    if (!validId(req.params.id)||!validId(req.params.assessmentId)) {
      return res.status(400).json({error:'Identificador inválido.'});
    }
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      const current=await client.query(
        'SELECT '+fields+' FROM functional_assessments ' +
        'WHERE id=$1 AND student_id=$2 AND teacher_id=$3 AND NOT is_void FOR UPDATE',
        [req.params.assessmentId,req.params.id,req.teacher.id],
      );
      if (!current.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({error:'Avaliação não encontrada.'});
      }
      const old=current.rows[0];
      await client.query(
        'INSERT INTO functional_assessment_changes ' +
        '(id,assessment_id,teacher_id,action,previous_values) ' +
        "VALUES ($1,$2,$3,'voided',$4::jsonb)",
        [randomUUID(),old.id,req.teacher.id,JSON.stringify(previousSnapshot(old))],
      );
      await client.query(
        'UPDATE functional_assessments SET is_void=TRUE,voided_at=NOW(),updated_at=NOW() ' +
        'WHERE id=$1 AND student_id=$2 AND teacher_id=$3',
        [old.id,req.params.id,req.teacher.id],
      );
      await client.query('COMMIT');
      res.json({voided:true,retainedForAudit:true});
    } catch(error) {await client.query('ROLLBACK');throw error;}
    finally {client.release();}
  });

  app.get('/api/students/:id/assessments/:assessmentId/changes',
    requireTeacher,async(req,res)=>{
      if (!validId(req.params.id)||!validId(req.params.assessmentId)) {
        return res.status(400).json({error:'Identificador inválido.'});
      }
      const exists=await db.query(
        'SELECT id FROM functional_assessments ' +
        'WHERE id=$1 AND student_id=$2 AND teacher_id=$3',
        [req.params.assessmentId,req.params.id,req.teacher.id],
      );
      if (!exists.rows.length) return res.status(404).json({error:'Avaliação não encontrada.'});
      const changes=await db.query(
        'SELECT c.id,c.action,c.previous_values AS "previousValues", ' +
        'c.created_at AS "changedAt" ' +
        'FROM functional_assessment_changes c ' +
        'WHERE c.assessment_id=$1 AND c.teacher_id=$2 ' +
        'ORDER BY c.created_at DESC,c.id DESC LIMIT 100',
        [req.params.assessmentId,req.teacher.id],
      );
      res.json({changes:changes.rows,historyLimit:100});
    });
}
