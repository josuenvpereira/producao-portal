import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// env ANTES de importar config/gateway/library
const dataDir = mkdtempSync(join(tmpdir(), 'sfx-'));
process.env['DATA_DIR'] = dataDir;
process.env['SFX_API_KEY'] = 'k-test';
process.env['SFX_BASE_URL'] = 'http://10.8.0.2:8000';

type G = typeof import('./gateway.js');
type L = typeof import('./library.js');
let gw: G;
let lib: L;

function res(status: number, body: unknown, headers: Record<string, string> = {}, json = true) {
  return {
    ok: status === 200,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => String(body),
    arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer,
  } as unknown as Response;
}

beforeAll(async () => {
  gw = await import('./gateway.js');
  lib = await import('./library.js');
});
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe('sfx gateway — status', () => {
  it('todos ok → no_ar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { gateway: 'ok', acestep: 'ok', omnivoice: 'ok', audioldm2: 'ok' }, { 'content-type': 'application/json' })));
    const s = await gw.sfxStatus();
    expect(s.reachable).toBe(true);
    expect(s.state).toBe('no_ar');
    expect(s.down).toEqual([]);
  });
  it('um indisponivel → parcial + lista down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { gateway: 'ok', acestep: 'ok', omnivoice: 'ok', audioldm2: 'indisponivel' })));
    const s = await gw.sfxStatus();
    expect(s.state).toBe('parcial');
    expect(s.down).toContain('audioldm2');
  });
  it('fetch falha (casa off) → offline, sem lançar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const s = await gw.sfxStatus();
    expect(s.reachable).toBe(false);
    expect(s.state).toBe('offline');
  });
});

describe('sfx gateway — geração: erros + lock', () => {
  it('não-200 vira SfxError com status+detail (§5)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(503, { detail: 'GPU ocupada' }, { 'content-type': 'application/json' })));
    await expect(gw.sfxGenerate('sfx', { prompt: 'x' })).rejects.toMatchObject({ status: 503, message: 'GPU ocupada' });
  });
  it('422 estruturado (instruct inválido) preserva o objeto detail (§4.5)', async () => {
    const detailObj = {
      erro: 'instruct inválido',
      tokens_invalidos: ['banana'],
      validos: { gender: ['male', 'female'], age: [], accent: [], pitch: [], style: ['whisper'] },
      exemplo: 'female, young adult, portuguese accent',
    };
    vi.stubGlobal('fetch', vi.fn(async () => res(422, { detail: detailObj }, { 'content-type': 'application/json' })));
    const err = await gw.sfxGenerate('vocal', { text: 'oi', instruct: 'banana' }).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.message).toBe('instruct inválido'); // detail.erro vira a message
    expect(err.detail).toEqual(detailObj); // objeto preservado p/ a UI montar dropdowns
  });
  it('detail string → message = string, sem detail estruturado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(404, { detail: 'Preset não encontrado' }, { 'content-type': 'application/json' })));
    const err = await gw.sfxGenerate('bed', { name: 'x' }).catch((e) => e);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Preset não encontrado');
    expect(err.detail).toBeUndefined();
  });
  it('200 → bytes + X-Prompt-EN', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, 'MP3DATA', { 'x-prompt-en': 'broken glass' })));
    const r = await gw.sfxGenerate('sfx', { prompt: 'vidro', lang: 'pt' });
    expect(r.promptEn).toBe('broken glass');
    expect(r.bytes.length).toBeGreaterThan(0);
  });
  it('lock: 2ª geração concorrente → 409', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal('fetch', vi.fn(async () => { await gate; return res(200, 'X'); }));
    const p1 = gw.sfxGenerate('bed', { prompt: 'a' });
    await expect(gw.sfxGenerate('bed', { prompt: 'b' })).rejects.toMatchObject({ status: 409 });
    release();
    await p1;
  });
});

