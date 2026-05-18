import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AdapterResult } from './types.js';

// Lê os snapshots gerados por scripts/openclaw-export.sh (host → :ro).
// Fonte da Comunicação (crons + execuções) e do Custo (tokens por agente).
// Tudo defensivo: arquivo ausente/corrompido → degradado, nunca lança.

export interface CronJob {
  id: string;
  agentId: string;
  name: string;
  description: string;
  enabled: boolean;
  scheduleExpr: string;
  tz: string;
  status: string;
  lastRunAtMs: number | null;
  lastRunStatus: string | null;
  lastDurationMs: number | null;
  nextRunAtMs: number | null;
  consecutiveErrors: number;
}
export interface CronRun {
  jobId: string;
  agentId: string;
  atMs: number;
  action: string;
  status: string;
  summary: string;
  durationMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  sessionId: string;
}
export interface AgentUsage {
  agentId: string;
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}
export interface OpenClawSnapshot {
  crons: CronJob[];
  cronRuns: CronRun[];
  usage: AgentUsage[];
  exportedAt: string | null;
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}
function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function agentFromSessionKey(k: string): string {
  // "agent:gerente-com:cron:<jobId>:run:<sid>" → "gerente-com"
  const m = /^agent:([^:]+):/.exec(k || '');
  return m ? (m[1] as string) : 'desconhecido';
}

interface RawCron {
  jobs?: Array<{
    id: string;
    agentId?: string;
    name?: string;
    description?: string;
    enabled?: boolean;
    status?: string;
    schedule?: { expr?: string; tz?: string };
    state?: {
      lastRunAtMs?: number;
      lastRunStatus?: string;
      lastDurationMs?: number;
      nextRunAtMs?: number;
      consecutiveErrors?: number;
    };
  }>;
}
interface RawRuns {
  jobs?: Record<
    string,
    {
      runs?: Array<{
        ts?: number;
        runAtMs?: number;
        jobId?: string;
        action?: string;
        status?: string;
        summary?: string;
        durationMs?: number;
        model?: string;
        usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
        sessionId?: string;
        sessionKey?: string;
      }>;
    }
  >;
}
// Formato VALIDADO contra amostra real do VPS (2026-05-18,
// `openclaw sessions --all-agents --json`): objeto com `sessions[]`, cada
// item = { agentId, model, inputTokens, outputTokens, totalTokens (pode ser
// null), kind, key, ... }. O parser abaixo lê exatamente esses campos — não
// mudar sem reconfirmar amostra (o roster/formato já foi corrigido 2×).
type RawSessions =
  | Array<Record<string, unknown>>
  | { sessions?: Array<Record<string, unknown>> };

export function readOpenClawSnapshot(
  dir: string,
  price: { pro: number; flash: number },
): AdapterResult<OpenClawSnapshot> {
  const notes: string[] = [];
  const empty: OpenClawSnapshot = { crons: [], cronRuns: [], usage: [], exportedAt: null };
  if (!existsSync(dir)) {
    return {
      data: empty,
      degraded: true,
      notes: [`OPENCLAW_EXPORT_DIR ausente (${dir}) — rode scripts/openclaw-export.sh no VPS`],
    };
  }

  // crons
  const crons: CronJob[] = [];
  const rawCron = readJson<RawCron>(join(dir, 'cron.json'));
  if (!rawCron) notes.push('cron.json ausente/inválido');
  for (const j of rawCron?.jobs ?? []) {
    crons.push({
      id: j.id,
      agentId: j.agentId ?? '',
      name: j.name ?? j.id,
      description: j.description ?? '',
      enabled: j.enabled !== false,
      scheduleExpr: j.schedule?.expr ?? '',
      tz: j.schedule?.tz ?? '',
      status: j.status ?? '',
      lastRunAtMs: j.state?.lastRunAtMs ?? null,
      lastRunStatus: j.state?.lastRunStatus ?? null,
      lastDurationMs: j.state?.lastDurationMs ?? null,
      nextRunAtMs: j.state?.nextRunAtMs ?? null,
      consecutiveErrors: n(j.state?.consecutiveErrors),
    });
  }

  // cron runs (esteira de Comunicação)
  const cronRuns: CronRun[] = [];
  const rawRuns = readJson<RawRuns>(join(dir, 'cron-runs.json'));
  for (const [jobId, blk] of Object.entries(rawRuns?.jobs ?? {})) {
    for (const r of blk.runs ?? []) {
      cronRuns.push({
        jobId: r.jobId ?? jobId,
        agentId: agentFromSessionKey(r.sessionKey ?? ''),
        atMs: n(r.runAtMs ?? r.ts),
        action: r.action ?? '',
        status: r.status ?? '',
        summary: (r.summary ?? '').slice(0, 4000),
        durationMs: n(r.durationMs),
        model: r.model ?? '',
        inputTokens: n(r.usage?.input_tokens),
        outputTokens: n(r.usage?.output_tokens),
        totalTokens: n(r.usage?.total_tokens),
        sessionId: r.sessionId ?? '',
      });
    }
  }
  cronRuns.sort((a, b) => b.atMs - a.atMs);

  // usage por agente+modelo (Custos)
  const raw = readJson<RawSessions>(join(dir, 'sessions.json'));
  const list = Array.isArray(raw) ? raw : (raw?.sessions ?? []);
  if (!raw) notes.push('sessions.json ausente/inválido');
  const acc = new Map<string, AgentUsage>();
  for (const s of list) {
    const agentId = String(s['agentId'] ?? 'desconhecido');
    const model = String(s['model'] ?? '');
    const key = `${agentId}|${model}`;
    const cur =
      acc.get(key) ??
      { agentId, model, sessions: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
    cur.sessions += 1;
    cur.inputTokens += n(s['inputTokens']);
    cur.outputTokens += n(s['outputTokens']);
    cur.totalTokens += n(s['totalTokens']);
    acc.set(key, cur);
  }
  const usage = [...acc.values()].map((u) => {
    const per1M = /flash/i.test(u.model) ? price.flash : price.pro;
    return { ...u, costUsd: Math.round((u.totalTokens / 1e6) * per1M * 100) / 100 };
  });
  usage.sort((a, b) => b.totalTokens - a.totalTokens);

  const exportedAt = (() => {
    try {
      return readFileSync(join(dir, 'exported-at.txt'), 'utf8').trim();
    } catch {
      return null;
    }
  })();

  const degraded = !rawCron && !rawRuns && !raw;
  if (degraded) notes.push('nenhum snapshot do OpenClaw encontrado (exporter não rodou ainda)');
  return { data: { crons, cronRuns, usage, exportedAt }, degraded, notes };
}
