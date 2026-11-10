// Gestão administrativa de solicitações de eliminação: SEM exclusão automática.
// A origem informada é declaratória, não constitui verificação da identidade do titular.
// Admin vê somente ID do aluno, professor e metadados, nunca fichas/avaliações.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';

const validId = value => typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const origins = ['student','guardian','teacher'];
const statuses = ['submitted','reviewing','awaiting_policy'];
const fields = [
  'r.id,r.teacher_id AS "teacherId",r.student_id AS "studentId",',
  'r.reported_by AS "reportedBy",r.status,',
  'r.requested_at AS "requestedAt",r.updated_at AS "updatedAt"',
].join(' ');

async function getOwnedStudent(client, studentId, teacherId) {
  const result = await client.query(
    'SELECT id FROM students WHERE id=$1 AND teacher_id=$2',
    [studentId,teacherId],
  );
  return result.rows.length > 0;
}
async function getRequestHistory(client, requestId) {
  const history = await client.query(
    'SELECT h.id,h.previous_status AS "previousStatus",h.next_status AS "nextStatus", ' +
    'h.created_at AS "changedAt",t.is_admin AS "byAdmin" ' +
    'FROM student_erasure_request_events h JOIN teachers t ON t.id=h.actor_id ' +
    'WHERE h.request_id=$1 ORDER BY h.created_at,h.id',
    [requestId],
  );
  return history.rows;
}

export function registerErasureRequestRoutes(app,requireTeacher,requireAdmin,rateLimit) {
  const requestLimiter=rateLimit({
    windowMs:15*60*1000, limit:10,
    standardHeaders:'draft-8', legacyHeaders:false,
    message:{error:'Muitas solicitações. Tente novamente mais tarde.'},
  });

  app.get('/api/students/:id/erasure-request',requireTeacher,async(req,res)=>{
    if(!validId(req.params.id))return res.status(400).json({error:'Aluno inválido.'});
    if(!await getOwnedStudent(db,req.params.id,req.teacher.id)) {
      return res.status(404).json({error:'Aluno não encontrado.'});
    }
    const result=await db.query(
      'SELECT '+fields+' FROM student_erasure_requests r ' +
      'WHERE r.student_id=$1 AND r.teacher_id=$2',
      [req.params.id,req.teacher.id],
    );
    const entry=result.rows[0]||null;
    res.json({
      request:entry,
      history:entry?await getRequestHistory(db,entry.id):[],
      automatedErasure:false,
      identityVerified:false,
      note:'Registro administrativo declaratório. O sistema não confirma identidade nem elimina dados.',
    });
  });

  app.post('/api/students/:id/erasure-request',
    requireTeacher,requestLimiter,async(req,res)=>{
      if(!validId(req.params.id) || !origins.includes(req.body?.reportedBy)){
        return res.status(400).json({error:'Informe um aluno válido e a origem declarada do pedido.'});
      }
      if(req.body?.confirmation!=='REGISTER_REVIEW_ONLY'){
        return res.status(400).json({error:'Confirme que o registro não apaga dados.'});
      }
      const client=await db.connect();
      try {
        await client.query('BEGIN');
        if(!await getOwnedStudent(client,req.params.id,req.teacher.id)){
          await client.query('ROLLBACK');
          return res.status(404).json({error:'Aluno não encontrado.'});
        }
        const id=randomUUID();
        const result=await client.query(
          'INSERT INTO student_erasure_requests (id,teacher_id,student_id,reported_by) ' +
          'VALUES ($1,$2,$3,$4) RETURNING id',
          [id,req.teacher.id,req.params.id,req.body.reportedBy],
        );
        await client.query(
          'INSERT INTO student_erasure_request_events ' +
          '(id,request_id,actor_id,previous_status,next_status) ' +
          "VALUES ($1,$2,$3,NULL,'submitted')",
          [randomUUID(),id,req.teacher.id],
        );
        await client.query('COMMIT');
        res.status(201).json({
          requestId:result.rows[0].id,status:'submitted',
          deletionPerformed:false,identityVerified:false,
        });
      } catch(error){
        await client.query('ROLLBACK');
        if(error.code==='23505')return res.status(409).json({
          error:'Já existe um pedido de avaliação para este aluno.',
        });
        throw error;
      } finally {client.release();}
    });

  app.get('/api/admin/privacy/requests',
    requireTeacher,requireAdmin,async(_req,res)=>{
      const [result,counts]=await Promise.all([
        db.query(
          'SELECT '+fields+',t.full_name AS "teacherName",t.email AS "teacherEmail" ' +
          'FROM student_erasure_requests r ' +
          'JOIN teachers t ON t.id=r.teacher_id ' +
          'ORDER BY CASE r.status WHEN \'submitted\' THEN 0 ' +
          'WHEN \'reviewing\' THEN 1 ELSE 2 END,r.requested_at DESC LIMIT 200',
        ),
        db.query(
          'SELECT COUNT(*) FILTER(WHERE status=\'submitted\')::integer AS "submitted", ' +
          'COUNT(*) FILTER(WHERE status=\'reviewing\')::integer AS "reviewing", ' +
          'COUNT(*) FILTER(WHERE status=\'awaiting_policy\')::integer AS "awaitingPolicy" ' +
          'FROM student_erasure_requests',
        ),
      ]);
      res.json({
        requests:result.rows,summary:counts.rows[0],
        automatedErasure:false,identityVerification:'not_implemented',
      });
    });

  app.patch('/api/admin/privacy/requests/:id',
    requireTeacher,requireAdmin,async(req,res)=>{
      if(!validId(req.params.id)||!['reviewing','awaiting_policy'].includes(req.body?.status)){
        return res.status(400).json({error:'Pedido ou status inválido.'});
      }
      const client=await db.connect();
      try {
        await client.query('BEGIN');
        const locked=await client.query(
          'SELECT id,status FROM student_erasure_requests WHERE id=$1 FOR UPDATE',
          [req.params.id],
        );
        if(!locked.rows.length){
          await client.query('ROLLBACK');
          return res.status(404).json({error:'Pedido não encontrado.'});
        }
        const old=locked.rows[0].status;
        if(old===req.body.status){
          await client.query('COMMIT');
          return res.json({status:old,unchanged:true,deletionPerformed:false});
        }
        // Estados administrativos de triagem: nunca concluem nem executam eliminação.
        await client.query(
          'UPDATE student_erasure_requests SET status=$2,reviewed_by=$3,updated_at=NOW() ' +
          'WHERE id=$1',
          [req.params.id,req.body.status,req.teacher.id],
        );
        await client.query(
          'INSERT INTO student_erasure_request_events ' +
          '(id,request_id,actor_id,previous_status,next_status) ' +
          'VALUES ($1,$2,$3,$4,$5)',
          [randomUUID(),req.params.id,req.teacher.id,old,req.body.status],
        );
        await client.query('COMMIT');
        res.json({status:req.body.status,unchanged:false,deletionPerformed:false});
      } catch(error){
        await client.query('ROLLBACK');
        throw error;
      } finally {client.release();}
    });
}
