// End-to-end tests of descriptive assessments on the PostgreSQL-backed API.
// All identities and values are synthetic and confined to GitHub Actions.
import assert from 'node:assert/strict';

const base='http://localhost:8080';
async function request(path,{method='GET',cookie,body}={}) {
  const response=await fetch(base+path,{
    method,
    headers:{...(cookie?{Cookie:cookie}:{}),
      ...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  const data=await response.json().catch(()=>({}));
  return {
    status:response.status,data,
    cookie:response.headers.get('set-cookie')?.split(';')[0],
  };
}
async function login(email,password) {
  const response=await request('/api/auth/login',{
    method:'POST',body:{email,password},
  });
  assert.equal(response.status,200,JSON.stringify(response.data));
  return response.cookie;
}
const t1=await login('teste1@example.com','senha-para-testar-123');
const t2=await login('teste2@example.com','senha-segunda-conta-123');
const studentRes=await request('/api/students',{
  method:'POST',cookie:t1,body:{name:'Aluno sintético para avaliações'},
});
assert.equal(studentRes.status,201,JSON.stringify(studentRes.data));
const studentId=studentRes.data.student.id;
const route='/api/students/'+studentId+'/assessments';
const today=new Date().toISOString().slice(0,10);
const earlier=new Date(Date.parse(today+'T00:00:00Z')-7*86400000).toISOString().slice(0,10);
const first={
  date:earlier,category:'balance',testName:'Teste observacional',
  protocol:'Protocolo A, sem interpretação automática',value:12.5,unit:'s',
  notes:'Registro sintético do primeiro dia',
};
const second={...first,date:today,value:10.2,notes:'Registro sintético do segundo dia'};
assert.equal((await request(route)).status,401);
assert.equal((await request(route,{cookie:t2})).status,404);
assert.equal((await request(route,{cookie:t1})).status,200);
assert.equal((await request(route+'/invalid',{cookie:t1})).status,404);
for(const invalid of [
  {...first,date:'2026-02-30'},
  {...first,date:'2100-01-01'},
  {...first,value:10.123},
  {...first,value:12.5,unit:null},
  {...first,value:null,unit:null,notes:''},
  {...first,category:'diagnosis'},
  {...first,testName:'x'},
  {...first,notes:'x'.repeat(2001)},
]) {
  const r=await request(route,{method:'POST',cookie:t1,body:invalid});
  assert.equal(r.status,400,JSON.stringify({input:invalid.date,error:r.data}));
}
const created=await request(route,{method:'POST',cookie:t1,body:first});
assert.equal(created.status,201,JSON.stringify(created.data));
const firstId=created.data.assessment.id;
assert.equal(created.data.assessment.value,12.5);
const created2=await request(route,{method:'POST',cookie:t1,body:second});
assert.equal(created2.status,201,JSON.stringify(created2.data));
const secondId=created2.data.assessment.id;

let history=await request(route,{cookie:t1});
assert.equal(history.status,200,JSON.stringify(history.data));
assert.equal(history.data.total,2);
assert.equal(history.data.truncated,false);
assert.equal(history.data.assessments.length,2);
assert.equal(history.data.assessments[0].id,secondId);
assert.equal(history.data.comparisons.length,1);
assert.equal(history.data.comparisons[0].difference,-2.3);
assert.equal(history.data.comparisons[0].latest.value,10.2);
assert.equal(history.data.comparisons[0].previous.value,12.5);
assert.equal(history.data.clinicalInterpretation,false);

const changesUrl=route+'/'+secondId+'/changes';
assert.equal((await request(changesUrl,{cookie:t2})).status,404);
assert.deepEqual((await request(changesUrl,{cookie:t1})).data.changes,[]);
assert.equal((await request(route+'/'+secondId,{
  method:'PUT',cookie:t2,body:second,
})).status,404);
const unchanged=await request(route+'/'+secondId,{
  method:'PUT',cookie:t1,body:second,
});
assert.equal(unchanged.status,200,JSON.stringify(unchanged.data));
assert.equal(unchanged.data.unchanged,true);
assert.deepEqual((await request(changesUrl,{cookie:t1})).data.changes,[]);

const corrected={...second,value:9.5,notes:'Correção sintética de digitação'};
const edited=await request(route+'/'+secondId,{
  method:'PUT',cookie:t1,body:corrected,
});
assert.equal(edited.status,200,JSON.stringify(edited.data));
assert.equal(edited.data.unchanged,false);
assert.equal(edited.data.assessment.value,9.5);
const corrections=await request(changesUrl,{cookie:t1});
assert.equal(corrections.status,200);
assert.equal(corrections.data.changes.length,1);
assert.equal(corrections.data.changes[0].action,'corrected');
assert.equal(corrections.data.changes[0].previousValues.value,10.2);
history=await request(route,{cookie:t1});
assert.equal(history.data.comparisons[0].difference,-3);
assert.equal(history.data.comparisons[0].latest.value,9.5);

const third=await request(route,{method:'POST',cookie:t1,body:{
  ...first,date:today,unit:'reps',value:8,notes:'Unidade diferente',
}});
assert.equal(third.status,201);
history=await request(route,{cookie:t1});
assert.equal(history.data.total,3);
assert.equal(history.data.comparisons.length,1); // unidades diferentes não se misturam

const qualitative=await request(route,{method:'POST',cookie:t1,body:{
  date:today,category:'mobility',testName:'Observação de mobilidade',
  protocol:'',value:null,unit:null,notes:'Texto sintético, sem números',
}});
assert.equal(qualitative.status,201,JSON.stringify(qualitative.data));
history=await request(route,{cookie:t1});
assert.equal(history.data.total,4);
assert.equal(history.data.comparisons.length,1);

assert.equal((await request(route+'/'+secondId,{
  method:'DELETE',cookie:t2,
})).status,404);
const voided=await request(route+'/'+secondId,{method:'DELETE',cookie:t1});
assert.equal(voided.status,200,JSON.stringify(voided.data));
assert.equal(voided.data.retainedForAudit,true);
assert.equal((await request(route+'/'+secondId,{
  method:'DELETE',cookie:t1,
})).status,404);
const afterVoid=await request(route,{cookie:t1});
assert.equal(afterVoid.data.total,3);
assert.equal(afterVoid.data.comparisons.length,0);
const afterChanges=await request(changesUrl,{cookie:t1});
assert.equal(afterChanges.status,200);
assert.equal(afterChanges.data.changes.length,2);
assert.ok(afterChanges.data.changes.some(c=>c.action==='voided'));

const archive=await request('/api/students/'+studentId+'/status',{
  method:'PATCH',cookie:t1,body:{active:false},
});
assert.equal(archive.status,200);
assert.equal((await request(route,{cookie:t1})).data.total,3);
assert.equal((await request(route,{method:'POST',cookie:t1,body:first})).status,404);
assert.equal((await request(route+'/'+firstId,{
  method:'PUT',cookie:t1,body:first,
})).status,404);
assert.equal((await request(route,{cookie:t2})).status,404);
console.log('Avaliações funcionais: medições, comparações, correções auditáveis, acesso e arquivo OK.');
