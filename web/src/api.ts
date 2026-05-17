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
  comunicacao: () => req<Comunicacao>('/comunicacao'),
  assets: () => req<AssetsList>('/assets'),
  org: () => req<OrgManifest>('/org'),
  assetUrl: (relPath: string) => `/api/assets/file?path=${encodeURIComponent(relPath)}`,

  // ── SFX Factory ──
  sfxStatus: () => req<SfxStatus>('/sfx/status'),
  sfxCatalog: () => req<SfxCatalog>('/sfx/catalog'),
  sfxLibrary: () => req<SfxMeta[]>('/sfx/library'),
  sfxAudioUrl: (id: string) => `/api/sfx/library/${encodeURIComponent(id)}/audio`,
  async sfxGenerate(
    kind: 'sfx' | 'bed' | 'vocal',
    body: Record<string, unknown>,
  ): Promise<{ url: string; id: string | null; promptEn: string | null }> {
    const res = await fetch(`/api/sfx/${kind}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        msg = ((await res.json()) as { error?: string }).error ?? msg;
      } catch {
        /* sem json */
      }
      throw new ApiError(res.status, msg);
    }
    const blob = await res.blob();
    return {
      url: URL.createObjectURL(blob),
      id: res.headers.get('X-Sfx-Id'),
      promptEn: res.headers.get('X-Prompt-EN') || null,
    };
  },
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
  byAgent: Array<{ agent: string; model: string; sessions: number; tokens: number; cost_usd: number }>;
  totals: {
    ttsEstimateUsd: number;
    openclawUsd: number;
    openclawTokens: number;
    monthlyBudgetUsd: number;
    overBudget: boolean;
  };
  degraded: string[];
}
export interface Comunicacao {
  jobs: Array<{
    id: string;
    agent_id: string;
    name: string;
    description: string;
    enabled: number;
    schedule_expr: string;
    tz: string;
    status: string;
    last_run_at: number | null;
    last_status: string | null;
    last_duration: number | null;
    next_run_at: number | null;
    consec_errors: number;
  }>;
  runs: Array<{
    job_id: string;
    agent_id: string;
    at_ms: number;
    status: string;
    summary: string;
    duration_ms: number;
    model: string;
    total_tokens: number;
  }>;
  exportedAt: string | null;
  degraded: string[];
}
export interface AssetsList {
  assets: Array<{ episode_id: string; kind: string; rel_path: string; bytes: number; mtime: string }>;
  degraded: string[];
}
export interface SfxStatus {
  reachable: boolean;
  state: 'no_ar' | 'parcial' | 'offline';
  gateway?: string;
  acestep?: string;
  omnivoice?: string;
  audioldm2?: string;
  down: string[];
  busy: boolean;
}
export interface SfxCatalog {
  create_any?: Record<string, string>;
  bed_presets?: Array<{ name: string; prompt?: string; seed?: number }>;
}
export interface SfxMeta {
  id: string;
  kind: 'sfx' | 'bed' | 'vocal';
  req: Record<string, unknown>;
  promptEn: string | null;
  ts: number;
  bytes: number;
}
export interface OrgAgent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  branch?: string;
  model?: string;
  lead?: boolean;
  supervisor?: boolean;
  handsOffTo?: string[];
  supervises?: string[];
}
export interface OrgManifest {
  schemaVersion: number;
  project?: string;
  ceo?: { id: string; name: string; role: string; emoji: string; branch?: string; model?: string };
  pipeline?: string[];
  states?: string[];
  squads: Array<{ id: string; name: string; agents: OrgAgent[] }>;
  degraded?: string[];
}
