import { describe, it, expect } from 'vitest';
import { scryptSync, randomBytes } from 'node:crypto';
import { verifyKey } from './key.js';

// Recria o formato emitido por scripts/gen-portal-key.js.
function makeHash(key: string): string {
  const N = 32768, r = 8, p = 1;
  const salt = randomBytes(16);
  const dk = scryptSync(key, salt, 64, { N, r, p, maxmem: 128 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${dk.toString('hex')}`;
}

describe('verifyKey', () => {
  const key = randomBytes(32).toString('base64url');
  const hash = makeHash(key);

  it('aceita a chave correta', () => {
    expect(verifyKey(key, hash)).toBe(true);
  });
  it('rejeita chave errada', () => {
    expect(verifyKey(key + 'x', hash)).toBe(false);
    expect(verifyKey('', hash)).toBe(false);
  });
  it('rejeita hash malformado sem lançar', () => {
    expect(verifyKey(key, 'lixo')).toBe(false);
    expect(verifyKey(key, 'scrypt$1$2')).toBe(false);
    expect(verifyKey(key, '')).toBe(false);
  });
});
