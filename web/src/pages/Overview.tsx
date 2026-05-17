import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { useRefreshTick } from '../refresh';
import { Kpi, Bars, Banner, Loading, fmtUsd, fmtDate } from '../components';

export function Overview() {
  const tick = useRefreshTick();
  const { data, error } = useApi(() => api.overview(), [tick]);
  if (!data) return <Loading error={error} />;
  const k = data.kpis;
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">Última sincronização: {fmtDate(data.lastSync)}</div>
        </div>
      </div>
      <Banner notes={data.degraded} />
      <div className="grid kpis">
        <Kpi label="Episódios" value={k.totalEpisodes} />
        <Kpi label="Na esteira" value={k.inPipeline} sub={k.escalated ? `${k.escalated} escalado(s)` : 'ok'} tone={k.escalated ? 'neg' : 'pos'} />
        <Kpi label="Publicados" value={k.published} />
        <Kpi
          label="Custo do mês (est.)"
          value={fmtUsd(k.monthlyEstimateUsd)}
          sub={`teto ${fmtUsd(k.monthlyBudgetUsd)}${k.overBudget ? ' — ESTOUROU' : ''}`}
          tone={k.overBudget ? 'neg' : 'pos'}
        />
      </div>

      <div className="section-title">Episódios por estado</div>
      <div className="card">
        <Bars data={data.byState.map((s) => ({ label: s.state, value: s.c }))} />
      </div>

      <div className="section-title">Handoffs recentes (agente → agente)</div>
      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr><th>Quando</th><th>Episódio</th><th>De</th><th>Para</th><th>Estado</th><th>Nota</th></tr>
          </thead>
          <tbody>
            {data.recentHandoffs.length === 0 && (
              <tr><td colSpan={6} className="muted">sem handoffs ainda</td></tr>
            )}
            {data.recentHandoffs.map((h, i) => (
              <tr key={i}>
                <td className="muted">{fmtDate(h.at)}</td>
                <td><Link to={`/episodios/${h.episode_id}`}>{h.episode_id}</Link></td>
                <td>{h.from_agent}</td>
                <td>{h.to_agent}</td>
                <td className="mono">{h.to_state}</td>
                <td className="muted">{h.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
