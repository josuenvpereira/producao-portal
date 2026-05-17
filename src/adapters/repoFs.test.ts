import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRepoSnapshot } from './repoFs.js';

// Fixture: mini-repo com 1 episódio (estado + script + assets) + 1 só-script.
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'repofs-'));
  const ps = join(root, 'pipeline-state');
  mkdirSync(ps, { recursive: true });
  writeFileSync(
    join(ps, '03-cemiterio-skins.json'),
    JSON.stringify({
      episodeId: '03-cemiterio-skins',
      state: 'ROTEIRO',
      createdAt: '2026-05-16T10:00:00Z',
      updatedAt: '2026-05-16T11:00:00Z',
      attempts: { ROTEIRO: 1 },
      maxAttemptsPerStage: 3,
      escalated: false,
      history: [
        { at: '2026-05-16T10:00:00Z', from: null, to: 'NEW', by: 'supervisor', note: 'init' },
        { at: '2026-05-16T10:05:00Z', from: 'NEW', to: 'CURADORIA', by: 'curador_video', note: '' },
        { at: '2026-05-16T10:30:00Z', from: 'BRIEF_OK', to: 'ROTEIRO', by: 'roteirista_video', note: '' },
      ],
      escalations: [],
    }),
  );
  writeFileSync(
    join(ps, '_COST_APPROVAL_03-cemiterio-skins.json'),
    JSON.stringify({
      type: 'COST_APPROVAL', episodeId: '03-cemiterio-skins', channel: 'my-storage-units',
      at: '2026-05-16T10:40:00Z', projectedCostUsd: 4.2, budgetUsd: 3, chars: 14000, scenes: 6, files: ['cena_01.mp3'],
    }),
  );
  const vid = join(root, 'src', 'channels', 'my-storage-units', 'videos', '03-cemiterio-skins');
  mkdirSync(vid, { recursive: true });
  writeFileSync(
    join(vid, 'script.json'),
    JSON.stringify({
      episodio_id: '03-cemiterio-skins',
      titulo: 'Cemitério de Skins',
      branding: {},
      blocks: [
        { id: 'intro_stinger', kind: 'branded', variant: 'v1_neon', durationFrames: 90 },
        {
          id: 'hook', kind: 'single', audioFile: 'cena_01.mp3', durationFrames: 990,
          spokenText: 'x'.repeat(500),
          elements: [{ type: 'fadeImage', src: 'channels/my-storage-units/videos/03-cemiterio-skins/images/skin.png' }],
        },
        { id: 'core', kind: 'loop', items: [{ audioFile: 'cena_02.mp3', spokenText: 'y'.repeat(700) }] },
      ],
    }),
  );
  const aud = join(root, 'public', 'channels', 'my-storage-units', 'videos', '03-cemiterio-skins', 'audio');
  mkdirSync(aud, { recursive: true });
  writeFileSync(join(aud, 'cena_01.mp3'), Buffer.alloc(2048));
  const img = join(root, 'public', 'channels', 'my-storage-units', 'videos', '03-cemiterio-skins', 'images');
  mkdirSync(img, { recursive: true });
  writeFileSync(join(img, 'skin.png'), Buffer.alloc(1024));
  const brand = join(root, 'public', 'shared', 'brand');
  mkdirSync(brand, { recursive: true });
  writeFileSync(join(brand, 'bed_analytical_01.mp3'), Buffer.alloc(4096));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('readRepoSnapshot', () => {
  it('projeta episódio com estado + script + assets', () => {
    const { data, degraded } = readRepoSnapshot(root);
    expect(degraded).toBe(false);
    const ep = data.episodes.find((e) => e.episodeId === '03-cemiterio-skins');
    expect(ep).toBeTruthy();
    expect(ep!.title).toBe('Cemitério de Skins');
    expect(ep!.state?.state).toBe('ROTEIRO');
    expect(ep!.costApproval?.projectedCostUsd).toBe(4.2);
    expect(ep!.blocks).toHaveLength(3);
    const hook = ep!.blocks.find((b) => b.blockId === 'hook')!;
    expect(hook.spokenChars).toBe(500);
    expect(hook.images).toContain(
      'channels/my-storage-units/videos/03-cemiterio-skins/images/skin.png',
    );
    const loop = ep!.blocks.find((b) => b.blockId === 'core')!;
    expect(loop.spokenChars).toBe(700);
    expect(ep!.assets.some((a) => a.kind === 'audio')).toBe(true);
    expect(ep!.assets.some((a) => a.kind === 'image')).toBe(true);
    expect(data.sharedAssets.some((a) => a.relPath.includes('brand'))).toBe(true);
  });

  it('degrada sem pipeline-state mas não lança', () => {
    const empty = mkdtempSync(join(tmpdir(), 'empty-'));
    const r = readRepoSnapshot(empty);
    expect(r.data.episodes).toEqual([]);
    expect(r.degraded).toBe(true);
    rmSync(empty, { recursive: true, force: true });
  });
});
