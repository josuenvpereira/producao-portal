import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { logger } from './logger.js';
import { openDb } from './db/db.js';
import { authRoutes, requireAuth } from './auth/plugin.js';
import { apiRoutes } from './routes/api.js';
import { assetRoutes } from './routes/assets.js';
import { sfxRoutes } from './routes/sfx.js';
import { sseRoutes } from './routes/sse.js';
import { webhookRoutes } from './routes/webhook.js';
import { spaRoutes } from './routes/spa.js';

export async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true, // atrás do Traefik
    bodyLimit: 1 * 1024 * 1024,
  });

  app.decorate('db', openDb(config.storage.dbPath));
  app.addHook('onClose', (instance, done) => {
    try {
      instance.db.close();
    } catch {
      /* já fechado */
    }
    done();
  });

  // Resposta de erro uniforme. 5xx → corpo genérico (stack só no log, nunca
  // no corpo); 4xx (ex.: validação de schema) pode expor a mensagem.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    else req.log.warn({ err: err.message, code: err.code }, 'erro de request');
    reply
      .code(status)
      .send(
        status >= 500
          ? { error: 'internal_error' }
          : { error: err.code ?? 'bad_request', message: err.message },
      );
  });

  // Parser JSON que TAMBÉM guarda o raw (necessário p/ HMAC do webhook),
  // mantendo o parse normal pras outras rotas.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      const buf = body as Buffer;
      req.rawBody = buf;
      try {
        done(null, buf.length ? JSON.parse(buf.toString('utf8')) : {});
      } catch (err) {
        done(err as Error);
      }
    },
  );

  await app.register(helmet, {
    // CSP pragmática (Fase 2). Endurecimento com nonce → Fase 3.
    contentSecurityPolicy: config.isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
          },
        }
      : false,
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  });

  await app.register(cookie, { secret: config.auth.cookieSecret });
  await app.register(rateLimit, { global: false });

  app.get('/healthz', async () => ({
    ok: true,
    service: 'msu-producao-portal',
    ts: new Date().toISOString(),
  }));

  // Não-gateadas por cookie: login (rate-limited) + webhook (HMAC).
  await app.register(authRoutes);
  await app.register(webhookRoutes);

  // Escopo PROTEGIDO: tudo aqui exige sessão válida (cookie assinado).
  await app.register(async (scope) => {
    scope.addHook('preHandler', requireAuth);
    await scope.register(apiRoutes);
    await scope.register(assetRoutes);
    await scope.register(sfxRoutes);
    await scope.register(sseRoutes);
  });

  // SPA por último (catch-all GET → index.html). Não gateada (a app chama
  // /api/* que é gateado; sem sessão o usuário vê só a tela de login).
  await app.register(spaRoutes);

  return app;
}

async function main(): Promise<void> {
  const app = await buildServer();
  if (!config.isProd && !config.auth.accessKeyHash) {
    app.log.warn('PORTAL_ACCESS_KEY_HASH vazio (dev). Rode: node scripts/gen-portal-key.js');
  }
  // CD faz `docker compose up -d --build` → SIGTERM no container. Sem isto o
  // hook onClose (fecha SQLite/WAL) não dispara e o SSE é cortado abrupto.
  // Sem process.exit() explícito: deixa o loop drenar (padrão do indexer.ts).
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      app.log.info({ sig }, 'sinal recebido — encerrando');
      void app.close().catch((err) => {
        app.log.error(err, 'erro no shutdown');
        process.exitCode = 1;
      });
    });
  }
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exitCode = 1;
  }
}

const entry = argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) void main();
