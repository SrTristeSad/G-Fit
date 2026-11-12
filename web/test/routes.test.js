import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_ROUTES, PROFESSOR_ROUTES,
  homeFor, urlFor, resolveWorkspaceRoute,
} from '../src/routes.js';

const admin = { id: 'a', isAdmin: true };
const professor = { id: 'p', isAdmin: false };

test('every section has a stable URL inside the proper workspace', () => {
  assert.equal(homeFor(admin), '/admin');
  assert.equal(homeFor(professor), '/professor');
  assert.equal(urlFor(admin, 'security'), '/admin/seguranca');
  assert.equal(urlFor(admin, 'teachers'), '/admin/professores');
  assert.equal(urlFor(professor, 'library'), '/professor/exercicios');
  assert.equal(urlFor(professor, 'account'), '/professor/conta');
  assert.equal(urlFor(admin, 'not-found'), '/admin');
  assert.equal(urlFor(professor, 'not-found'), '/professor');
  // Administrators can switch between both real workspaces.
  assert.equal(urlFor(admin, 'students', 'professor'), '/professor');
  assert.equal(urlFor(admin, 'library', 'professor'), '/professor/exercicios');
  assert.equal(urlFor(admin, 'account', 'professor'), '/professor/conta');
  assert.equal(urlFor(admin, 'account', 'admin'), '/admin/conta');
  assert.equal(urlFor(professor, 'teachers', 'admin'), '/professor');
  for (const url of Object.values(ADMIN_ROUTES)) assert.match(url, /^\/admin(?:\/|$)/);
  for (const url of Object.values(PROFESSOR_ROUTES)) assert.match(url, /^\/professor(?:\/|$)/);
});

test('deep links identify the appropriate section after page reload', () => {
  for (const [view, path] of Object.entries(ADMIN_ROUTES)) {
    assert.deepEqual(resolveWorkspaceRoute(path, admin), { view, redirect: null });
  }
  for (const [view, path] of Object.entries(PROFESSOR_ROUTES)) {
    assert.deepEqual(resolveWorkspaceRoute(path, professor), { view, redirect: null });
    assert.deepEqual(resolveWorkspaceRoute(path, admin), { view, redirect: null });
  }
  assert.deepEqual(resolveWorkspaceRoute('/admin/planos/', admin), { view: 'plans', redirect: null });
  assert.deepEqual(resolveWorkspaceRoute('/professor/turmas/', professor), { view: 'classes', redirect: null });
  assert.deepEqual(resolveWorkspaceRoute('/professor/turmas/', admin), { view: 'classes', redirect: null });
});

test('cross-role, unknown and root URLs redirect to the current user home', () => {
  for (const path of ['/', '/admin/unknown', '/administrador']) {
    const route = resolveWorkspaceRoute(path, admin);
    assert.equal(route.redirect, '/admin');
    assert.equal(route.view, 'overview');
  }
  for (const path of ['/', '/admin', '/admin/professores', '/professor/unknown', '/professores']) {
    const route = resolveWorkspaceRoute(path, professor);
    assert.equal(route.redirect, '/professor');
    assert.equal(route.view, 'students');
  }
});

test('private workspaces display only the login form before authentication', () => {
  for (const path of ['/', '/admin', '/admin/seguranca', '/professor', '/professor/exercicios']) {
    assert.deepEqual(resolveWorkspaceRoute(path, null), { view: 'login', redirect: null });
  }
});
