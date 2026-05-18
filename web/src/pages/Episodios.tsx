import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { useRefreshTick } from '../refresh';
import { StateBadge, Panel, Banner, Loading, fmtDate } from '../components';

// Lista tabular de episódios (estado + render). Antes /episodios e /esteira
// renderizavam o MESMO componente; agora a Esteira é o pipeline visual e
// esta é a lista. Fonte: api.pipeline() (read-model: episodes + render_runs).
export function Episodios() {
  const tick = useRefreshTick();
  const { data, error } = useApi(() => api.pipeline(), [tick]);
  const [q, setQ] = useState('');
  if (!data) return <Loading error={error} />;

  const rows = data.episodes.filter(
    (e) => !q || `${e.title} ${e.episode_id} ${e.state ?? ''}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Episódios</h1>
          <div className="sub">{data.episodes.length} episódio(s) · estado + render · atualiza ao vivo (SSE)</div>
        </div>
      </div>
      <Banner notes={data.degraded} />
      <div className="card pad" style={{ marginBottom: 16, fontSize: 12 }}>
        <b>Escopo:</b> lista os episódios do <b>Canal MSU · Vídeo</b>
        (pipeline-state do orquestrador). A esteira de{' '}
        <b>Conteúdo · Mensageria</b> (gerente-com) roda por <b>cron no
        OpenClaw</b> e <b>ainda não está conectada</b> — fonte de log a definir
        (adapter CronLog pendente).
      </div>

      <Panel
        flush
        title="Episódios"
        sub="estado da máquina + render GitHub Actions"
        right={
          <input
            className="input"
            placeholder="filtrar episódio / estado…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
      >
        <table className="tbl">
          <thead>
            <tr><th>Episódio</th><th>Estado</th><th>Render (GH Actions)</th><th>Tentativas</th><th>Atualizado</th></tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.episode_id}>
                <td>
                  <Link to={`/episodios/${e.episode_id}`}><b>{e.title}</b></Link>
                  <div className="muted mono" style={{ fontSize: 11 }}>{e.episode_id}</div>
                </td>
                <td>
                  <StateBadge state={e.state} />
                  {e.escalated ? <span className="badge b-err" style={{ marginLeft: 6 }}>escalado</span> : null}
                </td>
                <td className="muted">
                  {e.last_run_status
                    ? `${e.last_run_status}${e.last_run_conclusion ? ` / ${e.last_run_conclusion}` : ''}`
                    : '—'}
                </td>
                <td className="mono muted">{e.attempts_json && e.attempts_json !== '{}' ? e.attempts_json : '—'}</td>
                <td className="muted">{fmtDate(e.updated_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="muted">nenhum episódio {q ? 'pro filtro' : 'cadastrado'}</td></tr>
            )}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
