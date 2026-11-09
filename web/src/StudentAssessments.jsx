import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

const categories = {
  mobility: 'Mobilidade', balance: 'Equilíbrio', strength: 'Força',
  endurance: 'Resistência', other: 'Outro',
};
const units = {
  s: 'segundos', reps: 'repetições', m: 'metros',
  cm: 'centímetros', kg: 'quilogramas', points: 'pontos',
};
const blank = () => ({
  date: new Date().toISOString().slice(0, 10),
  category: 'mobility', testName: '', protocol: '',
  value: '', unit: '', notes: '',
});
const fromRecord = item => ({
  date: item.date, category: item.category, testName: item.testName,
  protocol: item.protocol || '', value: item.value == null ? '' : String(item.value),
  unit: item.unit || '', notes: item.notes || '',
});
const prettyDate = date => date ? date.slice(0, 10).split('-').reverse().join('/') : '—';
const decimal = number => new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 2,
}).format(number);
const resultText = record => record.value == null ? 'Registro descritivo' :
  decimal(record.value) + ' ' + (units[record.unit] || record.unit);
function AssessmentForm({ form, change, onSubmit, busy, edit, onCancel }) {
  return (
    <form onSubmit={onSubmit} className="stack">
      <div className="form-grid">
        <label>Data da avaliação
          <input type="date" required min="2000-01-01"
            max={new Date().toISOString().slice(0, 10)}
            value={form.date} onChange={e => change('date', e.target.value)} />
        </label>
        <label>Área observada
          <select value={form.category} onChange={e => change('category', e.target.value)}>
            {Object.entries(categories).map(([key, name]) =>
              <option key={key} value={key}>{name}</option>)}
          </select>
        </label>
      </div>
      <label>Nome do teste ou observação
        <input type="text" required minLength="2" maxLength="120"
          value={form.testName} onChange={e => change('testName', e.target.value)}
          placeholder="Nome registrado pelo profissional" />
      </label>
      <label>Procedimento ou protocolo utilizado (opcional)
        <textarea rows="2" maxLength="500" value={form.protocol}
          onChange={e => change('protocol', e.target.value)}
          placeholder="Como o profissional conduziu a avaliação" />
      </label>
      <div className="form-grid">
        <label>Resultado numérico (opcional)
          <input type="number" step="0.01" min="0" max="100000"
            value={form.value} onChange={e => change('value', e.target.value)}
            placeholder="Ex.: 12,5" />
        </label>
        <label>Unidade do resultado
          <select value={form.unit} onChange={e => change('unit', e.target.value)}>
            <option value="">Sem medição numérica</option>
            {Object.entries(units).map(([key, name]) =>
              <option key={key} value={key}>{name}</option>)}
          </select>
        </label>
      </div>
      <label>Observações do profissional
        <textarea rows="3" maxLength="2000" value={form.notes}
          onChange={e => change('notes', e.target.value)}
          placeholder="Registre somente as informações necessárias. Sem diagnóstico automático." />
      </label>
      <p className="muted">
        Informe resultado e unidade juntos. Sem resultado numérico, as observações são obrigatórias.
        Use o mesmo nome, protocolo e unidade para comparar medições futuras.
      </p>
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Salvando…' : edit ? 'Salvar correção' : 'Registrar avaliação'}
        </button>
        {edit && (
          <button type="button" className="secondary-light" onClick={onCancel} disabled={busy}>
            Cancelar edição
          </button>
        )}
      </div>
    </form>
  );
}

