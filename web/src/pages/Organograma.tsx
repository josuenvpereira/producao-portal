import { api } from '../api';
import { useApi } from '../hooks';
import { Banner, Loading } from '../components';

// Fase 3: lista por squad (data-driven, de openclaw_workspaces/org.json).
// Fase 4 substitui por grafo React Flow (mesma fonte de dados).
export function Organograma() {
  const { data, error } = useApi(() => api.org(), []);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <div className="topbar">
        <div><h1>Organograma</h1><div className="sub">{data.project ?? 'Pipeline'} — gerado de openclaw_workspaces/</div></div>
      </div>
      <Banner notes={data.degraded} />
      {data.squads.map((sq) => (
        <div key={sq.id}>
          <div className="section-title">{sq.name}</div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {sq.agents.map((a) => (
              <div className="card" key={a.id}>
                <div className="row">
                  <span style={{ fontSize: 22 }}>{a.emoji}</span>
                  <b>{a.name}</b>
                </div>
                <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>{a.role}</div>
                <div className="muted mono" style={{ marginTop: 10, fontSize: 11 }}>
                  {a.handsOffTo?.length ? `→ ${a.handsOffTo.join(', ')}` : a.supervises?.length ? `supervisiona: ${a.supervises.length}` : '·'}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
