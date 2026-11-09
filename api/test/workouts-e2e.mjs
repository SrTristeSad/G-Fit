// Catálogo do professor e planejamento semanal; dados e contas de teste do smoke do CI.
import assert from 'node:assert/strict';

const base = 'http://localhost:8080';
async function request(path, { method='GET', cookie, body }={}) {
  const response = await fetch(base + path,{
    method,
    headers: {
      ...(cookie ? { Cookie:cookie } : {}),
      ...(body ? { 'Content-Type':'application/json' } : {}),
    },
    ...(body ? { body:JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(()=>({}));
  return { status:response.status,data,
    cookie:response.headers.get('set-cookie')?.split(';')[0] };
}

const first = await request('/api/auth/login',{
  method:'POST',body:{ email:'teste1@example.com',password:'senha-para-testar-123' },
});
const second = await request('/api/auth/login',{
  method:'POST',body:{ email:'teste2@example.com',password:'senha-segunda-conta-123' },
});
assert.equal(first.status,200,JSON.stringify(first.data));
assert.equal(second.status,200,JSON.stringify(second.data));
const c1=first.cookie,c2=second.cookie;
const students=await request('/api/students',{cookie:c1});
const student=students.data.students.find(s=>s.name==='Aluno de Teste');
assert.ok(student);
const studentId=student.id;

assert.equal((await request('/api/exercises/library')).status,401);
assert.deepEqual((await request('/api/exercises/library',{cookie:c2})).data.exercises,[]);
const create=await request('/api/exercises/library',{
  method:'POST',cookie:c1,body:{
    title:'Atividade de mobilidade guiada',category:'Mobilidade',
    description:'Movimento supervisionado conforme avaliação do professor.',
    defaultSets:2,defaultRepetitions:8,defaultDurationMinutes:15,
  },
});
assert.equal(create.status,201,JSON.stringify(create.data));
const libId=create.data.exercise.id;
assert.equal(create.data.exercise.defaultDurationMinutes,15);
assert.equal((await request('/api/exercises/library',{cookie:c1})).data.exercises.length,1);
assert.equal((await request('/api/exercises/library',{cookie:c2})).data.exercises.length,0);
const invalidCatalog=await request('/api/exercises/library',{
  method:'POST',cookie:c1,body:{
    title:'Invalido',category:'A',defaultSets:0,defaultRepetitions:-1,
  },
});
assert.equal(invalidCatalog.status,400);

const selected=await request('/api/students/'+studentId+'/exercises',{
  method:'POST',cookie:c1,body:{
    libraryExerciseId:libId, weekdays:[1,3,5], schedule:'Manhã',
  },
});
assert.equal(selected.status,201,JSON.stringify(selected.data));
assert.equal(selected.data.exercise.title,'Atividade de mobilidade guiada');
assert.equal(selected.data.exercise.durationMinutes,15);
assert.equal(selected.data.exercise.weekdaysMask,21);
assert.deepEqual(selected.data.exercise.weekdays,[1,3,5]);
const assignedId=selected.data.exercise.id;
let profile=await request('/api/students/'+studentId,{cookie:c1});
assert.equal(profile.status,200);
assert.equal(profile.data.exercises[0].weekdaysMask,21);
assert.deepEqual(profile.data.exercises[0].weekdays,[1,3,5]);
assert.equal(profile.data.exercises[0].libraryExerciseId,libId);
assert.equal((await request('/api/students/'+studentId,{cookie:c2})).status,404);

assert.equal((await request('/api/students/'+studentId+'/exercises',{
  method:'POST',cookie:c1,
  body:{title:'Exercício ruim',sets:2,repetitions:10,weekdays:[1,1]},
})).status,400);
assert.equal((await request('/api/students/'+studentId+'/exercises',{
  method:'POST',cookie:c1,
  body:{title:'Exercício ruim',sets:2,repetitions:10,weekdays:[8]},
})).status,400);
assert.equal((await request('/api/students/'+studentId+'/exercises',{
  method:'POST',cookie:c2,
  body:{libraryExerciseId:libId,weekdays:[2]},
})).status,404);

assert.equal((await request('/api/students/'+studentId+'/exercises/'+assignedId+'/complete',{
  method:'POST',cookie:c1,
})).status,201);
const edited=await request('/api/students/'+studentId+'/exercises/'+assignedId,{
  method:'PATCH',cookie:c1,body:{
    title:'Mobilidade individualizada',sets:3,repetitions:6,weekdays:[2,4],
    durationMinutes:20, schedule:'Tarde',instructions:'Sessão ajustada pelo professor',
  },
});
assert.equal(edited.status,200,JSON.stringify(edited.data));
assert.deepEqual(edited.data.exercise.weekdays,[2,4]);
assert.equal(edited.data.exercise.durationMinutes,20);
profile=await request('/api/students/'+studentId,{cookie:c1});
assert.equal(profile.data.exercises[0].completedCount,1);
assert.equal(profile.data.exercises[0].title,'Mobilidade individualizada');
assert.equal(profile.data.exercises[0].weekdaysMask,10);
assert.equal((await request('/api/students/'+studentId+'/exercises/'+assignedId,{
  method:'PATCH',cookie:c2,
  body:{title:'Intruso',sets:1,repetitions:1,weekdays:[1]},
})).status,404);

const legacy=await request('/api/students/'+studentId+'/exercises',{
  method:'POST',cookie:c1,
  body:{title:'Atividade em texto livre',sets:1,repetitions:12,schedule:'Quarta-feira'},
});
assert.equal(legacy.status,201,JSON.stringify(legacy.data));
assert.deepEqual(legacy.data.exercise.weekdays,[]);
profile=await request('/api/students/'+studentId,{cookie:c1});
assert.equal(profile.data.summary.assignedExercises,2);
assert.equal(profile.data.summary.loggedCompletions,1);
assert.equal(profile.data.exercises.find(x=>x.id===legacy.data.exercise.id).schedule,'Quarta-feira');

const archive=await request('/api/exercises/library/'+libId,{
  method:'PUT',cookie:c1,body:{
    title:'Atividade de mobilidade guiada',category:'Mobilidade',
    description:'Atividade arquivada',defaultSets:2,defaultRepetitions:8,
    defaultDurationMinutes:15,active:false,
  },
});
assert.equal(archive.status,200);
assert.equal(archive.data.exercise.active,false);
assert.equal((await request('/api/students/'+studentId+'/exercises',{
  method:'POST',cookie:c1,body:{libraryExerciseId:libId,weekdays:[1]},
})).status,404);
profile=await request('/api/students/'+studentId,{cookie:c1});
assert.equal(profile.data.exercises.find(e=>e.id===assignedId).title,'Mobilidade individualizada');
assert.equal(profile.data.exercises.find(e=>e.id===assignedId).completedCount,1);
assert.equal((await request('/api/exercises/library/'+libId,{
  method:'PUT',cookie:c2,body:{
    title:'Outro professor',category:'Outra',defaultSets:1,defaultRepetitions:1,active:true,
  },
})).status,404);
console.log('Treinos: biblioteca própria, planejamento semanal, edição, histórico, arquivo e isolamento OK');
