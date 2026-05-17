import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

// Serve a SPA buildada (web/dist) — single deployable. SPA fallback: rotas
// não-/api e não-arquivo → index.html (client-side routing). Em dev a SPA roda
// no Vite (proxy /api), então se web/dist não existe, apenas não registra.

export async function spaRoutes(app: FastifyInstance): Promise<void> {
  const here = fileURLToPath(new URL('.', import.meta.url));
  // dist/routes → ../../web/dist  (build) | src/routes → ../../web/dist (dev tsx)
  const webDist = resolve(here, '..', '..', 'web', 'dist');
  if (!existsSync(join(webDist, 'index.html'))) {
    app.log.warn(`SPA não encontrada em ${webDist} (ok em dev — use o Vite).`);
    return;
  }

  // wildcard true (default): serve TODOS os arquivos (inclui /assets/*.js|css)
  // com o MIME correto. Faltou arquivo → 404 → notFoundHandler → index.html
  // (SPA client-side routing). wildcard:false NÃO serve aninhados → o JS caía
  // no fallback como text/html e o browser recusava o módulo (tela branca).
  await app.register(fastifyStatic, { root: webDist });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.method !== 'GET') {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.type('text/html').sendFile('index.html');
  });
}
