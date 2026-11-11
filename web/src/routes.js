// Centralized, dependency-free URL rules for the two independent workspaces.
// The backend is still responsible for authorization on every API endpoint.
export const ADMIN_ROUTES = Object.freeze({
  overview: '/admin',
  teachers: '/admin/professores',
  plans: '/admin/planos',
  access: '/admin/vigencias',
  billing: '/admin/financeiro',
  operations: '/admin/monitoramento',
  alerts: '/admin/alertas',
  security: '/admin/seguranca',
  privacy: '/admin/privacidade',
  audit: '/admin/auditoria',
  updates: '/admin/atualizacoes',
  account: '/admin/conta',
});

export const PROFESSOR_ROUTES = Object.freeze({
  students: '/professor',
  library: '/professor/exercicios',
  classes: '/professor/turmas',
  reports: '/professor/relatorios',
  billing: '/professor/pix',
  account: '/professor/conta',
});

export function homeFor(teacher) {
  return teacher.isAdmin ? ADMIN_ROUTES.overview : PROFESSOR_ROUTES.students;
}

export function urlFor(teacher, section) {
  const routes = teacher.isAdmin ? ADMIN_ROUTES : PROFESSOR_ROUTES;
  return routes[section] || homeFor(teacher);
}

export function resolveWorkspaceRoute(pathname, teacher) {
  if (!teacher) return { view: 'login', redirect: null };
  const routes = teacher.isAdmin ? ADMIN_ROUTES : PROFESSOR_ROUTES;
  const requested = pathname.replace(/\/+$/, '') || '/';
  const match = Object.entries(routes).find(([, url]) => url === requested);
  if (match) return { view: match[0], redirect: null };
  // Never render the other workspace, even during a browser Back/Forward.
  return { view: teacher.isAdmin ? 'overview' : 'students', redirect: homeFor(teacher) };
}
