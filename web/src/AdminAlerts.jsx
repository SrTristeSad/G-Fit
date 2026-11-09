import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const types = {
  charge_attention: 'Cobrança exige conferência',
  webhook_failure: 'Falha na entrega de webhook',
  webhook_divergence: 'Divergência na conciliação',
  refund_review: 'Reembolso exige conferência',
};
const reasons = {
  creation_stuck: 'A criação da cobrança está sem confirmação há mais de 15 minutos.',
  overdue: 'O vencimento passou e a cobrança continua pendente.',
  pending_48h: 'A cobrança permanece pendente há mais de 48 horas.',
  manual_review: 'A cobrança está marcada para revisão administrativa.',
  mismatch: 'A cobrança informada não corresponde ao registro verificado.',
  unmatched: 'O evento recebido não foi associado a uma cobrança.',
  review_status: 'O evento indica uma situação que exige revisão.',
  ignored_status: 'O evento chegou quando a cobrança já estava em outro estado.',
  unpaid_charge: 'O evento de estorno está associado a cobrança sem pagamento confirmado.',
  pending: 'O estorno ainda está em processamento.',
  review: 'Os dados disponíveis não permitem confirmar o estorno.',
};
const states = {
  open: 'Novo',
  acknowledged: 'Em análise',
  resolved: 'Resolvido',
};
function fmtDate(value) {
  return value ? new Date(value).toLocaleString('pt-BR') : 'Não disponível';
}
function alertText(alert) {
  return reasons[alert.details?.reason] ||
    reasons[alert.details?.resolution] ||
    reasons[alert.details?.refundState] ||
    (alert.alertType === 'webhook_failure' ?
      'A última tentativa autenticada recebeu HTTP ' + (alert.details?.lastHttpStatus ?? '?') + '.' :
      'Consulte o monitoramento e o histórico financeiro.');
}

export default function AdminAlerts({ onChanged }) {
  const [payload, setPayload] = useState(null);
  const [filter, setFilter] = useState('active');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await api('/api/admin/alerts');
      setPayload(result);
    } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => {
    refresh();
    const refreshId = setInterval(refresh, 60 * 1000);
    return () => clearInterval(refreshId);
  }, [refresh]);

  async function scanNow() {
    setError('');
    setScanning(true);
    try {
      await api('/api/admin/alerts/scan', { method: 'POST' });
      await refresh();
      await onChanged?.();
    } catch (err) { setError(err.message); }
    finally { setScanning(false); }
  }
  async function acknowledge(alert) {
    setError('');
    setBusy(true);
    try {
      await api('/api/admin/alerts/' + alert.id + '/acknowledge', { method: 'PATCH' });
      await refresh();
      await onChanged?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const alerts = useMemo(() => {
    const all = payload?.alerts || [];
    if (filter === 'active') return all.filter(a => a.status !== 'resolved');
    if (filter === 'open') return all.filter(a => a.status === 'open');
    if (filter === 'acknowledged') return all.filter(a => a.status === 'acknowledged');
    if (filter === 'resolved') return all.filter(a => a.status === 'resolved');
    return all;
  }, [payload, filter]);

  return (
    <section className="stack">
      <div className="card">
        <div className="section-heading">
          <div>
            <h2>Alertas administrativos</h2>
            <p className="muted">Problemas de cobranças e webhooks identificados automaticamente pelo G-Fit.</p>
          </div>
          <button className="secondary-light" type="button" disabled={scanning || busy} onClick={scanNow}>
            {scanning ? 'Verificando…' : 'Verificar agora'}
          </button>
        </div>
        <p className="notice">
          Alertas internos do Asaas Sandbox: não enviam e-mails ou mensagens.
          Não provam que a fila de webhooks do Asaas está ativa. Confira o painel do provedor quando houver falhas.
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        {payload && (
          <>
            <div className="admin-stats">
              <div className="admin-stat"><span>Novos alertas</span><strong>{payload.summary.open}</strong></div>
              <div className="admin-stat"><span>Em análise</span><strong>{payload.summary.acknowledged}</strong></div>
              <div className="admin-stat"><span>Resolvidos</span><strong>{payload.summary.resolved}</strong></div>
            </div>
            <p className="muted">
              Última verificação bem-sucedida: {fmtDate(payload.scanner?.lastSuccessAt)}.
              {payload.scanner?.lastErrorAt && (
                <> Última falha de verificação: {fmtDate(payload.scanner.lastErrorAt)}.</>
              )}
            </p>
          </>
        )}
      </div>
      <div className="card">
        <div className="section-heading">
          <h2>Caixa de alertas</h2>
          <label>Exibir
            <select value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="active">Ativos e em análise</option>
              <option value="open">Somente novos</option>
              <option value="acknowledged">Somente em análise</option>
              <option value="resolved">Resolvidos recentemente</option>
              <option value="all">Todos (até 100)</option>
            </select>
          </label>
        </div>
        {!payload ? <p className="muted">Carregando alertas…</p> :
          alerts.length === 0 ? <p className="muted">Nenhum alerta encontrado para este filtro.</p> :
          <div className="alert-list">
            {alerts.map(alert => (
              <article className="alert-record" key={alert.id}>
                <div className="section-heading">
                  <strong>{types[alert.alertType] || 'Aviso do sistema'}</strong>
                  <span className="tag">{states[alert.status] || alert.status}
                    {' · '}{alert.severity === 'critical' ? 'Alta prioridade' : 'Atenção'}
                  </span>
                </div>
                <p>{alertText(alert)}</p>
                <small className="muted">
                  Referência: {alert.sourceKey} · Identificado: {fmtDate(alert.firstDetectedAt)}
                </small>
                {alert.acknowledgedBy && (
                  <small className="muted">
                    Em análise por {alert.acknowledgedBy} desde {fmtDate(alert.acknowledgedAt)}
                  </small>
                )}
                {alert.status === 'resolved' && (
                  <small className="muted">Resolvido automaticamente em {fmtDate(alert.resolvedAt)}</small>
                )}
                {alert.status === 'open' && (
                  <button type="button" className="secondary-light" disabled={busy || scanning}
                    onClick={() => acknowledge(alert)}>Marcar em análise</button>
                )}
              </article>
            ))}
          </div>}
        <p className="muted">
          Marcar como em análise não elimina a causa do aviso nem confirma pagamento.
          O G-Fit só resolve o alerta quando uma nova verificação confirma que a condição desapareceu.
        </p>
      </div>
    </section>
  );
}
