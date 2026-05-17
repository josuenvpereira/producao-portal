import 'fastify';
import type { Db } from './db/db.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}
