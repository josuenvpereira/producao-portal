import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type {
  RawPipelineState,
  CostApprovalSignal,
  EscalationSignal,
  ScriptJson,
  ScriptBlock,
} from '../domain.js';
import type {
  AdapterResult,
  AssetRef,
  EpisodeProjection,
  RepoSnapshot,
  ScriptBlockProjection,
} from './types.js';

// Adapter de filesystem do repo (local/VPS). pipeline-state/*.json é
// gitignored e vive onde o supervisor (orquestrador_msu) roda — no VPS o
// portal lê o MESMO diretório. script.json/áudio/imagens/brand são
// versionados. Tudo defensivo: arquivo ausente/corrompido → ignora + nota,
// nunca lança.

function safeJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function lsFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => {
      try {
        return statSync(join(dir, f)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function lsDirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => {
      try {
        return statSync(join(dir, f)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function asset(repoRoot: string, abs: string, kind: AssetRef['kind']): AssetRef | null {
  try {
    const st = statSync(abs);
    return {
      kind,
      relPath: relative(repoRoot, abs).split('\\').join('/'),
      bytes: st.size,
      mtime: st.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

function blockProjection(blocks: ScriptBlock[]): ScriptBlockProjection[] {
  return blocks.map((b, i): ScriptBlockProjection => {
    // spokenText pode estar no bloco (single) ou nos items (loop).
    let chars = b.spokenText?.length ?? 0;
    for (const it of b.items ?? []) chars += it.spokenText?.length ?? 0;
    const images = (b.elements ?? [])
      .filter((e) => typeof e.src === 'string' && /\.(png|jpe?g|webp)$/i.test(e.src))
      .map((e) => e.src as string);
    return {
      blockId: b.id,
      ord: i,
      kind: b.kind,
      audioFile: b.audioFile ?? null,
      durationFrames: b.durationFrames ?? null,
      spokenChars: chars,
      images,
    };
  });
}

/** Mapeia episodeDir → { channel, scriptPath, script } varrendo src/channels. */
function discoverScripts(
  repoRoot: string,
): Map<string, { channel: string; scriptPath: string; script: ScriptJson }> {
  const out = new Map<string, { channel: string; scriptPath: string; script: ScriptJson }>();
  const channelsRoot = join(repoRoot, 'src', 'channels');
  for (const channel of lsDirs(channelsRoot)) {
    const videosRoot = join(channelsRoot, channel, 'videos');
    for (const epDir of lsDirs(videosRoot)) {
      const scriptPath = join(videosRoot, epDir, 'script.json');
      if (!existsSync(scriptPath)) continue;
      const script = safeJson<ScriptJson>(scriptPath);
      if (!script || !Array.isArray(script.blocks)) continue;
      const id = script.episodio_id || epDir;
      out.set(id, {
        channel,
        scriptPath: relative(repoRoot, scriptPath).split('\\').join('/'),
        script,
      });
    }
  }
  return out;
}

export function readRepoSnapshot(repoRoot: string): AdapterResult<RepoSnapshot> {
  const notes: string[] = [];
  let degraded = false;

  const scripts = discoverScripts(repoRoot);
  const stateDir = join(repoRoot, 'pipeline-state');
  const stateFiles = lsFiles(stateDir).filter(
    (f) => f.endsWith('.json') && !f.startsWith('_'),
  );
  if (!existsSync(stateDir)) {
    degraded = true;
    notes.push('pipeline-state/ ausente — esteira vazia');
  }

  // União: episódios com estado ∪ episódios com script.json.
  const ids = new Set<string>([
    ...stateFiles.map((f) => f.replace(/\.json$/, '')),
    ...scripts.keys(),
  ]);

  const episodes: EpisodeProjection[] = [];
  for (const episodeId of [...ids].sort()) {
    const sc = scripts.get(episodeId) ?? null;
    const state = safeJson<RawPipelineState>(join(stateDir, `${episodeId}.json`));
    const costApproval = safeJson<CostApprovalSignal>(
      join(stateDir, `_COST_APPROVAL_${episodeId}.json`),
    );
    const escalationSignal = safeJson<EscalationSignal>(
      join(stateDir, `_ESCALATION_${episodeId}.json`),
    );

    const channel = sc?.channel ?? 'my-storage-units';
    const epDirGuess = sc ? sc.scriptPath.split('/').slice(-2)[0]! : episodeId;
    const assets: AssetRef[] = [];
    const audioDir = join(repoRoot, 'public', 'channels', channel, 'videos', epDirGuess, 'audio');
    for (const f of lsFiles(audioDir)) {
      if (!/\.(mp3|wav|m4a)$/i.test(f)) continue;
      const a = asset(repoRoot, join(audioDir, f), 'audio');
      if (a) assets.push(a);
    }
    const imgDir = join(repoRoot, 'public', 'channels', channel, 'videos', epDirGuess, 'images');
    for (const f of lsFiles(imgDir)) {
      if (!/\.(png|jpe?g|webp)$/i.test(f)) continue;
      const a = asset(repoRoot, join(imgDir, f), 'image');
      if (a) assets.push(a);
    }

    episodes.push({
      episodeId,
      channel,
      title: sc?.script.titulo ?? episodeId,
      scriptPath: sc?.scriptPath ?? null,
      state,
      costApproval,
      escalationSignal,
      blocks: sc ? blockProjection(sc.script.blocks) : [],
      assets,
    });
  }

  const sharedAssets: AssetRef[] = [];
  const brandDir = join(repoRoot, 'public', 'shared', 'brand');
  for (const f of lsFiles(brandDir)) {
    if (!/\.(mp3|wav)$/i.test(f)) continue;
    const a = asset(repoRoot, join(brandDir, f), 'brand');
    if (a) sharedAssets.push(a);
  }

  return { data: { episodes, sharedAssets }, degraded, notes };
}
