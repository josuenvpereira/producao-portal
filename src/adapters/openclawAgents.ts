import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Lê agents.json gerado por scripts/openclaw-export.sh (host → :ro). Fonte
// VIVA do roster do organograma. Defensivo: arquivo ausente/corrompido →
// retorna null e o caller decide o fallback (org.json estático).

export interface OpenclawAgent {
  id: string;
  name: string;
  identityName: string | null;
  identityEmoji: string | null;
  model: string | null;
  bindings: number;
  isDefault: boolean;
}

export interface OpenclawAgentsSnapshot {
  agents: OpenclawAgent[];
  source: string; // caminho do arquivo lido (debug)
}

// Campos do JSON do openclaw (a partir da amostra real do VPS 2026-05-27):
// id, name, identityName, identityEmoji, identitySource, workspace,
// agentDir, model, bindings, isDefault. Ignoramos o que não usamos.
interface RawAgent {
  id?: unknown;
  name?: unknown;
  identityName?: unknown;
  identityEmoji?: unknown;
  model?: unknown;
  bindings?: unknown;
  isDefault?: unknown;
}

function normString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}
function normNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function normBool(v: unknown): boolean {
  return v === true;
}

/** Lê e parseia agents.json do diretório de export do OpenClaw. */
export function readOpenclawAgents(exportDir: string): OpenclawAgentsSnapshot | null {
  const p = join(exportDir, 'agents.json');
  if (!existsSync(p)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
  // OpenClaw devolve array de raiz; toleramos envelope { agents: [...] }
  // por segurança caso a CLI mude no futuro.
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { agents?: unknown }).agents)
      ? ((parsed as { agents: unknown[] }).agents)
      : null;
  if (!arr) return null;
  const agents: OpenclawAgent[] = [];
  for (const raw of arr as RawAgent[]) {
    const id = normString(raw.id);
    if (!id) continue; // sem id é inválido — pula
    agents.push({
      id,
      name: normString(raw.name) ?? id,
      identityName: normString(raw.identityName),
      identityEmoji: normString(raw.identityEmoji),
      model: normString(raw.model),
      bindings: normNumber(raw.bindings),
      isDefault: normBool(raw.isDefault),
    });
  }
  if (agents.length === 0) return null;
  return { agents, source: p };
}
