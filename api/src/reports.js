// Relatórios operacionais para o professor responsável.
// Os números são registros administrativos, não avaliações clínicas.
// Ausência de marcação não equivale a falta; justificativas não entram no denominador da taxa.
import { db } from './db.js';
import {
  parseReportRange, currentReportRange, attendanceRate,
} from './report-utils.js';

const validId = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const exerciseFilter =
  "ec.completed_at >= ($2::date::timestamp AT TIME ZONE 'UTC') " +
  "AND ec.completed_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC')";

function getRange(req,res) {
  const defaultRange=currentReportRange();
  const range=parseReportRange(
    req.query.from === undefined && req.query.to === undefined ?
      defaultRange.from : req.query.from,
    req.query.from === undefined && req.query.to === undefined ?
      defaultRange.to : req.query.to,
  );
  if (!range) res.status(400).json({
    error:'Informe início e fim válidos, com até 366 dias inclusivos.',
  });
  return range;
}
function stats(row) {
  const present=Number(row?.present || 0);
  const absent=Number(row?.absent || 0);
  const excused=Number(row?.excused || 0);
  return {
    present,absent,excused,
    recorded:present+absent+excused,
    attendanceRate:attendanceRate(present,absent),
  };
}
function monthRows(range, classes, completions) {
  const monthIndex=new Map();
  const point = new Date(range.from.slice(0,7)+'-01T00:00:00Z');
  const last=range.to.slice(0,7);
  for(let i=0;i<14;i++) {
    const month=point.toISOString().slice(0,7);
    monthIndex.set(month,{
      month,sessions:0,present:0,absent:0,excused:0,completions:0,
    });
    if(month===last)break;
    point.setUTCMonth(point.getUTCMonth()+1);
  }
  for(const row of classes){
    const target=monthIndex.get(row.month);
    if(target){
      target.sessions=Number(row.sessions);
      target.present=Number(row.present);
      target.absent=Number(row.absent);
      target.excused=Number(row.excused);
    }
  }
  for(const row of completions){
    const target=monthIndex.get(row.month);
    if(target)target.completions=Number(row.completions);
  }
  return [...monthIndex.values()].map(row=>({
    ...row,attendanceRate:attendanceRate(row.present,row.absent),
  }));
}

