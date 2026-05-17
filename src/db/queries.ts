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
  const byAgent = db
    .prepare(
      `SELECT agent, source, SUM(tokens) tokens, SUM(cost_usd) cost_usd, period
       FROM token_usage GROUP BY agent, period ORDER BY cost_usd DESC`,
    )
    .all();
  const totalEst = (
    db.prepare('SELECT COALESCE(SUM(tts_cost_usd),0) s FROM cost_estimates').get() as {
      s: number;
    }
  ).s;
  const totalUsage = (
    db.prepare('SELECT COALESCE(SUM(cost_usd),0) s FROM token_usage').get() as { s: number }
  ).s;
  return {
    estimates,
    byAgent,
    totals: {
      ttsEstimateUsd: Math.round(totalEst * 100) / 100,
      openclawUsd: Math.round(totalUsage * 100) / 100,
      monthlyBudgetUsd: config.cost.monthlyBudgetUsd,
      overBudget: totalEst + totalUsage > config.cost.monthlyBudgetUsd,
    },
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

export function orgManifest(): unknown {
  // org.json é versionado (gerado por scripts/generate_org_manifest.js).
  try {
    const p = join(config.storage.repoDir, 'openclaw_workspaces', 'org.json');
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { schemaVersion: 1, squads: [], degraded: ['org.json ausente — rode generate_org_manifest.js'] };
  }
}
