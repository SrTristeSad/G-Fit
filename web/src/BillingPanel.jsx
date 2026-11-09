import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const brl = cents => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
}).format(cents / 100);
const status = {
  creating: 'Em conciliação',
  pending: 'Aguardando pagamento',
  paid: 'Pagamento verificado',
  cancelled: 'Cancelada',
  review: 'Verificar manualmente',
};

function Charge({ charge, admin, onRefresh }) {
  const [qr, setQr] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function getQr() {
    setError('');
    setLoading(true);
    try {
      const data = await api('/api/billing/charges/' + charge.id + '/pix');
      setQr(data);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function recover() {
    setError('');
    setLoading(true);
    try {
      await api('/api/admin/billing/charges/' + charge.id + '/recover', { method: 'POST' });
      await onRefresh();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function check() {
    setError('');
    setLoading(true);
    try {
      await api('/api/admin/billing/charges/' + charge.id + '/check', { method: 'POST' });
      await onRefresh();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function cancelPending() {
    if (!window.confirm(
      'Cancelar esta cobrança Pix de TESTE no Asaas? Não é um estorno e a cobrança deixará de aceitar pagamentos.',
    )) return;
    setError('');
    setLoading(true);
    try {
      await api('/api/admin/billing/charges/' + charge.id + '/cancel', { method: 'POST' });
      setQr(null);
      await onRefresh();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function checkRefunds() {
    setError('');
    setLoading(true);
    try {
      await api('/api/admin/billing/charges/' + charge.id + '/refunds/check', { method: 'POST' });
      await onRefresh();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function copyPix() {
    try { await navigator.clipboard.writeText(qr.payload); }
    catch { setError('Não foi possível copiar automaticamente. Selecione o código abaixo.'); }
  }

  return (
    <div className="billing-charge">
      <div className="section-heading">
        <strong>{charge.planName} — {brl(charge.amountCents)}</strong>
        <span className="tag">{charge.overdue ? 'Vencida — aguardando conciliação' :
          (status[charge.status] || charge.status)}</span>
      </div>
      {admin && <small className="muted">Professor: {charge.teacherName}</small>}
      <small className="muted">Vencimento: {charge.dueDate} · Cobrança G-Fit: {charge.id}</small>
      {charge.paidAt && <small className="saved-message">
        Recebimento validado: {new Date(charge.paidAt).toLocaleString('pt-BR')}
      </small>}
      {charge.cancelledAt && <small className="muted">
        Cancelamento confirmado: {new Date(charge.cancelledAt).toLocaleString('pt-BR')}
      </small>}
      {charge.refundState && charge.refundState !== 'none' && (
        <p className="notice" role="status">
          Estorno: {charge.refundState === 'pending' ? 'em processamento' :
            charge.refundState === 'partial' ? 'parcialmente concluído' :
            charge.refundState === 'full' ? 'concluído integralmente' :
            'necessita conferência manual'}.
          {' '}Valor devolvido confirmado: {brl(charge.refundedCents || 0)}.
          A vigência do professor não foi alterada automaticamente.
        </p>
      )}
      <div className="actions">
        {(charge.status === 'pending' || charge.status === 'paid') && (
          <button type="button" className="secondary-light" disabled={loading} onClick={getQr}>
            Ver Pix de teste
          </button>
        )}
        {admin && charge.providerPaymentId && charge.status !== 'paid' && (
          <button type="button" className="secondary-light" disabled={loading} onClick={check}>
            Conferir no Asaas
          </button>
        )}
        {admin && charge.status === 'creating' && !charge.providerPaymentId && (
          <button type="button" className="secondary-light" disabled={loading} onClick={recover}>
            Recuperar no Asaas
          </button>
        )}
        {admin && charge.status === 'pending' && (
          <button type="button" className="danger-light" disabled={loading} onClick={cancelPending}>
            Cancelar cobrança de teste
          </button>
        )}
        {admin && charge.status === 'paid' && (
          <button type="button" className="secondary-light" disabled={loading} onClick={checkRefunds}>
            Consultar estornos
          </button>
        )}
      </div>
      {qr && (
        <div className="pix-qr">
          <p className="notice">
            <strong>Sandbox:</strong> este Pix pertence ao ambiente de testes do Asaas e não deve receber dinheiro real.
          </p>
          <img
            alt="QR Code Pix de teste"
            width="190" height="190"
            src={'data:image/png;base64,' + qr.imageBase64}
          />
          <label>Pix Copia e Cola (sandbox)
            <textarea rows="3" value={qr.payload} readOnly />
          </label>
          <button type="button" className="primary" onClick={copyPix}>Copiar código</button>
        </div>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}

export default function BillingPanel({ admin = false, teachers = [] }) {
  const [data, setData] = useState(null);
  const [teacherId, setTeacherId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await api(admin ? '/api/admin/billing' : '/api/account/charges');
    setData(response);
  }, [admin]);
  useEffect(() => {
    refresh().catch(e => setError(e.message));
  }, [refresh]);

  const selectedTeacher = useMemo(() => teachers.find(t => t.id === teacherId), [teachers, teacherId]);
  const customers = admin ? (data?.customers || []) : [];
  useEffect(() => {
    setCustomerId(customers.find(c => c.teacherId === teacherId)?.customerId || '');
  }, [teacherId, data]);

  async function doAction(action, successText) {
    setBusy(true);
    setFeedback('');
    setError('');
    try {
      await action();
      await refresh();
      setFeedback(successText);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function saveCustomer(event) {
    event.preventDefault();
    if (!teacherId) return setError('Escolha um professor.');
    doAction(
      () => api('/api/admin/teachers/' + teacherId + '/asaas-customer', {
        method: 'PUT', body: JSON.stringify({ customerId: customerId.trim() }),
      }),
      'Cliente Asaas vinculado ao professor.',
    );
  }
  function createCharge(event) {
    event.preventDefault();
    if (admin && !teacherId) return setError('Escolha um professor.');
    doAction(
      () => api(admin ? '/api/admin/teachers/' + teacherId + '/pix-charge' : '/api/account/pix-charge', {
        method: 'POST', body: JSON.stringify(admin ? { dueDate } : {}),
      }),
      'Cobrança de teste criada. Consulte o QR Code na lista abaixo.',
    );
  }

  return (
    <section className="stack">
      <div className="card">
        <h2>{admin ? 'Cobranças Pix — Asaas Sandbox' : 'Meus pagamentos de teste'}</h2>
        <p className="muted">
          Esta integração utiliza exclusivamente o ambiente de testes do Asaas.
          Não são cobrados valores reais. Uma conta só recebe crédito de acesso
          após a confirmação validada diretamente na API do provedor.
        </p>
        <p className="notice">
          {admin ?
            (data?.configured ? 'Chave de sandbox e token de webhook configurados no servidor.' :
              'Configure ASAAS_API_KEY e ASAAS_WEBHOOK_TOKEN no arquivo .env do servidor para habilitar as cobranças.') :
            'O administrador precisa vincular um plano e um cliente Asaas à sua conta antes do primeiro Pix.'}
        </p>
        {admin && (
          <>
            <label>Professor
              <select value={teacherId} onChange={e => setTeacherId(e.target.value)}>
                <option value="">Selecione uma conta</option>
                {teachers.filter(t => !t.isAdmin).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.planName || 'sem plano'}
                  </option>
                ))}
              </select>
            </label>
            {teacherId && (
              <form onSubmit={saveCustomer} className="billing-form">
                <label>ID do cliente cadastrado no Asaas Sandbox
                  <input value={customerId} onChange={e => setCustomerId(e.target.value)}
                    placeholder="cus_000005219613" required minLength="7" maxLength="100" />
                </label>
                <button className="secondary-light" type="submit" disabled={busy}>
                  Salvar vínculo do cliente
                </button>
                <p className="muted">Cadastre o cliente no painel Asaas Sandbox e copie seu ID. Não informe CPF ou dados de alunos no G-Fit.</p>
              </form>
            )}
          </>
        )}
        <form className="billing-form" onSubmit={createCharge}>
          {admin && (
            <label>Vencimento da cobrança
              <input type="date" required value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </label>
          )}
          <button type="submit" className="primary"
            disabled={busy || (admin && (!teacherId || !selectedTeacher?.planId)) || (admin && !data?.configured)}>
            {admin ? 'Criar Pix de teste para professor' : 'Gerar meu Pix de teste'}
          </button>
        </form>
        {error && <p role="alert" className="error">{error}</p>}
        {feedback && <p role="status" className="saved-message">{feedback}</p>}
      </div>
      {admin && data?.summary && (
        <div className="admin-stats" aria-label="Resumo financeiro do sandbox">
          <div className="admin-stat"><span>Aguardando pagamento</span><strong>{data.summary.pendingCount}</strong></div>
          <div className="admin-stat"><span>Vencidas e pendentes</span><strong>{data.summary.overdueCount}</strong></div>
          <div className="admin-stat"><span>Canceladas</span><strong>{data.summary.cancelledCount}</strong></div>
          <div className="admin-stat"><span>Recebidas (teste)</span><strong>{data.summary.paidCount}</strong></div>
          <div className="admin-stat"><span>Casos de estorno</span><strong>{data.summary.refundReviewCount}</strong></div>
          <div className="admin-stat"><span>Em conciliação</span><strong>{data.summary.reconciliationCount}</strong></div>
        </div>
      )}
      {admin && data?.summary && (
        <p className="notice">Somente sandbox. Recebimentos brutos registrados: {brl(Number(data.summary.grossPaidCents))}.
          {' '}Estornos concluídos: {brl(Number(data.summary.confirmedRefundedCents))}.
          Não são valores financeiros reais nem demonstrativo contábil.</p>
      )}
      <div className="card">
        <div className="section-heading">
          <h2>Histórico de cobranças</h2>
          <button type="button" className="secondary-light" onClick={() => refresh().catch(e => setError(e.message))}>
            Atualizar
          </button>
        </div>
        {data?.charges?.length ? (
          <div className="billing-charges">
            {data.charges.map(c => <Charge key={c.id} charge={c} admin={admin} onRefresh={refresh} />)}
          </div>
        ) : <p className="muted">Nenhuma cobrança registrada até o momento.</p>}
      </div>
    </section>
  );
}
