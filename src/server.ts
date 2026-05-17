import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import { config } from './config.js';
import { logger } from './logger.js';

// Servidor do portal. Single deployable: a API e (em prod) a SPA buildada são
// servidas pelo mesmo processo. Fase 0 = esqueleto bootável + baseline de
// segurança (helmet). Auth/rotas/SSE/webhook entram nas Fases 2–3 nos pontos
// de extensão marcados abaixo.

export async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true, // atrás do Traefik
    bodyLimit: 1 * 1024 * 1024,
  });

  // Baseline de headers (CSP/HSTS/XFO/nosniff). CSP completa (nonce p/ SPA) é
  // endurecida na Fase 3.
  await app.register(helmet, {
    contentSecurityPolicy: config.isProd ? undefined : false,
  });

  app.get('/healthz', async () => ({
    ok: true,
    service: 'msu-producao-portal',
    ts: new Date().toISOString(),
  }));

  // ── Pontos de extensão (preenchidos nas próximas fases) ──────────────────
  // Fase 2: await app.register(authPlugin)
  //         await app.register(apiRoutes, { prefix: '/api' })
  //         await app.register(assetRoutes, { prefix: '/api/assets' })
  //         await app.register(sseRoutes); await app.register(webhookRoutes)
  // Fase 3: await app.register(spaStatic) // serve web/dist

  return app;
}

async function main(): Promise<void> {
  const app = await buildServer();
  if (!config.isProd && !config.auth.accessKeyHash) {
    app.log.warn('PORTAL_ACCESS_KEY_HASH vazio (dev). Rode: node scripts/gen-portal-key.js');
  }
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Executa só quando rodado direto (não em testes que importam buildServer).
const entry = argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) void main();
