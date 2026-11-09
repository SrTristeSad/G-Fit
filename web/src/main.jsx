import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import StudentProfile from './StudentProfile.jsx';
import AdminPanel from './AdminPanel.jsx';
import './style.css';

function App() {
  const [teacher, setTeacher] = useState(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState('login');
  const [tab, setTab] = useState('students');
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [students, setStudents] = useState([]);
  const [quota, setQuota] = useState({ activeStudents: 0, maxStudents: 20 });
  const [studentName, setStudentName] = useState('');

  const refreshStudents = useCallback(async () => {
    const result = await api('/api/students');
    setStudents(result.students);
    setQuota(result.quota);
  }, []);

  useEffect(() => {
    api('/api/auth/me')
      .then(data => setTeacher(data.teacher))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (teacher) {
      refreshStudents().catch(err => setError(err.message));
    }
  }, [teacher, refreshStudents]);

  async function submitAuth(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    try {
      const body = {
        email: String(form.get('email')),
        password: String(form.get('password')),
      };
      if (mode === 'register') body.name = String(form.get('name'));
      const result = await api('/api/auth/' + (mode === 'register' ? 'register' : 'login'), {
        method: 'POST', body: JSON.stringify(body),
      });
      setTeacher(result.teacher);
      setSelectedId(null);
      setTab('students');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function addStudent(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/students', { method: 'POST', body: JSON.stringify({ name: studentName }) });
      setStudentName('');
      await refreshStudents();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/logout', { method: 'POST' });
      setTeacher(null);
      setStudents([]);
      setSelectedId(null);
      setTab('students');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (checking) return <main className="center"><p>Carregando G Fit…</p></main>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="symbol">G</span><span>Fit</span></div>
        {teacher && (
          <div className="header-actions">
            <span className="header-name">{teacher.name}</span>
            <button className="secondary" disabled={busy} onClick={logout}>Sair</button>
          </div>
        )}
      </header>
      <main>
        {!teacher ? (
          <section className="auth card">
            <div className="eyebrow">Movimento com cuidado</div>
            <h1>{mode === 'login' ? 'Bem-vindo ao G Fit' : 'Criar conta de professor'}</h1>
            <p className="muted">Organize seus alunos e as atividades com segurança e praticidade.</p>
            <form onSubmit={submitAuth}>
              {mode === 'register' && (
                <label>Nome completo<input name="name" autoComplete="name"
                  minLength="2" maxLength="120" required /></label>
              )}
              <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
              <label>Senha<input name="password" type="password"
                minLength={mode === 'register' ? 10 : undefined}
                maxLength="128"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required /></label>
              {error && <p role="alert" className="error">{error}</p>}
              <button className="primary" type="submit" disabled={busy}>
                {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
            </form>
            <button className="link" onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}>
              {mode === 'login' ? 'Primeiro acesso? Criar conta' : 'Já tenho uma conta'}
            </button>
          </section>
        ) : (
          <>
            <nav aria-label="Áreas do sistema" className="tabs">
              <button className={tab === 'students' ? 'active' : ''} onClick={() => { setTab('students'); setSelectedId(null); }}>
                Meus alunos
              </button>
              {teacher.isAdmin && (
                <button className={tab === 'admin' ? 'active' : ''} onClick={() => {
                  setTab('admin'); setSelectedId(null);
                }}>Administração</button>
              )}
            </nav>
            {tab === 'admin' && teacher.isAdmin ? <AdminPanel /> :
              selectedId ? (
                <StudentProfile id={selectedId} onBack={() => setSelectedId(null)} onChanged={refreshStudents} />
              ) : (
                <>
                  <div className="intro">
                    <div>
                      <div className="eyebrow">Painel do professor</div>
                      <h1>Olá, {teacher.name.split(' ')[0]}!</h1>
                      <p className="muted">Selecione um aluno para ver sua ficha e seu plano de atividades.</p>
                    </div>
                    <div className="stat">
                      <strong>{quota.activeStudents} / {quota.maxStudents}</strong>
                      <span>Vagas de alunos ativos</span>
                    </div>
                  </div>
                  <div className="columns">
                    <section className="card">
                      <h2>Cadastrar aluno</h2>
                      <p className="muted">
                        Insira só o nome inicial; os outros dados ficam na ficha do aluno.
                      </p>
                      <form onSubmit={addStudent}>
                        <label>Nome do aluno
                          <input value={studentName} onChange={e => setStudentName(e.target.value)}
                            minLength="2" maxLength="120" placeholder="Nome completo" required />
                        </label>
                        {error && <p role="alert" className="error">{error}</p>}
                        <button className="primary" type="submit"
                          disabled={busy || quota.activeStudents >= quota.maxStudents}>
                          {quota.activeStudents >= quota.maxStudents ? 'Limite de vagas atingido' : 'Adicionar aluno'}
                        </button>
                      </form>
                    </section>
                    <section className="card">
                      <h2>Meus alunos</h2>
                      {students.length === 0 ? (
                        <p className="muted">Nenhum aluno cadastrado ainda.</p>
                      ) : (
                        <ul className="students">
                          {students.map(student => (
                            <li key={student.id}>
                              <span className="avatar">{student.name[0]?.toUpperCase()}</span>
                              <button className="student-link" onClick={() => setSelectedId(student.id)}>
                                {student.preferredName || student.name}
                                {!student.active && <span className="tag">Arquivado</span>}
                                <small>Ver ficha e atividades →</small>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                  <p className="notice">O acompanhamento de atividades é registrado manualmente pelo professor; esta versão ainda não coleta dados de dispositivos.</p>
                </>
              )}
          </>
        )}
      </main>
      <footer>G Fit · Protótipo inicial · Acesso profissional</footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
