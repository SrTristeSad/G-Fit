import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const days = ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
const initial = {
  libraryExerciseId: '', title: '', sets: '2', repetitions: '10',
  durationMinutes: '', instructions: '', schedule: '', weekdays: [],
};
function fromExisting(item) {
  return {
    libraryExerciseId: item.libraryExerciseId || '',
    title: item.title, sets: String(item.sets), repetitions: String(item.repetitions),
    durationMinutes: item.durationMinutes == null ? '' : String(item.durationMinutes),
    instructions: item.instructions || '', schedule: item.schedule || '',
    weekdays: item.weekdays || [],
  };
}
function toPayload(fields) {
  return {
    title: fields.title.trim(),
    libraryExerciseId: fields.libraryExerciseId || null,
    sets: Number(fields.sets), repetitions: Number(fields.repetitions),
    durationMinutes: fields.durationMinutes === '' ? null : Number(fields.durationMinutes),
    schedule: fields.schedule,
    instructions: fields.instructions,
    weekdays: fields.weekdays,
  };
}
function WeekdayPicker({ value, onChange }) {
  return (
    <fieldset className="weekday-picker">
      <legend>Planejamento semanal (opcional)</legend>
      <div className="weekday-options">
        {days.map((day,index) => {
          const number = index+1;
          return (
            <label key={day} className={value.includes(number) ? 'selected' : ''}>
              <input type="checkbox" checked={value.includes(number)}
                onChange={e => onChange(e.target.checked ?
                  [...value,number].sort((a,b)=>a-b) : value.filter(d => d!==number))} />
              {day.slice(0,3)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
function ExerciseForm({ form, setForm, onSubmit, submitLabel, busy, active, children }) {
  function update(field, value) { setForm(old=>({...old,[field]:value})); }
  return (
    <form onSubmit={onSubmit}>
      <label>Nome da atividade
        <input required minLength="2" maxLength="120" value={form.title}
          onChange={e=>update('title',e.target.value)} />
      </label>
      <div className="form-grid">
        <label>Séries
          <input required type="number" min="1" max="30" value={form.sets}
            onChange={e=>update('sets',e.target.value)} />
        </label>
        <label>Repetições
          <input required type="number" min="1" max="500" value={form.repetitions}
            onChange={e=>update('repetitions',e.target.value)} />
        </label>
      </div>
      <label>Duração da sessão em minutos (opcional)
        <input type="number" min="1" max="240" value={form.durationMinutes}
          onChange={e=>update('durationMinutes',e.target.value)} />
      </label>
      <WeekdayPicker value={form.weekdays} onChange={next=>update('weekdays',next)} />
      <label>Frequência ou detalhes de horário (texto opcional)
        <input maxLength="120" value={form.schedule}
          onChange={e=>update('schedule',e.target.value)}
          placeholder="Ex.: manhã, com acompanhamento" />
      </label>
      <label>Orientações individuais do professor
        <textarea rows="3" maxLength="1000" value={form.instructions}
          onChange={e=>update('instructions',e.target.value)} />
      </label>
      <div className="actions">
        <button className="primary" type="submit" disabled={busy || !active}>{submitLabel}</button>
        {children}
      </div>
    </form>
  );
}

export default function StudentWorkouts({ id, data, run, busy }) {
  const [library, setLibrary] = useState([]);
  const [error, setError] = useState('');
  const [form,setForm] = useState(initial);
  const [editing,setEditing] = useState(null);
  const [editForm,setEditForm] = useState(initial);
  const active = data.student.active;

  useEffect(() => {
    api('/api/exercises/library')
      .then(result => setLibrary(result.exercises.filter(item=>item.active)))
      .catch(err => setError(err.message));
  }, []);

  function chooseCatalog(id) {
    const item = library.find(x=>x.id===id);
    if (!item) {
      setForm(initial);
      return;
    }
    setForm({
      libraryExerciseId: item.id, title: item.title,
      sets: String(item.defaultSets), repetitions: String(item.defaultRepetitions),
      durationMinutes: item.defaultDurationMinutes == null ? '' : String(item.defaultDurationMinutes),
      instructions: item.description || '', schedule: '', weekdays: [],
    });
  }

  const week = useMemo(() => days.map((label,i)=>({
    day: label, items: data.exercises.filter(e=>(e.weekdays || []).includes(i+1)),
  })), [data.exercises]);
  const unscheduled = data.exercises.filter(e=>!(e.weekdays || []).length);

  async function add(event) {
    event.preventDefault();
    await run(async () => {
      await api('/api/students/' + id + '/exercises', {
        method: 'POST', body: JSON.stringify(toPayload(form)),
      });
      setForm(initial);
    });
  }
  async function saveEdit(event) {
    event.preventDefault();
    await run(async () => {
      await api('/api/students/' + id + '/exercises/' + editing, {
        method: 'PATCH', body: JSON.stringify(toPayload(editForm)),
      });
      setEditing(null);
    });
  }
  return (
    <div className="stack">
      {error && <p className="error" role="alert">{error}</p>}
      <section className="card">
        <h2>Planejamento semanal</h2>
        <p className="muted">
          Dias definidos pelo professor. Os registros de realização são manuais e não representam
          uma avaliação clínica ou confirmação automática de presença.
        </p>
        <div className="weekly-board">
          {week.map(entry=>(
            <div className="weekly-day" key={entry.day}>
              <strong>{entry.day}</strong>
              {entry.items.length ? (
                <ul>{entry.items.map(ex=>(
                  <li key={ex.id}>
                    {ex.title}
                    <small>{ex.sets} × {ex.repetitions}
                      {ex.durationMinutes ? ' · ' + ex.durationMinutes + ' min' : ''}
                    </small>
                  </li>
                ))}</ul>
              ) : <small className="muted">Nenhuma atividade prevista</small>}
            </div>
          ))}
        </div>
        {unscheduled.length > 0 &&
          <p className="muted">{unscheduled.length} atividade(s) sem dias definidos ou com frequência em texto livre.</p>}
      </section>
      <div className="columns">
        <section className="card">
          <h2>Atividades deste aluno</h2>
          {data.exercises.length === 0 ? <p className="muted">Nenhuma atividade atribuída.</p> :
            <ul className="exercise-list">
              {data.exercises.map(item=>(
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.sets} séries × {item.repetitions} repetições
                    {item.durationMinutes ? ' · ' + item.durationMinutes + ' minutos' : ''}
                  </span>
                  {(item.weekdays || []).length > 0 &&
                    <small>Planejado: {item.weekdays.map(d=>days[d-1]).join(', ')}</small>}
                  {item.schedule && <small>Orientação de horário: {item.schedule}</small>}
                  {item.instructions && <small>{item.instructions}</small>}
                  <span className="muted">
                    Realizações registradas: {item.completedCount}
                    {item.lastCompletedAt && ' · Última: ' + new Date(item.lastCompletedAt).toLocaleDateString('pt-BR')}
                  </span>
                  <div className="actions">
                    <button type="button" className="secondary-light" disabled={busy || !active}
                      onClick={()=>run(()=>api('/api/students/' + id + '/exercises/' + item.id + '/complete',{method:'POST'}))}>
                      Registrar realização
                    </button>
                    <button type="button" className="secondary-light" disabled={busy || !active}
                      onClick={()=>{setEditing(editing===item.id?null:item.id);setEditForm(fromExisting(item));}}>
                      {editing===item.id?'Fechar edição':'Editar plano'}
                    </button>
                    <button type="button" className="danger-light" disabled={busy}
                      onClick={()=>{
                        if(window.confirm('Excluir esta atividade e todos os registros de realização?')) {
                          run(()=>api('/api/students/' + id + '/exercises/' + item.id,{method:'DELETE'}));
                        }
                      }}>Excluir</button>
                  </div>
                  {editing===item.id &&
                    <div className="workout-editor">
                      <h3>Editar prescrição</h3>
                      <ExerciseForm form={editForm} setForm={setEditForm}
                        onSubmit={saveEdit} submitLabel="Salvar plano" busy={busy} active={active}>
                        <button type="button" className="secondary-light" onClick={()=>setEditing(null)}>Cancelar</button>
                      </ExerciseForm>
                    </div>}
                </li>
              ))}
            </ul>}
        </section>
        <section className="card">
          <h2>Prescrever atividade</h2>
          <p className="muted">Escolha da biblioteca ou crie uma prescrição livre apenas para este aluno.</p>
          <label>Exercício da minha biblioteca
            <select value={form.libraryExerciseId} onChange={e=>chooseCatalog(e.target.value)}>
              <option value="">Prescrição livre</option>
              {library.map(e=><option key={e.id} value={e.id}>{e.title} · {e.category}</option>)}
            </select>
          </label>
          <ExerciseForm form={form} setForm={setForm}
            onSubmit={add} submitLabel="Atribuir atividade" busy={busy} active={active} />
          <p className="notice">
            O profissional deve decidir exercícios, frequência e volume adequados para cada aluno.
            Esta ferramenta não gera recomendações automáticas.
          </p>
        </section>
      </div>
    </div>
  );
}
