import { api } from '../api';
import { useApi } from '../hooks';
import { useRefreshTick } from '../refresh';
import { Kpi, Banner, Loading, fmtUsd } from '../components';

export function Custos() {
  const tick = useRefreshTick();
  const { data, error } = useApi(() => api.cost(), [tick]);
  if (!data) return <Loading error={error} />;
  const t = data.totals;
  return (
    <>
      <div className="topbar">
        <div><h1>Custos</h1><div className="sub">Controlador de custo — evitar surpresas (ex: incidente ~8k créditos ElevenLabs)</div></div>
      </div>
      <Banner notes={data.degraded} />
      <div className="grid kpis">
        <Kpi label="TTS estimado (ElevenLabs)" value={fmtUsd(t.ttsEstimateUsd)} />
        <Kpi label="Tokens OpenClaw" value={fmtUsd(t.openclawUsd)} sub="claw.jotaene.ia.br/usage" />
        <Kpi label="Teto mensal" value={fmtUsd(t.monthlyBudgetUsd)} />
        <Kpi label="Status" value={t.overBudget ? 'ESTOUROU' : 'dentro'} tone={t.overBudget ? 'neg' : 'pos'} />
      </div>

      <div className="section-title">Estimativa de TTS por episódio (spokenText × $0.30/1k)</div>
      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead><tr><th>Episódio</th><th>Chars</th><th>Custo est.</th><th>Aprovado (sinal)</th><th>Teto</th></tr></thead>
          <tbody>
            {data.estimates.map((e) => (
              <tr key={e.episode_id}>
                <td>{e.title ?? e.episode_id}</td>
                <td className="mono">{e.tts_chars.toLocaleString('pt-BR')}</td>
                <td className="mono">{fmtUsd(e.tts_cost_usd)}</td>
                <td className="mono">{fmtUsd(e.projected_usd)}</td>
                <td className="mono muted">{fmtUsd(e.budget_usd)}</td>
              </tr>
            ))}
            {data.estimates.length === 0 && <tr><td colSpan={5} className="muted">sem estimativas</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="section-title">Consumo por agente (OpenClaw)</div>
      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead><tr><th>Agente</th><th>Período</th><th>Tokens</th><th>Custo</th></tr></thead>
          <tbody>
            {data.byAgent.length === 0 && (
              <tr><td colSpan={4} className="muted">
                Indisponível — /usage do OpenClaw é HTML (não-JSON). Mapeamento pendente
                (item de investigação). Degrada sem quebrar.
              </td></tr>
            )}
            {data.byAgent.map((a, i) => (
              <tr key={i}>
                <td>{a.agent}</td><td className="muted">{a.period}</td>
                <td className="mono">{a.tokens}</td><td className="mono">{fmtUsd(a.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
