import { createReadStream } from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sfxStatus, sfxCatalog, sfxGenerate, SfxError } from '../sfx/gateway.js';
import {
  saveGeneration,
  listLibrary,
  audioPath,
  deleteGeneration,
  setExported,
} from '../sfx/library.js';

const sfxAssetRel = (id: string): string => `sfx-library/${id}.mp3`;

// Proxy fino p/ a SFX Factory. Chave injetada server-side (nunca no browser).
// Registrado no escopo PROTEGIDO (cookie de sessão já gateia /api/*).

const KINDS = new Set(['sfx', 'bed', 'vocal']);

export async function sfxRoutes(app: FastifyInstance): Promise<void> {
  // status: nunca 5xx — "offline" é estado normal (casa desligada)
  app.get('/api/sfx/status', async () => sfxStatus());

  app.get('/api/sfx/catalog', async (_req, reply) => {
    try {
      return await sfxCatalog();
    } catch (e) {
      const err = e as SfxError;
      return reply.code(err.status ?? 503).send({ error: err.message });
    }
  });

  app.post(
    '/api/sfx/:kind',
    {
      // Voice Clone / Multi-Speaker enviam áudio de referência em base64
      // (até ~16MB); o bodyLimit global do server é 1MB — só esta rota sobe.
      bodyLimit: 32 * 1024 * 1024,
      schema: {
        params: {
          type: 'object',
          required: ['kind'],
          properties: { kind: { type: 'string', enum: ['sfx', 'bed', 'vocal'] } },
        },
      },
    },
    async (req: FastifyRequest<{ Params: { kind: string }; Body: unknown }>, reply) => {
      const kind = req.params.kind;
      if (!KINDS.has(kind)) return reply.code(404).send({ error: 'tipo inválido' });
      try {
        const { bytes, promptEn } = await sfxGenerate(
          kind as 'sfx' | 'bed' | 'vocal',
          req.body,
        );
        const meta = saveGeneration(
          kind as 'sfx' | 'bed' | 'vocal',
          req.body,
          bytes,
          promptEn,
        );
        reply.header('Content-Type', 'audio/mpeg');
        reply.header('Content-Disposition', `inline; filename="${meta.id}.mp3"`);
        reply.header('X-Sfx-Id', meta.id);
        if (promptEn) reply.header('X-Prompt-EN', promptEn);
        return reply.send(bytes);
      } catch (e) {
        const err = e as SfxError;
        req.log.warn({ kind, status: err.status }, 'sfx gen falhou');
        const payload: { error: string; detail?: unknown } = { error: err.message };
        if (err.detail !== undefined) payload.detail = err.detail;
        return reply.code(err.status ?? 502).send(payload);
      }
    },
  );

  app.get('/api/sfx/library', async () => listLibrary());

  app.get(
    '/api/sfx/library/:id/audio',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const p = audioPath(req.params.id);
      if (!p) return reply.code(404).send({ error: 'áudio não encontrado' });
      reply.header('Content-Type', 'audio/mpeg');
      reply.header('Cache-Control', 'private, max-age=86400');
      return reply.send(createReadStream(p));
    },
  );

  // Apaga um item da biblioteca (escopo protegido: só sessão válida).
  app.delete(
    '/api/sfx/library/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      if (!deleteGeneration(req.params.id)) {
        return reply.code(404).send({ error: 'áudio não encontrado' });
      }
      // mantém o read-model consistente: se estava exportado, sai dos Assets.
      app.db.prepare('DELETE FROM assets WHERE rel_path=?').run(sfxAssetRel(req.params.id));
      return { ok: true };
    },
  );

  // Exporta/desexporta p/ a aba Assets. Não move bytes: marca no <id>.json e
  // projeta a linha no read-model na hora (o indexer reconcilia depois).
  app.post(
    '/api/sfx/library/:id/export',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', maxLength: 64 } },
        },
        body: {
          type: 'object',
          required: ['exported'],
          properties: { exported: { type: 'boolean' } },
        },
      },
    },
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: { exported: boolean } }>,
      reply,
    ) => {
      const meta = setExported(req.params.id, req.body.exported);
      if (!meta) return reply.code(404).send({ error: 'áudio não encontrado' });
      const rel = sfxAssetRel(meta.id);
      if (req.body.exported) {
        app.db
          .prepare(
            `INSERT INTO assets (episode_id, kind, rel_path, bytes, mtime)
             VALUES ('__sfx__',?,?,?,?)
             ON CONFLICT(rel_path) DO UPDATE SET
               kind=excluded.kind, bytes=excluded.bytes, mtime=excluded.mtime`,
          )
          .run(meta.kind, rel, meta.bytes, new Date(meta.ts).toISOString());
      } else {
        app.db.prepare('DELETE FROM assets WHERE rel_path=?').run(rel);
      }
      return { ok: true, exported: req.body.exported };
    },
  );
}
