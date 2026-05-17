// Cliente da API. Cookies de sessão via credentials:'include'. Mesma origem
// em prod (Fastify serve a SPA); em dev o Vite faz proxy de /api → :8080.

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (res.status === 401) throw new ApiError(401, 'não autenticado');
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    msg: string,
  ) {
    super(msg);
  }
}

export const api = {
  me: () => req<{ authenticated: boolean }>('/auth/me'),
  login: (key: string) =>
    req<{ ok: true }>('/auth/session', { method: 'POST', body: JSON.stringify({ key }) }),
  logout: () => req<{ ok: true }>('/auth/logout', { method: 'POST' }),
  overview: () => req<Overview>('/overview'),
  pipeline: () => req<PipelineList>('/pipeline'),
  episode: (id: string) => req<EpisodeDetail>(`/episodes/${id}`),
  cost: () => req<CostSummary>('/cost/summary'),
  assets: () => req<AssetsList>('/assets'),
  org: () => req<OrgManifest>('/org'),
  assetUrl: (relPath: string) => `/api/assets/file?path=${encodeURIComponent(relPath)}`,
};

// ── Tipos (espelham db/queries.ts; campos vindos do SQLite) ────────────────
export interface Overview {
  kpis: {
    totalEpisodes: number;
    inPipeline: number;
    published: number;
    escalated: number;
    monthlyEstimateUsd: number;
    monthlyBudgetUsd: number;
    overBudget: boolean;
  };
  byState: Array<{ state: string; c: number }>;
  recentHandoffs: Array<{
    episode_id: string;
    at: string;
    from_agent: string;
    to_agent: string;
    to_state: string;
    note: string;
  }>;
  lastSync: string | null;
  degraded: string[];
}
export interface PipelineRow {
  episode_id: string;
  title: string;
  channel: string;
  state: string | null;
  escalated: number;
  updated_at: string | null;
  attempts_json: string | null;
  last_run_status: string | null;
  last_run_conclusion: string | null;
}
export interface PipelineList {
  episodes: PipelineRow[];
  degraded: string[];
}
export interface EpisodeDetail {
  episode: Record<string, unknown>;
  blocks: Array<{
    block_id: string;
    ord: number;
    kind: string;
    audio_file: string | null;
    duration_frames: number | null;
    spoken_chars: number;
    images_json: string;
  }>;
  assets: Array<{ kind: string; rel_path: string; bytes: number; mtime: string }>;
  history: Array<{ seq: number; at: string; from_state: string; to_state: string; by_agent: string; note: string }>;
  handoffs: Array<{ seq: number; at: string; from_agent: string; to_agent: string; to_state: string; note: string }>;
  escalations: Array<{ at: string; stage: string; attempts: number; reason: string }>;
  costSignal: Record<string, unknown> | null;
  costEstimate: { tts_chars: number; tts_cost_usd: number } | null;
  runs: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
}
export interface CostSummary {
  estimates: Array<{
    episode_id: string;
    title: string | null;
    tts_chars: number;
    tts_cost_usd: number;
    projected_usd: number | null;
    budget_usd: number | null;
  }>;
  byAgent: Array<{ agent: string; source: string; tokens: number; cost_usd: number; period: string }>;
  totals: { ttsEstimateUsd: number; openclawUsd: number; monthlyBudgetUsd: number; overBudget: boolean };
  degraded: string[];
}
export interface AssetsList {
  assets: Array<{ episode_id: string; kind: string; rel_path: string; bytes: number; mtime: string }>;
  degraded: string[];
}
export interface OrgAgent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  branch?: string;
  lead?: boolean;
  supervisor?: boolean;
  handsOffTo?: string[];
  supervises?: string[];
}
export interface OrgManifest {
  schemaVersion: number;
  project?: string;
  ceo?: { id: string; name: string; role: string; emoji: string; branch?: string };
  pipeline?: string[];
  states?: string[];
  squads: Array<{ id: string; name: string; agents: OrgAgent[] }>;
  degraded?: string[];
}
