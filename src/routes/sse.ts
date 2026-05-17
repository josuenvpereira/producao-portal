import type { FastifyInstance } from 'fastify';
import { getMeta } from '../db/db.js';

// SSE p/ a esteira ao vivo. Em vez de empurrar deltas, sinaliza "houve
// atualização" quando o indexer regrava o read-model (meta.last_sync muda) —
// o frontend então refaz os fetches. Simples e robusto atrás de proxy.

export async function sseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/stream', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 5000\n\n');

    let lastSync = getMeta(app.db, 'last_sync') ?? '';
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ lastSync })}\n\n`);

    const poll = setInterval(() => {
      try {
        const cur = getMeta(app.db, 'last_sync') ?? '';
        if (cur !== lastSync) {
          lastSync = cur;
          reply.raw.write(`event: update\ndata: ${JSON.stringify({ lastSync })}\n\n`);
        }
      } catch {
        /* db transitório — ignora, próxima iteração tenta */
      }
    }, 4000);

    const beat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 25000);

    const close = (): void => {
      clearInterval(poll);
      clearInterval(beat);
    };
    req.raw.on('close', close);
    req.raw.on('error', close);
  });
}
