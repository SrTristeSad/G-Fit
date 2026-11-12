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

// An administrator may work in the professor workspace under the same account.
// Teachers cannot enter admin pages. This does not expand API data access.
export function urlFor(teacher, section, workspace = null) {
  const routes = workspace === 'professor' ? PROFESSOR_ROUTES
    : workspace === 'admin' ? (teacher.isAdmin ? ADMIN_ROUTES : PROFESSOR_ROUTES)
    : teacher.isAdmin ? ADMIN_ROUTES : PROFESSOR_ROUTES;
  return routes[section] || (routes === ADMIN_ROUTES ? ADMIN_ROUTES.overview : PROFESSOR_ROUTES.students);
}

export function resolveWorkspaceRoute(pathname, teacher) {
  if (!teacher) return { view: 'login', redirect: null };
  const requested = pathname.replace(/\/+$/, '') || '/';
  if (teacher.isAdmin) {
    const adminPage = Object.entries(ADMIN_ROUTES).find(([,url]) => url === requested);
    if (adminPage) return { view: adminPage[0], redirect: null };
  }
  const professorPage = Object.entries(PROFESSOR_ROUTES).find(([,url]) => url === requested);
  if (professorPage) return { view: professorPage[0], redirect: null };
  return { view: teacher.isAdmin ? 'overview' : 'students', redirect: homeFor(teacher) };
}
