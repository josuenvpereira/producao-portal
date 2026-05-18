import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';
import { openDb, setMeta, type Db } from './db/db.js';
import { readRepoSnapshot } from './adapters/repoFs.js';
import { fetchRenderData } from './adapters/githubActions.js';
import { readOpenClawSnapshot } from './adapters/openclawExport.js';
import { deriveCosts } from './adapters/costDerive.js';
import { listLibrary } from './sfx/library.js';
import type { EpisodeProjection } from './adapters/types.js';

// Indexer: projeta GitHub (repo+Actions) e OpenClaw → read-model SQLite.
// Idempotente (upsert). Cada fonte degrada sozinha sem derrubar as outras.

const log = logger.child({ mod: 'indexer' });

function hash(o: unknown): string {
  return createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);
}

function upsertEpisode(db: Db, ep: EpisodeProjection): void {
  db.prepare(
    `INSERT INTO episodes
       (episode_id, channel, title, state, escalated, created_at, updated_at, attempts_json, content_hash, indexed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(episode_id) DO UPDATE SET
       channel=excluded.channel, title=excluded.title, state=excluded.state,
       escalated=excluded.escalated, created_at=excluded.created_at,
       updated_at=excluded.updated_at, attempts_json=excluded.attempts_json,
       content_hash=excluded.content_hash, indexed_at=excluded.indexed_at`,
  ).run(
    ep.episodeId,
    ep.channel,
    ep.title,
    ep.state?.state ?? null,
    ep.state?.escalated ? 1 : 0,
    ep.state?.createdAt ?? null,
    ep.state?.updatedAt ?? null,
    ep.state ? JSON.stringify(ep.state.attempts) : null,
    hash(ep),
    new Date().toISOString(),
  );
}

function upsertHistoryAndHandoffs(db: Db, ep: EpisodeProjection): void {
  const hist = ep.state?.history ?? [];
  const insHist = db.prepare(
    `INSERT INTO state_history (episode_id, seq, at, from_state, to_state, by_agent, note)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(episode_id, seq) DO UPDATE SET
       at=excluded.at, from_state=excluded.from_state, to_state=excluded.to_state,
       by_agent=excluded.by_agent, note=excluded.note`,
  );
  const insHand = db.prepare(
    `INSERT INTO handoffs (episode_id, seq, at, from_agent, to_agent, to_state, note)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(episode_id, seq) DO UPDATE SET
       at=excluded.at, from_agent=excluded.from_agent, to_agent=excluded.to_agent,
       to_state=excluded.to_state, note=excluded.note`,
  );
  let prevBy: string | null = null;
  hist.forEach((h, seq) => {
    insHist.run(ep.episodeId, seq, h.at, h.from, h.to, h.by, h.note);
    if (prevBy !== null && prevBy !== h.by) {
      insHand.run(ep.episodeId, seq, h.at, prevBy, h.by, h.to, h.note);
    }
    prevBy = h.by;
  });
}

function upsertEscalations(db: Db, ep: EpisodeProjection): void {
  const ins = db.prepare(
    `INSERT INTO escalations (episode_id, at, stage, attempts, reason, from_state)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(episode_id, at) DO UPDATE SET
       stage=excluded.stage, attempts=excluded.attempts, reason=excluded.reason,
       from_state=excluded.from_state`,
  );
  for (const e of ep.state?.escalations ?? []) {
    ins.run(ep.episodeId, e.at, e.stage, e.attempts, e.reason, e.fromState);
  }
}

function upsertCostSignal(db: Db, ep: EpisodeProjection): void {
  if (!ep.costApproval) return;
  const s = ep.costApproval;
  db.prepare(
    `INSERT INTO cost_signals (episode_id, at, type, projected_usd, budget_usd, chars, scenes, files_json)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(episode_id) DO UPDATE SET
       at=excluded.at, type=excluded.type, projected_usd=excluded.projected_usd,
       budget_usd=excluded.budget_usd, chars=excluded.chars, scenes=excluded.scenes,
       files_json=excluded.files_json`,
  ).run(ep.episodeId, s.at, s.type, s.projectedCostUsd, s.budgetUsd, s.chars, s.scenes, JSON.stringify(s.files));
}

