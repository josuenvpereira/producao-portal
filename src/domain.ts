// Tipos de domínio + constantes da máquina de estados.
// ESPELHA scripts/pipeline_state.js (fonte da verdade do schema). Se aquele
// arquivo mudar os estados/transições, atualizar aqui (teste de contrato cobre).

export const PIPELINE_STATES = [
  'NEW', 'CURADORIA', 'BRIEF_OK', 'ROTEIRO', 'SCRIPT_OK', 'BRANDING',
  'BRANDING_OK', 'PRODUCAO_AUDIO', 'AUDIO_OK', 'RENDER_QUEUED', 'RENDERED',
  'REVISAO', 'REVIEW_OK', 'PACKAGING', 'PACKAGED', 'READY_TO_PUBLISH',
  'PUBLISHED', 'REPROVADO', 'ESCALATED',
] as const;
export type PipelineState = (typeof PIPELINE_STATES)[number];

// Grafo de transições (idêntico ao TRANSITIONS do pipeline_state.js).
export const TRANSITIONS: Record<PipelineState, PipelineState[]> = {
  NEW: ['CURADORIA'],
  CURADORIA: ['BRIEF_OK'],
  BRIEF_OK: ['ROTEIRO'],
  ROTEIRO: ['SCRIPT_OK'],
  SCRIPT_OK: ['BRANDING'],
  BRANDING: ['BRANDING_OK'],
  BRANDING_OK: ['PRODUCAO_AUDIO'],
  PRODUCAO_AUDIO: ['AUDIO_OK'],
  AUDIO_OK: ['RENDER_QUEUED'],
  RENDER_QUEUED: ['RENDERED'],
  RENDERED: ['REVISAO'],
  REVISAO: ['REVIEW_OK', 'REPROVADO'],
  REPROVADO: ['ROTEIRO', 'BRANDING', 'PRODUCAO_AUDIO'],
  REVIEW_OK: ['PACKAGING'],
  PACKAGING: ['PACKAGED'],
  PACKAGED: ['READY_TO_PUBLISH'],
  READY_TO_PUBLISH: ['PUBLISHED'],
  PUBLISHED: [],
  ESCALATED: [],
};

// Etapa "responsável" por estado (idêntico ao STAGE_OF). Usado p/ tentativas.
export const STAGE_OF: Partial<Record<PipelineState, string>> = {
  CURADORIA: 'CURADORIA', ROTEIRO: 'ROTEIRO', BRANDING: 'BRANDING',
  PRODUCAO_AUDIO: 'PRODUCAO_AUDIO', RENDER_QUEUED: 'RENDER',
  REVISAO: 'REVISAO', PACKAGING: 'PACKAGING',
};

// Estado bruto gravado em pipeline-state/<id>.json (schema do writer).
export interface RawPipelineState {
  episodeId: string;
  state: PipelineState;
  createdAt: string;
  updatedAt: string;
  attempts: Record<string, number>;
  maxAttemptsPerStage: number;
  escalated: boolean;
  history: HistoryEntry[];
  escalations: EscalationEntry[];
}
export interface HistoryEntry {
  at: string;
  from: PipelineState | null;
  to: PipelineState;
  by: string;
  note: string;
}
export interface EscalationEntry {
  at: string;
  stage: string;
  attempts: number | null;
  reason: string;
  fromState: PipelineState;
}

// Sinal pipeline-state/_COST_APPROVAL_<id>.json (gerado por generate_episode_audio.js).
export interface CostApprovalSignal {
  type: 'COST_APPROVAL';
  episodeId: string;
  channel: string;
  at: string;
  projectedCostUsd: number;
  budgetUsd: number;
  chars: number;
  scenes: number;
  files: string[];
  approveCommand?: string;
}

// Sinal pipeline-state/_ESCALATION_<id>.json.
export interface EscalationSignal {
  episodeId: string;
  stage: string;
  reason: string;
  at: string;
  fromState: PipelineState;
}

// script.json (subset relevante p/ rastreabilidade tarefa→artefato + custo).
export interface ScriptBlock {
  id: string;
  kind: 'branded' | 'single' | 'loop';
  audioFile?: string;
  durationFrames?: number;
  spokenText?: string;
  items?: Array<{ audioFile?: string; spokenText?: string }>;
  elements?: Array<{ type: string; src?: string }>;
}
export interface ScriptJson {
  episodio_id: string;
  titulo: string;
  branding?: Record<string, unknown>;
  blocks: ScriptBlock[];
}

export function isPipelineState(s: string): s is PipelineState {
  return (PIPELINE_STATES as readonly string[]).includes(s);
}
