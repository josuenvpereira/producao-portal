import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';

// Biblioteca local: a fábrica NÃO persiste — cada geração devolve bytes 1x.
// Guardamos <id>.mp3 + <id>.json no volume portal-data (gitignored).

const LIB = config.sfx.libDir;
const ID_RE = /^[0-9]{10,}-[a-f0-9]{8}$/; // anti path-traversal

export interface SfxMeta {
  id: string;
  kind: 'sfx' | 'bed' | 'vocal';
  req: unknown;
  promptEn: string | null;
  ts: number;
  bytes: number;
}

function ensureDir(): void {
  mkdirSync(LIB, { recursive: true });
}

export function saveGeneration(
  kind: SfxMeta['kind'],
  req: unknown,
  bytes: Buffer,
  promptEn: string | null,
): SfxMeta {
  ensureDir();
  const id = `${Math.floor(Date.now() / 1000)}-${randomBytes(4).toString('hex')}`;
  const meta: SfxMeta = { id, kind, req, promptEn, ts: Date.now(), bytes: bytes.length };
  writeFileSync(join(LIB, `${id}.mp3`), bytes);
  writeFileSync(join(LIB, `${id}.json`), JSON.stringify(meta, null, 2));
  return meta;
}

export function listLibrary(): SfxMeta[] {
  if (!existsSync(LIB)) return [];
  const out: SfxMeta[] = [];
  for (const f of readdirSync(LIB)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(LIB, f), 'utf8')) as SfxMeta);
    } catch {
      /* meta corrompido — ignora */
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/** Caminho do mp3 se o id é válido e o arquivo existe; senão null. */
export function audioPath(id: string): string | null {
  if (!ID_RE.test(id)) return null;
  const p = join(LIB, `${id}.mp3`);
  try {
    if (statSync(p).isFile()) return p;
  } catch {
    /* não existe */
  }
  return null;
}
