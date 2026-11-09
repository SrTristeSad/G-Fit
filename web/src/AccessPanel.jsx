import React, { useState } from 'react';
import { api } from './api.js';

function todayString() {
  const date = new Date();
  const tz = date.getTimezoneOffset();
  return new Date(date.getTime() - tz * 60000).toISOString().slice(0, 10);
}
function oneMonthFromToday() {
  const date = new Date(todayString() + 'T12:00:00');
  date.setMonth(date.getMonth() + 1);
  const tz = date.getTimezoneOffset();
  return new Date(date.getTime() - tz * 60000).toISOString().slice(0, 10);
}
function statusLabel(status) {
  return ({
    active: 'Dentro do prazo',
    scheduled: 'Agendado',
    expired: 'Vencido',
    revoked: 'Revogado',
    legacy: 'Sem prazo definido',
  })[status] || 'Não configurado';
}

function AccessRow({ teacher, current, refresh }) {
  const [start, setStart] = useState(current?.startsOn || todayString());
  const [end, setEnd] = useState(current?.endsOn || oneMonthFromToday());
  const [months, setMonths] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function execute(action) {
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      await action();
      await refresh();
      setSuccess('Acesso atualizado.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function grant(event) {
    event.preventDefault();
    execute(() => api('/api/admin/teachers/' + teacher.id + '/access', {
      method: 'PUT',
      body: JSON.stringify({ startsOn: start, endsOn: end }),
    }));
  }
  function renew() {
    execute(() => api('/api/admin/teachers/' + teacher.id + '/access/renew', {
      method: 'POST', body: JSON.stringify({ months: Number(months) }),
    }));
  }
  function revoke() {
    if (!window.confirm('Revogar o acesso com prazo deste professor? Isso bloqueará novos alunos e novas prescrições, sem excluir fichas existentes.')) return;
    execute(() => api('/api/admin/teachers/' + teacher.id + '/access/revoke', { method: 'POST' }));
  }

  return (
    <section className="access-row">
      <div className="section-heading">
        <div>
          <strong>{teacher.name}</strong>
          <div className="muted">{teacher.email}</div>
          <small className="muted">Plano: {teacher.planName || 'não atribuído'} · {teacher.activeStudents} alunos ativos</small>
        </div>
        <span className="tag">{statusLabel(current?.status || 'legacy')}</span>
      </div>
      {current && <p className="muted">
        Vigência: {current.startsOn} até {current.endsOn} (datas inclusivas, calendário UTC).
        {current.status === 'revoked' && ' · Revogado pela administração.'}
      </p>}
      <form onSubmit={grant} className="access-form">
        <label>Início do prazo
          <input type="date" required min="2000-01-01" max="2100-12-31"
            value={start} onChange={e => setStart(e.target.value)} />
        </label>
        <label>Último dia do prazo
          <input type="date" required min={start} max="2100-12-31"
            value={end} onChange={e => setEnd(e.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={busy || !teacher.planId}>
          {current ? 'Redefinir vigência' : 'Conceder vigência'}
        </button>
      </form>
      <div className="access-actions">
        <label>Prorrogar manualmente
          <select value={months} onChange={e => setMonths(e.target.value)}>
            <option value="1">1 mês</option>
            <option value="3">3 meses</option>
            <option value="6">6 meses</option>
            <option value="12">12 meses</option>
          </select>
        </label>
        <button type="button" className="secondary-light" disabled={busy || !current || current.status === 'revoked'}
          onClick={renew}>Renovar prazo</button>
        <button type="button" className="danger-light" disabled={busy || !current || current.status === 'revoked'}
          onClick={revoke}>Revogar prazo</button>
      </div>
      {!teacher.planId &&
        <p className="notice">Atribua um plano ao professor antes de conceder um prazo de acesso.</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {success && <p role="status" className="saved-message">{success}</p>}
    </section>
  );
}

export default function AccessPanel({ teachers, accessTerms, refresh }) {
  const [query, setQuery] = useState('');
  const search = query.trim().toLocaleLowerCase('pt-BR');
  const filtered = teachers.filter(t => !t.isAdmin &&
    (!search || t.name.toLocaleLowerCase('pt-BR').includes(search) ||
      t.email.toLocaleLowerCase('pt-BR').includes(search)));
  const byTeacher = new Map(accessTerms.map(t => [t.teacherId, t]));
  const expired = accessTerms.filter(t => t.status === 'expired').length;
  const active = accessTerms.filter(t => t.status === 'active').length;
  return (
    <div className="stack">
      <div className="card">
        <h2>Vigências e renovações manuais</h2>
        <p className="muted">
          Conceda um prazo de acesso a professores com plano vinculado. Esse controle é
          <strong> administrativo</strong>: nenhuma ação aqui cobra Pix, confirma pagamento
          ou gera assinatura financeira.
        </p>
        <div className="admin-stats">
          <div className="admin-stat"><span>Dentro do prazo</span><strong>{active}</strong></div>
          <div className="admin-stat"><span>Vencidos</span><strong>{expired}</strong></div>
          <div className="admin-stat"><span>Com prazo configurado</span><strong>{accessTerms.length}</strong></div>
        </div>
        <p className="notice">
          Contas antigas sem prazo mantêm as permissões anteriores. Quando um prazo é
          definido, seu vencimento bloqueia novos cadastros, reativações e novas
          prescrições, mas permite consultar e corrigir fichas existentes.
        </p>
      </div>
      <div className="card">
        <h2>Gerenciar por professor</h2>
        <label>Buscar professor
          <input type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Nome ou e-mail" />
        </label>
        <div className="access-list">
          {filtered.length === 0 ? <p className="muted">Nenhum professor encontrado.</p> :
            filtered.map(teacher => (
              <AccessRow key={teacher.id + ':' + (byTeacher.get(teacher.id)?.updatedAt || '')}
                teacher={teacher} current={byTeacher.get(teacher.id)} refresh={refresh} />
            ))}
        </div>
      </div>
    </div>
  );
}
