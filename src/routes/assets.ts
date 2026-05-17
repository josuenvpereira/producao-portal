import { createReadStream, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { audit } from '../audit.js';

// Streaming de assets GATEADO (escopo protegido). Anti path-traversal idêntico
// ao padrão de scripts/render_daemon.js: resolve + força pra dentro da raiz
// permitida. Só serve de public/ (áudio/imagem/brand versionados). Range p/
// players. Allowlist de extensão → content-type.

const PUBLIC_ROOT = resolve(config.storage.repoDir, 'public');

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

function safeResolve(relRaw: string): string | null {
  const abs = resolve(PUBLIC_ROOT, relRaw.replace(/^[/\\]+/, ''));
  if (abs !== PUBLIC_ROOT && !abs.startsWith(PUBLIC_ROOT + sep)) return null;
  return abs;
}

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/assets/file',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string', minLength: 1, maxLength: 512 } },
        },
      },
    },
    async (req: FastifyRequest<{ Querystring: { path: string } }>, reply) => {
      const rel = req.query.path;
      const abs = safeResolve(rel);
      if (!abs) return reply.code(400).send({ error: 'path inválido' });
      const ext = extname(abs).toLowerCase();
      const mime = MIME[ext];
      if (!mime) return reply.code(415).send({ error: 'tipo não permitido' });

      let st;
      try {
        st = statSync(abs);
        if (!st.isFile()) throw new Error('not file');
      } catch {
        return reply.code(404).send({ error: 'asset não encontrado' });
      }

      audit('asset_served', { ip: req.ip, path: rel });
      reply.header('Content-Type', mime);
      reply.header('Cache-Control', 'private, max-age=300');
      reply.header('Accept-Ranges', 'bytes');

      const range = req.headers.range;
      const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
      if (m) {
        const size = st.size;
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : size - 1;
        if (start >= size || end >= size || start > end) {
          return reply
            .code(416)
            .header('Content-Range', `bytes */${size}`)
            .send();
        }
        reply
          .code(206)
          .header('Content-Range', `bytes ${start}-${end}/${size}`)
          .header('Content-Length', String(end - start + 1));
        return reply.send(createReadStream(abs, { start, end }));
      }

      reply.header('Content-Length', String(st.size));
      return reply.send(createReadStream(abs));
    },
  );
}
