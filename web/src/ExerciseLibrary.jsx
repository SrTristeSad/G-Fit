import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const blank = {
  title: '', category: 'Geral', description: '', defaultSets: '2',
  defaultRepetitions: '10', defaultDurationMinutes: '', active: true,
};
const parse = item => ({
  title: item.title, category: item.category, description: item.description || '',
  defaultSets: String(item.defaultSets),
  defaultRepetitions: String(item.defaultRepetitions),
  defaultDurationMinutes: item.defaultDurationMinutes == null ? '' : String(item.defaultDurationMinutes),
  active: item.active,
});
export default function ExerciseLibrary() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const result = await api('/api/exercises/library');
    setList(result.exercises);
  }, []);
  useEffect(() => { refresh().catch(e => setError(e.message)); }, [refresh]);

  const filtered = useMemo(() => list.filter(e =>
    (showArchived || e.active) &&
    (e.title + ' ' + e.category).toLowerCase().includes(search.trim().toLowerCase())
  ), [list, showArchived, search]);

  function field(name, value) {
    setForm(old => ({ ...old, [name]: value }));
    setFeedback('');
  }
  function startEdit(item) {
    setEditing(item.id);
    setForm(parse(item));
    setError('');
    setFeedback('');
  }
  function reset() {
    setEditing(null);
    setForm(blank);
  }
  function payload(active = form.active) {
    return {
      title: form.title.trim(), category: form.category.trim(),
      description: form.description.trim(), defaultSets: Number(form.defaultSets),
      defaultRepetitions: Number(form.defaultRepetitions),
      defaultDurationMinutes: form.defaultDurationMinutes ? Number(form.defaultDurationMinutes) : null,
      active,
    };
  }
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await api(editing ? '/api/exercises/library/' + editing : '/api/exercises/library', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload()),
      });
      await refresh();
      reset();
      setFeedback('Exercício salvo na sua biblioteca.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function toggle(item) {
    if (item.active && !window.confirm('Arquivar este exercício do catálogo? As prescrições já atribuídas aos alunos serão preservadas.')) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await api('/api/exercises/library/' + item.id, {
        method: 'PUT',
        body: JSON.stringify({
          title: item.title, category: item.category, description: item.description || '',
          defaultSets: item.defaultSets, defaultRepetitions: item.defaultRepetitions,
          defaultDurationMinutes: item.defaultDurationMinutes, active: !item.active,
        }),
      });
      await refresh();
      setFeedback(item.active ? 'Exercício arquivado.' : 'Exercício reativado.');
      if (editing === item.id) reset();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <section className="stack">
      <div>
        <div className="eyebrow">Ferramentas do professor</div>
        <h1>Biblioteca de exercícios</h1>
        <p className="muted">
          Crie exercícios e reutilize-os nas fichas dos seus alunos.
          Esta biblioteca é privada da sua conta.
        </p>
      </div>
      <div className="columns">
        <section className="card">
          <h2>{editing ? 'Editar exercício' : 'Novo exercício'}</h2>
          <form onSubmit={submit}>
            <label>Nome do exercício
              <input value={form.title} minLength="2" maxLength="120" required
                onChange={e => field('title',e.target.value)}
                placeholder="Ex.: atividade orientada" />
            </label>
            <label>Categoria
              <input value={form.category} minLength="2" maxLength="60" required
                onChange={e => field('category',e.target.value)}
                placeholder="Ex.: Mobilidade" />
            </label>
            <div className="form-grid">
              <label>Séries padrão
                <input type="number" min="1" max="30" required value={form.defaultSets}
                  onChange={e => field('defaultSets',e.target.value)} />
              </label>
              <label>Repetições padrão
                <input type="number" min="1" max="500" required value={form.defaultRepetitions}
                  onChange={e => field('defaultRepetitions',e.target.value)} />
              </label>
            </div>
            <label>Duração por sessão, em minutos (opcional)
              <input type="number" min="1" max="240" value={form.defaultDurationMinutes}
                onChange={e => field('defaultDurationMinutes',e.target.value)}
                placeholder="Ex.: 15" />
            </label>
            <label>Orientações gerais
              <textarea rows="4" maxLength="1000" value={form.description}
                onChange={e => field('description',e.target.value)}
                placeholder="O professor deve adaptar estas orientações a cada aluno." />
            </label>
            {editing && (
              <label className="checkline">
                <input type="checkbox" checked={form.active}
                  onChange={e => field('active',e.target.checked)} /> Disponível para novas prescrições
              </label>
            )}
            {error && <p className="error" role="alert">{error}</p>}
            {feedback && <p className="saved-message" role="status">{feedback}</p>}
            <div className="actions">
              <button className="primary" type="submit" disabled={busy}>
                {editing ? 'Salvar alterações' : 'Adicionar à biblioteca'}
              </button>
              {editing && <button type="button" className="secondary-light" onClick={reset}>Cancelar edição</button>}
            </div>
          </form>
          <p className="notice">
            O catálogo não contém prescrições automáticas ou orientações clínicas.
            Apenas o profissional deve selecionar e adaptar atividades.
          </p>
        </section>
        <section className="card">
          <h2>Meus exercícios ({list.filter(x => x.active).length})</h2>
          <label>Pesquisar
            <input type="search" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Nome ou categoria" />
          </label>
          <label className="checkline">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Mostrar arquivados
          </label>
          {!filtered.length ? <p className="muted">Nenhum exercício encontrado.</p> : (
            <ul className="exercise-list">
              {filtered.map(item => (
                <li key={item.id}>
                  <strong>{item.title} {!item.active && <span className="tag">Arquivado</span>}</strong>
                  <small>{item.category} · {item.defaultSets} séries × {item.defaultRepetitions} repetições
                    {item.defaultDurationMinutes ? ' · ' + item.defaultDurationMinutes + ' minutos' : ''}
                  </small>
                  {item.description && <small>{item.description}</small>}
                  <div className="actions">
                    <button type="button" className="secondary-light" disabled={busy}
                      onClick={() => startEdit(item)}>Editar</button>
                    <button type="button" className={item.active ? 'danger-light' : 'secondary-light'}
                      disabled={busy} onClick={() => toggle(item)}>
                      {item.active ? 'Arquivar' : 'Reativar'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
