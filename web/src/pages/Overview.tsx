import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { useRefreshTick } from '../refresh';
import { Kpi, MiniBars, Bars, Panel, StateBadge, Banner, Loading, fmtUsd, fmtDate } from '../components';

export function Overview() {
  const tick = useRefreshTick();
  const { data, error } = useApi(() => api.overview(), [tick]);
  const { data: cost } = useApi(() => api.cost(), [tick]);
  const [q, setQ] = useState('');
  if (!data) return <Loading error={error} />;
  const k = data.kpis;

  const stateCounts = data.byState.map((s) => s.c);
  const pubShare = k.totalEpisodes ? Math.round((k.published / k.totalEpisodes) * 100) : 0;

  // Handoffs por agente (do recentHandoffs) → barras do painel direito.
  const perAgent = new Map<string, number>();
  for (const h of data.recentHandoffs) perAgent.set(h.to_agent, (perAgent.get(h.to_agent) ?? 0) + 1);
  const agentBars = [...perAgent.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const handoffs = data.recentHandoffs.filter(
    (h) =>
      !q ||
      [h.episode_id, h.from_agent, h.to_agent, h.to_state, h.note]
        .join(' ')
        .toLowerCase()
        .includes(q.toLowerCase()),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bem-vindo de volta</h1>
          <div className="sub">Visão geral da produção · Jotaene Serviços</div>
        </div>
        <div className="row">
          <span className="chip">Atualizado: {fmtDate(data.lastSync)}</span>
        </div>
      </div>

      <Banner notes={data.degraded} />

      <div className="grid kpis">
        <Kpi
          label="Episódios"
          value={k.totalEpisodes}
          chart={<MiniBars values={stateCounts.length ? stateCounts : [1]} />}
          foot={<>{k.published} publicado(s) no total</>}
        />
        <Kpi
          label="Na esteira"
          value={k.inPipeline}
          tone={k.escalated ? 'neg' : 'pos'}
          foot={k.escalated ? <>🚨 {k.escalated} escalado(s)</> : <>sem escalonamentos</>}
        />
        <Kpi
          label="Publicados"
          value={k.published}
          foot={<>{pubShare}% dos episódios</>}
        />
        <Kpi
          label="Custo do mês (est.)"
          value={fmtUsd(k.monthlyEstimateUsd)}
          tone={k.overBudget ? 'neg' : 'pos'}
          chart={<MiniBars values={[k.monthlyEstimateUsd || 0.01, k.monthlyBudgetUsd]} />}
          foot={<>teto {fmtUsd(k.monthlyBudgetUsd)}{k.overBudget ? ' — ESTOUROU' : ' — dentro'}</>}
        />
      </div>

      <div className="grid split" style={{ gridTemplateColumns: '1.7fr 1fr', marginTop: 16 }}>
        <Panel title="Produção por estado" sub="episódios na máquina de estados">
          <Bars data={data.byState.map((s) => ({ label: s.state, value: s.c }))} />
        </Panel>
        <Panel title="Handoffs por agente" sub="quem recebeu trabalho (recente)">
          <Bars data={agentBars} />
        </Panel>
      </div>

      {cost && (
        <>
          <div className="section-title">Custo por mês</div>
          <Panel
            title="Custo de cron por mês"
            sub={`estimado · TTS ${fmtUsd(cost.totals.ttsEstimateUsd)} + agentes ${fmtUsd(cost.totals.openclawUsd)} · teto ${fmtUsd(cost.totals.monthlyBudgetUsd)} (timeline só de crons — agent_usage não tem tempo)`}
          >
            <Bars data={[...cost.cronTimeline.byMonth].reverse().map((x) => ({ label: x.m, value: x.cost }))} />
          </Panel>
        </>
      )}

      <div className="section-title">Atividade recente — handoffs agente → agente</div>
      <div className="card">
        <div className="panel-head">
          <h3 style={{ fontSize: 13 }}>{handoffs.length} evento(s)</h3>
          <input
            className="input"
            placeholder="filtrar episódio / agente / estado…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <table className="tbl">
          <thead>
            <tr><th>Quando</th><th>Episódio</th><th>De</th><th>Para</th><th>Estado</th><th>Nota</th></tr>
          </thead>
          <tbody>
            {handoffs.length === 0 && (
              <tr><td colSpan={6} className="muted">sem handoffs {q ? 'pro filtro' : 'ainda'}</td></tr>
            )}
            {handoffs.map((h, i) => (
              <tr key={i}>
                <td className="muted">{fmtDate(h.at)}</td>
                <td><Link to={`/episodios/${h.episode_id}`}>{h.episode_id}</Link></td>
                <td>{h.from_agent}</td>
                <td><b>{h.to_agent}</b></td>
                <td><StateBadge state={h.to_state} /></td>
                <td className="muted">{h.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
