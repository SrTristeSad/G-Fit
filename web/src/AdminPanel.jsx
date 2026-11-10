import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import PlansPanel from './PlansPanel.jsx';
import AccessPanel from './AccessPanel.jsx';
import BillingPanel from './BillingPanel.jsx';
import BillingOperations from './BillingOperations.jsx';
import AdminAlerts from './AdminAlerts.jsx';
import PrivacyRequestsAdmin from './PrivacyRequestsAdmin.jsx';

function Stat({ label, value, caption }) {
  return (
    <div className="admin-stat">
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

export default function AdminPanel() {
  const [teachers, setTeachers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [accessTerms, setAccessTerms] = useState([]);
  const [alertsSummary, setAlertsSummary] = useState({ open: 0, acknowledged: 0 });
  const [overview, setOverview] = useState(null);
  const [billing, setBilling] = useState(null);
  const [events, setEvents] = useState([]);
  const [view, setView] = useState('overview');
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

  return (
    <section className="stack">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Administração do G Fit</div>
          <h1>Controle da plataforma</h1>
        </div>
        <button className="secondary-light" disabled={loading} onClick={reload}>Atualizar dados</button>
      </div>
      <nav aria-label="Seções administrativas" className="admin-tabs">
        <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>
          Visão geral
        </button>
        <button className={view === 'teachers' ? 'active' : ''} onClick={() => setView('teachers')}>
          Professores
        </button>
        <button className={view === 'plans' ? 'active' : ''} onClick={() => setView('plans')}>
          Planos
        </button>
        <button className={view === 'access' ? 'active' : ''} onClick={() => setView('access')}>
          Vigências
        </button>
        <button className={view === 'billing' ? 'active' : ''} onClick={() => setView('billing')}>
          Financeiro (teste)
        </button>
        <button className={view === 'operations' ? 'active' : ''} onClick={() => setView('operations')}>
          Monitoramento
        </button>
        <button className={view === 'alerts' ? 'active' : ''} onClick={() => setView('alerts')}>
          Alertas{alertsSummary.open > 0 ? ' (' + alertsSummary.open + ')' : ''}
        </button>
        <button className={view === 'privacy' ? 'active' : ''} onClick={() => setView('privacy')}>
          Privacidade
        </button>
        <button className={view === 'audit' ? 'active' : ''} onClick={() => setView('audit')}>
          Histórico
        </button>
      </nav>
      {error && <p role="alert" className="error">{error}</p>}
      {loading && <p className="muted">Atualizando informações…</p>}
      {view === 'overview' && (
        <>
          <div className="admin-stats">
            <Stat label="Professores ativos" value={overview?.teachersActive ?? '—'}
              caption={overview ? overview.teachersTotal + ' cadastrados' : ''} />
            <Stat label="Professores suspensos" value={overview?.teachersInactive ?? '—'} />
            <Stat label="Alunos ativos" value={overview?.studentsActive ?? '—'}
              caption={overview ? overview.studentsArchived + ' arquivados' : ''} />
            <Stat label="Atividades atribuídas" value={overview?.exercisesAssigned ?? '—'} />
            <Stat label="Realizações registradas" value={overview?.completionsLogged ?? '—'} />
            <Stat label="Turmas ativas" value={overview?.classesActive ?? '—'}
              caption={overview ? overview.classesArchived + ' arquivadas' : ''} />
            <Stat label="Aulas cadastradas" value={overview?.classSessions ?? '—'} />
            <Stat label="Presenças manuais" value={overview?.attendancePresent ?? '—'}
              caption={overview ? overview.attendanceAbsent + ' faltas registradas' : ''} />
            <Stat label="Exportações de alunos" value={overview?.studentExportsTotal ?? '—'}
              caption={overview ? overview.studentExportsLast30d + ' nos últimos 30 dias' : ''} />
            <Stat label="Novos professores (30 dias)" value={overview?.teachersNew30d ?? '—'} />
            <Stat label="Prazos ativos (manual)" value={overview?.manualAccessActive ?? '—'} />
            <Stat label="Prazos vencidos (manual)" value={overview?.manualAccessExpired ?? '—'} />
            <Stat label="Prazos agendados (manual)" value={overview?.manualAccessScheduled ?? '—'} />
            <Stat label="Alertas abertos" value={alertsSummary.open ?? '—'} />
          </div>
          <div className="columns">
            <div className="card">
              <h2>Atividade recente</h2>
              <p className="muted">
                Novos alunos nos últimos 30 dias:
                <strong> {overview?.studentsNew30d ?? '—'}</strong>
              </p>
              <p className="muted">
                A administração consulta números agregados, não os dados pessoais e
                informações privadas das fichas dos alunos.
              </p>
            </div>
            <div className="card">
              <h2>Financeiro e assinaturas</h2>
              <p className="muted">{billing?.message || 'Sem dados financeiros disponíveis.'}</p>
              <p className="notice">
                O G Fit possui geração e conciliação de Pix apenas em sandbox. Não há faturamento real nem homologação para produção.
                Entre em Financeiro (teste) para acessar as cobranças simuladas.
              </p>
            </div>
          </div>
        </>
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
    </section>
  );
}