function upsertBlocksAndAssets(db: Db, ep: EpisodeProjection): void {
  const insB = db.prepare(
    `INSERT INTO script_blocks (episode_id, block_id, ord, kind, audio_file, duration_frames, spoken_chars, images_json)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(episode_id, block_id) DO UPDATE SET
       ord=excluded.ord, kind=excluded.kind, audio_file=excluded.audio_file,
       duration_frames=excluded.duration_frames, spoken_chars=excluded.spoken_chars,
       images_json=excluded.images_json`,
  );
  for (const b of ep.blocks) {
    insB.run(ep.episodeId, b.blockId, b.ord, b.kind, b.audioFile, b.durationFrames, b.spokenChars, JSON.stringify(b.images));
  }
  const insA = db.prepare(
    `INSERT INTO assets (episode_id, kind, rel_path, bytes, mtime)
     VALUES (?,?,?,?,?)
     ON CONFLICT(rel_path) DO UPDATE SET
       episode_id=excluded.episode_id, kind=excluded.kind, bytes=excluded.bytes, mtime=excluded.mtime`,
  );
  for (const a of ep.assets) insA.run(ep.episodeId, a.kind, a.relPath, a.bytes, a.mtime);
}

export interface IndexResult {
  episodes: number;
  runs: number;
  artifacts: number;
  crons: number;
  cronRuns: number;
  agentUsage: number;
  degraded: string[];
}

let inFlight: Promise<IndexResult> | null = null;

