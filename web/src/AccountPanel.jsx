import React, { useState } from 'react';
import { api } from './api.js';

export default function AccountPanel({ onPasswordChanged }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError('A confirmação não corresponde à nova senha.');
      return;
    }
    setBusy(true);
    try {
      await api('/api/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      onPasswordChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <section className="stack">
      <div><div className="eyebrow">Segurança</div><h1>Minha conta</h1></div>
      <div className="card auth-card-wide">
        <h2>Alterar senha</h2>
        <p className="muted">Depois da troca, todas as sessões serão encerradas. Entre novamente com a senha nova.</p>
        <form onSubmit={submit}>
          <label>Senha atual
            <input type="password" autoComplete="current-password" required
              value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
          </label>
          <label>Nova senha
            <input type="password" minLength="10" maxLength="128" autoComplete="new-password" required
              value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </label>
          <label>Confirmar nova senha
            <input type="password" minLength="10" maxLength="128" autoComplete="new-password" required
              value={confirm} onChange={e => setConfirm(e.target.value)} />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" disabled={busy}>Salvar nova senha</button>
        </form>
      </div>
    </section>
  );
}
