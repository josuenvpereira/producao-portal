import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  overview,
  pipeline,
  episodeDetail,
  costSummary,
  orgManifest,
} from '../db/queries.js';

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
  app.get('/api/org', async () => orgManifest());
}
