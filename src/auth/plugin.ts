import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { verifyKey } from './key.js';
import { issueSession, clearSession, isAuthed } from './session.js';
import { audit } from '../audit.js';

// Rotas de sessão. @fastify/cookie e @fastify/rate-limit são registrados na
// RAIZ (server.ts) p/ os decorators (req.cookies/unsignCookie) serem visíveis
// em todos os escopos. NÃO protege rotas aqui — quem protege é requireAuth.

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/auth/session',
    {
      config: { rateLimit: { max: 8, timeWindow: '5 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['key'],
          properties: { key: { type: 'string', minLength: 1, maxLength: 512 } },
        },
      },
    },
    async (req: FastifyRequest<{ Body: { key: string } }>, reply: FastifyReply) => {
      const ok =
        config.auth.accessKeyHash.length > 0 &&
        verifyKey(req.body.key, config.auth.accessKeyHash);
      if (!ok) {
        audit('login_fail', { ip: req.ip });
        return reply.code(401).send({ error: 'credenciais inválidas' });
      }
      audit('login_ok', { ip: req.ip });
      issueSession(reply);
      return reply.send({ ok: true });
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    audit('logout', { ip: req.ip });
    clearSession(reply);
    return reply.send({ ok: true });
  });

  app.get('/api/auth/me', async (req, reply) =>
    reply.send({ authenticated: isAuthed(req) }),
  );
}

/** preHandler do escopo protegido: 401 sem sessão; senão renova (TTL deslizante). */
export function requireAuth(req: FastifyRequest, reply: FastifyReply, done: () => void): void {
  if (!isAuthed(req)) {
    void reply.code(401).send({ error: 'não autenticado' });
    return;
  }
  issueSession(reply);
  done();
}
