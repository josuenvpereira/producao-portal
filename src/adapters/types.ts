import type {
  RawPipelineState,
  CostApprovalSignal,
  EscalationSignal,
} from '../domain.js';

// Resultado de qualquer adapter: dados + sinal de degradação (fonte fora do ar
// nunca derruba o portal — mostra stale + aviso).
export interface AdapterResult<T> {
  data: T;
  degraded: boolean;
  notes: string[];
}

export interface AssetRef {
  kind: 'audio' | 'image' | 'brand';
  relPath: string; // relativo à raiz do repo (p/ stream gated com anti-traversal)
  bytes: number;
  mtime: string;
}

export interface ScriptBlockProjection {
  blockId: string;
  ord: number;
  kind: string;
  audioFile: string | null;
  durationFrames: number | null;
  spokenChars: number;
  images: string[]; // src de fadeImage etc. (imagens pesquisadas/encontradas)
}

export interface EpisodeProjection {
  episodeId: string;
  channel: string;
  title: string;
  scriptPath: string | null;
  state: RawPipelineState | null;
  costApproval: CostApprovalSignal | null;
  escalationSignal: EscalationSignal | null;
  blocks: ScriptBlockProjection[];
  assets: AssetRef[];
}

export interface RepoSnapshot {
  episodes: EpisodeProjection[];
  sharedAssets: AssetRef[]; // public/shared/brand/* (beds, intro_sting)
}

export interface RenderRun {
  runId: string;
  episode: string | null;
  channel: string | null;
  status: string; // queued|in_progress|completed
  conclusion: string | null; // success|failure|cancelled|null
  approvePaidApis: boolean;
  event: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  headSha: string;
  jobs: Array<{ name: string; status: string; conclusion: string | null }>;
}

export interface ArtifactRef {
  id: string;
  runId: string;
  episode: string | null;
  name: string;
  kind: 'mp4' | 'audio' | 'other';
  sizeBytes: number;
  expiresAt: string;
  expired: boolean;
}

export interface TokenUsageRow {
  id: string;
  at: string;
  period: string; // YYYY-MM
  agent: string;
  source: string; // openclaw|elevenlabs-derived
  tokens: number;
  costUsd: number;
  raw: unknown;
}
