import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.js';
import { getMeta } from './db.js';
import { config } from '../config.js';

// Queries do read-model → shapes prontos pro frontend. Tudo read-only.

function degradedNotes(db: Db): string[] {
  try {
    return JSON.parse(getMeta(db, 'degraded') ?? '[]') as string[];
  } catch {
    return [];
  }
}

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
  return {
    estimates,
    byAgent,
    totals: {
      ttsEstimateUsd: Math.round(totalEst * 100) / 100,
      openclawUsd: Math.round(totalUsage * 100) / 100,
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

// Esteira visual: o fluxo de fases vem do org.json (`pipeline` = agentes na
// ordem do handoff); cada episódio é posicionado pelo ÚLTIMO `by_agent` do
// state_history (dado real, sem inferir estado→fase).
export function esteira(db: Db) {
  const org = orgManifest() as {
    pipeline?: string[];
    squads?: Array<{
      agents?: Array<{ id: string; name?: string; emoji?: string; role?: string }>;
    }>;
  };
  const pipeline = Array.isArray(org.pipeline) ? org.pipeline : [];
  const byId = new Map<string, { id: string; name: string; emoji: string; role: string }>();
  for (const sq of org.squads ?? []) {
    for (const a of sq.agents ?? []) {
      byId.set(a.id, {
        id: a.id,
        name: a.name ?? a.id,
        emoji: a.emoji ?? '•',
        role: a.role ?? '',
      });
    }
  }
  const agents = pipeline.map(
    (id) => byId.get(id) ?? { id, name: id, emoji: '•', role: '' },
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

export function orgManifest(): unknown {
  // org.json roster-driven, versionado na raiz deste repo (standalone).
  try {
    return JSON.parse(readFileSync(config.org.manifestPath, 'utf8'));
  } catch {
    return { schemaVersion: 1, squads: [], degraded: ['org.json ausente — rode scripts/generate_org_manifest.js'] };
  }
}
