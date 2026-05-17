import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

// Configura env ANTES de importar server/config (config lê env no load).
const TEST_KEY = 'chave-de-teste-123';
const salt = randomBytes(16);
const dk = scryptSync(TEST_KEY, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
const dataDir = mkdtempSync(join(tmpdir(), 'portal-srv-'));

process.env['NODE_ENV'] = 'test';
process.env['PORTAL_ACCESS_KEY_HASH'] = `scrypt$32768$8$1$${salt.toString('hex')}$${dk.toString('hex')}`;
process.env['PORTAL_COOKIE_SECRET'] = 'segredo-de-cookie-para-teste-bem-grande-0123456789';
process.env['DATA_DIR'] = dataDir;
process.env['REPO_DIR'] = dataDir; // sem repo real → snapshot degrada (ok)

let app: FastifyInstance;

beforeAll(async () => {
  const { buildServer } = await import('./server.js');
  app = (await buildServer()) as unknown as FastifyInstance;
  await app.ready();
});
afterAll(async () => {
  await app.close(); // hook onClose fecha o db (libera o lock no Windows)
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    /* temp dir — SO limpa depois; lock residual do Windows não falha o teste */
  }
});

function cookieHeader(res: { cookies: Array<{ name: string; value: string }> }): string {
  return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

describe('auth + API gate', () => {
  it('bloqueia /api/overview sem sessão (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/overview' });
    expect(res.statusCode).toBe(401);
  });

  it('rejeita chave errada com 401 genérico', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { key: 'errada' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).not.toHaveProperty('hint');
  });

  it('aceita a chave correta, seta cookie e libera a API', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { key: TEST_KEY },
    });
    expect(login.statusCode).toBe(200);
    const cookie = cookieHeader(login);
    expect(cookie).toContain('msu_portal_sess');

    const ov = await app.inject({
      method: 'GET',
      url: '/api/overview',
      headers: { cookie },
    });
    expect(ov.statusCode).toBe(200);
    expect(ov.json()).toHaveProperty('kpis');
  });

  it('endpoints read respondem 200 autenticado', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { key: TEST_KEY },
    });
    const cookie = cookieHeader(login);
    for (const url of ['/api/pipeline', '/api/cost/summary', '/api/assets', '/api/org']) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it('healthz é público', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('webhook sem secret configurado → 503 (não aceita não-autenticado)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhook/github',
      headers: { 'x-github-event': 'push' },
      payload: {},
    });
    expect(res.statusCode).toBe(503);
  });
});

describe('assets — anti path-traversal', () => {
  let cookie = '';
  beforeAll(async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { key: TEST_KEY },
    });
    cookie = cookieHeader(login);
  });

  it('rejeita escape do public/ (400)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/assets/file?path=' + encodeURIComponent('../../../../etc/passwd'),
      headers: { cookie },
    });
    expect([400, 404, 415]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(200);
  });

  it('exige sessão p/ assets', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/assets/file?path=x.png' });
    expect(res.statusCode).toBe(401);
  });
});
