import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const days = ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
const emptyClass = {
  name:'', description:'', weekdays:[1,3],startTime:'09:00',
  durationMinutes:'60', maxStudents:'10',active:true,
};
const localDate = () => {
  const date = new Date();
  return new Date(date.getTime()-date.getTimezoneOffset()*60000)
    .toISOString().slice(0,10);
};
const datePt = value => value ? value.split('-').reverse().join('/') : '—';
const weekdayText = numbers => (numbers || []).map(d=>days[d-1]).join(', ') || 'Sem dias';
const attendanceLabel = {
  present:'Presente',absent:'Ausente',excused:'Justificado',
};

function ClassForm({value,setValue,onSubmit,busy,submitLabel,onCancel}) {
  const update = (key,val) => setValue(old=>({...old,[key]:val}));
  const toggleDay = (day,checked) => update('weekdays',checked ?
    [...value.weekdays,day].sort((a,b)=>a-b) : value.weekdays.filter(d=>d!==day));
  return (
    <form onSubmit={onSubmit}>
      <label>Nome da turma
        <input required minLength="2" maxLength="100" value={value.name}
          onChange={e=>update('name',e.target.value)}
          placeholder="Ex.: Mobilidade da manhã" />
      </label>
      <fieldset className="weekday-picker">
        <legend>Dias da semana</legend>
        <div className="weekday-options">
          {days.map((name,i)=>(
            <label key={name} className={value.weekdays.includes(i+1)?'selected':''}>
              <input type="checkbox" checked={value.weekdays.includes(i+1)}
                onChange={e=>toggleDay(i+1,e.target.checked)} />
              {name.slice(0,3)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="form-grid">
        <label>Horário de início
          <input type="time" required value={value.startTime}
            onChange={e=>update('startTime',e.target.value)} />
        </label>
        <label>Duração da aula (minutos)
          <input type="number" min="15" max="240" required value={value.durationMinutes}
            onChange={e=>update('durationMinutes',e.target.value)} />
        </label>
        <label>Vagas nesta turma
          <input type="number" min="1" max="200" required value={value.maxStudents}
            onChange={e=>update('maxStudents',e.target.value)} />
        </label>
      </div>
      <label>Observações gerais (opcional)
        <textarea rows="2" maxLength="500" value={value.description}
          onChange={e=>update('description',e.target.value)}
          placeholder="Local, orientações de funcionamento ou materiais necessários" />
      </label>
      {onCancel && (
        <label className="checkline">
          <input type="checkbox" checked={value.active}
            onChange={e=>update('active',e.target.checked)} />
          Turma ativa para novas matrículas e sessões
        </label>
      )}
      <div className="actions">
        <button className="primary" type="submit" disabled={busy || !value.weekdays.length}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="secondary-light" onClick={onCancel}>
            Cancelar edição
          </button>
        )}
      </div>
    </form>
  );
}
function SessionAttendance({ session,students,onSave,busy }) {
  const initial = useMemo(()=>Object.fromEntries(
    session.attendance.map(a=>[a.studentId,a.status])
  ),[session]);
  const [values,setValues] = useState(initial);
  useEffect(()=>setValues(initial),[initial]);
  const summary = {
    present:session.attendance.filter(r=>r.status==='present').length,
    absent:session.attendance.filter(r=>r.status==='absent').length,
    excused:session.attendance.filter(r=>r.status==='excused').length,
  };
  return (
    <div className="stack">
      <p className="muted">
        Registros desta aula: {summary.present} presente(s), {summary.absent} ausente(s),
        {' '}{summary.excused} justificado(s). Atualizados manualmente pelo professor.
      </p>
      {students.length === 0 ? (
        <p className="muted">Matricule alunos ativos para registrar a presença.</p>
      ) : (
        <div className="attendance-grid">
          {students.map(st=>(
            <label key={st.id}>
              {st.preferredName || st.name}
              <select value={values[st.id] || ''}
                onChange={e=>setValues(current=>({...current,[st.id]:e.target.value||null}))}>
                <option value="">Sem registro</option>
                <option value="present">Presente</option>
                <option value="absent">Ausente</option>
                <option value="excused">Justificado</option>
              </select>
            </label>
          ))}
        </div>
      )}
      <div className="actions">
        <button type="button" className="primary" disabled={busy || !students.length}
          onClick={()=>onSave(students.map(st=>({
            studentId:st.id,status:values[st.id]||null,
          })))}>
          Salvar lista de presença
        </button>
      </div>
      {session.attendance.some(row=>!students.some(st=>st.id===row.studentId)) && (
        <div>
          <h3>Registros históricos de ex-alunos da turma</h3>
          <ul className="simple-roster">
            {session.attendance.filter(row=>!students.some(st=>st.id===row.studentId))
              .map(row=>(
                <li key={row.studentId}>
                  {row.studentName} — {attendanceLabel[row.status] || row.status}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ClassManager() {
  const [classes,setClasses] = useState([]);
  const [students,setStudents] = useState([]);
  const [selectedId,setSelectedId] = useState(null);
  const [detail,setDetail] = useState(null);
  const [createForm,setCreateForm] = useState(emptyClass);
  const [editForm,setEditForm] = useState(null);
  const [studentId,setStudentId] = useState('');
  const [sessionDate,setSessionDate] = useState(localDate());
  const [sessionNotes,setSessionNotes] = useState('');
  const [selectedSessionId,setSelectedSessionId] = useState(null);
  const [error,setError] = useState('');
  const [success,setSuccess] = useState('');
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);

  const refresh = useCallback(async (id = selectedId) => {
    const [groups,studentList,group] = await Promise.all([
      api('/api/classes'),
      api('/api/students'),
      id ? api('/api/classes/'+id) : Promise.resolve(null),
    ]);
    setClasses(groups.classes);
    setStudents(studentList.students);
    setDetail(group);
  },[selectedId]);
  useEffect(()=>{
    setLoading(true);
    refresh().catch(e=>setError(e.message)).finally(()=>setLoading(false));
  },[refresh]);

  async function run(operation,message,id=selectedId) {
    setBusy(true);setError('');setSuccess('');
    try {
      await operation();
      await refresh(id);
      if (message) setSuccess(message);
      return true;
    } catch(e) {setError(e.message);return false;}
    finally {setBusy(false);}
  }
  function classPayload(form) {
    return {
      name:form.name.trim(),description:form.description,
      weekdays:form.weekdays,startTime:form.startTime,
      durationMinutes:Number(form.durationMinutes),
      maxStudents:Number(form.maxStudents),active:form.active,
    };
  }
  async function createClass(e) {
    e.preventDefault();
    setBusy(true);setError('');setSuccess('');
    try {
      const response = await api('/api/classes',{
        method:'POST',body:JSON.stringify(classPayload(createForm)),
      });
      setCreateForm(emptyClass);
      setSelectedId(response.classId);
      await refresh(response.classId);
      setSuccess('Turma cadastrada.');
    } catch(err) {setError(err.message);}
    finally {setBusy(false);}
  }
  async function saveClass(e) {
    e.preventDefault();
    const saved = await run(()=>api('/api/classes/'+selectedId,{
      method:'PUT',body:JSON.stringify(classPayload(editForm)),
    }),'Dados e capacidade da turma atualizados.');
    if(saved) setEditForm(null);
  }
  function startEdit(group) {
    setEditForm({
      name:group.name,description:group.description||'',
      weekdays:group.weekdays,startTime:group.startTime,
      durationMinutes:String(group.durationMinutes),
      maxStudents:String(group.maxStudents),active:group.active,
    });
  }
  async function enroll(e) {
    e.preventDefault();
    if(!studentId) return;
    const saved=await run(()=>api('/api/classes/'+selectedId+'/enrollments',{
      method:'POST',body:JSON.stringify({studentId}),
    }),'Aluno matriculado na turma.');
    if(saved) setStudentId('');
  }
  async function removeStudent(id) {
    if(!window.confirm('Remover esta matrícula ativa? O histórico de presença será preservado.')) return;
    await run(()=>api('/api/classes/'+selectedId+'/enrollments/'+id,{method:'DELETE'}),
      'Matrícula desativada. Histórico preservado.');
  }
  async function addSession(e) {
    e.preventDefault();
    const saved=await run(async()=>{
      const response=await api('/api/classes/'+selectedId+'/sessions',{
        method:'POST',body:JSON.stringify({date:sessionDate,notes:sessionNotes}),
      });
      setSelectedSessionId(response.sessionId);
    },'Aula cadastrada. Registre a presença abaixo.');
    if(saved) setSessionNotes('');
  }
  async function saveAttendance(records) {
    await run(()=>api('/api/classes/'+selectedId+'/sessions/'+selectedSessionId+'/attendance',{
      method:'PUT',body:JSON.stringify({records}),
    }),'Lista de presença salva.');
  }

  const group=detail?.class;
  const activeStudents=students.filter(s=>s.active);
  const availableStudents=activeStudents.filter(st=>!detail?.students.some(e=>e.id===st.id));
  const selectedSession=detail?.sessions.find(s=>s.id===selectedSessionId) || null;

  return (
    <section className="stack">
      <div className="intro">
        <div>
          <div className="eyebrow">Painel do professor</div>
          <h1>Turmas e aulas</h1>
          <p className="muted">
            Defina horários semanais, limite de vagas e presenças registradas manualmente.
          </p>
        </div>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {success && <p role="status" className="saved-message">{success}</p>}
      {loading && <p className="muted">Carregando turmas…</p>}
      <div className="columns">
        <section className="card">
          <h2>Minhas turmas ({classes.length})</h2>
          {classes.length===0 ? <p className="muted">Nenhuma turma cadastrada ainda.</p> : (
            <div className="class-list">
              {classes.map(item=>(
                <button type="button" key={item.id}
                  className={'class-choice '+(item.id===selectedId?'selected':'')}
                  onClick={()=>{
                    setSelectedId(item.id);setSelectedSessionId(null);setEditForm(null);
                    setError('');setSuccess('');
                  }}>
                  <strong>{item.name} {!item.active && <small>Arquivada</small>}</strong>
                  <span>{weekdayText(item.weekdays)} · {item.startTime}</span>
                  <span>{item.durationMinutes} minutos · {item.enrolledCount}/{item.maxStudents} vagas</span>
                </button>
              ))}
            </div>
          )}
          <h2>Nova turma</h2>
          <ClassForm value={createForm} setValue={setCreateForm}
            onSubmit={createClass} busy={busy} submitLabel="Criar turma" />
        </section>
        <section className="card">
          {group ? (
            <div className="stack">
              <div>
                <div className="eyebrow">Turma selecionada</div>
                <h2>{group.name}</h2>
                <p className="muted">
                  {weekdayText(group.weekdays)} às {group.startTime} · {group.durationMinutes} min.
                  {' '}{group.enrolledCount}/{group.maxStudents} vagas ocupadas.
                </p>
                {group.description && <p className="muted">{group.description}</p>}
                {!group.active && <p className="notice">
                  Esta turma está arquivada. As aulas anteriores e presenças continuam disponíveis.
                </p>}
                <button type="button" className="secondary-light"
                  onClick={()=>editForm?setEditForm(null):startEdit(group)}>
                  {editForm?'Fechar edição':'Editar turma e vagas'}
                </button>
              </div>
              {editForm && <div className="workout-editor">
                <ClassForm value={editForm} setValue={setEditForm}
                  onSubmit={saveClass} busy={busy} submitLabel="Salvar turma"
                  onCancel={()=>setEditForm(null)} />
              </div>}
              <div className="divider-line" />
              <div>
                <h3>Matrículas ativas ({detail.students.length})</h3>
                {detail.students.length ? (
                  <ul className="simple-roster">
                    {detail.students.map(st=>(
                      <li key={st.id}>
                        <span>{st.preferredName||st.name}</span>
                        <button type="button" className="danger-light"
                          disabled={busy} onClick={()=>removeStudent(st.id)}>Retirar</button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted">Nenhum aluno matriculado nesta turma.</p>}
                <form onSubmit={enroll} className="inline-class-form">
                  <label>Adicionar aluno ativo
                    <select value={studentId} onChange={e=>setStudentId(e.target.value)}>
                      <option value="">Selecione o aluno</option>
                      {availableStudents.map(st=>(
                        <option key={st.id} value={st.id}>{st.preferredName||st.name}</option>
                      ))}
                    </select>
                  </label>
                  <button className="primary" type="submit"
                    disabled={busy||!studentId||!group.active||
                      group.enrolledCount>=group.maxStudents}>Matricular</button>
                </form>
                <p className="muted">
                  A capacidade é desta turma. O mesmo aluno pode participar de outras turmas,
                  sem ocupar uma segunda vaga no limite geral do professor.
                </p>
              </div>
              <div className="divider-line" />
              <div>
                <h3>Aulas e presença</h3>
                <p className="muted">
                  A data de cada aula pode ser escolhida livremente para permitir reposições.
                  O quadro semanal é a referência padrão da turma.
                </p>
                <form onSubmit={addSession}>
                  <label>Data da aula
                    <input type="date" min="2020-01-01" max="2100-12-31"
                      required value={sessionDate} onChange={e=>setSessionDate(e.target.value)} />
                  </label>
                  <label>Observações sobre a aula (opcional)
                    <textarea rows="2" maxLength="500" value={sessionNotes}
                      onChange={e=>setSessionNotes(e.target.value)} />
                  </label>
                  <button className="primary" type="submit"
                    disabled={busy||!group.active}>Cadastrar aula</button>
                </form>
                {detail.sessions.length===0 ? (
                  <p className="muted">Nenhuma aula registrada.</p>
                ) : (
                  <div className="session-list">
                    {detail.sessions.map(item=>(
                      <button key={item.id} type="button"
                        className={'session-choice '+(item.id===selectedSessionId?'selected':'')}
                        onClick={()=>setSelectedSessionId(item.id)}>
                        <strong>{datePt(item.date)}</strong>
                        <span>{item.attendance.filter(a=>a.status==='present').length} presente(s)</span>
                        {item.notes && <small>{item.notes}</small>}
                      </button>
                    ))}
                  </div>
                )}
                {selectedSession && (
                  <div className="workout-editor">
                    <h3>Presenças de {datePt(selectedSession.date)}</h3>
                    <SessionAttendance key={selectedSession.id} session={selectedSession}
                      students={detail.students} onSave={saveAttendance} busy={busy} />
                  </div>
                )}
              </div>
            </div>
          ) : <p className="muted">Selecione uma turma para gerenciar matrículas e presença.</p>}
        </section>
      </div>
      <p className="notice">
        Registros de presença são informações administrativas preenchidas pelo professor;
        o aplicativo não atesta automaticamente que uma pessoa participou da aula.
        Não armazene informações clínicas nesta versão do protótipo.
      </p>
    </section>
  );
}
