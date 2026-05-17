import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { runIndexer } from '../indexer.js';

// Webhook do GitHub (push / workflow_run). HMAC SHA-256 obrigatório
// (x-hub-signature-256). Sem secret configurado → recusa (não aceita
// não-autenticado). Disparo reindexação debounced (não bloqueia a resposta).

let debounce: NodeJS.Timeout | null = null;
function scheduleReindex(app: FastifyInstance): void {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    runIndexer().catch((err) => app.log.error(err, 'reindex pós-webhook falhou'));
  }, 3000);
}

function validSignature(secret: string, raw: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/webhook/github', async (req: FastifyRequest, reply) => {
    if (!config.github.webhookSecret) {
      return reply.code(503).send({ error: 'webhook não configurado' });
    }
    const raw = req.rawBody;
    if (!raw) return reply.code(400).send({ error: 'corpo ausente' });
    const sig = req.headers['x-hub-signature-256'];
    if (!validSignature(config.github.webhookSecret, raw, typeof sig === 'string' ? sig : undefined)) {
      req.log.warn({ ip: req.ip }, 'webhook assinatura inválida');
      return reply.code(401).send({ error: 'assinatura inválida' });
    }
    const event = req.headers['x-github-event'];
    if (event === 'push' || event === 'workflow_run') {
      scheduleReindex(app);
      return reply.code(202).send({ ok: true, reindex: 'agendado' });
    }
    return reply.code(204).send();
  });
}