// Serializa execuções concorrentes (webhook debounced + CLI): duas indexações
// simultâneas fariam o `DELETE FROM cron_*` + re-INSERT concorrer, deixando a
// tabela momentaneamente vazia. Chamadas durante uma execução em curso
// recebem o resultado dela.
export function runIndexer(): Promise<IndexResult> {
  if (inFlight) return inFlight;
  inFlight = doIndex().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doIndex(): Promise<IndexResult> {
  const db = openDb(config.storage.dbPath);
  const degraded: string[] = [];

  const repo = readRepoSnapshot(config.storage.repoDir);
  if (repo.degraded) degraded.push(...repo.notes);

  db.exec('BEGIN');
  try {
    for (const ep of repo.data.episodes) {
      upsertEpisode(db, ep);
      upsertHistoryAndHandoffs(db, ep);
      upsertEscalations(db, ep);
      upsertCostSignal(db, ep);
      upsertBlocksAndAssets(db, ep);
    }
    // assets compartilhados (brand) — sem episódio.
    const insA = db.prepare(
      `INSERT INTO assets (episode_id, kind, rel_path, bytes, mtime) VALUES ('__shared__',?,?,?,?)
       ON CONFLICT(rel_path) DO UPDATE SET kind=excluded.kind, bytes=excluded.bytes, mtime=excluded.mtime`,
    );
    for (const a of repo.data.sharedAssets) insA.run(a.kind, a.relPath, a.bytes, a.mtime);

    const costs = deriveCosts(repo.data.episodes, config.cost.monthlyBudgetUsd);
    const insC = db.prepare(
      `INSERT INTO cost_estimates (episode_id, tts_chars, tts_cost_usd, computed_at)
       VALUES (?,?,?,?)
       ON CONFLICT(episode_id) DO UPDATE SET
         tts_chars=excluded.tts_chars, tts_cost_usd=excluded.tts_cost_usd, computed_at=excluded.computed_at`,
    );
    const now = new Date().toISOString();
    for (const c of costs.episodes) insC.run(c.episodeId, c.ttsChars, c.ttsCostUsd, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // SFX exportados → assets. Read-model reconstruível: a verdade são os
  // <id>.json da biblioteca; só os `exported` entram na aba Assets.
  db.exec('BEGIN');
  try {
    db.exec("DELETE FROM assets WHERE rel_path LIKE 'sfx-library/%'");
    const insSfx = db.prepare(
      `INSERT INTO assets (episode_id, kind, rel_path, bytes, mtime) VALUES ('__sfx__',?,?,?,?)
       ON CONFLICT(rel_path) DO UPDATE SET kind=excluded.kind, bytes=excluded.bytes, mtime=excluded.mtime`,
    );
    for (const m of listLibrary()) {
      if (!m.exported) continue;
      insSfx.run(m.kind, `sfx-library/${m.id}.mp3`, m.bytes, new Date(m.ts).toISOString());
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // GitHub Actions (runs + artifacts + vault) — degrada sozinho.
  const gh = await fetchRenderData({
    repo: config.github.repo,
    token: config.github.token,
    vaultDir: config.storage.vaultDir,
  });
  if (gh.degraded) degraded.push(...gh.notes);
  db.exec('BEGIN');
  try {
    const insR = db.prepare(
      `INSERT INTO render_runs (run_id, episode, channel, status, conclusion, approve_paid_apis, event, created_at, updated_at, html_url, head_sha, jobs_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(run_id) DO UPDATE SET
         episode=excluded.episode, status=excluded.status, conclusion=excluded.conclusion,
         approve_paid_apis=excluded.approve_paid_apis, updated_at=excluded.updated_at,
         jobs_json=excluded.jobs_json`,
    );
    for (const r of gh.data.runs) {
      insR.run(r.runId, r.episode, r.channel, r.status, r.conclusion, r.approvePaidApis ? 1 : 0, r.event, r.createdAt, r.updatedAt, r.htmlUrl, r.headSha, JSON.stringify(r.jobs));
    }
    const insArt = db.prepare(
      `INSERT INTO artifacts (id, run_id, episode, name, kind, size_bytes, expires_at, expired, vault_path, downloaded_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         expired=excluded.expired, vault_path=excluded.vault_path, downloaded_at=excluded.downloaded_at`,
    );
    for (const a of gh.data.artifacts) {
      const vault = a.kind === 'mp4' && !a.expired ? `${a.name}.zip` : null;
      insArt.run(a.id, a.runId, a.episode, a.name, a.kind, a.sizeBytes, a.expiresAt, a.expired ? 1 : 0, vault, vault ? new Date().toISOString() : null);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // OpenClaw snapshot (crons + esteira Comunicação + custo por agente)
  const oc = readOpenClawSnapshot(config.openclaw.exportDir, {
    pro: config.openclaw.priceProPer1M,
    flash: config.openclaw.priceFlashPer1M,
  });
  if (oc.degraded) degraded.push(...oc.notes);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM cron_jobs; DELETE FROM cron_runs; DELETE FROM agent_usage;');
    const insJ = db.prepare(
      `INSERT INTO cron_jobs (id, agent_id, name, description, enabled, schedule_expr, tz, status, last_run_at, last_status, last_duration, next_run_at, consec_errors)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const c of oc.data.crons) {
      insJ.run(c.id, c.agentId, c.name, c.description, c.enabled ? 1 : 0, c.scheduleExpr, c.tz, c.status, c.lastRunAtMs, c.lastRunStatus, c.lastDurationMs, c.nextRunAtMs, c.consecutiveErrors);
    }
    const insR = db.prepare(
      `INSERT INTO cron_runs (job_id, session_id, agent_id, at_ms, action, status, summary, duration_ms, model, in_tokens, out_tokens, total_tokens)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(job_id, session_id) DO UPDATE SET status=excluded.status, summary=excluded.summary`,
    );
    for (const r of oc.data.cronRuns) {
      insR.run(r.jobId, r.sessionId || `${r.jobId}:${r.atMs}`, r.agentId, r.atMs, r.action, r.status, r.summary, r.durationMs, r.model, r.inputTokens, r.outputTokens, r.totalTokens);
    }
    const insAU = db.prepare(
      `INSERT INTO agent_usage (agent_id, model, sessions, in_tokens, out_tokens, total_tokens, cost_usd)
       VALUES (?,?,?,?,?,?,?)`,
    );
    for (const u of oc.data.usage) {
      insAU.run(u.agentId, u.model, u.sessions, u.inputTokens, u.outputTokens, u.totalTokens, u.costUsd);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  setMeta(db, 'last_sync', new Date().toISOString());
  setMeta(db, 'openclaw_exported_at', oc.data.exportedAt ?? '');
  setMeta(db, 'degraded', JSON.stringify(degraded));

  const result: IndexResult = {
    episodes: repo.data.episodes.length,
    runs: gh.data.runs.length,
    artifacts: gh.data.artifacts.length,
    crons: oc.data.crons.length,
    cronRuns: oc.data.cronRuns.length,
    agentUsage: oc.data.usage.length,
    degraded,
  };
  log.info(result, 'indexação concluída');
  db.close();
  return result;
}

const entry = argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  // Sem process.exit() explícito: deixa o loop drenar (db.close + timers do
  // AbortSignal) p/ evitar a assertion do libuv no Windows. exitCode sinaliza.
  runIndexer()
    .then((r) => {
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    })
    .catch((err) => {
      log.error(err, 'indexação falhou');
      process.exitCode = 1;
    });
}
