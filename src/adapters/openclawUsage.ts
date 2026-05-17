import type { AdapterResult, TokenUsageRow } from './types.js';

// Adapter de custo de tokens do OpenClaw (https://claw.jotaene.ia.br/usage).
//
// INVESTIGAÇÃO FASE 1 — RESOLVIDA: /usage responde **text/html** (NÃO é API
// JSON). Próximo passo (não bloqueia): parsear o HTML OU achar um endpoint
// JSON do OpenClaw — exige inspecionar a página real autenticada (no VPS,
// Fase 5, ou amostra do Josué). Por ora este adapter DEGRADA graciosamente
// (dashboard mostra "custo indisponível" sem quebrar). Continua PLUGÁVEL:
// quando o formato real for conhecido, só `normalize()` (e o parse) mudam.

interface OcConfig {
  usageUrl: string;
  token: string;
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Normaliza payloads conhecidos/heurísticos do /usage → TokenUsageRow[]. */
function normalize(payload: unknown, period: string): TokenUsageRow[] {
  const rows: TokenUsageRow[] = [];
  const push = (agent: string, tokens: number, costUsd: number, raw: unknown): void => {
    rows.push({
      id: `oc:${period}:${agent}`,
      at: new Date().toISOString(),
      period,
      agent,
      source: 'openclaw',
      tokens: Number.isFinite(tokens) ? tokens : 0,
      costUsd: Number.isFinite(costUsd) ? costUsd : 0,
      raw,
    });
  };

  // Heurística 1: { agents: [{ name|agent, tokens, cost|cost_usd }] }
  const obj = payload as Record<string, unknown> | null;
  const list =
    obj && Array.isArray(obj['agents'])
      ? (obj['agents'] as Array<Record<string, unknown>>)
      : Array.isArray(payload)
        ? (payload as Array<Record<string, unknown>>)
        : null;
  if (list) {
    for (const a of list) {
      const agent = String(a['name'] ?? a['agent'] ?? 'desconhecido');
      const tokens = Number(a['tokens'] ?? a['total_tokens'] ?? 0);
      const cost = Number(a['cost_usd'] ?? a['cost'] ?? a['usd'] ?? 0);
      push(agent, tokens, cost, a);
    }
    return rows;
  }

  // Heurística 2: total agregado { total_tokens, total_cost_usd }
  if (obj && (('total_tokens' in obj) || ('total_cost_usd' in obj))) {
    push('TOTAL', Number(obj['total_tokens'] ?? 0), Number(obj['total_cost_usd'] ?? 0), obj);
    return rows;
  }
  return rows;
}

export async function fetchOpenClawUsage(
  cfg: OcConfig,
): Promise<AdapterResult<TokenUsageRow[]>> {
  const period = currentPeriod();
  if (!cfg.usageUrl) {
    return { data: [], degraded: true, notes: ['OPENCLAW_USAGE_URL ausente'] };
  }
  const reqHeaders: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'msu-producao-portal',
  };
  if (cfg.token) reqHeaders['Authorization'] = `Bearer ${cfg.token}`;

  try {
    const res = await fetch(cfg.usageUrl, {
      headers: reqHeaders,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        data: [],
        degraded: true,
        notes: [`/usage retornou HTTP ${res.status} (degradado)`],
      };
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) {
      // Provável HTML — formato a definir quando inspecionarmos o /usage real.
      return {
        data: [],
        degraded: true,
        notes: [
          `/usage respondeu ${ct || 'tipo desconhecido'} (não-JSON). ` +
            'Mapeamento será fechado ao inspecionar o payload real (item Fase 1).',
        ],
      };
    }
    const payload = (await res.json()) as unknown;
    const rows = normalize(payload, period);
    return {
      data: rows,
      degraded: rows.length === 0,
      notes: rows.length === 0 ? ['/usage JSON em formato não reconhecido'] : [],
    };
  } catch (err) {
    return {
      data: [],
      degraded: true,
      notes: [`Falha ao buscar /usage: ${(err as Error).message}`],
    };
  }
}
