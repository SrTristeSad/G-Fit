import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import PlansPanel from './PlansPanel.jsx';
import AccessPanel from './AccessPanel.jsx';
import BillingPanel from './BillingPanel.jsx';
import BillingOperations from './BillingOperations.jsx';
import AdminAlerts from './AdminAlerts.jsx';
import PrivacyRequestsAdmin from './PrivacyRequestsAdmin.jsx';
import SystemUpdates from './SystemUpdates.jsx';

const ADMIN_MENU = [
  { title: 'Painel', items: [{ id: 'overview', label: 'Visão geral' }] },
  { title: 'Gestão', items: [
    { id: 'teachers', label: 'Professores' },
    { id: 'plans', label: 'Planos' },
    { id: 'access', label: 'Vigências' },
  ] },
  { title: 'Financeiro', items: [
    { id: 'billing', label: 'Cobranças (teste)' },
    { id: 'operations', label: 'Monitoramento' },
    { id: 'alerts', label: 'Alertas' },
  ] },
  { title: 'Proteção e dados', items: [
    { id: 'security', label: 'Segurança' },
    { id: 'privacy', label: 'Privacidade' },
    { id: 'audit', label: 'Auditoria' },
  ] },
  { title: 'Sistema', items: [{ id: 'updates', label: 'Atualizações' }] },
];

const VIEW_TITLES = {
  overview: ['Visão geral', 'Acompanhe os indicadores essenciais da plataforma.'],
  teachers: ['Professores', 'Gerencie contas, limites e planos de acesso.'],
  plans: ['Planos comerciais', 'Organize planos e seus limites.'],
  access: ['Vigências', 'Controle os prazos administrativos de acesso.'],
  billing: ['Cobranças de teste', 'Acompanhe os pagamentos apenas no ambiente de simulação.'],
  operations: ['Monitoramento financeiro', 'Conciliação e eventos do Asaas Sandbox.'],
  alerts: ['Alertas', 'Acompanhe situações que exigem atenção.'],
  security: ['Central de segurança', 'Controles de conta, privacidade e rastreabilidade.'],
  privacy: ['Privacidade', 'Triagem de solicitações e responsabilidades de proteção de dados.'],
  audit: ['Auditoria', 'Histórico administrativo de alterações registradas.'],
  updates: ['Atualizações', 'Gerencie versões assinadas do G-Fit.'],
};

function Stat({ label, value, caption, featured = false }) {
  return (
    <div className={featured ? 'admin-stat admin-stat-featured' : 'admin-stat'}>
      <span>{label}</span>
      <strong>{value}</strong>
      {caption && <small>{caption}</small>}
    </div>
  );
}