describe('sfx library — persist/list/anti-traversal', () => {
  it('salva, lista (desc) e valida id', () => {
    const m = lib.saveGeneration('vocal', { text: 'oi' }, Buffer.from('AAA'), null);
    expect(m.id).toMatch(/^\d{10,}-[a-f0-9]{8}$/);
    const all = lib.listLibrary();
    expect(all.find((x) => x.id === m.id)).toBeTruthy();
    expect(lib.audioPath(m.id)).toContain(`${m.id}.mp3`);
    expect(lib.audioPath('../etc/passwd')).toBeNull();
    expect(lib.audioPath('nope')).toBeNull();
  });
});

describe('sfx library — perfis (Voice Clone reutilizável)', () => {
  const validB64 = Buffer.from('FAKEAUDIOBYTES_long_enough_to_pass').toString('base64');

  it('cria perfil a partir de áudio b64 + transcrição (input direto)', () => {
    const p = lib.createProfile({
      name: '  Voz narrador  ',
      refAudioB64: validB64,
      refText: 'Olá, sou o Jotaene',
      language: 'pt',
    });
    if ('error' in p) throw new Error('esperava perfil, veio error: ' + p.error);
    expect(p.id).toMatch(/^pid_\d{10,}-[a-f0-9]{8}$/);
    expect(p.name).toBe('Voz narrador'); // trim
    expect(p.refText).toBe('Olá, sou o Jotaene');
    expect(p.language).toBe('pt');
    expect(p.audioBytes).toBeGreaterThan(0);

    const all = lib.listProfiles();
    expect(all.find((x) => x.id === p.id)).toBeTruthy();
    expect(lib.profileAudioPath(p.id)).toContain(`${p.id}.profile.mp3`);
  });

  it('listLibrary NÃO inclui perfis (.profile.json) — bug que dava tela preta', () => {
    // garante que tem um perfil + um item normal coexistindo
    lib.createProfile({ name: 'P', refAudioB64: validB64, refText: 'oi' });
    const m = lib.saveGeneration('sfx', { prompt: 'vidro' }, Buffer.from('B'), null);
    const items = lib.listLibrary();
    expect(items.find((x) => x.id === m.id)).toBeTruthy();
    // nenhum item da Biblioteca pode ter id começando com pid_
    expect(items.every((x) => !x.id.startsWith('pid_'))).toBe(true);
    // e todos têm `req` definido (era o crash do map: r['prompt'] em undefined)
    expect(items.every((x) => x.req !== undefined)).toBe(true);
  });

  it('language opcional/vazio vira null', () => {
    const p = lib.createProfile({ name: 'X', refAudioB64: validB64, refText: 'oi' });
    if ('error' in p) throw new Error('esperava perfil');
    expect(p.language).toBeNull();
    const p2 = lib.createProfile({ name: 'Y', refAudioB64: validB64, refText: 'oi', language: '   ' });
    if ('error' in p2) throw new Error('esperava perfil');
    expect(p2.language).toBeNull();
  });

  it('falha em nome vazio / transcrição vazia / áudio ausente', () => {
    expect(lib.createProfile({ name: '   ', refAudioB64: validB64, refText: 'x' }))
      .toEqual({ error: 'nome do perfil obrigatório' });
    expect(lib.createProfile({ name: 'X', refAudioB64: validB64, refText: '   ' }))
      .toEqual({ error: 'transcrição exata obrigatória' });
    expect(lib.createProfile({ name: 'X', refAudioB64: '', refText: 'x' }))
      .toEqual({ error: 'áudio de referência obrigatório' });
  });

  it('deleteProfile remove json + mp3; PID_RE barra path-traversal', () => {
    const p = lib.createProfile({ name: 'tmp', refAudioB64: validB64, refText: 'oi' });
    if ('error' in p) throw new Error('esperava perfil');
    expect(lib.deleteProfile(p.id)).toBe(true);
    expect(lib.profileAudioPath(p.id)).toBeNull();
    expect(lib.deleteProfile('../etc/passwd')).toBe(false);
    expect(lib.deleteProfile('pid_invalid')).toBe(false);
  });
});
