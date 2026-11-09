// Relatórios HTTP após workouts-e2e e classes-e2e (dados de teste).
import assert from 'node:assert/strict';

const base='http://localhost:8080';
async function request(path,{cookie}={}) {
  const response=await fetch(base+path,{headers:cookie?{Cookie:cookie}:{}});
  const data=await response.json().catch(()=>({}));
  return {
    status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],
  };
}
async function login(email,password) {
  const response=await fetch(base+'/api/auth/login',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email,password}),
  });
  const data=await response.json().catch(()=>({}));
  assert.equal(response.status,200,JSON.stringify(data));
  return response.headers.get('set-cookie').split(';')[0];
}
const t1=await login('teste1@example.com','senha-para-testar-123');
const t2=await login('teste2@example.com','senha-segunda-conta-123');
const today=new Date().toISOString().slice(0,10);
const range='?from='+today+'&to='+today;

assert.equal((await request('/api/reports/overview')).status,401);
assert.equal((await request('/api/reports/students/not-a-uuid'+range,{cookie:t1})).status,400);
assert.equal((await request('/api/reports/overview?from=2026-02-30&to=2026-03-01',{cookie:t1})).status,400);
assert.equal((await request('/api/reports/overview?from=2026-01-01&to=2027-01-02',{cookie:t1})).status,400);
assert.equal((await request('/api/reports/overview?from=2026-11-01',{cookie:t1})).status,400);
assert.equal((await request('/api/reports/overview?from=2026-12-01&to=2026-11-01',{cookie:t1})).status,400);

const overview=await request('/api/reports/overview'+range,{cookie:t1});
assert.equal(overview.status,200,JSON.stringify(overview.data));
assert.deepEqual(overview.data.range,{from:today,to:today,days:1,timezone:'UTC'});
assert.equal(overview.data.summary.sessions,1);
assert.equal(overview.data.summary.present,1);
assert.equal(overview.data.summary.absent,1);
assert.equal(overview.data.summary.excused,0);
assert.equal(overview.data.summary.attendanceRate,50);
assert.equal(overview.data.summary.completions,1);
assert.equal(overview.data.summary.studentsWithRecords,2);
assert.equal(overview.data.classes.length,1);
assert.equal(overview.data.classes[0].active,false);
assert.equal(overview.data.classes[0].sessions,1);
assert.equal(overview.data.classes[0].attendanceRate,50);
assert.equal(overview.data.trend.length,1);
assert.equal(overview.data.trend[0].sessions,1);
assert.equal(overview.data.trend[0].present,1);
assert.equal(overview.data.trend[0].absent,1);
assert.equal(overview.data.trend[0].completions,1);
assert.equal(overview.data.attendanceIsManual,true);

const first=overview.data.students.find(s=>s.name==='Aluno de Teste');
const third=overview.data.students.find(s=>s.name==='Terceiro aluno');
const second=overview.data.students.find(s=>s.name==='Aluna da turma');
assert.ok(first&&second&&third);
assert.equal(first.absent,1);
assert.equal(first.present,0);
assert.equal(first.attendanceRate,0);
assert.equal(first.completions,1);
assert.equal(second.attendanceRate,null);
assert.equal(second.completions,0);
assert.equal(third.attendanceRate,100);
assert.equal(third.present,1);
assert.equal(third.completions,0);

const individual=await request('/api/reports/students/'+first.id+range,{cookie:t1});
assert.equal(individual.status,200,JSON.stringify(individual.data));
assert.equal(individual.data.student.id,first.id);
assert.equal(individual.data.summary.absent,1);
assert.equal(individual.data.summary.present,0);
assert.equal(individual.data.summary.attendanceRate,0);
assert.equal(individual.data.summary.completions,1);
assert.equal(individual.data.attendance.length,1);
assert.equal(individual.data.attendance[0].status,'absent');
assert.equal(individual.data.exercises.reduce((sum,x)=>sum+x.completions,0),1);
assert.equal(individual.data.trend.length,1);
assert.equal(individual.data.trend[0].completions,1);
assert.equal((await request('/api/reports/students/'+first.id+range,{cookie:t2})).status,404);

const other=await request('/api/reports/overview'+range,{cookie:t2});
assert.equal(other.status,200);
assert.equal(other.data.summary.sessions,0);
assert.equal(other.data.summary.present,0);
assert.equal(other.data.summary.completions,0);
assert.equal(other.data.classes.length,0);
assert.equal(other.data.students.some(s=>s.id===first.id),false);
assert.equal(other.data.trend.length,1);
assert.equal(other.data.trend[0].completions,0);
const emptyDate=await request('/api/reports/overview?from=2030-01-01&to=2030-01-31',{cookie:t1});
assert.equal(emptyDate.status,200);
assert.equal(emptyDate.data.summary.attendanceRate,null);
assert.equal(emptyDate.data.summary.sessions,0);
assert.equal(emptyDate.data.summary.completions,0);
assert.equal(emptyDate.data.trend.length,1);
console.log('Relatórios: totais, intervalo, agrupamento mensal, privacidade e ausência de inferências OK');
