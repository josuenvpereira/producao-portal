import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { SfxStatus, SfxCatalog, SfxMeta } from '../api';
import { useApi } from '../hooks';
import { Loading, fmtDate } from '../components';

type Kind = 'sfx' | 'bed' | 'vocal';

// Presets de voz p/ OmniVoice — a fábrica NÃO expõe catálogo de vozes (só
// bed_presets), então a lista é curada aqui. "Personalizado…" libera o
// instruct livre. Editar/acrescentar à vontade (label + value).
const VOICE_PRESETS: { label: string; value: string }[] = [
  { label: 'Padrão da fábrica (recomendado)', value: '' },
  { label: 'Masc · PT-BR · narrador claro', value: 'male, brazilian portuguese, clear neutral narrator' },
  { label: 'Masc · PT-BR · enérgico / hype', value: 'male, brazilian portuguese, energetic hype narrator' },
  { label: 'Masc · PT-BR · sério / analítico', value: 'male, brazilian portuguese, calm serious analytical narrator' },
  { label: 'Masc · PT-BR · grave / dramático', value: 'male, brazilian portuguese, deep dramatic cinematic narrator' },
  { label: 'Fem · PT-BR · clara / neutra', value: 'female, brazilian portuguese, clear neutral narrator' },
  { label: 'Fem · PT-BR · enérgica', value: 'female, brazilian portuguese, energetic narrator' },
];
const SPEEDS = ['0.8', '0.9', '1.0', '1.1', '1.2', '1.25'];

function StatusHeader({ s }: { s: SfxStatus | null }) {
  if (!s) return <span className="badge b-idle">checando…</span>;
  if (!s.reachable || s.state === 'offline')
    return <span className="badge b-idle">Serviço offline (casa desligada)</span>;
  if (s.state === 'parcial')
    return (
      <span className="badge b-warn">
        Parcial — fora: {s.down.join(', ') || 'algum gerador'}
      </span>
    );
  return <span className="badge b-done">No ar{s.busy ? ' · gerando…' : ''}</span>;
}

