import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync, randomBytes, createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

// Configura env ANTES de importar server/config (config lê env no load).
// Aqui o webhook secret ESTÁ setado (server.test.ts cobre o caso sem secret).
const TEST_KEY = 'chave-de-teste-123';
const salt = randomBytes(16);
const dk = scryptSync(TEST_KEY, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
const dataDir = mkdtempSync(join(tmpdir(), 'portal-wh-'));
const WEBHOOK_SECRET = 'segredo-webhook-de-teste';

process.env['NODE_ENV'] = 'test';
process.env['PORTAL_ACCESS_KEY_HASH'] = `scrypt$32768$8$1$${salt.toString('hex')}$${dk.toString('hex')}`;
process.env['PORTAL_COOKIE_SECRET'] = 'segredo-de-cookie-para-teste-bem-grande-0123456789';
process.env['DATA_DIR'] = dataDir;
process.env['REPO_DIR'] = dataDir;
process.env['GITHUB_WEBHOOK_SECRET'] = WEBHOOK_SECRET;

let app: FastifyInstance;

beforeAll(async () => {
  const { buildServer } = await import('./server.js');
  app = (await buildServer()) as unknown as FastifyInstance;
  await app.ready();
});
afterAll(async () => {
  await app.close();
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    /* temp dir — SO limpa depois */
  }
});

function sign(raw: string): string {
  return 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(raw)).digest('hex');
}

describe('webhook github — HMAC', () => {
  // Evento 'ping' (não-reindex) → 204 sem agendar o debounce (sem timer
  // vazando no teste). Valida só a verificação de assinatura.
  it('assinatura válida → aceita (204 p/ evento não-reindex)', async () => {
    const body = '{}';
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'ping',
        'x-hub-signature-256': sign(body),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(204);
  });

  it('assinatura inválida → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-hub-signature-256': 'sha256=deadbeef',
      },
      payload: '{}',
    });
    expect(res.statusCode).toBe(401);
  });

  it('sem assinatura → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/github',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(401);
  });
});
