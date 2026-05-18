import { api } from '../api';
import { useApi } from '../hooks';
import { useRefreshTick } from '../refresh';
import { Kpi, MiniBars, Panel, Banner, Loading, fmtUsd } from '../components';

export function Custos() {
  const tick = useRefreshTick();
  const { data, error } = useApi(() => api.cost(), [tick]);
  if (!data) return <Loading error={error} />;
  const t = data.totals;
  const estBars = data.estimates.slice(0, 8).map((e) => e.tts_cost_usd);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Custos</h1>
          <div className="sub">Controlador de custo — evitar surpresas (ex.: incidente ~8k créditos ElevenLabs)</div>
        </div>
      </div>
      <Banner notes={data.degraded} />

      <div className="grid kpis">
        <Kpi
          label="TTS estimado (ElevenLabs)"
          value={fmtUsd(t.ttsEstimateUsd)}
          chart={<MiniBars values={estBars.length ? estBars : [1]} />}
          foot={<>{data.estimates.length} episódio(s)</>}
        />
        <Kpi label="Tokens OpenClaw" value={fmtUsd(t.openclawUsd)} foot={<>exporter (sessions por agente)</>} />
        <Kpi label="Teto mensal" value={fmtUsd(t.monthlyBudgetUsd)} foot={<>orçamento configurado</>} />
        <Kpi
          label="Status"
          value={t.overBudget ? 'ESTOUROU' : 'Dentro'}
          tone={t.overBudget ? 'neg' : 'pos'}
          foot={<>{fmtUsd(t.ttsEstimateUsd + t.openclawUsd)} de {fmtUsd(t.monthlyBudgetUsd)}</>}
        />
      </div>

      <div className="grid" style={{ gap: 16, marginTop: 16 }}>
        <Panel flush title="Estimativa de TTS por episódio" sub="spokenText × $0.30/1k chars (igual generate_episode_audio.js)">
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
        </Panel>

        <Panel
          flush
          title="Consumo por agente (OpenClaw)"
          sub={`tokens reais por agente/modelo · ${data.totals.openclawTokens.toLocaleString('pt-BR')} tokens`}
        >
          <table className="tbl">
            <thead><tr><th>Agente</th><th>Modelo</th><th>Sessões</th><th>Tokens</th><th>Custo*</th></tr></thead>
            <tbody>
              {data.byAgent.length === 0 && (
                <tr><td colSpan={5} className="muted">
                  Sem dados — rode o exporter no VPS (scripts/openclaw-export.sh).
                </td></tr>
              )}
              {data.byAgent.map((a, i) => (
                <tr key={i}>
                  <td>{a.agent}</td>
                  <td className="muted">{a.model.replace('deepseek-', '')}</td>
                  <td className="mono muted">{a.sessions}</td>
                  <td className="mono">{a.tokens.toLocaleString('pt-BR')}</td>
                  <td className="mono">{a.cost_usd ? fmtUsd(a.cost_usd) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted" style={{ padding: '10px 16px', fontSize: 11 }}>
            *Custo = tokens × preço DeepSeek configurável (DEEPSEEK_PRO/FLASH_USD_PER_1M no .env).
            Tokens são reais; defina o preço pra ver USD.
          </div>
        </Panel>
      </div>
    </>
  );
}
