import { useEffect, useRef, useState } from 'react';
import { api, ApiError, asInstructError } from '../api';
import type { SfxStatus, SfxCatalog, SfxMeta } from '../api';
import { useApi } from '../hooks';
import { Loading, fmtDate } from '../components';

type Kind = 'sfx' | 'bed' | 'vocal';
type VMode = 'tts' | 'design' | 'clone' | 'multi';
type InstructSel = { gender: string; age: string; accent: string; pitch: string; style: string };

const EMPTY_SEL: InstructSel = { gender: '', age: '', accent: '', pitch: '', style: '' };
const SEL_KEYS = ['gender', 'age', 'accent', 'pitch', 'style'] as const;

// Vocabulário FIXO de `instruct` — transcrito do PORTAL_HANDOFF §4.5 (o
// contrato declara esta lista final e autoritativa). NÃO é fabricação: a
// fábrica valida contra exatamente isto e devolve 422 estruturado com
// `validos` se algo sair daqui. Voice Design monta o instruct só por estes
// dropdowns, então o texto enviado é sempre válido por construção.
const INSTRUCT_VOCAB: Record<keyof InstructSel, string[]> = {
  gender: ['male', 'female'],
  age: ['child', 'teenager', 'young adult', 'middle-aged', 'elderly'],
  accent: [
    'american accent', 'british accent', 'australian accent', 'canadian accent',
    'chinese accent', 'indian accent', 'japanese accent', 'korean accent',
    'portuguese accent', 'russian accent',
  ],
  pitch: ['very low pitch', 'low pitch', 'moderate pitch', 'high pitch', 'very high pitch'],
  style: ['whisper'],
};
const SEL_LABEL: Record<keyof InstructSel, string> = {
  gender: 'gênero', age: 'idade', accent: 'sotaque', pitch: 'tom', style: 'estilo',
};

function buildInstruct(sel: InstructSel): string {
  return SEL_KEYS.map((k) => sel[k]).filter(Boolean).join(', ');
}

// Lê um File como base64 puro (sem o prefixo data:...;base64,). Transporte
// do Voice Clone / Multi-Speaker conforme §4.5 (base64 no JSON).
function fileToB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('falha ao ler o arquivo'));
    r.onload = () => {
      const s = String(r.result);
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.readAsDataURL(file);
  });
}
const MAX_REF_BYTES = 12 * 1024 * 1024; // §4.5: ~12MB de áudio bruto

// Erro da fábrica → mensagem clara (PORTAL_HANDOFF §5). A `message` já vem
// propagada do gateway; aqui damos contexto por status.
function friendlyError(e: ApiError): string {
  const m = (e.message || '').trim();
  switch (e.status) {
    case 401:
      return 'Falha de autenticação na fábrica (configuração do portal).';
    case 404:
      return `${m || 'Preset não encontrado'} — recarregue a página p/ atualizar o catálogo.`;
    case 409:
      return m || 'Uma geração já está em andamento (GPU serializada). Aguarde terminar.';
    case 422:
      return m || 'Dados inválidos no formulário.';
    case 502:
      return `Gerador indisponível agora (backend caído). ${m}`.trim();
    case 503:
      return /offline|deslig|túnel|tunel/i.test(m)
        ? m
        : `Serviço ocupado ou sem chave: ${m || 'tente em instantes'}.`;
    case 504:
      return 'Demorou demais; tente de novo.';
    default:
      return m || `Erro ${e.status}.`;
  }
}

// Deriva o modo do vocal a partir do req salvo (a fábrica não guarda isso).
function vocalModeOf(r: Record<string, unknown>): string {
  if (Array.isArray(r['speakers'])) return 'multi';
  if (r['ref_audio_b64']) return 'clone';
  if (r['instruct']) return 'design';
  return 'tts';
}

