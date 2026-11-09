// Operações de leitura da administração. Nunca retornam fichas individuais de alunos.
// Os controles de acesso são aplicados pelo middleware antes de chegar aqui.
import { db } from './db.js';

export function registerAdminReadRoutes(app, requireTeacher, requireAdmin) {
  app.get('/api/admin/dashboard', requireTeacher, requireAdmin, async (_req, res) => {
    const result = await db.query([
      'SELECT',
      ' (SELECT COUNT(*)::INTEGER FROM teachers WHERE NOT is_admin) AS "teachersTotal",',
      ' (SELECT COUNT(*)::INTEGER FROM teachers WHERE NOT is_admin AND is_active) AS "teachersActive",',
      ' (SELECT COUNT(*)::INTEGER FROM teachers WHERE NOT is_admin AND NOT is_active) AS "teachersInactive",',
      ' (SELECT COUNT(*)::INTEGER FROM students WHERE is_active) AS "studentsActive",',
      ' (SELECT COUNT(*)::INTEGER FROM students WHERE NOT is_active) AS "studentsArchived",',
      ' (SELECT COUNT(*)::INTEGER FROM student_exercises) AS "exercisesAssigned",',
      ' (SELECT COUNT(*)::INTEGER FROM exercise_completions) AS "completionsLogged",',
      ' (SELECT COUNT(*)::INTEGER FROM teachers WHERE NOT is_admin AND created_at >= NOW() - INTERVAL \'30 days\') AS "teachersNew30d",',
      ' (SELECT COUNT(*)::INTEGER FROM students WHERE created_at >= NOW() - INTERVAL \'30 days\') AS "studentsNew30d"',
    ].join('\n'));
    res.json({
      overview: result.rows[0],
      billing: { connected: false, message: 'Cobranças Pix ainda não estão integradas.' },
    });
  });

  app.get('/api/admin/audit', requireTeacher, requireAdmin, async (_req, res) => {
    const result = await db.query([
      'SELECT logs.id, logs.action, logs.changes, logs.created_at AS "createdAt",',
      ' a.full_name AS "actorName", t.full_name AS "targetName"',
      'FROM admin_audit_logs logs',
      'JOIN teachers a ON a.id = logs.actor_id',
      'LEFT JOIN teachers t ON t.id = logs.target_teacher_id',
      'ORDER BY logs.created_at DESC, logs.id DESC LIMIT 50',
    ].join('\n'));
    res.json({ events: result.rows });
  });
}
