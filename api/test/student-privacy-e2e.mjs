// Exportação JSON auditável e isolamento de dados pessoais; só dados sintéticos.
import assert from 'node:assert/strict';

const base='http://localhost:8080';
async function request(path,{method='GET',cookie,body,headers={}}={}) {
  const response=await fetch(base+path,{
    method,
    headers:{...(cookie?{Cookie:cookie}:{}),
      ...(body?{'Content-Type':'application/json'}:{}),...headers},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  const data=await response.json().catch(()=>({}));
  return {status:response.status,data,headers:response.headers,
    cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function login(email,password) {
  const result=await request('/api/auth/login',{
    method:'POST',body:{email,password},
  });
  assert.equal(result.status,200,JSON.stringify(result.data));
  return result.cookie;
}
const t1=await login('teste1@example.com','senha-para-testar-123');
const t2=await login('teste2@example.com','senha-segunda-conta-123');
const student=await request('/api/students',{
  method:'POST',cookie:t1,body:{name:'Pessoa Sintetica Exportavel'},
});
const other=await request('/api/students',{
  method:'POST',cookie:t1,body:{name:'PESSOA_SIGILOSA_NAO_EXPORTAR'},
});
assert.equal(student.status,201,JSON.stringify(student.data));
assert.equal(other.status,201,JSON.stringify(other.data));
const id=student.data.student.id;
const otherId=other.data.student.id;
const privacy='/api/students/'+id+'/privacy';
const exportPath='/api/students/'+id+'/export';

assert.equal((await request(privacy)).status,401);
assert.equal((await request(privacy,{cookie:t2})).status,404);
assert.equal((await request(exportPath,{
  method:'POST',cookie:t2,body:{confirmation:'EXPORT_SENSITIVE_DATA'},
})).status,404);
assert.equal((await request(exportPath,{method:'POST',cookie:t1})).status,400);
assert.equal((await request(exportPath,{
  method:'POST',cookie:t1,body:{confirmation:'invalid'},
})).status,400);
assert.equal((await request(exportPath,{
  method:'POST',cookie:t1,headers:{'Sec-Fetch-Site':'cross-site'},
  body:{confirmation:'EXPORT_SENSITIVE_DATA'},
})).status,403);
assert.equal((await request('/api/students/00000000-0000-4000-8000-000000000000/privacy',
  {cookie:t1})).status,404);

const before=await request(privacy,{cookie:t1});
assert.equal(before.status,200);
assert.ok(before.headers.get('cache-control')?.includes('no-store'));
assert.equal(before.data.retentionPolicy,'not_automated');
assert.equal(before.data.recentExports.length,0);
assert.equal(before.data.counts.exercises,0);

const updated=await request('/api/students/'+id,{
  method:'PUT',cookie:t1,body:{
    name:'Pessoa Sintetica Exportavel',preferredName:'Apelido Temporario',
    phone:'(00) 90000-0000',emergencyContact:'Contato Ficticio',
    emergencyPhone:'(00) 80000-0000',goals:'Objetivos sinteticos',
    notes:'Observacoes pessoais ficticias',
  },
});
assert.equal(updated.status,200);
const exercise=await request('/api/students/'+id+'/exercises',{
  method:'POST',cookie:t1,body:{
    title:'Exercicio para exportacao',sets:2,repetitions:10,weekdays:[1,3],
    schedule:'Seg e Qua',instructions:'Somente para teste',
  },
});
assert.equal(exercise.status,201,JSON.stringify(exercise.data));
const completion=await request('/api/students/'+id+'/exercises/'+exercise.data.exercise.id+'/complete',{
  method:'POST',cookie:t1,
});
assert.equal(completion.status,201);

const group=await request('/api/classes',{
  method:'POST',cookie:t1,body:{
    name:'Turma de Teste de Exportacao',
    weekdays:[2],startTime:'10:00',durationMinutes:45,maxStudents:2,
    description:'Turma apenas de teste',
  },
});
assert.equal(group.status,201);
const classId=group.data.classId;
for(const studentId of [id,otherId]){
  const enroll=await request('/api/classes/'+classId+'/enrollments',{
    method:'POST',cookie:t1,body:{studentId},
  });
  assert.equal(enroll.status,201);
}
const today=new Date().toISOString().slice(0,10);
const session=await request('/api/classes/'+classId+'/sessions',{
  method:'POST',cookie:t1,
  body:{date:today,notes:'SEGREDO_DE_OUTRO_ALUNO_NAS_NOTAS_DA_AULA'},
});
assert.equal(session.status,201,JSON.stringify(session.data));
const attendance=await request('/api/classes/'+classId+'/sessions/'+session.data.sessionId+'/attendance',{
  method:'PUT',cookie:t1,body:{records:[
    {studentId:id,status:'present'},
    {studentId:otherId,status:'absent'},
  ]},
});
assert.equal(attendance.status,200);

const assessmentRoute='/api/students/'+id+'/assessments';
const assessment=await request(assessmentRoute,{
  method:'POST',cookie:t1,body:{
    date:today,category:'mobility',testName:'Registro de teste privado',
    protocol:'Procedimento sintético',value:15,unit:'s',
    notes:'Valor original ficticio',
  },
});
assert.equal(assessment.status,201,JSON.stringify(assessment.data));
const assessmentId=assessment.data.assessment.id;
const corrected=await request(assessmentRoute+'/'+assessmentId,{
  method:'PUT',cookie:t1,body:{
    date:today,category:'mobility',testName:'Registro de teste privado',
    protocol:'Procedimento sintético',value:14,unit:'s',
    notes:'Valor corrigido ficticio',
  },
});
assert.equal(corrected.status,200,JSON.stringify(corrected.data));
const removed=await request(assessmentRoute+'/'+assessmentId,{
  method:'DELETE',cookie:t1,
});
assert.equal(removed.status,200);

const exportResponse=await request(exportPath,{
  method:'POST',cookie:t1,body:{confirmation:'EXPORT_SENSITIVE_DATA'},
});
assert.equal(exportResponse.status,200,JSON.stringify(exportResponse.data));
assert.equal(exportResponse.headers.get('x-gfit-export-schema'),'1');
assert.ok(exportResponse.headers.get('cache-control')?.includes('no-store'));
assert.ok(exportResponse.headers.get('content-disposition')?.includes('attachment'));
assert.equal(exportResponse.data.format,'gfit.student.export');
assert.equal(exportResponse.data.schemaVersion,1);
assert.equal(exportResponse.data.student.id,id);
assert.equal(exportResponse.data.student.phone,'(00) 90000-0000');
assert.equal(exportResponse.data.exercises.length,1);
assert.equal(exportResponse.data.exerciseCompletions.length,1);
assert.equal(exportResponse.data.classEnrollments.length,1);
assert.equal(exportResponse.data.attendance.length,1);
assert.equal(exportResponse.data.attendance[0].status,'present');
assert.equal(exportResponse.data.functionalAssessments.length,1);
assert.equal(exportResponse.data.functionalAssessments[0].voided,true);
assert.equal(exportResponse.data.functionalAssessments[0].value,14);
assert.equal(exportResponse.data.assessmentCorrections.length,2);
assert.ok(exportResponse.data.assessmentCorrections.some(item=>
  item.action==='corrected' && item.previousValues.value===15));
assert.ok(exportResponse.data.assessmentCorrections.some(item=>item.action==='voided'));
assert.equal(exportResponse.data.counts.functionalAssessments,1);
assert.equal(exportResponse.data.counts.assessmentCorrections,2);

const json=JSON.stringify(exportResponse.data);
assert.equal(json.includes('PESSOA_SIGILOSA_NAO_EXPORTAR'),false);
assert.equal(json.includes(otherId),false);
assert.equal(json.includes('SEGREDO_DE_OUTRO_ALUNO_NAS_NOTAS_DA_AULA'),false);
assert.equal(json.includes('password_hash'),false);
assert.equal(json.includes('gfit_session'),false);
assert.equal(json.includes('email'),false);

const after=await request(privacy,{cookie:t1});
assert.equal(after.status,200);
assert.equal(after.data.counts.exercises,1);
assert.equal(after.data.counts.exerciseCompletions,1);
assert.equal(after.data.counts.classEnrollments,1);
assert.equal(after.data.counts.attendance,1);
assert.equal(after.data.counts.functionalAssessments,1);
assert.equal(after.data.counts.assessmentCorrections,2);
assert.equal(after.data.recentExports.length,1);
assert.ok(after.data.recentExports[0].bytes>100);
assert.equal(JSON.stringify(after.data).includes('Valor original ficticio'),false);

// Arquivamento não deve impedir acesso aos próprios registros anteriores.
assert.equal((await request('/api/students/'+id+'/status',{
  method:'PATCH',cookie:t1,body:{active:false},
})).status,200);
const archived=await request(exportPath,{
  method:'POST',cookie:t1,body:{confirmation:'EXPORT_SENSITIVE_DATA'},
});
assert.equal(archived.status,200);
assert.equal(archived.data.student.active,false);
assert.equal(archived.data.functionalAssessments.length,1);
assert.equal((await request(privacy,{cookie:t1})).data.recentExports.length,2);
assert.equal((await request(privacy,{cookie:t2})).status,404);
console.log('Privacidade: exportação completa, no-store, auditoria e isolamento de alunos aprovados.');