export function Sfx() {
  const { data: status, reload: reloadStatus } = useApi(() => api.sfxStatus(), []);
  const { data: catalog } = useApi(() => api.sfxCatalog().catch(() => ({}) as SfxCatalog), []);
  const { data: library, reload: reloadLib } = useApi(() => api.sfxLibrary(), []);

  const [kind, setKind] = useState<Kind>('sfx');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ url: string; promptEn: string | null } | null>(null);

  // form state (defaults do §4)
  const [sfxF, setSfxF] = useState({ prompt: '', lang: 'pt', duration: 5, steps: 150, seed: '' });
  const [bedF, setBedF] = useState({ prompt: '', name: '', audio_duration: 60, seed: '' });
  const [vocF, setVocF] = useState({ text: '', language: 'pt', instruct: '', speed: '1.0', custom: false });

  // poll de status a cada 20s
  const rs = useRef(reloadStatus);
  rs.current = reloadStatus;
  useEffect(() => {
    const t = setInterval(() => rs.current(), 20000);
    return () => clearInterval(t);
  }, []);

  const offline = !status?.reachable || status?.state === 'offline';
  const locked = busy || !!status?.busy;

  function validate(): string | null {
    if (kind === 'sfx') {
      if (!sfxF.prompt.trim()) return 'Descreva o som (prompt).';
      if (sfxF.duration < 0.5 || sfxF.duration > 30) return 'Duração entre 0.5 e 30s.';
      if (sfxF.steps < 20 || sfxF.steps > 400) return 'Steps entre 20 e 400.';
    }
    if (kind === 'bed' && !bedF.prompt.trim() && !bedF.name) return 'Informe um prompt OU um preset.';
    if (kind === 'vocal' && !vocF.text.trim()) return 'Escreva o texto da narração.';
    return null;
  }

  async function generate() {
    const v = validate();
    if (v) {
      setErr(v);
      return;
    }
    setErr('');
    setResult(null);
    setBusy(true);
    try {
      let body: Record<string, unknown>;
      if (kind === 'sfx')
        body = {
          prompt: sfxF.prompt,
          lang: sfxF.lang,
          duration: sfxF.duration,
          steps: sfxF.steps,
          ...(sfxF.seed ? { seed: Number(sfxF.seed) } : {}),
        };
      else if (kind === 'bed')
        body = {
          ...(bedF.name ? { name: bedF.name } : { prompt: bedF.prompt }),
          audio_duration: bedF.audio_duration,
          ...(bedF.seed ? { seed: Number(bedF.seed) } : {}),
        };
      else
        body = {
          text: vocF.text,
          language: vocF.language || null,
          instruct: vocF.instruct || null,
          ...(vocF.speed ? { speed: Number(vocF.speed) } : {}),
        };
      const r = await api.sfxGenerate(kind, body);
      setResult({ url: r.url, promptEn: r.promptEn });
      reloadLib();
      reloadStatus();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha na geração.');
    } finally {
      setBusy(false);
    }
  }

  const inp = { className: 'input', style: { width: '100%' } };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>SFX / Áudio</h1>
          <div className="sub">Geração de áudio por IA (SFX · música · voz) — fábrica na casa</div>
        </div>
        <StatusHeader s={status} />
      </div>

      {offline && (
        <div className="banner">
          A fábrica está <b>offline</b> (casa desligada ou túnel caído). Dá pra ver
          o status e a biblioteca; geração fica desabilitada até voltar.
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1.1fr 1fr', alignItems: 'start' }}>
        <div className="card pad">
          <div className="seg" style={{ marginBottom: 16 }}>
            {(['sfx', 'bed', 'vocal'] as Kind[]).map((k) => (
              <button key={k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setErr(''); }}>
                {k === 'sfx' ? 'SFX' : k === 'bed' ? 'Bed (música)' : 'Vocal (voz)'}
              </button>
            ))}
          </div>

          {kind === 'sfx' && (
            <div className="grid" style={{ gap: 10 }}>
              <textarea {...inp} rows={2} placeholder="descrição do som (ex.: vidro quebrando no concreto)"
                value={sfxF.prompt} onChange={(e) => setSfxF({ ...sfxF, prompt: e.target.value })} />
              <div className="row">
                <select className="input" value={sfxF.lang} onChange={(e) => setSfxF({ ...sfxF, lang: e.target.value })}>
                  <option value="pt">pt (traduz p/ en)</option><option value="en">en</option>
                </select>
                <label className="muted">duração {sfxF.duration}s
                  <input type="range" min={0.5} max={30} step={0.5} value={sfxF.duration}
                    onChange={(e) => setSfxF({ ...sfxF, duration: Number(e.target.value) })} />
                </label>
              </div>
              <div className="row">
                <label className="muted">steps <input className="input" type="number" min={20} max={400}
                  value={sfxF.steps} onChange={(e) => setSfxF({ ...sfxF, steps: Number(e.target.value) })} style={{ width: 90 }} /></label>
                <label className="muted">seed <input className="input" placeholder="opcional"
                  value={sfxF.seed} onChange={(e) => setSfxF({ ...sfxF, seed: e.target.value })} style={{ width: 110 }} /></label>
              </div>
            </div>
          )}

          {kind === 'bed' && (
            <div className="grid" style={{ gap: 10 }}>
              <select className="input" value={bedF.name}
                onChange={(e) => setBedF({ ...bedF, name: e.target.value })}>
                <option value="">— preset (ou use prompt livre) —</option>
                {(catalog?.bed_presets ?? []).map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
              <textarea {...inp} rows={2} placeholder="prompt livre (ignore se escolheu preset)"
                value={bedF.prompt} disabled={!!bedF.name}
                onChange={(e) => setBedF({ ...bedF, prompt: e.target.value })} />
              <div className="row">
                <label className="muted">duração {bedF.audio_duration}s
                  <input type="range" min={10} max={180} step={5} value={bedF.audio_duration}
                    onChange={(e) => setBedF({ ...bedF, audio_duration: Number(e.target.value) })} /></label>
                <label className="muted">seed <input className="input" placeholder="opcional"
                  value={bedF.seed} onChange={(e) => setBedF({ ...bedF, seed: e.target.value })} style={{ width: 110 }} /></label>
              </div>
            </div>
          )}

          {kind === 'vocal' && (
            <div className="grid" style={{ gap: 10 }}>
              <textarea {...inp} rows={3} placeholder="texto da narração (PT-BR)"
                value={vocF.text} onChange={(e) => setVocF({ ...vocF, text: e.target.value })} />
              <div className="row">
                <label className="muted" style={{ flex: 1 }}>voz
                  <select className="input" style={{ width: '100%' }}
                    value={vocF.custom ? '__custom__' : vocF.instruct}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__custom__') setVocF({ ...vocF, custom: true, instruct: '' });
                      else setVocF({ ...vocF, custom: false, instruct: v });
                    }}>
                    {VOICE_PRESETS.map((p) => (
                      <option key={p.label} value={p.value}>{p.label}</option>
                    ))}
                    <option value="__custom__">Personalizado…</option>
                  </select>
                </label>
                <label className="muted" style={{ width: 120 }}>velocidade
                  <select className="input" style={{ width: '100%' }} value={vocF.speed}
                    onChange={(e) => setVocF({ ...vocF, speed: e.target.value })}>
                    {SPEEDS.map((s) => (
                      <option key={s} value={s}>{s === '1.0' ? '1.0× (padrão)' : s + '×'}</option>
                    ))}
                  </select>
                </label>
              </div>
              {vocF.custom && (
                <input className="input" autoFocus
                  placeholder='instruct livre (ex.: "male, portuguese accent")'
                  value={vocF.instruct}
                  onChange={(e) => setVocF({ ...vocF, instruct: e.target.value })} />
              )}
            </div>
          )}

          <button className="btn primary" style={{ marginTop: 14 }}
            disabled={offline || locked}
            onClick={generate}>
            {busy ? 'gerando…' : locked ? 'fábrica ocupada…' : 'Gerar áudio'}
          </button>
          {busy && <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            ⏳ a 1ª geração de cada tipo pode levar alguns minutos (carregando o modelo). Não recarregue.
          </div>}
          {err && <div className="banner" style={{ marginTop: 12 }}>{err}</div>}

          {result && !err && (
            <div className="muted" style={{ marginTop: 12, fontSize: 13 }}>
              ✓ Áudio gerado — disponível na <b>Biblioteca</b> ao lado (tocar e baixar por lá).
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="panel-head"><h3 style={{ fontSize: 13 }}>Biblioteca</h3></div>
          {!library ? <Loading /> : (
            <table className="tbl">
              <thead><tr><th>Quando</th><th>Tipo</th><th>Prompt/texto</th><th>Áudio</th></tr></thead>
              <tbody>
                {library.length === 0 && <tr><td colSpan={4} className="muted">vazio — gere algo</td></tr>}
                {library.map((m: SfxMeta) => {
                  const r = m.req as Record<string, unknown>;
                  const desc = String(r['prompt'] ?? r['name'] ?? r['text'] ?? '—');
                  return (
                    <tr key={m.id}>
                      <td className="muted">{fmtDate(new Date(m.ts).toISOString())}</td>
                      <td>{m.kind}</td>
                      <td className="muted" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</td>
                      <td><audio controls preload="none" src={api.sfxAudioUrl(m.id)} style={{ width: 200, height: 32 }} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