export function registerReportRoutes(app,requireTeacher) {
  app.get('/api/reports/overview',requireTeacher,async(req,res)=>{
    const range=getRange(req,res);
    if(!range)return;
    const args=[req.teacher.id,range.from,range.to];
    const [classRows,studentRows,monthlyAttendance,monthlyCompletion]=await Promise.all([
      db.query(
        'SELECT c.id,c.name,c.is_active AS active,' +
        'COALESCE(a.sessions,0)::INTEGER AS sessions,' +
        'COALESCE(a.present,0)::INTEGER AS present,' +
        'COALESCE(a.absent,0)::INTEGER AS absent,' +
        'COALESCE(a.excused,0)::INTEGER AS excused ' +
        'FROM fitness_classes c LEFT JOIN (' +
        'SELECT se.class_id,COUNT(DISTINCT se.id)::INTEGER AS sessions,' +
        "COUNT(*) FILTER(WHERE at.status='present')::INTEGER AS present," +
        "COUNT(*) FILTER(WHERE at.status='absent')::INTEGER AS absent," +
        "COUNT(*) FILTER(WHERE at.status='excused')::INTEGER AS excused " +
        'FROM class_sessions se LEFT JOIN class_attendance at ON at.session_id=se.id ' +
        'WHERE se.teacher_id=$1 AND se.session_date BETWEEN $2::date AND $3::date ' +
        'GROUP BY se.class_id) a ON a.class_id=c.id ' +
        'WHERE c.teacher_id=$1 ORDER BY c.name,c.id LIMIT 200',
        args,
      ),
      db.query(
        'SELECT s.id,s.full_name AS name,s.preferred_name AS "preferredName", ' +
        's.is_active AS active,' +
        'COALESCE(a.present,0)::INTEGER AS present,' +
        'COALESCE(a.absent,0)::INTEGER AS absent,' +
        'COALESCE(a.excused,0)::INTEGER AS excused,' +
        'COALESCE(ex.completions,0)::INTEGER AS completions ' +
        'FROM students s LEFT JOIN (' +
        'SELECT at.student_id,' +
        "COUNT(*) FILTER(WHERE at.status='present')::INTEGER AS present," +
        "COUNT(*) FILTER(WHERE at.status='absent')::INTEGER AS absent," +
        "COUNT(*) FILTER(WHERE at.status='excused')::INTEGER AS excused " +
        'FROM class_attendance at JOIN class_sessions se ON se.id=at.session_id ' +
        'JOIN fitness_classes c ON c.id=se.class_id ' +
        'WHERE se.teacher_id=$1 AND c.teacher_id=$1 ' +
        'AND se.session_date BETWEEN $2::date AND $3::date ' +
        'GROUP BY at.student_id) a ON a.student_id=s.id ' +
        'LEFT JOIN (SELECT ec.student_id,COUNT(*)::INTEGER AS completions ' +
        'FROM exercise_completions ec WHERE ec.teacher_id=$1 AND '+exerciseFilter+' ' +
        'GROUP BY ec.student_id) ex ON ex.student_id=s.id ' +
        'WHERE s.teacher_id=$1 ORDER BY s.full_name,s.id LIMIT 10000',
        args,
      ),
      db.query(
        "SELECT to_char(se.session_date,'YYYY-MM') AS month," +
        'COUNT(DISTINCT se.id)::INTEGER AS sessions,' +
        "COUNT(*) FILTER(WHERE a.status='present')::INTEGER AS present," +
        "COUNT(*) FILTER(WHERE a.status='absent')::INTEGER AS absent," +
        "COUNT(*) FILTER(WHERE a.status='excused')::INTEGER AS excused " +
        'FROM class_sessions se JOIN fitness_classes c ON c.id=se.class_id ' +
        'LEFT JOIN class_attendance a ON a.session_id=se.id ' +
        'WHERE se.teacher_id=$1 AND c.teacher_id=$1 ' +
        'AND se.session_date BETWEEN $2::date AND $3::date ' +
        'GROUP BY 1 ORDER BY 1',
        args,
      ),
      db.query(
        "SELECT to_char(ec.completed_at AT TIME ZONE 'UTC','YYYY-MM') AS month," +
        'COUNT(*)::INTEGER AS completions FROM exercise_completions ec ' +
        'WHERE ec.teacher_id=$1 AND '+exerciseFilter+' ' +
        'GROUP BY 1 ORDER BY 1',
        args,
      ),
    ]);
    const classes=classRows.rows.map(row=>({
      ...row,...stats(row),sessions:Number(row.sessions),
    }));
    const students=studentRows.rows.map(row=>({
      ...row,...stats(row),completions:Number(row.completions),
    }));
    const summary=classes.reduce((sum,row)=>({
      sessions:sum.sessions+row.sessions,
      present:sum.present+row.present,
      absent:sum.absent+row.absent,
      excused:sum.excused+row.excused,
    }),{sessions:0,present:0,absent:0,excused:0});
    const completions=students.reduce((sum,row)=>sum+row.completions,0);
    res.json({
      range,summary:{
        ...stats(summary),sessions:summary.sessions,completions,
        studentsWithRecords:students.filter(row=>row.recorded>0||row.completions>0).length,
      },
      classes,students,
      trend:monthRows(range,monthlyAttendance.rows,monthlyCompletion.rows),
      attendanceIsManual:true,
      rateDefinition:'present / (present + absent); excused and unmarked excluded',
    });
  });

  app.get('/api/reports/students/:id',requireTeacher,async(req,res)=>{
    if(!validId(req.params.id))return res.status(400).json({error:'Aluno inválido.'});
    const range=getRange(req,res);
    if(!range)return;
    const student=await db.query(
      'SELECT id,full_name AS name,preferred_name AS "preferredName",is_active AS active ' +
      'FROM students WHERE id=$1 AND teacher_id=$2',
      [req.params.id,req.teacher.id],
    );
    if(!student.rows.length)return res.status(404).json({error:'Aluno não encontrado.'});
    const args=[req.teacher.id,range.from,range.to,req.params.id];
    const [groups,exercises,attendance,monthlyAttendance,monthlyCompletion]=await Promise.all([
      db.query(
        'SELECT c.id,c.name,' +
        "COUNT(*) FILTER(WHERE a.status='present')::INTEGER AS present," +
        "COUNT(*) FILTER(WHERE a.status='absent')::INTEGER AS absent," +
        "COUNT(*) FILTER(WHERE a.status='excused')::INTEGER AS excused " +
        'FROM class_attendance a JOIN class_sessions se ON se.id=a.session_id ' +
        'JOIN fitness_classes c ON c.id=se.class_id ' +
        'WHERE c.teacher_id=$1 AND se.teacher_id=$1 AND a.student_id=$4 ' +
        'AND se.session_date BETWEEN $2::date AND $3::date ' +
        'GROUP BY c.id ORDER BY c.name,c.id',
        args,
      ),
      db.query(
        'SELECT e.id,e.title,COUNT(ec.id)::INTEGER AS completions ' +
        'FROM student_exercises e LEFT JOIN exercise_completions ec ON ec.exercise_id=e.id ' +
        'AND ec.student_id=$4 AND ec.teacher_id=$1 AND '+exerciseFilter+' ' +
        'WHERE e.student_id=$4 AND e.teacher_id=$1 ' +
        'GROUP BY e.id ORDER BY e.title,e.id',
        args,
      ),
      db.query(
        "SELECT to_char(se.session_date,'YYYY-MM-DD') AS date," +
        'c.name AS "className",a.status ' +
        'FROM class_attendance a JOIN class_sessions se ON se.id=a.session_id ' +
        'JOIN fitness_classes c ON c.id=se.class_id ' +
        'WHERE c.teacher_id=$1 AND se.teacher_id=$1 AND a.student_id=$4 ' +
        'AND se.session_date BETWEEN $2::date AND $3::date ' +
        'ORDER BY se.session_date DESC,c.name,a.session_id DESC LIMIT 100',
        args,
      ),
      db.query(
        "SELECT to_char(se.session_date,'YYYY-MM') AS month," +
        '0::INTEGER AS sessions,' +
        "COUNT(*) FILTER(WHERE a.status='present')::INTEGER AS present," +
        "COUNT(*) FILTER(WHERE a.status='absent')::INTEGER AS absent," +
        "COUNT(*) FILTER(WHERE a.status='excused')::INTEGER AS excused " +
        'FROM class_attendance a JOIN class_sessions se ON se.id=a.session_id ' +
        'JOIN fitness_classes c ON c.id=se.class_id ' +
        'WHERE c.teacher_id=$1 AND se.teacher_id=$1 AND a.student_id=$4 ' +
        'AND se.session_date BETWEEN $2::date AND $3::date GROUP BY 1 ORDER BY 1',
        args,
      ),
      db.query(
        "SELECT to_char(ec.completed_at AT TIME ZONE 'UTC','YYYY-MM') AS month," +
        'COUNT(*)::INTEGER AS completions FROM exercise_completions ec ' +
        'WHERE ec.teacher_id=$1 AND ec.student_id=$4 AND '+exerciseFilter+' ' +
        'GROUP BY 1 ORDER BY 1',
        args,
      ),
    ]);
    const classes=groups.rows.map(row=>({...row,...stats(row)}));
    const exercisesSummary=exercises.rows.map(row=>({
      ...row,completions:Number(row.completions),
    }));
    const summary=classes.reduce((sum,row)=>({
      present:sum.present+row.present,absent:sum.absent+row.absent,
      excused:sum.excused+row.excused,
    }),{present:0,absent:0,excused:0});
    res.json({
      range,student:student.rows[0],
      summary:{
        ...stats(summary),
        completions:exercisesSummary.reduce((sum,row)=>sum+row.completions,0),
      },
      classes,exercises:exercisesSummary,attendance:attendance.rows,
      trend:monthRows(range,monthlyAttendance.rows,monthlyCompletion.rows),
      attendanceIsManual:true,
      rateDefinition:'present / (present + absent); excused and unmarked excluded',
      attendanceLimitedToRecent:100,
    });
  });
}
