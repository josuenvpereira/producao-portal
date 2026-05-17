import { config } from '../config.js';

// Cliente da SFX Factory (na casa, via WireGuard). Só o backend fala com ela:
// injeta a chave server-side, mapeia erros (§5 do handoff) e SERIALIZA as
// gerações (GPU concorrência=1). "Casa desligada" = offline normal, não erro.

const BASE = config.sfx.baseUrl.replace(/\/+$/, '');

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

export class SfxError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Lock global: GPU processa 1 job por vez. Recusa rápido se ocupado (o front
// também desabilita o botão); evita empilhar requests de minutos.
let busy = false;
export function sfxBusy(): boolean {
  return busy;
}

async function factoryFetch(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<globalThis.Response> {
  return fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export async function sfxStatus(): Promise<SfxStatus> {
  try {
    // /health faz checks sequenciais (até ~15s) → read ~20s; falha = offline.
    const r = await factoryFetch('/health', { method: 'GET' }, 20_000);
    if (!r.ok) return { reachable: false, state: 'offline', down: [], busy };
    const h = (await r.json()) as Record<string, string>;
    const backends = ['acestep', 'omnivoice', 'audioldm2'] as const;
    const down = backends.filter((b) => h[b] && h[b] !== 'ok');
    const allOk = h['gateway'] === 'ok' && down.length === 0;
    return {
      reachable: true,
      state: allOk ? 'no_ar' : 'parcial',
      gateway: h['gateway'],
      acestep: h['acestep'],
      omnivoice: h['omnivoice'],
      audioldm2: h['audioldm2'],
      down,
      busy,
    };
  } catch {
    // connect refused / timeout → casa desligada ou túnel caído (normal)
    return { reachable: false, state: 'offline', down: [], busy };
  }
}

export async function sfxCatalog(): Promise<unknown> {
  try {
    const r = await factoryFetch('/catalog', { method: 'GET' }, 10_000);
    if (!r.ok) throw new SfxError(r.status, 'catálogo indisponível');
    return await r.json();
  } catch (e) {
    if (e instanceof SfxError) throw e;
    throw new SfxError(503, 'Serviço offline (casa desligada ou túnel caído)');
  }
}

export interface GenResult {
  bytes: Buffer;
  promptEn: string | null;
}

/** Gera (kind = sfx|bed|vocal). Serializado: recusa 409 se já há geração. */
export async function sfxGenerate(
  kind: 'sfx' | 'bed' | 'vocal',
  body: unknown,
): Promise<GenResult> {
  if (busy) {
    throw new SfxError(
      409,
      'Uma geração já está em andamento (GPU serializada). Aguarde ela terminar.',
    );
  }
  if (!config.sfx.apiKey) {
    throw new SfxError(503, 'SFX_API_KEY não configurada no portal');
  }
  busy = true;
  try {
    let r: globalThis.Response;
    try {
      r = await factoryFetch(
        `/${kind}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': config.sfx.apiKey },
          body: JSON.stringify(body ?? {}),
        },
        config.sfx.readTimeoutMs,
      );
    } catch {
      throw new SfxError(503, 'Serviço offline (casa desligada ou túnel caído)');
    }
    if (r.status !== 200) {
      const ct = r.headers.get('content-type') ?? '';
      let detail = `erro ${r.status}`;
      try {
        detail = ct.includes('json')
          ? String(((await r.json()) as { detail?: unknown }).detail ?? detail)
          : (await r.text()).slice(0, 300);
      } catch {
        /* mantém detail genérico */
      }
      throw new SfxError(r.status, detail);
    }
    const bytes = Buffer.from(await r.arrayBuffer());
    return { bytes, promptEn: r.headers.get('X-Prompt-EN') || null };
  } finally {
    busy = false;
  }
}
