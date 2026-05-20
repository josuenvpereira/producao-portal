import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';

// Biblioteca local: a fábrica NÃO persiste — cada geração devolve bytes 1x.
// Guardamos <id>.mp3 + <id>.json no volume portal-data (gitignored).

const LIB = config.sfx.libDir;
const ID_RE = /^[0-9]{10,}-[a-f0-9]{8}$/; // anti path-traversal
const PID_RE = /^pid_[0-9]{10,}-[a-f0-9]{8}$/;

export interface SfxMeta {
  id: string;
  kind: 'sfx' | 'bed' | 'vocal';
  req: unknown;
  promptEn: string | null;
  ts: number;
  bytes: number;
  exported?: boolean; // marcado p/ aparecer na aba Assets (read-model)
}

// Perfil de voz: snapshot reutilizável de uma geração vocal que rodou bem.
// Auto-contido (mp3 copiado pra <pid>.profile.mp3) — apagar o item original
// da Biblioteca NÃO quebra o perfil. Aplicar = preencher Voice Clone com
// ref_audio (o mp3 do perfil) + ref_text (a transcrição exata).
export interface SfxProfile {
  id: string;            // pid_<ts>-<rand>
  name: string;          // batizado pelo user
  fromLibraryId: string; // origem (pra rastrear; pode não existir mais)
  kind: 'vocal';
  sourceText: string;    // texto da geração original (= req.text)
  refText: string;       // o que vai como ref_text no Voice Clone (default = sourceText)
  language: string | null;
  createdAt: number;
  audioBytes: number;
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

/**
 * Marca/desmarca um item como exportado p/ Assets (persistido no <id>.json).
 * Retorna o meta atualizado ou null se id inválido / inexistente.
 */
export function setExported(id: string, exported: boolean): SfxMeta | null {
  if (!ID_RE.test(id)) return null;
  const metaPath = join(LIB, `${id}.json`);
  if (!existsSync(metaPath)) return null;
  let meta: SfxMeta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8')) as SfxMeta;
  } catch {
    return null;
  }
  meta.exported = exported;
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

/**
 * Apaga <id>.mp3 + <id>.json da biblioteca. ID_RE barra path-traversal
 * (mesmo guarda do audioPath) — só remove os 2 arquivos do próprio id,
 * nunca fora de LIB. Retorna true se removeu algo.
 */
export function deleteGeneration(id: string): boolean {
  if (!ID_RE.test(id)) return false;
  let removed = false;
  for (const ext of ['mp3', 'json'] as const) {
    const p = join(LIB, `${id}.${ext}`);
    try {
      if (existsSync(p)) {
        rmSync(p);
        removed = true;
      }
    } catch {
      /* já removido / sem permissão — ignora */
    }
  }
  return removed;
}

// ─────────────── Perfis ───────────────

function isVocalReq(req: unknown): req is { text: string; language?: string | null } {
  if (!req || typeof req !== 'object') return false;
  const r = req as Record<string, unknown>;
  return typeof r['text'] === 'string' && r['text'].trim().length > 0;
}

/**
 * Cria um perfil a partir de um item vocal da Biblioteca. Falha se o item
 * não existe, não é vocal, ou não tem `text`. Copia o mp3 pra
 * <pid>.profile.mp3 e grava <pid>.profile.json — perfil é auto-contido.
 */
export function createProfile(
  fromLibraryId: string,
  name: string,
  refText?: string,
): SfxProfile | { error: string } {
  ensureDir();
  if (!ID_RE.test(fromLibraryId)) return { error: 'id inválido' };
  const srcMeta = join(LIB, `${fromLibraryId}.json`);
  const srcAudio = join(LIB, `${fromLibraryId}.mp3`);
  if (!existsSync(srcMeta) || !existsSync(srcAudio)) {
    return { error: 'item da biblioteca não encontrado' };
  }
  let meta: SfxMeta;
  try {
    meta = JSON.parse(readFileSync(srcMeta, 'utf8')) as SfxMeta;
  } catch {
    return { error: 'metadados corrompidos' };
  }
  if (meta.kind !== 'vocal') return { error: 'só dá pra fazer perfil de vocal' };
  if (!isVocalReq(meta.req)) return { error: 'item vocal sem texto (não dá pra clonar)' };
  const cleanName = name.trim().slice(0, 64);
  if (!cleanName) return { error: 'nome do perfil obrigatório' };
  const sourceText = meta.req.text;
  const language = typeof meta.req.language === 'string' ? meta.req.language : null;
  const pid = `pid_${Math.floor(Date.now() / 1000)}-${randomBytes(4).toString('hex')}`;
  const audioBytes = readFileSync(srcAudio);
  const profile: SfxProfile = {
    id: pid,
    name: cleanName,
    fromLibraryId,
    kind: 'vocal',
    sourceText,
    refText: (refText ?? sourceText).slice(0, 4000),
    language,
    createdAt: Date.now(),
    audioBytes: audioBytes.length,
  };
  writeFileSync(join(LIB, `${pid}.profile.mp3`), audioBytes);
  writeFileSync(join(LIB, `${pid}.profile.json`), JSON.stringify(profile, null, 2));
  return profile;
}

export function listProfiles(): SfxProfile[] {
  if (!existsSync(LIB)) return [];
  const out: SfxProfile[] = [];
  for (const f of readdirSync(LIB)) {
    if (!f.endsWith('.profile.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(LIB, f), 'utf8')) as SfxProfile);
    } catch {
      /* perfil corrompido — ignora */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Caminho do mp3 do perfil se o id é válido e o arquivo existe; senão null. */
export function profileAudioPath(pid: string): string | null {
  if (!PID_RE.test(pid)) return null;
  const p = join(LIB, `${pid}.profile.mp3`);
  try {
    if (statSync(p).isFile()) return p;
  } catch {
    /* não existe */
  }
  return null;
}

/** Apaga <pid>.profile.json + <pid>.profile.mp3. Retorna true se removeu algo. */
export function deleteProfile(pid: string): boolean {
  if (!PID_RE.test(pid)) return false;
  let removed = false;
  for (const ext of ['profile.mp3', 'profile.json'] as const) {
    const p = join(LIB, `${pid}.${ext}`);
    try {
      if (existsSync(p)) {
        rmSync(p);
        removed = true;
      }
    } catch {
      /* ignora */
    }
  }
  return removed;
}
