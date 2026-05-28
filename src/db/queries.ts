import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.js';
import { getMeta } from './db.js';
import { config } from '../config.js';
import { readOpenclawAgents } from '../adapters/openclawAgents.js';
import type { OpenclawAgent } from '../adapters/openclawAgents.js';

// Queries do read-model → shapes prontos pro frontend. Tudo read-only.

function degradedNotes(db: Db): string[] {
  try {
    return JSON.parse(getMeta(db, 'degraded') ?? '[]') as string[];
  } catch {
    return [];
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function overview(db: Db) {
  const total = (db.prepare('SELECT COUNT(*) c FROM episodes').get() as { c: number }).c;
  const published = (
    db.prepare("SELECT COUNT(*) c FROM episodes WHERE state='PUBLISHED'").get() as { c: number }
  ).c;
  const escalated = (
    db.prepare('SELECT COUNT(*) c FROM episodes WHERE escalated=1').get() as { c: number }
  ).c;
  const inPipeline = (
    db
      .prepare("SELECT COUNT(*) c FROM episodes WHERE state IS NOT NULL AND state!='PUBLISHED'")
      .get() as { c: number }
  ).c;
  const costRow = db
    .prepare('SELECT COALESCE(SUM(tts_cost_usd),0) s FROM cost_estimates')
    .get() as { s: number };
  const recentHandoffs = db
    .prepare(
      `SELECT episode_id, at, from_agent, to_agent, to_state, note
       FROM handoffs ORDER BY at DESC LIMIT 12`,
    )
    .all();
  const byState = db
    .prepare("SELECT COALESCE(state,'(sem estado)') state, COUNT(*) c FROM episodes GROUP BY state")
    .all();
  return {
    kpis: {
      totalEpisodes: total,
      inPipeline,
      published,
      escalated,
      monthlyEstimateUsd: Math.round(costRow.s * 100) / 100,
      monthlyBudgetUsd: config.cost.monthlyBudgetUsd,
      overBudget: costRow.s > config.cost.monthlyBudgetUsd,
    },
    byState,
    recentHandoffs,
    lastSync: getMeta(db, 'last_sync'),
    degraded: degradedNotes(db),
  };
}

export function pipeline(db: Db) {
  const rows = db
    .prepare(
      `SELECT e.episode_id, e.title, e.channel, e.state, e.escalated, e.updated_at,
              e.attempts_json,
              (SELECT status FROM render_runs r WHERE r.episode=e.episode_id
                 ORDER BY r.created_at DESC LIMIT 1) AS last_run_status,
              (SELECT conclusion FROM render_runs r WHERE r.episode=e.episode_id
                 ORDER BY r.created_at DESC LIMIT 1) AS last_run_conclusion
       FROM episodes e ORDER BY e.updated_at DESC NULLS LAST, e.episode_id`,
    )
    .all();
  return { episodes: rows, degraded: degradedNotes(db) };
}

export function episodeDetail(db: Db, id: string) {
  const ep = db.prepare('SELECT * FROM episodes WHERE episode_id=?').get(id);
  if (!ep) return null;
  return {
    episode: ep,
    blocks: db
      .prepare('SELECT * FROM script_blocks WHERE episode_id=? ORDER BY ord').all(id),
    assets: db.prepare('SELECT * FROM assets WHERE episode_id=?').all(id),
    history: db
      .prepare('SELECT * FROM state_history WHERE episode_id=? ORDER BY seq').all(id),
    handoffs: db.prepare('SELECT * FROM handoffs WHERE episode_id=? ORDER BY seq').all(id),
    escalations: db.prepare('SELECT * FROM escalations WHERE episode_id=?').all(id),
    costSignal: db.prepare('SELECT * FROM cost_signals WHERE episode_id=?').get(id) ?? null,
    costEstimate: db.prepare('SELECT * FROM cost_estimates WHERE episode_id=?').get(id) ?? null,
    runs: db
      .prepare('SELECT * FROM render_runs WHERE episode=? ORDER BY created_at DESC').all(id),
    artifacts: db
      .prepare(
        'SELECT * FROM artifacts WHERE episode=? ORDER BY downloaded_at DESC NULLS LAST',
      )
      .all(id),
  };
}

export function costSummary(db: Db) {
  const estimates = db
    .prepare(
      `SELECT ce.episode_id, e.title, ce.tts_chars, ce.tts_cost_usd,
              cs.projected_usd, cs.budget_usd
       FROM cost_estimates ce
       LEFT JOIN episodes e ON e.episode_id=ce.episode_id
       LEFT JOIN cost_signals cs ON cs.episode_id=ce.episode_id
       ORDER BY ce.tts_cost_usd DESC`,
    )
    .all();
  // Tokens/custo reais do OpenClaw (agent_usage, via exporter).
  const byAgent = db
    .prepare(
      `SELECT agent_id agent, model, SUM(sessions) sessions,
              SUM(total_tokens) tokens, SUM(cost_usd) cost_usd
       FROM agent_usage GROUP BY agent_id, model ORDER BY tokens DESC`,
    )
    .all();
  const totalEst = (
    db.prepare('SELECT COALESCE(SUM(tts_cost_usd),0) s FROM cost_estimates').get() as {
      s: number;
    }
  ).s;
  const totalUsage = (
    db.prepare('SELECT COALESCE(SUM(cost_usd),0) s FROM agent_usage').get() as { s: number }
  ).s;
  const totalTokens = (
    db.prepare('SELECT COALESCE(SUM(total_tokens),0) s FROM agent_usage').get() as { s: number }
  ).s;
  // Por squad: agrega byAgent via org.json (agente→squad). #4
  const org = orgManifest() as {
    squads?: Array<{ name?: string; agents?: Array<{ id: string }> }>;
  };
  const agentSquad = new Map<string, string>();
  for (const sqd of org.squads ?? []) {
    for (const a of sqd.agents ?? []) agentSquad.set(a.id, sqd.name ?? 'Squad');
  }
  const sacc = new Map<string, { squad: string; agents: Set<string>; tokens: number; cost: number }>();
  for (const a of byAgent as Array<{ agent: string; tokens: number; cost_usd: number }>) {
    const name = agentSquad.get(a.agent) ?? 'Outros';
    const cur = sacc.get(name) ?? { squad: name, agents: new Set<string>(), tokens: 0, cost: 0 };
    cur.agents.add(a.agent);
    cur.tokens += a.tokens ?? 0;
    cur.cost += a.cost_usd ?? 0;
    sacc.set(name, cur);
  }
  const bySquad = [...sacc.values()]
    .map((s) => ({ squad: s.squad, agents: s.agents.size, tokens: s.tokens, cost_usd: round2(s.cost) }))
    .sort((a, b) => b.tokens - a.tokens);

  // Timeline de custo dos crons. cron_runs tem at_ms; agent_usage NÃO tem
  // tempo (agregado) — por isso a timeline cobre só os crons. Custo in/out
  // via config (mesmos preços do agent_usage).
  const p = config.openclaw;
  const cr = db
    .prepare('SELECT at_ms, in_tokens, out_tokens, model FROM cron_runs')
    .all() as Array<{ at_ms: number; in_tokens: number; out_tokens: number; model: string }>;
  const day = new Map<string, { d: string; runs: number; tokens: number; cost: number }>();
  const mon = new Map<string, { m: string; runs: number; tokens: number; cost: number }>();
  for (const r of cr) {
    if (!r.at_ms) continue;
    const iso = new Date(r.at_ms).toISOString();
    const d = iso.slice(0, 10);
    const m = iso.slice(0, 7);
    const flash = /flash/i.test(r.model ?? '');
    const cost =
      ((r.in_tokens ?? 0) / 1e6) * (flash ? p.priceFlashIn : p.priceProIn) +
      ((r.out_tokens ?? 0) / 1e6) * (flash ? p.priceFlashOut : p.priceProOut);
    const tok = (r.in_tokens ?? 0) + (r.out_tokens ?? 0);
    const dd = day.get(d) ?? { d, runs: 0, tokens: 0, cost: 0 };
    dd.runs += 1; dd.tokens += tok; dd.cost += cost; day.set(d, dd);
    const mm = mon.get(m) ?? { m, runs: 0, tokens: 0, cost: 0 };
    mm.runs += 1; mm.tokens += tok; mm.cost += cost; mon.set(m, mm);
  }
  const byDay = [...day.values()]
    .sort((a, b) => (a.d < b.d ? 1 : -1))
    .slice(0, 30)
    .map((x) => ({ ...x, cost: round2(x.cost) }));
  const byMonth = [...mon.values()]
    .sort((a, b) => (a.m < b.m ? 1 : -1))
    .map((x) => ({ ...x, cost: round2(x.cost) }));

  return {
    estimates,
    byAgent,
    bySquad,
    cronTimeline: { byDay, byMonth },
    totals: {
      ttsEstimateUsd: round2(totalEst),
      openclawUsd: round2(totalUsage),
      openclawTokens: totalTokens,
      monthlyBudgetUsd: config.cost.monthlyBudgetUsd,
      overBudget: totalEst + totalUsage > config.cost.monthlyBudgetUsd,
    },
    degraded: degradedNotes(db),
  };
}

export function comunicacao(db: Db) {
  const jobs = db
    .prepare(
      `SELECT id, agent_id, name, description, enabled, schedule_expr, tz, status,
              last_run_at, last_status, last_duration, next_run_at, consec_errors
       FROM cron_jobs ORDER BY enabled DESC, name`,
    )
    .all();
  const runs = db
    .prepare(
      `SELECT job_id, agent_id, at_ms, status, summary, duration_ms, model,
              total_tokens
       FROM cron_runs ORDER BY at_ms DESC LIMIT 60`,
    )
    .all();
  return {
    jobs,
    runs,
    exportedAt: getMeta(db, 'openclaw_exported_at'),
    degraded: degradedNotes(db),
  };
}

export function assetsList(db: Db) {
  const rows = db
    .prepare(
      `SELECT episode_id, kind, rel_path, bytes, mtime FROM assets
       ORDER BY episode_id, kind, rel_path`,
    )
    .all();
  return { assets: rows, degraded: degradedNotes(db) };
}

// Esteira visual: o fluxo n8n vem do org.json — TODOS os squads (Comunicação
// + Canal MSU), com as arestas de handoff em `handsOffTo` (gerador). Cada
// episódio é posicionado pelo ÚLTIMO `by_agent` do state_history (dado real,
// sem inferir estado→fase).
export function esteira(db: Db) {
  const org = orgManifest() as {
    pipeline?: string[];
    squads?: Array<{
      id?: string;
      name?: string;
      agents?: Array<{
        id: string;
        name?: string;
        emoji?: string;
        role?: string;
        lead?: boolean;
        handsOffTo?: string[];
      }>;
    }>;
  };
  const pipeline = Array.isArray(org.pipeline) ? org.pipeline : [];
  const agents = (org.squads ?? []).flatMap((sq) =>
    (sq.agents ?? []).map((a) => ({
      id: a.id,
      name: a.name ?? a.id,
      emoji: a.emoji ?? '•',
      role: a.role ?? '',
      squadId: sq.id ?? '',
      squadName: sq.name ?? '',
      lead: !!a.lead,
      handsOffTo: Array.isArray(a.handsOffTo) ? a.handsOffTo : [],
    })),
  );
  const episodes = db
    .prepare(
      `SELECT e.episode_id, e.title, e.state, e.escalated,
              (SELECT by_agent FROM state_history sh WHERE sh.episode_id=e.episode_id
                 ORDER BY sh.seq DESC LIMIT 1) AS last_agent,
              (SELECT at FROM state_history sh WHERE sh.episode_id=e.episode_id
                 ORDER BY sh.seq DESC LIMIT 1) AS last_at
       FROM episodes e
       ORDER BY e.updated_at DESC NULLS LAST, e.episode_id`,
    )
    .all();
  return { pipeline, agents, episodes, degraded: degradedNotes(db) };
}

// ───────────── Organograma ─────────────
// Estratégia: roster VIVO do OpenClaw (agents.json do exporter) — quando
// disponível, vira a fonte da verdade. Mescla com org.json estático pra
// preservar metadados que o OpenClaw não tem (pipeline canônico do MSU,
// handsOffTo explícitos, project name). Sem agents.json → fallback puro
// pro org.json estático (zero regressão durante migração).

interface StaticAgent {
  id: string;
  branch?: string;
  emoji?: string;
  name?: string;
  role?: string;
  model?: string;
  lead?: boolean;
  handsOffTo?: string[];
}
interface StaticSquad { id: string; name: string; agents?: StaticAgent[] }
interface StaticManifest {
  schemaVersion?: number;
  generatedAt?: string;
  project?: string;
  ceo?: StaticAgent;
  pipeline?: string[];
  states?: string[];
  squads?: StaticSquad[];
}

// Squads conhecidas — id, label e regra de detecção pelo sufixo do id do
// agente. Ordem do array = ordem de exibição. Agente que não cai em
// nenhuma squad conhecida vai pra "outros" (silenciosamente).
const SQUAD_DEFS: Array<{ id: string; name: string; match: (id: string) => boolean }> = [
  { id: 'conteudo',  name: 'Conteúdo · Mensageria',     match: (id) => id.endsWith('-com') },
  { id: 'canal_msu', name: 'Canal MSU · Vídeo',         match: (id) => id.endsWith('-msu') },
  { id: 'dev',       name: 'Desenvolvimento · Produto', match: (id) => id.endsWith('-dev') },
];
const SQUAD_OUTROS = { id: 'outros', name: 'Outros' };

function squadOf(agentId: string): { id: string; name: string } {
  for (const s of SQUAD_DEFS) if (s.match(agentId)) return { id: s.id, name: s.name };
  return SQUAD_OUTROS;
}

// "⚡ (raio — assinatura oficial)" → "⚡"; null/'' → '•'.
function cleanEmoji(raw: string | null): string {
  const head = (raw ?? '').split(/[\s(]/)[0]?.trim();
  return head || '•';
}

function readStaticManifest(): StaticManifest | null {
  try {
    return JSON.parse(readFileSync(config.org.manifestPath, 'utf8')) as StaticManifest;
  } catch {
    return null;
  }
}

// Constrói o manifest a partir do roster VIVO (agents.json) + metadados
// herdados do static (pipeline, handsOffTo, role bonito quando existir).
function buildLiveManifest(
  live: OpenclawAgent[],
  staticM: StaticManifest | null,
): StaticManifest & { source: 'openclaw-live' } {
  // Lookup do static por id pra herdar role/handsOffTo/lead/branch quando
  // o agente já é conhecido lá.
  const staticById = new Map<string, StaticAgent>();
  for (const sq of staticM?.squads ?? []) {
    for (const a of sq.agents ?? []) staticById.set(a.id, a);
  }
  if (staticM?.ceo) staticById.set(staticM.ceo.id, staticM.ceo);

  const toAgent = (a: OpenclawAgent): StaticAgent => {
    const fromStatic = staticById.get(a.id) ?? {} as StaticAgent;
    return {
      id: a.id,
      branch: fromStatic.branch ?? a.id,
      emoji: cleanEmoji(a.identityEmoji) !== '•' ? cleanEmoji(a.identityEmoji) : (fromStatic.emoji ?? '•'),
      name: a.identityName ?? fromStatic.name ?? a.name ?? a.id,
      role: fromStatic.role ?? a.identityName ?? a.id,
      model: a.model ?? fromStatic.model ?? '',
      // Heurística simples: id começa com `gerente-` ou tem bindings>0.
      // Static `lead` explícito vence se já estiver definido.
      lead: fromStatic.lead ?? (a.id.startsWith('gerente-') || a.bindings > 0),
      handsOffTo: fromStatic.handsOffTo ?? [],
    };
  };

  // Separa CEO (isDefault ou id === 'main') do resto.
  const ceoLive = live.find((a) => a.isDefault) ?? live.find((a) => a.id === 'main');
  const ceo: StaticAgent | undefined = ceoLive
    ? toAgent(ceoLive)
    : staticM?.ceo;

  // Agrupa o restante por squad (ordem fixa do SQUAD_DEFS, depois 'outros').
  const buckets = new Map<string, { id: string; name: string; agents: StaticAgent[] }>();
  for (const sq of [...SQUAD_DEFS, SQUAD_OUTROS]) {
    buckets.set(sq.id, { id: sq.id, name: sq.name, agents: [] });
  }
  for (const a of live) {
    if (a === ceoLive) continue; // CEO sai do grupo
    const sq = squadOf(a.id);
    buckets.get(sq.id)!.agents.push(toAgent(a));
  }
  // Só exibe squads que têm agente.
  const squads = [...buckets.values()].filter((s) => s.agents.length > 0);

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    project: staticM?.project ?? 'Pipeline',
    ceo,
    pipeline: staticM?.pipeline ?? [], // ordem canônica do MSU vem do static
    states: staticM?.states ?? [],
    squads,
    source: 'openclaw-live',
  };
}

export function orgManifest(): unknown {
  // 1) Tenta roster VIVO do OpenClaw (exporter).
  const liveSnap = readOpenclawAgents(config.openclaw.exportDir);
  const staticM = readStaticManifest();
  if (liveSnap) {
    return buildLiveManifest(liveSnap.agents, staticM);
  }
  // 2) Fallback: org.json estático (versionado).
  if (staticM) return staticM;
  // 3) Nada — degrada com aviso.
  return {
    schemaVersion: 1,
    squads: [],
    degraded: ['org.json ausente e agents.json não encontrado'],
  };
}
