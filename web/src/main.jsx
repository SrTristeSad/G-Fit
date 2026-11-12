import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import { homeFor, resolveWorkspaceRoute, urlFor } from './routes.js';
import StudentProfile from './StudentProfile.jsx';
import ExerciseLibrary from './ExerciseLibrary.jsx';
import ClassManager from './ClassManager.jsx';
import ReportsPanel from './ReportsPanel.jsx';
import AdminPanel from './AdminPanel.jsx';
import AccountPanel from './AccountPanel.jsx';
import BillingPanel from './BillingPanel.jsx';
import './style.css';

function App() {
  const [teacher, setTeacher] = useState(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState('login');
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [students, setStudents] = useState([]);
  const [quota, setQuota] = useState({ activeStudents: 0, maxStudents: 20 });
  const [myPlan, setMyPlan] = useState(null);
  const [myAccess, setMyAccess] = useState(null);
  const [studentName, setStudentName] = useState('');
  const navigate = useCallback((url, { replace = false } = {}) => {
    if (window.location.pathname !== url) {
      window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
    }
    setPathname(url);
    setSelectedId(null);
  }, []);

  const route = resolveWorkspaceRoute(pathname, teacher);
  const adminEntry = pathname === '/admin' || pathname.startsWith('/admin/');
  const inAdminWorkspace = Boolean(teacher?.isAdmin && adminEntry);
  const tab = route.view === 'account' ? 'account'
    : inAdminWorkspace ? 'admin' : route.view;
  const registering = !adminEntry && mode === 'register';

  useEffect(() => {
    const onPopState = () => {
      setPathname(window.location.pathname);
      setSelectedId(null);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (teacher && route.redirect) {
      navigate(route.redirect, { replace: true });
    }
  }, [teacher, route.redirect, navigate]);

  const refreshStudents = useCallback(async () => {
    const [result, planInfo, accessInfo] = await Promise.all([
      api('/api/students'),
      api('/api/account/plan'),
      api('/api/account/access'),
    ]);
    setStudents(result.students);
    setQuota(result.quota);
    setMyPlan(planInfo.plan);
    setMyAccess(accessInfo.access);
  }, []);

  useEffect(() => {
    api('/api/auth/me')
      .then(data => setTeacher(data.teacher))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (teacher && !adminEntry) {
      refreshStudents().catch(err => setError(err.message));
    }
  }, [teacher, adminEntry, refreshStudents]);

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
      if (registering) body.name = String(form.get('name'));
      const result = await api('/api/auth/' + (registering ? 'register' : 'login'), {
        method: 'POST', body: JSON.stringify(body),
      });
      setTeacher(result.teacher);
      const target = resolveWorkspaceRoute(window.location.pathname, result.teacher);
      navigate(target.redirect || (window.location.pathname === '/' ? homeFor(result.teacher) : window.location.pathname), { replace: true });
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
      setMyPlan(null);
      setMyAccess(null);
      setSelectedId(null);
      navigate('/', { replace: true });
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (checking) return <main className="center"><p>Carregando G Fit…</p></main>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="symbol">G</span><span>Fit</span><span className="brand-subtitle">Plataforma de gestão</span></div>
        {teacher && (
          <div className="header-actions">
            <span className="workspace-badge">{inAdminWorkspace ? 'Administrador' : 'Área do professor'}</span>
            <span className="header-name">{teacher.name}</span>
            {teacher.isAdmin && (
              <nav aria-label="Alternar ambiente" className="workspace-switcher">
                <button type="button" className={!inAdminWorkspace ? 'active' : ''}
                  aria-current={!inAdminWorkspace ? 'page' : undefined}
                  onClick={() => navigate('/professor')}>Área do professor</button>
                <button type="button" className={inAdminWorkspace ? 'active' : ''}
                  aria-current={inAdminWorkspace ? 'page' : undefined}
                  onClick={() => navigate('/admin')}>Administração</button>
              </nav>
            )}
            <button className="header-shortcut" type="button" onClick={() => {
              const workspace = inAdminWorkspace ? 'admin' : 'professor';
              navigate(tab === 'account' ? urlFor(teacher, inAdminWorkspace ? 'overview' : 'students', workspace)
                : urlFor(teacher, 'account', workspace));
            }}>{tab === 'account' ? 'Voltar ao painel' : 'Conta e segurança'}</button>
            <button className="secondary" disabled={busy} onClick={logout}>Sair</button>
          </div>
        )}
      </header>
      <main className={inAdminWorkspace ? 'admin-root' : undefined}>
        {!teacher ? (
          <section className="auth card">
            <div className="eyebrow">{adminEntry ? 'Área administrativa' : 'Movimento com cuidado'}</div>
            <h1>{adminEntry ? 'Entrar na administração' : registering ? 'Criar conta de professor' : 'Bem-vindo ao G Fit'}</h1>
            <p className="muted">{adminEntry
              ? 'Acesso reservado às contas de administração do G Fit.'
              : 'Organize seus alunos e as atividades com segurança e praticidade.'}</p>
            <form onSubmit={submitAuth}>
              {registering && (
                <label>Nome completo<input name="name" autoComplete="name"
                  minLength="2" maxLength="120" required /></label>
              )}
              <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
              <label>Senha<input name="password" type="password"
                minLength={registering ? 10 : undefined}
                maxLength="128"
                autoComplete={registering ? 'new-password' : 'current-password'} required /></label>
              {error && <p role="alert" className="error">{error}</p>}
              <button className="primary" type="submit" disabled={busy}>
                {busy ? 'Aguarde…' : registering ? 'Criar conta' : 'Entrar'}
              </button>
            </form>
            {!adminEntry && <button className="link" onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}>
              {registering ? 'Já tenho uma conta' : 'Primeiro acesso? Criar conta'}
            </button>}
          </section>
        ) : (
          <>
            {!inAdminWorkspace && tab !== 'account' && <nav aria-label="Área do professor" className="tabs teacher-tabs">
              <button className={tab === 'students' ? 'active' : ''} onClick={() => { navigate(urlFor(teacher, 'students', 'professor')); }}>
                Meus alunos
              </button>
              <button className={tab === 'library' ? 'active' : ''} onClick={() => {
                navigate(urlFor(teacher, 'library', 'professor'));
              }}>Exercícios</button>
              <button className={tab === 'classes' ? 'active' : ''} onClick={() => {
                navigate(urlFor(teacher, 'classes', 'professor'));
              }}>Turmas e presença</button>
              <button className={tab === 'reports' ? 'active' : ''} onClick={() => {
                navigate(urlFor(teacher, 'reports', 'professor'));
              }}>Relatórios</button>
              <button className={tab === 'billing' ? 'active' : ''} onClick={() => {
                navigate(urlFor(teacher, 'billing', 'professor'));
              }}>Pix (teste)</button>
            </nav>}
            {tab === 'account' ? <AccountPanel onPasswordChanged={() => {
                setTeacher(null); setStudents([]);
                navigate('/', { replace: true });
                setError('Senha alterada. Entre novamente com a nova senha.');
              }} /> :
              inAdminWorkspace ? <AdminPanel view={route.view}
                onNavigate={section => navigate(urlFor(teacher, section, 'admin'))}
                onOpenSecurity={() => navigate(urlFor(teacher, 'account', 'admin'))} /> :
              tab === 'billing' ? <BillingPanel /> :
              tab === 'library' ? <ExerciseLibrary /> :
              tab === 'classes' ? <ClassManager /> :
              tab === 'reports' ? <ReportsPanel /> :
              selectedId ? (
                <StudentProfile id={selectedId} onBack={() => setSelectedId(null)} onChanged={refreshStudents} />
              ) : (
                <>
                  <div className="intro">
                    <div>
                      <div className="eyebrow">Painel do professor</div>
                      <h1>Olá, {teacher.name.split(' ')[0]}!</h1>
                      <p className="muted">Selecione um aluno para ver sua ficha e seu plano de atividades.</p>
                      <p className="muted">
                        {myPlan ? 'Plano vinculado: ' + myPlan.name + ' (atribuição manual; sem cobrança Pix)' :
                          'Sem plano comercial atribuído; vale o limite individual configurado pela administração.'}
                      </p>
                      {myAccess && myAccess.status !== 'legacy' && (
                        <p className={myAccess.status === 'active' ? 'muted' : 'error'} role="status">
                          Prazo administrativo: {myAccess.startsOn} até {myAccess.endsOn}.
                          {myAccess.status === 'active' ? ' Acesso dentro da vigência.' :
                            ' A vigência não está ativa: novos alunos e novas prescrições estão bloqueados.'}
                          {' '}Isso não confirma pagamento.
                        </p>
                      )}
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