export default function StudentAssessments({ id, active }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [changesId, setChangesId] = useState(null);
  const [changes, setChanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const refresh = useCallback(async () => {
    const result = await api('/api/students/' + id + '/assessments');
    setData(result);
  }, [id]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api('/api/students/' + id + '/assessments')
      .then(result => { if (!cancelled) setData(result); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  function change(key, value) {
    setForm(current => ({ ...current, [key]: value }));
  }
  function reset() {
    setEditingId(null);
    setForm(blank());
  }
  function payload() {
    return {
      date: form.date, category: form.category, testName: form.testName.trim(),
      protocol: form.protocol.trim(), notes: form.notes.trim(),
      value: form.value === '' ? null : Number(form.value),
      unit: form.unit || null,
    };
  }
  async function save(event) {
    event.preventDefault();
    setError(''); setSuccess('');
    if ((form.value !== '') !== Boolean(form.unit)) {
      return setError('Informe resultado numérico e unidade juntos.');
    }
    if (!form.value && form.value !== '0' && !form.notes.trim()) {
      return setError('Sem medição numérica, preencha as observações.');
    }
    setBusy(true);
    try {
      await api(
        editingId ?
          '/api/students/' + id + '/assessments/' + editingId :
          '/api/students/' + id + '/assessments',
        { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(payload()) },
      );
      reset();
      setChangesId(null);
      await refresh();
      setSuccess('Avaliação registrada na ficha do aluno.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function edit(record) {
    setEditingId(record.id);
    setForm(fromRecord(record));
    setChangesId(null);
    setError(''); setSuccess('');
  }
  async function voidRecord(record) {
    if (!window.confirm(
      'Retirar esta avaliação do histórico visível? O registro original ficará guardado para auditoria.',
    )) return;
    setBusy(true);
    setError(''); setSuccess('');
    try {
      await api('/api/students/' + id + '/assessments/' + record.id, { method: 'DELETE' });
      if (editingId === record.id) reset();
      setChangesId(null);
      await refresh();
      setSuccess('Avaliação retirada da lista. Histórico de alterações preservado.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function showChanges(record) {
    if (changesId === record.id) { setChangesId(null); return; }
    setError('');
    try {
      const result = await api('/api/students/' + id + '/assessments/' + record.id + '/changes');
      setChanges(result.changes);
      setChangesId(record.id);
    } catch (err) { setError(err.message); }
  }

  return (
    <section className="stack">
      <section className="card">
        <div className="section-heading">
          <div>
            <h2>Avaliações funcionais</h2>
            <p className="muted">Registro descritivo feito pelo professor, com histórico de datas e correções.</p>
          </div>
        </div>
        <p className="notice">
          Protótipo para demonstração. Não insira dados de saúde reais até a revisão de segurança
          e LGPD. Resultados não são diagnósticos nem recebem classificação automática.
        </p>
        {!active ? <p className="muted">
          O aluno está arquivado. As avaliações permanecem disponíveis para consulta, mas novas
          avaliações e correções ficam bloqueadas.
        </p> : (
          <>
            <h3>{editingId ? 'Corrigir avaliação' : 'Nova avaliação'}</h3>
            <AssessmentForm form={form} change={change} onSubmit={save}
              busy={busy} edit={!!editingId} onCancel={reset} />
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {success && <p className="saved-message" role="status">{success}</p>}
      </section>
      <section className="card">
        <h3>Comparações de medições equivalentes</h3>
        <p className="muted">
          A diferença é apenas matemática. Um número maior ou menor não significa
          automaticamente melhora ou piora. São comparadas datas diferentes do mesmo
          teste, protocolo e unidade.
        </p>
        {loading ? <p>Carregando comparações…</p> :
          !data?.comparisons?.length ? (
            <p className="muted">Cadastre duas medições comparáveis em datas diferentes para visualizar a diferença.</p>
          ) : (
            <div className="assessment-comparisons">
              {data.comparisons.map((item, i) => (
                <div key={item.category + item.testName + item.unit + i} className="assessment-comparison">
                  <strong>{item.testName} — {categories[item.category]}</strong>
                  {item.protocol && <small>{item.protocol}</small>}
                  <div className="assessment-values">
                    <span>{prettyDate(item.previous.date)}: {decimal(item.previous.value)}</span>
                    <span>{prettyDate(item.latest.date)}: {decimal(item.latest.value)}</span>
                  </div>
                  <small>
                    Diferença numérica: {item.difference > 0 ? '+' : ''}
                    {decimal(item.difference)} {units[item.unit] || item.unit}
                  </small>
                </div>
              ))}
            </div>
          )}
      </section>
      <section className="card">
        <h3>Histórico de avaliações ({data?.total ?? 0})</h3>
        {data?.truncated && (
          <p className="notice">Somente os 200 registros mais recentes são exibidos nesta versão.</p>
        )}
        {loading ? <p>Carregando histórico…</p> :
          !data?.assessments?.length ? <p className="muted">Nenhuma avaliação registrada.</p> : (
            <div className="assessment-list">
              {data.assessments.map(item => (
                <article key={item.id} className="assessment-entry">
                  <div className="section-heading">
                    <div>
                      <strong>{item.testName}</strong>
                      <small className="muted">
                        {prettyDate(item.date)} · {categories[item.category] || item.category}
                      </small>
                    </div>
                    <span className="tag">{resultText(item)}</span>
                  </div>
                  {item.protocol && <p><strong>Protocolo: </strong>{item.protocol}</p>}
                  {item.notes && <p>{item.notes}</p>}
                  <small className="muted">Registrado: {new Date(item.createdAt).toLocaleString('pt-BR')}</small>
                  <div className="actions">
                    {active && <button type="button" className="secondary-light"
                      disabled={busy} onClick={() => edit(item)}>Corrigir</button>}
                    <button type="button" className="secondary-light"
                      disabled={busy} onClick={() => showChanges(item)}>
                      {changesId === item.id ? 'Ocultar alterações' : 'Ver correções'}
                    </button>
                    <button type="button" className="danger-light"
                      disabled={busy} onClick={() => voidRecord(item)}>
                      Retirar do histórico visível
                    </button>
                  </div>
                  {changesId === item.id && (
                    <div className="assessment-revisions">
                      <h4>Correções anteriores</h4>
                      {changes.length === 0 ? <p className="muted">Nenhuma correção registrada.</p> : (
                        <ul>
                          {changes.map(revision => (
                            <li key={revision.id}>
                              {revision.action === 'corrected' ? 'Corrigido' : 'Retirado'} em{' '}
                              {new Date(revision.changedAt).toLocaleString('pt-BR')}. Antes:{' '}
                              <strong>{revision.previousValues.testName}</strong> —{' '}
                              {revision.previousValues.value == null ?
                                'sem valor numérico' : resultText(revision.previousValues)}
                              {revision.previousValues.notes &&
                                <small>Observações anteriores: {revision.previousValues.notes}</small>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
      </section>
    </section>
  );
}
