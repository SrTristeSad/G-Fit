import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import StudentWorkouts from './StudentWorkouts.jsx';

const blank = {
  name: '', preferredName: '', dateOfBirth: '', phone: '',
  emergencyContact: '', emergencyPhone: '', goals: '', notes: '',
};
function normalized(student) {
  return Object.fromEntries(
    Object.keys(blank).map(key => [key, key === 'dateOfBirth' && student[key] ? String(student[key]).slice(0, 10) : (student[key] ?? '')]),
  );
}
function age(date) {
  if (!date) return null;
  const dateValue = String(date).slice(0, 10);
  const born = new Date(dateValue + 'T12:00:00Z');
  const today = new Date();
  let years = today.getFullYear() - born.getUTCFullYear();
  if (today.getMonth() < born.getUTCMonth() ||
      (today.getMonth() === born.getUTCMonth() && today.getDate() < born.getUTCDate())) years -= 1;
  return years;
}

export default function StudentProfile({ id, onBack, onChanged }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const info = await api('/api/students/' + id);
    setData(info);
    setForm(normalized(info.student));
  }, [id]);

  useEffect(() => {
    setLoading(true);
    setError('');
    load().catch(err => setError(err.message)).finally(() => setLoading(false));
  }, [load]);

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
      await onChanged?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function edit(key, value) {
    setForm(current => ({ ...current, [key]: value }));
  }
  async function saveProfile(event) {
    event.preventDefault();
    await run(() => api('/api/students/' + id, { method: 'PUT', body: JSON.stringify(form) }));
  }
  async function setActive(active) {
    await run(() => api('/api/students/' + id + '/status', {
      method: 'PATCH', body: JSON.stringify({ active }),
    }));
  }

  if (loading) return <section className="card"><p>Carregando ficha do aluno…</p></section>;
  return (
    <div className="stack">
      <button className="link" onClick={onBack}>← Voltar aos alunos</button>
      {error && <p role="alert" className="error">{error}</p>}
      {data && (
        <>
          <div className="intro">
            <div>
              <div className="eyebrow">Ficha individual</div>
              <h1>{data.student.preferredName || data.student.name}</h1>
              <p className="muted">
                {data.student.active ? 'Aluno ativo' : 'Aluno arquivado'}
                {data.student.dateOfBirth ? ' · ' + age(data.student.dateOfBirth) + ' anos' : ''}
              </p>
            </div>
            <div className="stat">
              <strong>{data.summary.loggedCompletions}</strong>
              <span>Atividades registradas</span>
            </div>
          </div>
          <section className="card">
            <div className="section-heading">
              <h2>Dados do aluno</h2>
              <button className="secondary-light" disabled={busy}
                onClick={() => setActive(!data.student.active)}>
                {data.student.active ? 'Arquivar aluno' : 'Reativar aluno'}
              </button>
            </div>
            <form onSubmit={saveProfile}>
              <div className="form-grid">
                <label>Nome completo<input required minLength="2" maxLength="120"
                  value={form.name} onChange={e => edit('name', e.target.value)} /></label>
                <label>Nome preferido<input maxLength="80"
                  value={form.preferredName} onChange={e => edit('preferredName', e.target.value)} /></label>
                <label>Data de nascimento<input type="date" max={new Date().toISOString().slice(0, 10)}
                  value={form.dateOfBirth ? String(form.dateOfBirth).slice(0, 10) : ''}
                  onChange={e => edit('dateOfBirth', e.target.value)} /></label>
                <label>Telefone<input type="tel" maxLength="30"
                  value={form.phone} onChange={e => edit('phone', e.target.value)} /></label>
                <label>Contato de emergência<input maxLength="120"
                  value={form.emergencyContact} onChange={e => edit('emergencyContact', e.target.value)} /></label>
                <label>Telefone de emergência<input type="tel" maxLength="30"
                  value={form.emergencyPhone} onChange={e => edit('emergencyPhone', e.target.value)} /></label>
              </div>
              <label>Objetivos definidos com o aluno
                <textarea rows="3" maxLength="1000"
                  value={form.goals} onChange={e => edit('goals', e.target.value)}
                  placeholder="Ex.: melhorar disposição e autonomia nas atividades diárias" />
              </label>
              <label>Observações gerais do professor
                <textarea rows="3" maxLength="1000"
                  value={form.notes} onChange={e => edit('notes', e.target.value)}
                  placeholder="Não insira laudos, diagnósticos ou dados clínicos neste protótipo." />
              </label>
              <p className="notice">Dados pessoais: registre apenas o necessário, com ciência do aluno ou responsável. Esta versão ainda não está homologada para armazenar informações clínicas.</p>
              <button className="primary" disabled={busy}>Salvar ficha</button>
            </form>
          </section>
          <StudentWorkouts id={id} data={data} run={run} busy={busy} />
        </>
      )}
    </div>
  );
}
