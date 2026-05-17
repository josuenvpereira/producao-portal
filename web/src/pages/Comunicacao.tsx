import { api } from '../api';
import { useApi } from '../hooks';
import { useRefreshTick } from '../refresh';
import { Banner, Loading } from '../components';

const ms = (m: number | null) =>
  !m ? '—' : new Date(m).toLocaleString('pt-BR');
const dur = (d: number | null) =>
  !d ? '—' : d >= 60000 ? `${Math.round(d / 60000)}min` : `${Math.round(d / 1000)}s`;

// Esteira de Comunicação (Jotaene/mensageria) — crons do OpenClaw + histórico
// de execução (o que cada cron produziu). Dados via exporter (host → :ro).
export function Comunicacao() {
  const tick = useRefreshTick();
  const { data, error } = useApi(() => api.comunicacao(), [tick]);
  if (!data) return <Loading error={error} />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Comunicação</h1>
          <div className="sub">
            Crons do OpenClaw (mensageria/Jotaene) ·{' '}
            {data.exportedAt ? `snapshot ${ms(Date.parse(data.exportedAt))}` : 'sem snapshot'}
          </div>
        </div>
      </div>

      <Banner notes={data.degraded} />

      <div className="section-title">Crons (esteira)</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <table className="tbl">
          <thead>
            <tr><th>Cron</th><th>Agente</th><th>Agenda</th><th>Última exec.</th><th>Status</th><th>Duração</th><th>Próxima</th></tr>
          </thead>
          <tbody>
            {data.jobs.length === 0 && (
              <tr><td colSpan={7} className="muted">sem crons — rode o exporter no VPS</td></tr>
            )}
            {data.jobs.map((j) => (
              <tr key={j.id} style={{ opacity: j.enabled ? 1 : 0.5 }}>
                <td>
                  <b>{j.name}</b>
                  <div className="muted" style={{ fontSize: 11 }}>{j.description}</div>
                </td>
                <td className="mono">{j.agent_id}</td>
                <td className="mono muted">{j.schedule_expr} {j.tz ? `(${j.tz})` : ''}</td>
                <td className="muted">{ms(j.last_run_at)}</td>
                <td>
                  <span className={`badge ${j.last_status === 'ok' ? 'b-done' : j.last_status ? 'b-err' : 'b-idle'}`}>
                    {j.enabled ? (j.last_status ?? 'pendente') : 'desativado'}
                  </span>
                  {j.consec_errors > 0 && <span className="badge b-err" style={{ marginLeft: 6 }}>{j.consec_errors} erros</span>}
                </td>
                <td className="mono muted">{dur(j.last_duration)}</td>
                <td className="muted">{j.enabled ? ms(j.next_run_at) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Execuções recentes — o que cada cron produziu</div>
      <div className="grid" style={{ gap: 12 }}>
        {data.runs.length === 0 && (
          <div className="card pad muted">sem execuções (histórico via openclaw cron runs)</div>
        )}
        {data.runs.map((r, i) => (
          <div className="card pad" key={i}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row">
                <span className={`badge ${r.status === 'ok' ? 'b-done' : 'b-err'}`}>{r.status}</span>
                <b>{r.agent_id}</b>
                <span className="muted">{ms(r.at_ms)}</span>
              </div>
              <span className="muted mono" style={{ fontSize: 11 }}>
                {dur(r.duration_ms)} · {r.model.replace('deepseek-', '')} · {r.total_tokens.toLocaleString('pt-BR')} tok
              </span>
            </div>
            <pre
              style={{
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '10px 0 0',
                fontSize: 12, color: 'var(--text-2)', fontFamily: 'inherit',
                maxHeight: 220, overflow: 'auto',
              }}
            >
              {r.summary || '(sem resumo)'}
            </pre>
          </div>
        ))}
      </div>
    </>
  );
}
