import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from './api';

export function Login({ onOk }: { onOk: () => void }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.login(key.trim());
      onOk();
    } catch (e) {
      setErr(
        e instanceof ApiError && e.status === 429
          ? 'Muitas tentativas. Aguarde alguns minutos.'
          : 'Chave inválida.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>Produção · Jotaene Serviços</h1>
        <p>Acesso restrito. Informe a chave única.</p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="chave de acesso"
          autoFocus
          autoComplete="off"
        />
        <button disabled={busy || !key.trim()}>{busy ? 'verificando…' : 'Entrar'}</button>
        {err && <div className="err">{err}</div>}
      </form>
    </div>
  );
}
