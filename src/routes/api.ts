import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  overview,
  pipeline,
  episodeDetail,
  costSummary,
  comunicacao,
  assetsList,
  esteira,
  orgManifest,
} from '../db/queries.js';
import { runIndexer } from '../indexer.js';

// Endpoints read-only. Registrados em escopo protegido (requireAuth).
export async function apiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/overview', async () => overview(app.db));
  app.get('/api/pipeline', async () => pipeline(app.db));
  app.get('/api/episodes', async () => pipeline(app.db));

  app.get(
    '/api/episodes/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: '^[a-z0-9-]+$' } },
        },
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const d = episodeDetail(app.db, req.params.id);
      if (!d) return reply.code(404).send({ error: 'episódio não encontrado' });
      return d;
    },
  );

  app.get('/api/cost/summary', async () => costSummary(app.db));
  app.get('/api/comunicacao', async () => comunicacao(app.db));
  app.get('/api/assets', async () => assetsList(app.db));
  app.get('/api/esteira', async () => esteira(app.db));
  app.get('/api/org', async () => orgManifest());

  // Atualização sob demanda — força um reindex e responde com o resumo.
  // Já é re-entrancy-safe (guard `inFlight` em indexer.ts): cliques
  // concorrentes compartilham o mesmo Promise, sem duplicar trabalho.
  // O SSE de /api/stream também notifica em até ~4s (last_sync mudou).
  app.post('/api/admin/reindex', async () => {
    const r = await runIndexer();
    return { ok: true, ...r };
  });
}
