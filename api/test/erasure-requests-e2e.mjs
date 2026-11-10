// Pedidos sintéticos de exclusão: apenas triagem, NUNCA eliminação automática.
import assert from 'node:assert/strict';

const base='http://localhost:8080';
async function request(path,{method='GET',cookie,body}={}) {
  const response=await fetch(base+path,{
    method,
    headers:{
      ...(cookie?{Cookie:cookie}:{}),
      ...(body?{'Content-Type':'application/json'}:{}),
    },
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  const data=await response.json().catch(()=>({}));
  return {
    status:response.status,data,
    cookie:response.headers.get('set-cookie')?.split(';')[0],
    headers:response.headers,
  };
}
async function login(email,password) {
  const res=await request('/api/auth/login',{method:'POST',body:{email,password}});
  assert.equal(res.status,200,JSON.stringify(res.data));
  return res.cookie;
}
const t1=await login('teste1@example.com','senha-para-testar-123');
const t2=await login('teste2@example.com','senha-segunda-conta-123');
const admin=await login('admin@example.com',process.env.ADMIN_PASSWORD);
const student=await request('/api/students',{
  method:'POST',cookie:t1,body:{name:'Aluno Ficticio Sob Revisao'},
});
assert.equal(student.status,201,JSON.stringify(student.data));
const studentId=student.data.student.id;
const url='/api/students/'+studentId+'/erasure-request';
const adminUrl='/api/admin/privacy/requests';

assert.equal((await request(url)).status,401);
assert.equal((await request(url,{cookie:t2})).status,404);
assert.equal((await request(url,{cookie:admin})).status,404);
assert.equal((await request(adminUrl)).status,401);
assert.equal((await request(adminUrl,{cookie:t1})).status,403);

const before=await request(url,{cookie:t1});
assert.equal(before.status,200,JSON.stringify(before.data));
assert.equal(before.data.request,null);
assert.deepEqual(before.data.history,[]);
assert.equal(before.data.automatedErasure,false);
assert.equal(before.data.identityVerified,false);
assert.ok(before.headers.get('cache-control').includes('no-store'));

assert.equal((await request(url,{
  method:'POST',cookie:t1,
})).status,400);
assert.equal((await request(url,{
  method:'POST',cookie:t1,body:{reportedBy:'guardian'},
})).status,400);
assert.equal((await request(url,{
  method:'POST',cookie:t1,body:{reportedBy:'unknown',confirmation:'REGISTER_REVIEW_ONLY'},
})).status,400);
assert.equal((await request(url,{
  method:'POST',cookie:t2,body:{reportedBy:'guardian',confirmation:'REGISTER_REVIEW_ONLY'},
})).status,404);

const create=()=>request(url,{
  method:'POST',cookie:t1,
  body:{reportedBy:'student',confirmation:'REGISTER_REVIEW_ONLY'},
});
const concurrent=await Promise.all([create(),create()]);
assert.deepEqual(concurrent.map(r=>r.status).sort((a,b)=>a-b),[201,409]);
const created=concurrent.find(r=>r.status===201);
const reqId=created.data.requestId;
assert.equal(created.data.deletionPerformed,false);
assert.equal(created.data.identityVerified,false);
assert.equal((await create()).status,409);

let record=await request(url,{cookie:t1});
assert.equal(record.status,200);
assert.equal(record.data.request.id,reqId);
assert.equal(record.data.request.status,'submitted');
assert.equal(record.data.request.reportedBy,'student');
assert.equal(record.data.history.length,1);
assert.equal(record.data.history[0].nextStatus,'submitted');
assert.equal(record.data.history[0].byAdmin,false);

const adminList=await request(adminUrl,{cookie:admin});
assert.equal(adminList.status,200,JSON.stringify(adminList.data));
assert.equal(adminList.data.automatedErasure,false);
assert.equal(adminList.data.identityVerification,'not_implemented');
assert.ok(adminList.data.summary.submitted>=1);
const adminRecord=adminList.data.requests.find(r=>r.id===reqId);
assert.ok(adminRecord);
assert.equal(adminRecord.teacherName,'Professor Teste');
assert.equal(adminRecord.studentId,studentId);
assert.equal(JSON.stringify(adminList.data).includes('Aluno Ficticio Sob Revisao'),false);
assert.equal((await request('/api/students/'+studentId,{cookie:admin})).status,404);

const statusUrl=adminUrl+'/'+reqId;
assert.equal((await request(statusUrl,{
  method:'PATCH',cookie:t1,body:{status:'reviewing'},
})).status,403);
assert.equal((await request(statusUrl,{
  method:'PATCH',cookie:admin,body:{status:'deleted'},
})).status,400);
assert.equal((await request(statusUrl,{
  method:'PATCH',cookie:admin,body:{status:'resolved'},
})).status,400);
assert.equal((await request(adminUrl+'/00000000-0000-4000-8000-000000000000',{
  method:'PATCH',cookie:admin,body:{status:'reviewing'},
})).status,404);
const reviewing=await request(statusUrl,{
  method:'PATCH',cookie:admin,body:{status:'reviewing'},
});
assert.equal(reviewing.status,200,JSON.stringify(reviewing.data));
assert.equal(reviewing.data.deletionPerformed,false);
assert.equal(reviewing.data.status,'reviewing');

const unchanged=await request(statusUrl,{
  method:'PATCH',cookie:admin,body:{status:'reviewing'},
});
assert.equal(unchanged.status,200);
assert.equal(unchanged.data.unchanged,true);

const awaiting=await request(statusUrl,{
  method:'PATCH',cookie:admin,body:{status:'awaiting_policy'},
});
assert.equal(awaiting.status,200);
assert.equal(awaiting.data.deletionPerformed,false);
record=await request(url,{cookie:t1});
assert.equal(record.data.request.status,'awaiting_policy');
assert.equal(record.data.history.length,3);
assert.deepEqual(record.data.history.map(x=>x.nextStatus),[
  'submitted','reviewing','awaiting_policy',
]);
assert.equal(record.data.history[1].byAdmin,true);
assert.equal(record.data.history[2].byAdmin,true);
assert.equal((await create()).status,409);

// A ficha e os registros continuam existentes, apesar do pedido.
const profile=await request('/api/students/'+studentId,{cookie:t1});
assert.equal(profile.status,200);
assert.equal(profile.data.student.name,'Aluno Ficticio Sob Revisao');
const privateExport=await request('/api/students/'+studentId+'/privacy',{cookie:t1});
assert.equal(privateExport.status,200);
const adminAfter=await request(adminUrl,{cookie:admin});
assert.equal(adminAfter.data.requests.find(r=>r.id===reqId).status,'awaiting_policy');
assert.ok(adminAfter.data.summary.awaitingPolicy>=1);
assert.equal(JSON.stringify(adminAfter.data).includes('Aluno Ficticio Sob Revisao'),false);
console.log('Privacidade: triagem sem exclusão, concorrência, auditoria e isolamento de fichas OK.');
