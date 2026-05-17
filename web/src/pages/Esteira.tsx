import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { useRefreshTick } from '../refresh';
import { StateBadge, Panel, Banner, Loading, fmtDate } from '../components';

export function Esteira() {
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
          <h1>Esteira</h1>
          <div className="sub">{data.episodes.length} episódio(s) · atualiza ao vivo (SSE)</div>
        </div>
      </div>
      <Banner notes={data.degraded} />

      <Panel
        flush
        title="Pipeline"
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
                <tr><td colSpan={5} className="muted">nenhum episódio {q ? 'pro filtro' : 'na esteira'}</td></tr>
              )}
            </tbody>
          </table>
      </Panel>
    </>
  );
}
