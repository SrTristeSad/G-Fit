import assert from 'node:assert/strict';

const base = 'http://localhost:8080';
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) throw new Error('ADMIN_PASSWORD de teste não configurado');

async function request(path, { method = 'GET', cookie = '', body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

const health = await request('/api/health');
assert.equal(health.status, 200);
const homepage = await fetch(base);
assert.equal(homepage.status, 200);
assert.match(await homepage.text(), /G Fit/);

const first = await request('/api/auth/register', {
  method: 'POST', body: { name: 'Professora Um', email: 'um@example.com', password: 'senha-primeira-123' },
});
assert.equal(first.status, 201, JSON.stringify(first.data));
const c1 = first.cookie;
assert.equal(first.data.teacher.isAdmin, false);
assert.equal(first.data.teacher.maxStudents, 20);
const second = await request('/api/auth/register', {
  method: 'POST', body: { name: 'Professor Dois', email: 'dois@example.com', password: 'senha-segunda-123' },
});
assert.equal(second.status, 201);
const c2 = second.cookie;
assert.equal((await request('/api/admin/teachers', { cookie: c1 })).status, 403);

const newStudent = await request('/api/students', {
  method: 'POST', cookie: c1, body: { name: 'Dona Maria' },
});
assert.equal(newStudent.status, 201, JSON.stringify(newStudent.data));
const studentId = newStudent.data.student.id;
assert.equal((await request('/api/students/' + studentId, { cookie: c2 })).status, 404);
assert.equal((await request('/api/students', { cookie: c2 })).data.students.length, 0);

const admin = await request('/api/auth/login', {
  method: 'POST', body: { email: 'admin@example.com', password: adminPassword },
});
assert.equal(admin.status, 200, JSON.stringify(admin.data));
assert.equal(admin.data.teacher.isAdmin, true);
const dashboard = await request('/api/admin/dashboard', { cookie: admin.cookie });
assert.equal(dashboard.status, 200);
assert.equal(dashboard.data.overview.teachersTotal, 4);
assert.equal(dashboard.data.overview.studentsActive, 2);
assert.equal(dashboard.data.billing.connected, false);
assert.equal((await request('/api/admin/dashboard', { cookie: c1 })).status, 403);
const ca = admin.cookie;
const teachers = await request('/api/admin/teachers', { cookie: ca });
assert.equal(teachers.status, 200);
const teacher1 = teachers.data.teachers.find(t => t.email === 'um@example.com');
const teacher2 = teachers.data.teachers.find(t => t.email === 'dois@example.com');
assert.equal(teacher1.activeStudents, 1);
assert.equal((await request('/api/admin/teachers/' + teacher1.id, {
  method: 'PATCH', cookie: ca, body: { maxStudents: 1 },
})).status, 200);
const audit = await request('/api/admin/audit', { cookie: ca });
assert.equal(audit.status, 200);
assert.equal(audit.data.events.length, 1);
assert.equal(audit.data.events[0].action, 'teacher.settings.updated');
assert.equal(audit.data.events[0].changes.before.maxStudents, 20);
assert.equal(audit.data.events[0].changes.after.maxStudents, 1);
assert.equal((await request('/api/admin/audit', { cookie: c1 })).status, 403);
const full = await request('/api/students', {
  method: 'POST', cookie: c1, body: { name: 'Segundo aluno' },
});
assert.equal(full.status, 409, JSON.stringify(full.data));

const updated = await request('/api/students/' + studentId, {
  method: 'PUT', cookie: c1,
  body: { name: 'Maria Santos', preferredName: 'Dona Maria', dateOfBirth: '1950-03-15',
    phone: '11999999999', emergencyContact: 'Ana Santos', emergencyPhone: '11888888888',
    goals: 'Mobilidade e bem-estar', notes: 'Prefere aulas pela manhã' },
});
assert.equal(updated.status, 200, JSON.stringify(updated.data));
assert.equal(updated.data.student.preferredName, 'Dona Maria');
assert.equal(updated.data.student.goals, 'Mobilidade e bem-estar');
assert.equal((await request('/api/students/' + studentId, { cookie: c2 })).status, 404);
const exercise = await request('/api/students/' + studentId + '/exercises', {
  method: 'POST', cookie: c1,
  body: { title: 'Caminhada orientada', sets: 2, repetitions: 10,
    schedule: 'Segundas', instructions: 'Orientação personalizada' },
});
assert.equal(exercise.status, 201, JSON.stringify(exercise.data));
const exerciseId = exercise.data.exercise.id;
assert.equal((await request('/api/students/' + studentId + '/exercises/' + exerciseId + '/complete', {
  method: 'POST', cookie: c2,
})).status, 404);
assert.equal((await request('/api/students/' + studentId + '/exercises/' + exerciseId + '/complete', {
  method: 'POST', cookie: c1,
})).status, 201);
const profile = await request('/api/students/' + studentId, { cookie: c1 });
assert.equal(profile.status, 200);
assert.equal(profile.data.summary.assignedExercises, 1);
assert.equal(profile.data.summary.loggedCompletions, 1);
assert.equal(profile.data.exercises[0].completedCount, 1);
const archive = await request('/api/students/' + studentId + '/status', {
  method: 'PATCH', cookie: c1, body: { active: false },
});
assert.equal(archive.status, 200);
const replacement = await request('/api/students', {
  method: 'POST', cookie: c1, body: { name: 'Dona Joana' },
});
assert.equal(replacement.status, 201);
assert.equal((await request('/api/students/' + studentId + '/status', {
  method: 'PATCH', cookie: c1, body: { active: true },
})).status, 409);
assert.equal((await request('/api/admin/teachers/' + teacher2.id, {
  method: 'PATCH', cookie: ca, body: { isActive: false },
})).status, 200);
assert.equal((await request('/api/auth/me', { cookie: c2 })).status, 403);
assert.equal((await request('/api/auth/login', {
  method: 'POST', body: { email: 'dois@example.com', password: 'senha-segunda-123' },
})).status, 403);
assert.equal((await request('/api/admin/teachers/' + admin.data.teacher.id, {
  method: 'PATCH', cookie: ca, body: { isActive: false },
})).status, 400);

// Planos: apenas administrador configura e vincula. Nao representam pagamentos.
assert.equal((await request('/api/admin/plans', { cookie: c1 })).status, 403);
const plansEmpty = await request('/api/admin/plans', { cookie: ca });
assert.equal(plansEmpty.status, 200);
assert.deepEqual(plansEmpty.data.plans, []);
const invalidPlan = await request('/api/admin/plans', {
  method: 'POST', cookie: ca,
  body: { name: 'X', priceCents: -10, billingCycle: 'monthly', maxStudents: -1 },
});
assert.equal(invalidPlan.status, 400);
const createdPlan = await request('/api/admin/plans', {
  method: 'POST', cookie: ca,
  body: {
    name: 'Profissional 30', description: 'Plano mensal de teste',
    priceCents: 2990, billingCycle: 'monthly', maxStudents: 3,
  },
});
assert.equal(createdPlan.status, 201, JSON.stringify(createdPlan.data));
const planId = createdPlan.data.plan.id;
assert.equal(createdPlan.data.plan.priceCents, 2990);
assert.equal((await request('/api/admin/plans', {
  method: 'POST', cookie: ca,
  body: { name: 'profissional 30', priceCents: 2990, billingCycle: 'monthly', maxStudents: 3 },
})).status, 409);
const assign = await request('/api/admin/teachers/' + teacher1.id + '/plan', {
  method: 'PUT', cookie: ca, body: { planId },
});
assert.equal(assign.status, 200, JSON.stringify(assign.data));
assert.equal(assign.data.maxStudents, 3);
assert.equal(assign.data.assignment, 'manual');
const ownPlan = await request('/api/account/plan', { cookie: c1 });
assert.equal(ownPlan.status, 200, JSON.stringify(ownPlan.data));
assert.equal(ownPlan.data.plan.id, planId);
assert.equal(ownPlan.data.billingConnected, false);
assert.equal((await request('/api/students', { cookie: c1 })).data.quota.maxStudents, 3);
const plansWithAssignment = await request('/api/admin/plans', { cookie: ca });
assert.equal(plansWithAssignment.data.plans[0].assignedTeachers, 1);
const accountList = await request('/api/admin/teachers', { cookie: ca });
assert.equal(accountList.data.teachers.find(t => t.id === teacher1.id).planName, 'Profissional 30');
// Vigencias manuais: nao criam faturas, nao confirmam pagamentos e nao apagam fichas.
assert.equal((await request('/api/admin/access', { cookie: c1 })).status, 403);
const legacyAccess = await request('/api/account/access', { cookie: c1 });
assert.equal(legacyAccess.status, 200);
assert.equal(legacyAccess.data.access.status, 'legacy');
assert.equal(legacyAccess.data.billingConnected, false);
assert.equal((await request('/api/admin/teachers/' + teacher2.id + '/access', {
  method: 'PUT', cookie: ca, body: { startsOn: '2024-01-01', endsOn: '2024-01-31' },
})).status, 409);
assert.equal((await request('/api/admin/teachers/' + teacher1.id + '/access', {
  method: 'PUT', cookie: c1, body: { startsOn: '2024-01-01', endsOn: '2024-01-31' },
})).status, 403);
assert.equal((await request('/api/admin/teachers/' + teacher1.id + '/access', {
  method: 'PUT', cookie: ca, body: { startsOn: '2024-02-30', endsOn: '2024-03-20' },
})).status, 400);
const grantExpired = await request('/api/admin/teachers/' + teacher1.id + '/access', {
  method: 'PUT', cookie: ca, body: { startsOn: '2024-01-01', endsOn: '2024-01-31' },
});
assert.equal(grantExpired.status, 200, JSON.stringify(grantExpired.data));
assert.equal(grantExpired.data.access.status, 'expired');
assert.equal((await request('/api/students/' + studentId, { cookie: c1 })).status, 200);
assert.equal((await request('/api/students', {
  method: 'POST', cookie: c1, body: { name: 'Cadastro impedido' },
})).status, 403);
assert.equal((await request('/api/students/' + studentId + '/exercises', {
  method: 'POST', cookie: c1, body: { title: 'Atividade impedida', sets: 1, repetitions: 1 },
})).status, 403);
assert.equal((await request('/api/students/' + studentId + '/status', {
  method: 'PATCH', cookie: c1, body: { active: true },
})).status, 403);
const todayUTC = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.parse(todayUTC + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const in40days = new Date(Date.parse(todayUTC + 'T00:00:00Z') + 40 * 86400000).toISOString().slice(0, 10);
const scheduledAccess = await request('/api/admin/teachers/' + teacher1.id + '/access', {
  method: 'PUT', cookie: ca, body: { startsOn: tomorrow, endsOn: in40days },
});
assert.equal(scheduledAccess.status, 200);
assert.equal(scheduledAccess.data.access.status, 'scheduled');
const grantActive = await request('/api/admin/teachers/' + teacher1.id + '/access', {
  method: 'PUT', cookie: ca, body: { startsOn: todayUTC, endsOn: in40days },
});
assert.equal(grantActive.status, 200);
assert.equal(grantActive.data.access.status, 'active');
const newAccessStudent = await request('/api/students', {
  method: 'POST', cookie: c1, body: { name: 'Aluno durante vigência' },
});
assert.equal(newAccessStudent.status, 201, JSON.stringify(newAccessStudent.data));
const renewAccess = await request('/api/admin/teachers/' + teacher1.id + '/access/renew', {
  method: 'POST', cookie: ca, body: { months: 1 },
});
assert.equal(renewAccess.status, 200, JSON.stringify(renewAccess.data));
assert.ok(renewAccess.data.access.endsOn > in40days);
assert.equal(renewAccess.data.access.status, 'active');
const accessList = await request('/api/admin/access', { cookie: ca });
assert.equal(accessList.status, 200);
assert.equal(accessList.data.accessTerms.find(t => t.teacherId === teacher1.id).status, 'active');
const revokedAccess = await request('/api/admin/teachers/' + teacher1.id + '/access/revoke', {
  method: 'POST', cookie: ca,
});
assert.equal(revokedAccess.status, 200);
assert.equal(revokedAccess.data.access.status, 'revoked');
assert.equal((await request('/api/students', {
  method: 'POST', cookie: c1, body: { name: 'Bloqueio depois da revogação' },
})).status, 403);
assert.equal((await request('/api/admin/teachers/' + teacher1.id + '/access/renew', {
  method: 'POST', cookie: ca, body: { months: 1 },
})).status, 409);
assert.equal((await request('/api/account/access', { cookie: c1 })).data.access.status, 'revoked');

const disablePlan = await request('/api/admin/plans/' + planId, {
  method: 'PATCH', cookie: ca, body: { isActive: false },
});
assert.equal(disablePlan.status, 200);
assert.equal((await request('/api/admin/teachers/' + teacher2.id + '/plan', {
  method: 'PUT', cookie: ca, body: { planId },
})).status, 409);
assert.equal((await request('/api/account/plan', { cookie: c1 })).data.plan.id, planId);
const unassign = await request('/api/admin/teachers/' + teacher1.id + '/plan', {
  method: 'DELETE', cookie: ca,
});
assert.equal(unassign.status, 200);
assert.equal(unassign.data.maxStudents, 3);
assert.equal((await request('/api/account/plan', { cookie: c1 })).data.plan, null);
assert.equal((await request('/api/students', { cookie: c1 })).data.quota.maxStudents, 3);
const planAudit = await request('/api/admin/audit', { cookie: ca });
assert.equal(planAudit.status, 200);
const auditActions = planAudit.data.events.map(event => event.action);
for (const action of ['plan.created', 'teacher.plan.assigned', 'plan.status.updated', 'teacher.plan.removed']) {
  assert.ok(auditActions.includes(action), 'Evento ausente: ' + action);
}
console.log('E2E G Fit: contas, turmas futuras, fichas, administracao e planos manuais OK');

