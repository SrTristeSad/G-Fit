import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

function TeacherRow({ teacher, refresh }) {
  const [maxStudents, setMaxStudents] = useState(teacher.maxStudents);
  const [active, setActive] = useState(teacher.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setMaxStudents(teacher.maxStudents);
    setActive(teacher.isActive);
  }, [teacher.maxStudents, teacher.isActive]);

  async function save() {
    setError('');
    setBusy(true);
    try {
      await api('/api/admin/teachers/' + teacher.id, {
        method: 'PATCH',
        body: JSON.stringify({ maxStudents: Number(maxStudents), isActive: active }),
      });
      await refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="teacher-record">
      <div>
        <strong>{teacher.name}</strong> {teacher.isAdmin && <span className="tag">Admin</span>}
        <span className="muted">{teacher.email}</span>
      </div>
      <div className="teacher-controls">
        <span>{teacher.activeStudents} alunos ativos</span>
        <label>Limite
          <input type="number" min="0" max="10000" value={maxStudents}
            onChange={e => setMaxStudents(e.target.value)} />
        </label>
        <label className="checkline">
          <input type="checkbox" checked={active} disabled={teacher.isAdmin}
            onChange={e => setActive(e.target.checked)} />
          Ativo
        </label>
        <button type="button" className="primary" disabled={busy} onClick={save}>Salvar</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}
export default function AdminPanel() {
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const result = await api('/api/admin/teachers');
    setTeachers(result.teachers);
  }, []);
  useEffect(() => {
    refresh().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [refresh]);
  return (
    <section className="stack">
      <div><div className="eyebrow">Administração</div><h1>Professores da plataforma</h1></div>
      <div className="card">
        <h2>Contas e vagas disponíveis</h2>
        <p className="muted">
          O limite se aplica a alunos ativos de cada professor. Arquivados não ocupam vagas.
          Reduzir o limite não exclui alunos existentes, apenas impede novos cadastros
          até que haja vagas.
        </p>
        {error && <p role="alert" className="error">{error}</p>}
        {loading ? <p>Carregando contas…</p> :
          teachers.length === 0 ? <p>Nenhum professor cadastrado.</p> :
          <div className="teacher-list">{teachers.map(teacher => (
            <TeacherRow key={teacher.id} teacher={teacher} refresh={refresh} />
          ))}</div>}
      </div>
    </section>
  );
}
