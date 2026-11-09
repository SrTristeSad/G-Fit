// Testes reais HTTP/PostgreSQL, sem dados de clientes: turmas, vagas, aulas e presenças.
import assert from 'node:assert/strict';

const root = 'http://localhost:8080';
async function request(path,{method='GET',cookie,body}={}) {
  const response=await fetch(root+path,{
    method,headers:{
      ...(cookie?{Cookie:cookie}:{}),
      ...(body?{'Content-Type':'application/json'}:{}),
    },...(body?{body:JSON.stringify(body)}:{}),
  });
  const data=await response.json().catch(()=>({}));
  return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function login(email,password) {
  const r=await request('/api/auth/login',{method:'POST',body:{email,password}});
  assert.equal(r.status,200,JSON.stringify(r.data));
  return r.cookie;
}
const teacher1=await login('teste1@example.com','senha-para-testar-123');
const teacher2=await login('teste2@example.com','senha-segunda-conta-123');
const classBody={
  name:'Turma de mobilidade da manhã', description:'Aulas supervisionadas em grupo.',
  weekdays:[1,3,5],startTime:'09:30',durationMinutes:50,maxStudents:2,active:true,
};
assert.equal((await request('/api/classes')).status,401);
assert.equal((await request('/api/classes',{cookie:teacher2})).data.classes.length,0);
assert.equal((await request('/api/classes',{method:'POST',cookie:teacher1,
  body:{...classBody,weekdays:[1,1]}})).status,400);
assert.equal((await request('/api/classes',{method:'POST',cookie:teacher1,
  body:{...classBody,startTime:'25:90'}})).status,400);
const created=await request('/api/classes',{
  method:'POST',cookie:teacher1,body:classBody,
});
assert.equal(created.status,201,JSON.stringify(created.data));
const groupId=created.data.classId;
const listed=await request('/api/classes',{cookie:teacher1});
assert.equal(listed.status,200);
assert.equal(listed.data.classes.length,1);
assert.deepEqual(listed.data.classes[0].weekdays,[1,3,5]);
assert.equal(listed.data.classes[0].startTime,'09:30');
assert.equal(listed.data.classes[0].enrolledCount,0);
assert.equal((await request('/api/classes/'+groupId,{cookie:teacher2})).status,404);
assert.equal((await request('/api/classes/'+groupId,{
  method:'PUT',cookie:teacher2,body:classBody,
})).status,404);

const studentList=await request('/api/students',{cookie:teacher1});
const student1=studentList.data.students.find(s=>s.name==='Aluno de Teste');
assert.ok(student1);
const student2=await request('/api/students',{
  method:'POST',cookie:teacher1,body:{name:'Aluna da turma'},
});
assert.equal(student2.status,201);
const student3=await request('/api/students',{
  method:'POST',cookie:teacher1,body:{name:'Terceiro aluno'},
});
assert.equal(student3.status,201);
const id1=student1.id,id2=student2.data.student.id,id3=student3.data.student.id;
assert.equal((await request('/api/classes/'+groupId+'/enrollments',{
  method:'POST',cookie:teacher2,body:{studentId:id1},
})).status,404);
assert.equal((await request('/api/classes/'+groupId+'/enrollments',{
  method:'POST',cookie:teacher1,body:{studentId:id1},
})).status,201);
assert.equal((await request('/api/classes/'+groupId+'/enrollments',{
  method:'POST',cookie:teacher1,body:{studentId:id1},
})).data.unchanged,true);
assert.equal((await request('/api/classes/'+groupId+'/enrollments',{
  method:'POST',cookie:teacher1,body:{studentId:id2},
})).status,201);
assert.equal((await request('/api/classes/'+groupId+'/enrollments',{
  method:'POST',cookie:teacher1,body:{studentId:id3},
})).status,409);
const overLimit=await request('/api/classes/'+groupId,{
  method:'PUT',cookie:teacher1,body:{...classBody,maxStudents:1},
});
assert.equal(overLimit.status,409);
assert.equal((await request('/api/classes',{cookie:teacher1})).data.classes[0].enrolledCount,2);

const date=new Date().toISOString().slice(0,10);
const createdSession=await request('/api/classes/'+groupId+'/sessions',{
  method:'POST',cookie:teacher1,body:{date,notes:'Aula inicial da turma'},
});
assert.equal(createdSession.status,201,JSON.stringify(createdSession.data));
const sessionId=createdSession.data.sessionId;
assert.equal((await request('/api/classes/'+groupId+'/sessions',{
  method:'POST',cookie:teacher1,body:{date},
})).status,409);
assert.equal((await request('/api/classes/'+groupId+'/sessions',{
  method:'POST',cookie:teacher2,body:{date},
})).status,404);
assert.equal((await request('/api/classes/'+groupId+'/sessions',{
  method:'POST',cookie:teacher1,body:{date:'2026-02-30'},
})).status,400);
const attendPath='/api/classes/'+groupId+'/sessions/'+sessionId+'/attendance';
assert.equal((await request(attendPath,{
  method:'PUT',cookie:teacher2,body:{records:[{studentId:id1,status:'present'}]},
})).status,404);
assert.equal((await request(attendPath,{
  method:'PUT',cookie:teacher1,body:{records:[
    {studentId:id1,status:'present'},{studentId:id1,status:'absent'},
  ]},
})).status,400);
assert.equal((await request(attendPath,{
  method:'PUT',cookie:teacher1,body:{records:[{studentId:id3,status:'present'}]},
})).status,409);
const firstAttendance=await request(attendPath,{
  method:'PUT',cookie:teacher1,body:{records:[
    {studentId:id1,status:'present'},{studentId:id2,status:'excused'},
  ]},
});
assert.equal(firstAttendance.status,200,JSON.stringify(firstAttendance.data));
let detail=await request('/api/classes/'+groupId,{cookie:teacher1});
assert.equal(detail.status,200);
assert.equal(detail.data.students.length,2);
assert.equal(detail.data.sessions.length,1);
assert.equal(detail.data.sessions[0].attendance.length,2);
assert.equal(detail.data.sessions[0].attendance.find(a=>a.studentId===id2).status,'excused');

const change=await request(attendPath,{
  method:'PUT',cookie:teacher1,body:{records:[
    {studentId:id1,status:'absent'},{studentId:id2,status:null},
  ]},
});
assert.equal(change.status,200);
detail=await request('/api/classes/'+groupId,{cookie:teacher1});
assert.equal(detail.data.sessions[0].attendance.length,1);
assert.equal(detail.data.sessions[0].attendance[0].status,'absent');
const drop=await request('/api/classes/'+groupId+'/enrollments/'+id1,{
  method:'DELETE',cookie:teacher1,
});
assert.equal(drop.status,200);
detail=await request('/api/classes/'+groupId,{cookie:teacher1});
assert.equal(detail.data.students.length,1);
assert.equal(detail.data.sessions[0].attendance.length,1);
assert.equal(detail.data.sessions[0].attendance[0].studentId,id1);
assert.equal((await request('/api/classes/'+groupId+'/enrollments/'+id1,{
  method:'DELETE',cookie:teacher1,
})).status,404);
assert.equal((await request('/api/classes/'+groupId,{
  method:'PUT',cookie:teacher1,body:{...classBody,maxStudents:1},
})).status,200);
assert.equal((await request('/api/classes/'+groupId+'/enrollments',{
  method:'POST',cookie:teacher1,body:{studentId:id1},
})).status,409);
assert.equal((await request('/api/classes/'+groupId,{
  method:'PUT',cookie:teacher1,body:classBody,
})).status,200);
assert.equal((await request('/api/classes/'+groupId+'/enrollments',{
  method:'POST',cookie:teacher1,body:{studentId:id3},
})).status,201);
assert.equal((await request('/api/students/'+id3+'/status',{
  method:'PATCH',cookie:teacher1,body:{active:false},
})).status,200);
detail=await request('/api/classes/'+groupId,{cookie:teacher1});
assert.equal(detail.data.class.enrolledCount,1);
assert.equal(detail.data.students.some(s=>s.id===id3),false);
assert.equal((await request('/api/classes/'+groupId+'/enrollments',{
  method:'POST',cookie:teacher1,body:{studentId:id3},
})).status,404);
assert.equal((await request('/api/students/'+id3+'/status',{
  method:'PATCH',cookie:teacher1,body:{active:true},
})).status,200);
detail=await request('/api/classes/'+groupId,{cookie:teacher1});
assert.equal(detail.data.class.enrolledCount,1); // reativar aluno não reintegra turma
assert.equal((await request('/api/classes/'+groupId+'/enrollments',{
  method:'POST',cookie:teacher1,body:{studentId:id3},
})).status,201);
assert.equal((await request('/api/classes/'+groupId,{
  method:'PUT',cookie:teacher1,body:{...classBody,active:false},
})).status,200);
assert.equal((await request('/api/classes/'+groupId+'/enrollments',{
  method:'POST',cookie:teacher1,body:{studentId:id1},
})).status,404);
assert.equal((await request('/api/classes/'+groupId+'/sessions',{
  method:'POST',cookie:teacher1,body:{date:'2027-01-01'},
})).status,404);
assert.equal((await request('/api/classes/'+groupId,{cookie:teacher1})).data.sessions.length,1);
assert.equal((await request(attendPath,{
  method:'PUT',cookie:teacher1,body:{records:[{studentId:id3,status:'present'}]},
})).status,200); // arquivo de aula já existente permanece editável
console.log('Turmas: horários, isolamento, limite, matrícula, aulas, presença, arquivo e histórico OK');
