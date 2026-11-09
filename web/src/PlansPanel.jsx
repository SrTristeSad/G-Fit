import React, { useState } from 'react';
import { api } from './api.js';

const currency = cents => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
}).format(cents / 100);

function priceToCents(input) {
  const raw = input.trim();
  if (!/^(0|[1-9]\d{0,5})([,.]\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= 10000000 ? cents : null;
}

export default function PlansPanel({ plans, onChanged }) {
  const [form, setForm] = useState({
    name: '', description: '', price: '0,00', billingCycle: 'monthly', maxStudents: '20',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  function change(key, value) {
    setForm(old => ({ ...old, [key]: value }));
    setFeedback('');
  }

  async function createPlan(event) {
    event.preventDefault();
    setError('');
    setFeedback('');
    const priceCents = priceToCents(form.price);
    const maxStudents = Number(form.maxStudents);
    if (priceCents === null || !Number.isInteger(maxStudents) ||
        maxStudents < 0 || maxStudents > 10000) {
      setError('Informe preço em reais e limite válido de 0 a 10.000 alunos.');
      return;
    }
    setBusy(true);
    try {
      await api('/api/admin/plans', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          priceCents, billingCycle: form.billingCycle, maxStudents,
        }),
      });
      setForm({ name: '', description: '', price: '0,00', billingCycle: 'monthly', maxStudents: '20' });
      await onChanged();
      setFeedback('Plano cadastrado. Ainda não existem cobranças automáticas.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function changeStatus(plan) {
    if (!plan.isActive &&
        !window.confirm('Reativar este plano para novas atribuições?')) return;
    if (plan.isActive &&
        !window.confirm('Desativar novas atribuições? Professores já vinculados continuarão com sua cota atual.')) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await api('/api/admin/plans/' + plan.id, {
        method: 'PATCH', body: JSON.stringify({ isActive: !plan.isActive }),
      });
      await onChanged();
      setFeedback('Situação do plano atualizada.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="card">
        <h2>Novo plano</h2>
        <p className="muted">
          Configure a tabela comercial do G Fit. Nenhum valor será cobrado nesta fase.
          Para alterar preço ou cota padrão, crie uma nova versão do plano.
        </p>
        <form onSubmit={createPlan}>
          <div className="form-grid">
            <label>Nome do plano
              <input required minLength="3" maxLength="80" value={form.name}
                onChange={e => change('name', e.target.value)}
                placeholder="Ex.: Profissional 50" />
            </label>
            <label>Preço em reais (R$)
              <input required inputMode="decimal" value={form.price}
                onChange={e => change('price', e.target.value)}
                placeholder="Ex.: 49,90" />
            </label>
            <label>Periodicidade
              <select value={form.billingCycle} onChange={e => change('billingCycle', e.target.value)}>
                <option value="monthly">Mensal</option>
                <option value="yearly">Anual</option>
              </select>
            </label>
            <label>Máximo de alunos ativos
              <input type="number" min="0" max="10000" required value={form.maxStudents}
                onChange={e => change('maxStudents', e.target.value)} />
            </label>
          </div>
          <label>Descrição do plano
            <textarea maxLength="300" rows="2" value={form.description}
              onChange={e => change('description', e.target.value)}
              placeholder="Recursos incluídos, público e condições" />
          </label>
          <button type="submit" disabled={busy} className="primary">Cadastrar plano</button>
        </form>
        {error && <p role="alert" className="error">{error}</p>}
        {feedback && <p role="status" className="saved-message">{feedback}</p>}
      </div>
      <div className="card">
        <h2>Catálogo de planos</h2>
        {plans.length === 0 ? <p className="muted">Nenhum plano criado. Cadastre o primeiro acima.</p> :
          <div className="plan-grid">
            {plans.map(plan => (
              <div className="plan-card" key={plan.id}>
                <div className="section-heading">
                  <strong>{plan.name}</strong>
                  <span className="tag">{plan.isActive ? 'Disponível' : 'Desativado'}</span>
                </div>
                <strong className="plan-price">{currency(plan.priceCents)}</strong>
                <span className="muted">por {plan.billingCycle === 'monthly' ? 'mês' : 'ano'} · valor configurado</span>
                {plan.description && <p className="muted">{plan.description}</p>}
                <p>{plan.maxStudents} aluno(s) ativo(s) · {plan.assignedTeachers} professor(es) vinculado(s)</p>
                <button className="secondary-light" type="button" disabled={busy}
                  onClick={() => changeStatus(plan)}>
                  {plan.isActive ? 'Desativar para novas atribuições' : 'Reativar plano'}
                </button>
              </div>
            ))}
          </div>}
      </div>
    </div>
  );
}
