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
    <section className="stack account-security">
      <div className="account-security-heading">
        <div className="eyebrow">Área pessoal / Segurança</div>
        <h1>Conta e segurança</h1>
        <p className="muted">Gerencie a proteção do seu acesso sem misturá-la às atividades do professor ou às configurações administrativas.</p>
      </div>
      <div className="account-security-layout">
        <div className="card auth-card-wide">
          <h2>Alterar senha</h2>
          <p className="muted">Depois da troca, todas as sessões serão encerradas. Entre novamente com a nova senha.</p>
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
        <aside className="card security-guide">
          <div className="eyebrow">Cuidados com sua conta</div>
          <h2>Segurança de acesso</h2>
          <ul>
            <li>Use uma senha longa e exclusiva para o G-Fit.</li>
            <li>A alteração da senha encerra as sessões já abertas.</li>
            <li>Não compartilhe dados de acesso com outros usuários.</li>
            <li>Autenticação em dois fatores ainda não está disponível.</li>
          </ul>
        </aside>
      </div>
    </section>
  );
}