function InstructPicker({
  sel,
  onChange,
  vocab = INSTRUCT_VOCAB,
}: {
  sel: InstructSel;
  onChange: (s: InstructSel) => void;
  vocab?: Record<keyof InstructSel, string[]>;
}) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
      {SEL_KEYS.map((k) => (
        <label key={k} className="muted" style={{ fontSize: 12 }}>
          {SEL_LABEL[k]}
          <select
            className="input"
            style={{ display: 'block', minWidth: 130 }}
            value={sel[k]}
            onChange={(e) => onChange({ ...sel, [k]: e.target.value })}
          >
            <option value="">— qualquer —</option>
            {(vocab[k] ?? []).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

interface Speaker {
  tag: string;
  sel: InstructSel;
  refB64: string | null;
  refName: string | null;
}

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
  const [vmode, setVmode] = useState<VMode>('tts');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ url: string; promptEn: string | null } | null>(null);
  // override do vocabulário de instruct vindo do 422 estruturado (§4.5):
  // `validos` repovoa os dropdowns; `tokens_invalidos` marca o que a fábrica
  // recusou. Limpos ao trocar de modo.
  const [vocab, setVocab] = useState<Record<keyof InstructSel, string[]> | null>(null);
  const [badTok, setBadTok] = useState<string[]>([]);

  // form state (defaults do §4 / §4.5)
  const [sfxF, setSfxF] = useState({ prompt: '', lang: 'pt', duration: 5, steps: 150, seed: '' });
  const [bedF, setBedF] = useState({ prompt: '', name: '', audio_duration: 60, seed: '' });
  // vocal: campos comuns + por modo
  const [vtext, setVtext] = useState('');
  const [vlang, setVlang] = useState('pt');
  const [vspeed, setVspeed] = useState('1.0');
  const [vseed, setVseed] = useState('');
  const [vnumStep, setVnumStep] = useState('');
  const [vguid, setVguid] = useState('');
  const [vsel, setVsel] = useState<InstructSel>(EMPTY_SEL);
  const [vref, setVref] = useState<{ b64: string; name: string } | null>(null);
  const [vrefText, setVrefText] = useState('');
  const [vrefTextOn, setVrefTextOn] = useState(false);
  const [vspeakers, setVspeakers] = useState<Speaker[]>([
    { tag: 'Speaker_1', sel: EMPTY_SEL, refB64: null, refName: null },
    { tag: 'Speaker_2', sel: EMPTY_SEL, refB64: null, refName: null },
  ]);
  const [vpause, setVpause] = useState(0.3);

  // poll de status a cada 20s
  const rs = useRef(reloadStatus);
  rs.current = reloadStatus;
  useEffect(() => {
    const t = setInterval(() => rs.current(), 20000);
    return () => clearInterval(t);
  }, []);

  const offline = !status?.reachable || status?.state === 'offline';
  const locked = busy || !!status?.busy;

  async function onRefFile(
    file: File | undefined,
    set: (v: { b64: string; name: string } | null) => void,
  ): Promise<void> {
    if (!file) return set(null);
    if (file.size > MAX_REF_BYTES) {
      setErr(`Áudio de referência grande demais (${(file.size / 1048576).toFixed(1)}MB; máx 12MB). Use 3–15s.`);
      return;
    }
    try {
      set({ b64: await fileToB64(file), name: file.name });
      setErr('');
    } catch {
      setErr('Falha ao ler o áudio de referência.');
    }
  }

  function validate(): string | null {
    if (kind === 'sfx') {
      if (!sfxF.prompt.trim()) return 'Descreva o som (prompt).';
      if (sfxF.duration < 0.5 || sfxF.duration > 30) return 'Duração entre 0.5 e 30s.';
      if (sfxF.steps < 20 || sfxF.steps > 400) return 'Steps entre 20 e 400.';
      return null;
    }
    if (kind === 'bed') {
      if (!bedF.prompt.trim() && !bedF.name) return 'Informe um prompt OU um preset.';
      return null;
    }
    // vocal
    if (!vtext.trim()) return vmode === 'multi' ? 'Escreva o diálogo.' : 'Escreva o texto.';
    const sp = Number(vspeed);
    if (vspeed && (sp < 0.5 || sp > 2)) return 'Velocidade entre 0.5 e 2.0.';
    if (vnumStep && (Number(vnumStep) < 4 || Number(vnumStep) > 64)) return 'num_step entre 4 e 64.';
    if (vguid && (Number(vguid) < 0 || Number(vguid) > 10)) return 'guidance_scale entre 0 e 10.';
    if (vmode === 'clone' && !vref) return 'Envie um áudio de referência (3–15s) para o clone.';
    if (vmode === 'multi') {
      if (!vspeakers.length) return 'Adicione ao menos um speaker.';
      if (vspeakers.some((s) => !s.tag.trim())) return 'Todo speaker precisa de uma tag (ex.: Speaker_1).';
      if (!/\[Speaker_\d+\]\s*:/.test(vtext))
        return 'O diálogo precisa de marcações [Speaker_N]: (ex.: "[Speaker_1]: Olá").';
    }
    return null;
  }

  function vocalBody(): Record<string, unknown> {
    const adv: Record<string, unknown> = {};
    if (vspeed) adv['speed'] = Number(vspeed);
    if (vseed) adv['seed'] = Number(vseed);
    if (vnumStep) adv['num_step'] = Number(vnumStep);
    if (vguid) adv['guidance_scale'] = Number(vguid);
    const base = { text: vtext, language: vlang || null, ...adv };
    if (vmode === 'tts') return base;
    if (vmode === 'design') return { ...base, instruct: buildInstruct(vsel) || null };
    if (vmode === 'clone')
      return {
        ...base,
        ref_audio_b64: vref?.b64,
        ...(vrefTextOn && vrefText.trim() ? { ref_text: vrefText } : {}),
      };
    // multi
    return {
      text: vtext,
      language: vlang || null,
      pause_between_speakers: vpause,
      speakers: vspeakers.map((s) => ({
        tag: s.tag,
        ...(buildInstruct(s.sel) ? { instruct: buildInstruct(s.sel) } : {}),
        ...(s.refB64 ? { ref_audio_b64: s.refB64, ref_text: '' } : {}),
      })),
    };
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
      else body = vocalBody();
      const r = await api.sfxGenerate(kind, body);
      setResult({ url: r.url, promptEn: r.promptEn });
      setBadTok([]);
      reloadLib();
      reloadStatus();
    } catch (e) {
      if (e instanceof ApiError) {
        const ie = asInstructError(e.detail);
        if (ie) {
          setVocab(ie.validos);
          setBadTok(ie.tokens_invalidos);
          setErr(
            `Voz inválida: ${ie.tokens_invalidos.join(', ') || '—'}. ` +
              `Ajuste os campos (ex.: ${ie.exemplo}).`,
          );
        } else {
          setErr(friendlyError(e));
        }
      } else setErr('Falha na geração.');
    } finally {
      setBusy(false);
    }
  }

  const inp = { className: 'input', style: { width: '100%' } };
  const VMODES: Array<[VMode, string]> = [
    ['tts', 'TTS'],
    ['design', 'Voice Design'],
    ['clone', 'Voice Clone'],
    ['multi', 'Multi-Speaker'],
  ];

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

      <div className="grid split" style={{ gridTemplateColumns: '1.1fr 1fr', alignItems: 'start' }}>
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
              <details>
                <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>Avançado</summary>
                <div className="row" style={{ marginTop: 8 }}>
                  <label className="muted">steps <input className="input" type="number" min={20} max={400}
                    value={sfxF.steps} onChange={(e) => setSfxF({ ...sfxF, steps: Number(e.target.value) })} style={{ width: 90 }} /></label>
                  <label className="muted">seed <input className="input" placeholder="opcional"
                    value={sfxF.seed} onChange={(e) => setSfxF({ ...sfxF, seed: e.target.value })} style={{ width: 110 }} /></label>
                </div>
              </details>
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
              <div className="seg">
                {VMODES.map(([m, label]) => (
                  <button key={m} className={vmode === m ? 'on' : ''}
                    onClick={() => { setVmode(m); setErr(''); setBadTok([]); setVocab(null); }}>{label}</button>
                ))}
              </div>

              <textarea {...inp} rows={vmode === 'multi' ? 5 : 3}
                placeholder={vmode === 'multi'
                  ? '[Speaker_1]: Bom dia!\n[Speaker_2]: Olá, tudo bem?\n[Speaker_1]: Tudo ótimo.'
                  : 'texto da narração (aceita tags [laughter] [sigh] [sniff])'}
                value={vtext} onChange={(e) => setVtext(e.target.value)} />

              {vmode === 'design' && (
                <div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    voz (deixe “— qualquer —” p/ usar o padrão da fábrica)
                  </div>
                  <InstructPicker sel={vsel} onChange={setVsel} vocab={vocab ?? INSTRUCT_VOCAB} />
                  {badTok.length > 0 && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      recusado pela fábrica: <b>{badTok.join(', ')}</b> — dropdowns
                      atualizados com os valores aceitos.
                    </div>
                  )}
                </div>
              )}

              {vmode === 'clone' && (
                <div className="grid" style={{ gap: 8 }}>
                  <label className="muted" style={{ fontSize: 12 }}>
                    áudio de referência (3–15s; mp3/wav/m4a/ogg)
                    <input className="input" type="file" accept="audio/*" style={{ display: 'block' }}
                      onChange={(e) => onRefFile(e.target.files?.[0], setVref)} />
                  </label>
                  {vref && <div className="muted" style={{ fontSize: 12 }}>✓ {vref.name}</div>}
                  <label className="muted" style={{ fontSize: 12 }}>
                    <input type="checkbox" checked={vrefTextOn}
                      onChange={(e) => setVrefTextOn(e.target.checked)} />{' '}
                    tenho a transcrição EXATA do áudio (em branco = automático/ASR, recomendado)
                  </label>
                  {vrefTextOn && (
                    <input className="input" placeholder="transcrição exata do áudio de referência"
                      value={vrefText} onChange={(e) => setVrefText(e.target.value)} />
                  )}
                </div>
              )}

              {vmode === 'multi' && (
                <div className="grid" style={{ gap: 10 }}>
                  {vspeakers.map((s, i) => (
                    <div key={i} className="card pad" style={{ padding: 10 }}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <input className="input" style={{ width: 140 }} placeholder="Speaker_1"
                          value={s.tag}
                          onChange={(e) => setVspeakers(vspeakers.map((x, j) => j === i ? { ...x, tag: e.target.value } : x))} />
                        <button className="btn" type="button"
                          onClick={() => setVspeakers(vspeakers.filter((_, j) => j !== i))}>remover</button>
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <InstructPicker sel={s.sel}
                          onChange={(sel) => setVspeakers(vspeakers.map((x, j) => j === i ? { ...x, sel } : x))} />
                      </div>
                      <label className="muted" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                        voz de referência (opcional — clona este speaker)
                        <input className="input" type="file" accept="audio/*" style={{ display: 'block' }}
                          onChange={(e) => onRefFile(e.target.files?.[0], (v) =>
                            setVspeakers(vspeakers.map((x, j) => j === i
                              ? { ...x, refB64: v?.b64 ?? null, refName: v?.name ?? null } : x)))} />
                      </label>
                      {s.refName && <div className="muted" style={{ fontSize: 12 }}>✓ {s.refName}</div>}
                    </div>
                  ))}
                  <div className="row">
                    <button className="btn" type="button"
                      onClick={() => setVspeakers([...vspeakers,
                        { tag: `Speaker_${vspeakers.length + 1}`, sel: EMPTY_SEL, refB64: null, refName: null }])}>
                      + speaker
                    </button>
                    <label className="muted">pausa entre falas {vpause}s
                      <input type="range" min={0} max={5} step={0.1} value={vpause}
                        onChange={(e) => setVpause(Number(e.target.value))} /></label>
                  </div>
                </div>
              )}

              <div className="row">
                <label className="muted" style={{ width: 110 }}>idioma
                  <input className="input" style={{ width: '100%' }} value={vlang}
                    onChange={(e) => setVlang(e.target.value)} placeholder="pt" /></label>
                <label className="muted" style={{ width: 120 }}>velocidade
                  <input className="input" style={{ width: '100%' }} type="number" min={0.5} max={2} step={0.05}
                    value={vspeed} onChange={(e) => setVspeed(e.target.value)} /></label>
              </div>

              {(vmode === 'tts' || vmode === 'design') && (
                <details>
                  <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>Avançado (difusão)</summary>
                  <div className="row" style={{ marginTop: 8 }}>
                    <label className="muted">seed <input className="input" placeholder="opcional"
                      value={vseed} onChange={(e) => setVseed(e.target.value)} style={{ width: 100 }} /></label>
                    <label className="muted">num_step <input className="input" type="number" min={4} max={64}
                      placeholder="32" value={vnumStep} onChange={(e) => setVnumStep(e.target.value)} style={{ width: 90 }} /></label>
                    <label className="muted">guidance <input className="input" type="number" min={0} max={10} step={0.5}
                      placeholder="2.0" value={vguid} onChange={(e) => setVguid(e.target.value)} style={{ width: 90 }} /></label>
                  </div>
                </details>
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
            <div style={{ marginTop: 14 }}>
              <audio controls src={result.url} style={{ width: '100%' }} />
              <div className="row" style={{ marginTop: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                <a className="btn" href={result.url} download={`${kind}.mp3`}>baixar</a>
                <span className="muted" style={{ fontSize: 12 }}>salvo na Biblioteca →</span>
              </div>
              {result.promptEn && (
                <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                  gerado a partir de (EN): <i>{result.promptEn}</i>
                </div>
              )}
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
                  const tipo = m.kind === 'vocal' ? `vocal · ${vocalModeOf(r)}` : m.kind;
                  return (
                    <tr key={m.id}>
                      <td className="muted">{fmtDate(new Date(m.ts).toISOString())}</td>
                      <td>{tipo}</td>
                      <td className="muted" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</td>
                      <td>
                        <audio controls preload="none" src={api.sfxAudioUrl(m.id)} style={{ width: 170, height: 32, verticalAlign: 'middle' }} />
                        <a className="muted" href={api.sfxAudioUrl(m.id)} download={`${m.id}.mp3`} style={{ fontSize: 11, marginLeft: 6 }}>baixar</a>
                      </td>
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
