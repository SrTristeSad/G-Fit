import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

function time(value) {
  return value ? new Date(value).toLocaleString('pt-BR') : 'Nenhum registro';
}
const reason = {
  creation_stuck: 'Criação sem confirmação há mais de 15 minutos',
  overdue: 'Vencimento ultrapassado e cobrança pendente',
  pending_48h: 'Pagamento pendente há mais de 48 horas',
  manual_review: 'Cobrança marcada para revisão',
};
const errorDescriptions = {
  200: 'Processado',
  400: 'Evento inválido',
  503: 'Falha; provedor pode reenviar',
};
export default function BillingOperations() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const info = await api('/api/admin/billing/operations');
      setState(info);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <section className="stack">
      <div className="card">
        <div className="section-heading">
          <div>
            <h2>Monitoramento de cobranças e webhooks</h2>
            <p className="muted">Diagnóstico local do G-Fit no Asaas Sandbox.</p>
          </div>
          <button type="button" className="secondary-light" disabled={loading} onClick={refresh}>
            {loading ? 'Atualizando…' : 'Atualizar monitoramento'}
          </button>
        </div>
        <p className="notice">
          A API do G-Fit não sabe, por esses registros, se a fila do Asaas está pausada.
          Confira os Logs de Webhooks no painel Asaas Sandbox e reative a fila lá se necessário.
        </p>
        {error && <p role="alert" className="error">{error}</p>}
        {state && (
          <>
            <div className="admin-stats">
              <div className="admin-stat">
                <span>Eventos únicos recebidos</span>
                <strong>{state.webhook.uniqueEvents}</strong>
              </div>
              <div className="admin-stat">
                <span>Tentativas recebidas</span>
                <strong>{state.webhook.deliveryAttempts}</strong>
              </div>
              <div className="admin-stat">
                <span>Tentativas com falha</span>
                <strong>{state.webhook.failedAttempts}</strong>
              </div>
              <div className="admin-stat">
                <span>Eventos com última falha</span>
                <strong>{state.webhook.currentlyFailed}</strong>
              </div>
              <div className="admin-stat">
                <span>Eventos reenviados</span>
                <strong>{state.webhook.retriedEvents}</strong>
              </div>
              <div className="admin-stat">
                <span>Recebidos nas últimas 24h</span>
                <strong>{state.webhook.seenLast24h}</strong>
              </div>
            </div>
            <p className="muted">Última entrega autenticada registrada: {time(state.webhook.lastWebhookAt)}</p>
          </>
        )}
      </div>
      {state && (
        <>
          <div className="card">
            <h2>Cobranças para conferir</h2>
            <p className="muted">Alertas gerados a partir dos registros locais, não de uma consulta em tempo real ao Asaas.</p>
            {state.chargesToReview.length === 0 ? (
              <p className="muted">Nenhuma cobrança se enquadra nos critérios de atenção.</p>
            ) : (
              <ul className="admin-history">
                {state.chargesToReview.map(item => (
                  <li key={item.chargeId}>
                    <strong>{item.teacherName}</strong>
                    <span>{reason[item.reason] || 'Revisar'} · {item.dueDate}</span>
                    <small>ID da cobrança: <code>{item.chargeId}</code></small>
                    <small>
                      Acesse o histórico financeiro e utilize Conferir no Asaas ou Recuperar no Asaas,
                      conforme a situação. Nenhuma cobrança será criada automaticamente.
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="columns">
            <div className="card">
              <h2>Eventos que exigem atenção</h2>
              {state.eventsToReview.length === 0 ? (
                <p className="muted">Nenhuma divergência registrada nos eventos processados.</p>
              ) : (
                <ul className="admin-history">
                  {state.eventsToReview.map(item => (
                    <li key={item.eventId}>
                      <strong>{item.resolution}</strong>
                      <span>{item.eventType} · {time(item.createdAt)}</span>
                      <small>{item.eventId}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card">
              <h2>Últimas tentativas de webhook</h2>
              {state.recentAttempts.length === 0 ? (
                <p className="muted">Nenhuma entrega autenticada recebida nesta instalação.</p>
              ) : (
                <ul className="admin-history">
                  {state.recentAttempts.map(item => (
                    <li key={item.eventId}>
                      <strong>{item.eventType}</strong>
                      <span>
                        {item.lastHttpStatus == null ? 'Em processamento' :
                          errorDescriptions[item.lastHttpStatus] ||
                          'HTTP ' + item.lastHttpStatus}
                        {' '}· {item.attempts} tentativa(s) · {item.failureCount} falha(s)
                      </span>
                      <small>{time(item.lastReceivedAt)} · {item.eventId}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
