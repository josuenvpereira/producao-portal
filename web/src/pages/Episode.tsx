import { api } from '../api';
import { useApi } from '../hooks';
import { useRefreshTick } from '../refresh';
import { StateBadge, Panel, Loading, fmtUsd, fmtDate } from '../components';

const pubRel = (repoRel: string) => repoRel.replace(/^public\//, '');

export function Episode({ id }: { id: string }) {
  const tick = useRefreshTick();
  const { data, error } = useApi(() => api.episode(id), [tick, id]);
  if (!data) return <Loading error={error} />;
  const ep = data.episode as Record<string, string | number | null>;
  const audioByName = new Map<string, string>();
  for (const a of data.assets) {
    const m = /\/audio\/([^/]+)$/.exec(a.rel_path);
    if (m && m[1]) audioByName.set(m[1], pubRel(a.rel_path));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{String(ep['title'] ?? id)}</h1>
          <div className="sub mono">{id}</div>
        </div>
        <div className="row">
          <StateBadge state={(ep['state'] as string) ?? null} />
          {data.costEstimate && <span className="chip">TTS ~{fmtUsd(data.costEstimate.tts_cost_usd)}</span>}
        </div>
      </div>

      {data.costSignal && (
        <div className="banner">
          💰 Aprovação de custo: projetado {fmtUsd(Number(data.costSignal['projected_usd']))} (teto{' '}
          {fmtUsd(Number(data.costSignal['budget_usd']))})
        </div>
      )}

      <div className="grid" style={{ gap: 16 }}>
        <Panel flush title="Rastreabilidade" sub="blocos do script → áudio gerado / imagens encontradas">
          <table className="tbl">
            <thead><tr><th>Bloco</th><th>Tipo</th><th>Áudio (deste script)</th><th>Imagens</th><th>Chars</th></tr></thead>
            <tbody>
              {data.blocks.map((b) => {
                const imgs: string[] = (() => { try { return JSON.parse(b.images_json); } catch { return []; } })();
                const audioPath = b.audio_file ? audioByName.get(b.audio_file) : undefined;
                return (
                  <tr key={b.block_id}>
                    <td><b>{b.block_id}</b></td>
                    <td className="muted">{b.kind}</td>
                    <td>
                      {audioPath ? <audio controls preload="none" src={api.assetUrl(audioPath)} />
                        : <span className="muted">{b.audio_file ?? '—'}</span>}
                    </td>
                    <td className="row">
                      {imgs.length === 0 && <span className="muted">—</span>}
                      {imgs.map((src) => (
                        <a key={src} href={api.assetUrl(src)} target="_blank" rel="noreferrer">
                          <img className="thumb" src={api.assetUrl(src)} alt="" loading="lazy" />
                        </a>
                      ))}
                    </td>
                    <td className="mono muted">{b.spoken_chars}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>

        <Panel flush title="Render — GitHub Actions" sub="render-ep.yml (gate de custo: approve_paid_apis)">
          <table className="tbl">
            <thead><tr><th>Run</th><th>Status</th><th>Custo aprovado?</th><th>Artifacts</th><th>Quando</th></tr></thead>
            <tbody>
              {data.runs.length === 0 && <tr><td colSpan={5} className="muted">sem runs (precisa GITHUB_TOKEN)</td></tr>}
              {data.runs.map((r, i) => (
                <tr key={i}>
                  <td><a href={String(r['html_url'] ?? '#')} target="_blank" rel="noreferrer">{String(r['run_id'])}</a></td>
                  <td className="muted">{String(r['status'])}/{String(r['conclusion'] ?? '—')}</td>
                  <td>{Number(r['approve_paid_apis']) ? <span className="badge b-warn">pago</span> : <span className="badge b-idle">não</span>}</td>
                  <td className="muted">
                    {data.artifacts.filter((a) => a['run_id'] === r['run_id']).map((a) => String(a['name'])).join(', ') || '—'}
                  </td>
                  <td className="muted">{fmtDate(String(r['created_at'] ?? ''))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel flush title="Histórico de estados" sub="handoffs agente → agente">
          <table className="tbl">
            <thead><tr><th>Quando</th><th>De → Para</th><th>Por</th><th>Nota</th></tr></thead>
            <tbody>
              {data.history.length === 0 && <tr><td colSpan={4} className="muted">sem estado (episódio só com script)</td></tr>}
              {data.history.map((h) => (
                <tr key={h.seq}>
                  <td className="muted">{fmtDate(h.at)}</td>
                  <td className="mono">{h.from_state ?? '∅'} → {h.to_state}</td>
                  <td>{h.by_agent}</td>
                  <td className="muted">{h.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
