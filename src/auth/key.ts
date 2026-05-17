import { scryptSync, timingSafeEqual } from 'node:crypto';

// Verificação da CHAVE ÚNICA. Formato do hash (gerado por
// scripts/gen-portal-key.js): `scrypt$N$r$p$saltHex$dkHex`.
// Comparação SEMPRE tempo-constante (timingSafeEqual) — sem oráculo de timing.

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  dk: Buffer;
}

function parse(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltHex = parts[4] ?? '';
  const dkHex = parts[5] ?? '';
  if (!N || !r || !p || !saltHex || !dkHex) return null;
  return { N, r, p, salt: Buffer.from(saltHex, 'hex'), dk: Buffer.from(dkHex, 'hex') };
}

/**
 * Retorna true sse `key` corresponde ao `storedHash`. Nunca lança por chave
 * errada; só false. Custo de scrypt é intencional (anti brute-force) e somado
 * ao rate-limit da rota de login (Fase 2).
 */
export function verifyKey(key: string, storedHash: string): boolean {
  const parsed = parse(storedHash);
  if (!parsed) return false;
  let candidate: Buffer;
  try {
    candidate = scryptSync(key, parsed.salt, parsed.dk.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: 128 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  if (candidate.length !== parsed.dk.length) return false;
  return timingSafeEqual(candidate, parsed.dk);
}
