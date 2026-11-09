import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível completar a operação.');
  return data;
}

function App() {
  const [teacher, setTeacher] = useState(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [students, setStudents] = useState([]);
  const [studentName, setStudentName] = useState('');

  useEffect(() => {
    api('/api/auth/me')
      .then(data => setTeacher(data.teacher))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (teacher) {
      api('/api/students')
        .then(data => setStudents(data.students))
        .catch(e => setError(e.message));
    }
  }, [teacher]);

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
      setStudents([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function addStudent(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/students', {
        method: 'POST', body: JSON.stringify({ name: studentName }),
      });
      setStudents(current => [result.student, ...current]);
      setStudentName('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
      setTeacher(null);
      setStudents([]);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return <main className="center"><p>Carregando G Fit…</p></main>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="symbol">G</span><span>Fit</span></div>
        {teacher && (
          <button className="secondary" disabled={busy} onClick={logout}>Sair da conta</button>
        )}
      </header>
      <main>
        {!teacher ? (
          <section className="auth card">
            <div className="eyebrow">Movimento com cuidado</div>
            <h1>{mode === 'login' ? 'Bem-vindo ao G Fit' : 'Criar conta de professor'}</h1>
            <p className="muted">
              Organize seus alunos e prepare suas atividades em um só lugar.
            </p>
            <form onSubmit={submitAuth}>
              {mode === 'register' && (
                <label>Nome completo
                  <input name="name" autoComplete="name" minLength="2" maxLength="120" required />
                </label>
              )}
              <label>E-mail
                <input name="email" type="email" autoComplete="email" required />
              </label>
              <label>Senha
                <input
                  name="password"
                  type="password"
                  minLength={mode === 'register' ? 10 : undefined}
                  maxLength="128"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  required
                />
              </label>
              {error && <p role="alert" className="error">{error}</p>}
              <button disabled={busy} className="primary" type="submit">
                {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
            </form>
            <button
              className="link"
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
            >
              {mode === 'login' ? 'Primeiro acesso? Criar conta' : 'Já tenho uma conta'}
            </button>
          </section>
        ) : (
          <>
            <div className="intro">
              <div>
                <div className="eyebrow">Painel do professor</div>
                <h1>Olá, {teacher.name.split(' ')[0]}!</h1>
                <p className="muted">Gerencie seus alunos com praticidade.</p>
              </div>
              <div className="stat">
                <strong>{students.length}</strong><span>Alunos cadastrados</span>
              </div>
            </div>
            <div className="columns">
              <section className="card">
                <h2>Cadastrar aluno</h2>
                <p className="muted">
                  Comece pelo nome. Dados de saúde ainda não são coletados.
                </p>
                <form onSubmit={addStudent}>
                  <label>Nome do aluno
                    <input
                      value={studentName}
                      onChange={e => setStudentName(e.target.value)}
                      minLength="2"
                      maxLength="120"
                      placeholder="Nome completo"
                      required
                    />
                  </label>
                  {error && <p role="alert" className="error">{error}</p>}
                  <button className="primary" type="submit" disabled={busy}>
                    Adicionar aluno
                  </button>
                </form>
              </section>
              <section className="card">
                <h2>Meus alunos</h2>
                {students.length === 0 ? (
                  <p className="muted">Nenhum aluno cadastrado ainda.</p>
                ) : (
                  <ul className="students">
                    {students.map(s => (
                      <li key={s.id}>
                        <span className="avatar">{s.name[0]?.toUpperCase()}</span>
                        <span>{s.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <p className="notice">
              Versão inicial: planejamento de aulas e Pix serão adicionados em etapas futuras.
            </p>
          </>
        )}
      </main>
      <footer>G Fit · Protótipo inicial</footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