function TeacherRow({ teacher, refresh, plans }) {
  const [maxStudents, setMaxStudents] = useState(teacher.maxStudents);
  const [active, setActive] = useState(teacher.isActive);
  const [selectedPlanId, setSelectedPlanId] = useState(teacher.planId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setMaxStudents(teacher.maxStudents);
    setActive(teacher.isActive);
    setSelectedPlanId(teacher.planId || '');
  }, [teacher.maxStudents, teacher.isActive, teacher.planId]);

  async function save() {
    setError('');
    setSaved(false);
    const quota = Number(maxStudents);
    if (!Number.isInteger(quota) || quota < 0 || quota > 10000) {
      setError('Informe um limite entre 0 e 10.000 alunos.');
      return;
    }
    setBusy(true);
    try {
      await api('/api/admin/teachers/' + teacher.id, {
        method: 'PATCH',
        body: JSON.stringify({ maxStudents: quota, isActive: active }),
      });
      await refresh();
      setSaved(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function assignPlan() {
    if (!selectedPlanId) return;
    setError('');
    setSaved(false);
    setBusy(true);
    try {
      await api('/api/admin/teachers/' + teacher.id + '/plan', {
        method: 'PUT', body: JSON.stringify({ planId: selectedPlanId }),
      });
      await refresh();
      setSaved(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function removePlan() {
    if (!window.confirm('Desvincular o plano? O limite atual do professor será preservado.')) return;
    setError('');
    setSaved(false);
    setBusy(true);
    try {
      await api('/api/admin/teachers/' + teacher.id + '/plan', { method: 'DELETE' });
      await refresh();
      setSaved(true);
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
        <span>{teacher.activeStudents} aluno(s) ativo(s)</span>
        <label>Máximo
          <input aria-label={'Limite de alunos de ' + teacher.name}
            type="number" min="0" max="10000" value={maxStudents}
            onChange={e => { setMaxStudents(e.target.value); setSaved(false); }} />
        </label>
        <label className="checkline">
          <input aria-label={'Conta ativa: ' + teacher.name}
            type="checkbox" checked={active} disabled={teacher.isAdmin}
            onChange={e => { setActive(e.target.checked); setSaved(false); }} />
          Conta ativa
        </label>
        <button type="button" className="primary" disabled={busy} onClick={save}>
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
      {!teacher.isAdmin && (
        <div className="teacher-plan-controls">
          <label>Plano atribuído manualmente
            <select value={selectedPlanId} onChange={e => { setSelectedPlanId(e.target.value); setSaved(false); }}>
              <option value="">Sem plano atribuído</option>
              {plans.filter(plan => plan.isActive || plan.id === teacher.planId).map(plan => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}{!plan.isActive ? ' (desativado)' : ''} — {plan.maxStudents} alunos
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary-light" disabled={busy || !selectedPlanId || selectedPlanId === teacher.planId}
            onClick={assignPlan}>Atribuir plano</button>
          {teacher.planId && (
            <button type="button" className="secondary-light" disabled={busy}
              onClick={removePlan}>Desvincular</button>
          )}
          <small className="muted">
            {teacher.planName ? 'Atual: ' + teacher.planName : 'Nenhum plano vinculado.'}
            {' '}Atribuir outro plano redefine o limite; não confirma pagamento.
          </small>
        </div>
      )}
      {saved && <p role="status" className="saved-message">Alterações salvas.</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}

function AuditList({ events }) {
  if (!events.length) return <p className="muted">Ainda não há alterações administrativas registradas.</p>;
  return (
    <ul className="admin-history">
      {events.map(event => {
        const before = event.changes?.before ?? {};
        const after = event.changes?.after ?? {};
        const parts = [];
        if (before.maxStudents !== after.maxStudents) {
          parts.push('Limite: ' + before.maxStudents + ' → ' + after.maxStudents);
        }
        if (before.isActive !== after.isActive) {
          parts.push(after.isActive ? 'Conta reativada' : 'Conta suspensa');
        }
        let subject = event.targetName || 'Administração';
        if (event.action === 'plan.created') {
          subject = 'Plano criado: ' + (event.changes?.name || 'novo plano');
          parts.push('Preço e limites configurados');
        } else if (event.action === 'plan.status.updated') {
          subject = 'Disponibilidade de plano';
          parts.push(event.changes.after ? 'Plano reativado' : 'Plano desativado');
        } else if (event.action === 'teacher.plan.assigned') {
          parts.push('Plano vinculado manualmente');
          parts.push('Limite: ' + event.changes.previousMaxStudents + ' → ' + event.changes.maxStudents);
        } else if (event.action === 'teacher.plan.removed') {
          parts.push('Plano desvinculado; limite preservado');
        } else if (event.action === 'teacher.access.granted') {
          parts.push('Prazo de acesso concedido ou redefinido manualmente');
        } else if (event.action === 'teacher.access.renewed') {
          parts.push('Renovação manual: ' + event.changes.months + ' mês(es)');
        } else if (event.action === 'teacher.access.revoked') {
          parts.push('Prazo de acesso revogado');
        }
        else if (event.action === 'billing.pix.verified') {
          parts.push('Pix Sandbox confirmado com o Asaas');
          parts.push('Valor: R$ ' + ((event.changes?.amountCents || 0) / 100).toFixed(2).replace('.', ','));
        } else if (event.action === 'billing.pix.cancelled') {
          parts.push('Cobrança não paga removida no Asaas Sandbox');
        } else if (event.action === 'billing.pix.refund.observed') {
          parts.push('Estorno observado no Asaas Sandbox: ' + (event.changes?.refundState || 'revisão'));
          parts.push('Devolvido: R$ ' + ((event.changes?.refundedCents || 0) / 100).toFixed(2).replace('.', ','));
        } else if (event.action === 'billing.customer.configured') {
          parts.push('Cliente Asaas Sandbox associado à conta');
        }
        return (
          <li key={event.id}>
            <strong>{subject}</strong>
            <span>{parts.join(' · ') || 'Configuração atualizada'}</span>
            <small>
              Por {event.actorName} · {new Date(event.createdAt).toLocaleString('pt-BR')}
            </small>
          </li>
        );
      })}
    </ul>
  );
}

export default function AdminPanel({ view = 'overview', onNavigate, onOpenSecurity }) {
  const [teachers, setTeachers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [accessTerms, setAccessTerms] = useState([]);
  const [alertsSummary, setAlertsSummary] = useState({ open: 0, acknowledged: 0 });
  const [overview, setOverview] = useState(null);
  const [billing, setBilling] = useState(null);
  const [events, setEvents] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const [accounts, dashboard, audit, planList, accessList, alerts] = await Promise.all([
      api('/api/admin/teachers'),
      api('/api/admin/dashboard'),
      api('/api/admin/audit'),
      api('/api/admin/plans'),
      api('/api/admin/access'),
      api('/api/admin/alerts'),
    ]);
    setTeachers(accounts.teachers);
    setOverview(dashboard.overview);
    setBilling(dashboard.billing);
    setEvents(audit.events);
    setPlans(planList.plans);
    setAccessTerms(accessList.accessTerms);
    setAlertsSummary(alerts.summary);
  }, []);

  useEffect(() => {
    refresh().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [refresh]);

  const filteredTeachers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    return teachers.filter(teacher => {
      const matches = !query ||
        teacher.name.toLocaleLowerCase('pt-BR').includes(query) ||
        teacher.email.toLocaleLowerCase('pt-BR').includes(query);
      const status = statusFilter === 'all' ||
        (statusFilter === 'active' && teacher.isActive) ||
        (statusFilter === 'inactive' && !teacher.isActive);
      return matches && status;
    });
  }, [teachers, search, statusFilter]);

  async function reload() {
    setError('');
    setLoading(true);
    try { await refresh(); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  const title = VIEW_TITLES[view] || VIEW_TITLES.overview;
  return (
    <section className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-head">
          <span className="admin-sidebar-mark">G</span>
          <div>
            <strong>G Fit</strong>
            <small>Área administrativa</small>
          </div>
        </div>
        <nav aria-label="Navegação administrativa" className="admin-side-nav">
          {ADMIN_MENU.map(group => (
            <div className="admin-nav-group" key={group.title}>
              <span className="admin-nav-label">{group.title}</span>
              {group.items.map(item => (
                <button key={item.id} type="button"
                  className={view === item.id ? 'active' : ''}
                  aria-current={view === item.id ? 'page' : undefined}
                  onClick={() => onNavigate(item.id)}>
                  <span>{item.label}</span>
                  {item.id === 'alerts' && alertsSummary.open > 0 &&
                    <span className="admin-nav-count">{alertsSummary.open}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <p className="admin-sidebar-note">A gestão da plataforma é separada das fichas individuais dos alunos.</p>
      </aside>
      <div className="admin-main stack">
        <div className="admin-main-heading">
          <div>
            <div className="eyebrow">Administração / {title[0]}</div>
            <h1>{title[0]}</h1>
            <p className="muted">{title[1]}</p>
          </div>
          <button className="secondary-light" disabled={loading} onClick={reload}>Atualizar dados</button>
        </div>
      {error && <p role="alert" className="error">{error}</p>}
      {loading && <p className="muted">Atualizando informações…</p>}
      {view === 'overview' && (
        <div className="stack">
          <div className="admin-overview-intro">
            <div>
              <div className="eyebrow">Resumo operacional</div>
              <h2>O que está acontecendo no G Fit</h2>
              <p className="muted">Indicadores agregados, sem exposição de fichas individuais.</p>
            </div>
            <button type="button" className="secondary-light" onClick={() => onNavigate('teachers')}>
              Gerenciar professores
            </button>
          </div>
          <div className="admin-stats admin-stats-primary">
            <Stat featured label="Professores ativos" value={overview?.teachersActive ?? '—'}
              caption={overview ? overview.teachersTotal + ' cadastrados' : ''} />
            <Stat featured label="Alunos ativos" value={overview?.studentsActive ?? '—'}
              caption={overview ? overview.studentsArchived + ' arquivados' : ''} />
            <Stat featured label="Turmas ativas" value={overview?.classesActive ?? '—'}
              caption={overview ? overview.classesArchived + ' arquivadas' : ''} />
            <Stat featured label="Alertas em aberto" value={alertsSummary.open ?? '—'}
              caption={alertsSummary.open ? 'Acompanhar no financeiro' : 'Sem alertas abertos'} />
          </div>
          <div className="admin-overview-columns">
            <section className="card admin-summary-card">
              <div className="section-heading">
                <div>
                  <h2>Atividade da plataforma</h2>
                  <p className="muted">Registros operacionais e atividade recente.</p>
                </div>
              </div>
              <dl className="admin-metric-list">
                <div><dt>Atividades atribuídas</dt><dd>{overview?.exercisesAssigned ?? '—'}</dd></div>
                <div><dt>Realizações registradas</dt><dd>{overview?.completionsLogged ?? '—'}</dd></div>
                <div><dt>Aulas cadastradas</dt><dd>{overview?.classSessions ?? '—'}</dd></div>
                <div><dt>Presenças manuais</dt><dd>{overview?.attendancePresent ?? '—'}</dd></div>
                <div><dt>Faltas registradas</dt><dd>{overview?.attendanceAbsent ?? '—'}</dd></div>
                <div><dt>Novos alunos (30 dias)</dt><dd>{overview?.studentsNew30d ?? '—'}</dd></div>
                <div><dt>Exportações de alunos</dt><dd>{overview?.studentExportsTotal ?? '—'}</dd></div>
                <div><dt>Exportações (30 dias)</dt><dd>{overview?.studentExportsLast30d ?? '—'}</dd></div>
              </dl>
            </section>
            <section className="card admin-summary-card">
              <h2>Contas e vigências</h2>
              <p className="muted">Situação de acesso dos profissionais cadastrados.</p>
              <dl className="admin-metric-list">
                <div><dt>Professores suspensos</dt><dd>{overview?.teachersInactive ?? '—'}</dd></div>
                <div><dt>Novos professores (30 dias)</dt><dd>{overview?.teachersNew30d ?? '—'}</dd></div>
                <div><dt>Vigências ativas</dt><dd>{overview?.manualAccessActive ?? '—'}</dd></div>
                <div><dt>Vigências vencidas</dt><dd>{overview?.manualAccessExpired ?? '—'}</dd></div>
                <div><dt>Vigências agendadas</dt><dd>{overview?.manualAccessScheduled ?? '—'}</dd></div>
              </dl>
              <div className="admin-summary-actions">
                <button type="button" className="secondary-light" onClick={() => onNavigate('access')}>Ver vigências</button>
              </div>
            </section>
          </div>
          <section className="card admin-finance-brief">
            <div>
              <div className="eyebrow">Financeiro</div>
              <h2>Ambiente de testes</h2>
              <p className="muted">{billing?.message || 'Sem dados financeiros disponíveis.'}</p>
              <small>Pix somente no Sandbox. Esta área não representa faturamento real.</small>
            </div>
            <button type="button" className="secondary-light" onClick={() => onNavigate('billing')}>
              Abrir financeiro
            </button>
          </section>
        </div>
      )}
      {view === 'security' && (
        <div className="stack">
          <div className="admin-security-intro">
            <div className="eyebrow">Proteção e dados</div>
            <h2>Segurança da plataforma</h2>
            <p>Os controles disponíveis ficam organizados aqui. A existência desta área
              não substitui a revisão de segurança, os processos de LGPD ou a gestão de backups.</p>
          </div>
          <div className="admin-security-grid">
            <article className="card admin-security-card">
              <span className="admin-security-index">01 / Conta</span>
              <h3>Senha e sessões</h3>
              <p>Altere a senha da sua conta administrativa. A troca encerra as sessões existentes.</p>
              <button type="button" className="secondary-light" onClick={onOpenSecurity}>Abrir minha segurança</button>
            </article>
            <article className="card admin-security-card">
              <span className="admin-security-index">02 / Dados</span>
              <h3>Privacidade</h3>
              <p>Analise pedidos registrados sem abrir as fichas dos alunos. A exclusão definitiva ainda não foi implementada.</p>
              <button type="button" className="secondary-light" onClick={() => onNavigate('privacy')}>Ver solicitações</button>
            </article>
            <article className="card admin-security-card">
              <span className="admin-security-index">03 / Registros</span>
              <h3>Auditoria administrativa</h3>
              <p>Consulte as últimas alterações administrativas registradas, com autor e horário.</p>
              <button type="button" className="secondary-light" onClick={() => onNavigate('audit')}>Consultar histórico</button>
            </article>
            <article className="card admin-security-card">
              <span className="admin-security-index">04 / Integridade</span>
              <h3>Atualizações verificadas</h3>
              <p>Acompanhe o fluxo existente de atualizações por ZIP assinado, quando configurado no servidor.</p>
              <button type="button" className="secondary-light" onClick={() => onNavigate('updates')}>Gerenciar versões</button>
            </article>
          </div>
        </div>
      )}
      {view === 'teachers' && (
        <div className="card">
          <h2>Professores e limites</h2>
          <p className="muted">
            Defina o máximo de alunos ativos por conta. Arquivados não ocupam vagas.
            Reduzir o limite não exclui alunos já cadastrados.
          </p>
          <div className="admin-filters">
            <label>Buscar professor
              <input type="search" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Nome ou e-mail" />
            </label>
            <label>Situação
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">Todos</option>
                <option value="active">Ativos</option>
                <option value="inactive">Suspensos</option>
              </select>
            </label>
          </div>
          {!loading && filteredTeachers.length === 0 ?
            <p className="muted">Nenhuma conta corresponde aos filtros.</p> :
            <div className="teacher-list">{filteredTeachers.map(teacher => (
              <TeacherRow key={teacher.id} teacher={teacher} refresh={reload} plans={plans} />
            ))}</div>}
        </div>
      )}
      {view === 'plans' && <PlansPanel plans={plans} onChanged={reload} />}
      {view === 'access' && <AccessPanel teachers={teachers} accessTerms={accessTerms} refresh={reload} />}
      {view === 'billing' && <BillingPanel admin teachers={teachers} />}
      {view === 'operations' && <BillingOperations />}
      {view === 'alerts' && <AdminAlerts onChanged={reload} />}
      {view === 'privacy' && <PrivacyRequestsAdmin />}
      {view === 'updates' && <SystemUpdates />}
      {view === 'audit' && (
        <div className="card">
          <h2>Histórico de alterações</h2>
          <p className="muted">
            Últimas 50 alterações de contas, planos e vigências, com autor e horário.
            O histórico é somente leitura.
          </p>
          <AuditList events={events} />
        </div>
      )}
      </div>
    </section>
  );
}
