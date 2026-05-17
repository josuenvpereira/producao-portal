import { useState } from 'react';
import { api } from '../api';
import { useApi } from '../hooks';
import { useRefreshTick } from '../refresh';
import { Banner, Loading } from '../components';

const pubRel = (r: string) => r.replace(/^public\//, '');
const KB = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export function Assets() {
  const tick = useRefreshTick();
  const { data, error } = useApi(() => api.assets(), [tick]);
  const [filter, setFilter] = useState('');
  if (!data) return <Loading error={error} />;
  const rows = data.assets.filter(
    (a) => !filter || a.rel_path.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <>
      <div className="topbar">
        <div><h1>Assets</h1><div className="sub">{data.assets.length} arquivo(s) — áudio, imagens, brand (acesso gateado)</div></div>
        <input
          placeholder="filtrar…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}
        />
      </div>
      <Banner notes={data.degraded} />
      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead><tr><th>Episódio</th><th>Tipo</th><th>Arquivo</th><th>Tamanho</th><th>Preview</th></tr></thead>
          <tbody>
            {rows.map((a) => {
              const url = api.assetUrl(pubRel(a.rel_path));
              const isImg = /\.(png|jpe?g|webp)$/i.test(a.rel_path);
              const isAud = /\.(mp3|wav|m4a)$/i.test(a.rel_path);
              return (
                <tr key={a.rel_path}>
                  <td className="mono muted">{a.episode_id}</td>
                  <td>{a.kind}</td>
                  <td><a href={url} target="_blank" rel="noreferrer">{a.rel_path.split('/').pop()}</a></td>
                  <td className="mono muted">{KB(a.bytes)}</td>
                  <td>
                    {isImg && <img className="thumb" src={url} alt="" loading="lazy" />}
                    {isAud && <audio controls preload="none" src={url} />}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">nenhum asset</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
