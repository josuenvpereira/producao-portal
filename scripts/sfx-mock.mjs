#!/usr/bin/env node
// Mock LOCAL da SFX Factory — fiel ao PORTAL_HANDOFF.md (§4/§5).
// Serve p/ testar a aba SFX/Áudio sem a fábrica de casa (WireGuard).
// Aponte o portal para cá no .env:  SFX_BASE_URL=http://localhost:8099
//
//   npm run sfx:mock                 # porta 8099, key "dev-mock-key"
//   SFX_MOCK_PORT=9000 npm run sfx:mock
//   SFX_MOCK_DOWN=audioldm2 npm run sfx:mock   # /health PARCIAL
//
// Gatilhos de teste: inclua a palavra no prompt/text p/ forçar a resposta
//   ERR401 ERR422 ERRVOICE ERR404 ERR502 ERR503 ERR504 SLOW
// (ERRVOICE devolve o 422 estruturado de instruct — §4.5).
//
// Áudio: serve scripts/sfx-sample.mp3 se existir (tocável); senão um
// placeholder mínimo (o fluxo gerar→salvar→listar→baixar funciona; o
// <audio> pode não reproduzir o placeholder — para ouvir use um sample
// real ou a fábrica de verdade).
//
// ESM (.mjs) de propósito: scripts/ é CommonJS (scripts/package.json);
// .mjs roda como módulo sem conflito. Zero dependências (node:http).

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = Number(process.env['SFX_MOCK_PORT'] || 8099);
const KEY = process.env['SFX_MOCK_KEY'] || 'dev-mock-key';
const DIR = dirname(fileURLToPath(import.meta.url));

// Vocabulário FIXO de instruct — PORTAL_HANDOFF §4.5 (contrato final).
const VOCAB = {
  gender: ['male', 'female'],
  age: ['child', 'teenager', 'young adult', 'middle-aged', 'elderly'],
  accent: [
    'american accent', 'british accent', 'australian accent', 'canadian accent',
    'chinese accent', 'indian accent', 'japanese accent', 'korean accent',
    'portuguese accent', 'russian accent',
  ],
  pitch: ['very low pitch', 'low pitch', 'moderate pitch', 'high pitch', 'very high pitch'],
  style: ['whisper'],
};
const VOCAB_FLAT = new Set(Object.values(VOCAB).flat());

const BED_PRESETS = [
  { name: 'bed_cinematic_03', prompt: 'cinematic ambient pad, slow tension build', seed: 123 },
  { name: 'bed_lofi_01', prompt: 'lofi hip hop, mellow, vinyl crackle', seed: 7 },
  { name: 'bed_corporate_02', prompt: 'clean corporate background, light marimba', seed: 42 },
];

function sampleMp3() {
  const p = join(DIR, 'sfx-sample.mp3');
  if (existsSync(p)) return readFileSync(p);
  // Placeholder mínimo (não tocável; só p/ exercitar o fluxo).
  return Buffer.from('SUQzBAAAAAAAI1RTU0UAAAAPAAADTW9jayBTRlggRmFjdG9yeQ==', 'base64');
}

const sendJson = (res, code, obj, extra = {}) => {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': b.length, ...extra });
  res.end(b);
};
const sendAudio = (res, buf, headers = {}) => {
  res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': buf.length, ...headers });
  res.end(buf);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function authOk(req) {
  const k = req.headers['x-api-key'];
  const a = req.headers['authorization'];
  return k === KEY || a === `Bearer ${KEY}`;
}

const TRIGGERS = ['ERR401', 'ERR422', 'ERRVOICE', 'ERR404', 'ERR502', 'ERR503', 'ERR504', 'SLOW'];
function trigger(s) {
  const t = String(s || '');
  return TRIGGERS.find((x) => t.includes(x)) || null;
}

function badInstruct(instruct) {
  return String(instruct)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((x) => !VOCAB_FLAT.has(x));
}
const structured422 = (res, msg, bad) =>
  sendJson(res, 422, {
    detail: { erro: msg, tokens_invalidos: bad, validos: VOCAB, exemplo: 'female, young adult, portuguese accent' },
  });

const server = http.createServer(async (req, res) => {
  const url = (req.url || '').split('?')[0];
  const method = req.method || 'GET';

  if (method === 'GET' && url === '/health') {
    const down = (process.env['SFX_MOCK_DOWN'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    const st = (n) => (down.includes(n) ? 'indisponivel' : 'ok');
    return sendJson(res, 200, {
      gateway: st('gateway'),
      acestep: st('acestep'),
      omnivoice: st('omnivoice'),
      audioldm2: st('audioldm2'),
      acestep_url: 'http://acestep:8001',
      omnivoice_url: 'http://omnivoice:8002',
      audioldm2_url: 'http://audioldm2:8003',
    });
  }

  if (method === 'GET' && url === '/catalog') {
    return sendJson(res, 200, {
      create_any: {
        'POST /sfx': '{prompt} -> qualquer SFX/foley (AudioLDM2)',
        'POST /bed': '{prompt} -> qualquer musica (ACE-Step) | {name} preset',
        'POST /vocal': '{text} -> qualquer voz PT-BR (OmniVoice)',
      },
      bed_presets: BED_PRESETS,
    });
  }

  const gm = method === 'POST' && /^\/(sfx|bed|vocal)$/.exec(url);
  if (gm) {
    const kind = gm[1];
    let body = {};
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    } catch {
      return sendJson(res, 422, { detail: 'JSON inválido' });
    }

    if (!authOk(req)) return sendJson(res, 401, { detail: 'API key ausente ou inválida' });

    const probe = `${body.prompt ?? ''} ${body.text ?? ''} ${body.name ?? ''}`;
    switch (trigger(probe)) {
      case 'ERR401': return sendJson(res, 401, { detail: 'auth simulada (ERR401)' });
      case 'ERR422': return sendJson(res, 422, { detail: 'validação simulada (ERR422)' });
      case 'ERR404': return sendJson(res, 404, { detail: 'Preset não encontrado (ERR404)' });
      case 'ERR502': return sendJson(res, 502, { detail: 'erro proxy OmniVoice (ERR502)' });
      case 'ERR503': return sendJson(res, 503, { detail: 'GPU ocupada — tente em instantes (ERR503)' });
      case 'ERR504': return sendJson(res, 504, { detail: 'timeout ACE-Step (ERR504)' });
      case 'ERRVOICE':
        return structured422(res, 'instruct inválido (ERRVOICE)', ['banana', 'robot-voice']);
      default: break;
    }

    if (kind === 'sfx') {
      if (!String(body.prompt || '').trim()) return sendJson(res, 422, { detail: 'prompt obrigatório' });
      if (body.duration != null && (body.duration <= 0.5 || body.duration > 30))
        return sendJson(res, 422, { detail: 'duration fora de 0.5..30' });
    } else if (kind === 'bed') {
      if (!body.prompt && !body.name) return sendJson(res, 422, { detail: 'informe prompt OU name' });
      if (body.name && !BED_PRESETS.some((p) => p.name === body.name))
        return sendJson(res, 404, { detail: 'preset inexistente' });
    } else {
      if (!String(body.text || '').trim()) return sendJson(res, 422, { detail: 'text obrigatório' });
      if (body.instruct) {
        const bad = badInstruct(body.instruct);
        if (bad.length) return structured422(res, 'instruct inválido', bad);
      }
      if (Array.isArray(body.speakers)) {
        if (!/\[Speaker_\d+\]\s*:/.test(String(body.text)))
          return sendJson(res, 422, { detail: 'nenhuma fala [Speaker_N]: encontrada no text' });
        for (const sp of body.speakers) {
          if (sp && sp.instruct) {
            const bad = badInstruct(sp.instruct);
            if (bad.length) return structured422(res, `instruct inválido (speaker ${sp.tag})`, bad);
          }
        }
      }
    }

    await sleep(trigger(probe) === 'SLOW' ? 6000 : 1200); // simula processamento (spinner)
    const headers = { 'content-disposition': `inline; filename="${kind}.mp3"` };
    if (kind === 'sfx' && body.lang === 'pt')
      headers['x-prompt-en'] = `EN(${String(body.prompt).slice(0, 60)})`;
    return sendAudio(res, sampleMp3(), headers);
  }

  sendJson(res, 404, { detail: `rota ${method} ${url} não existe no mock` });
});

server.listen(PORT, () => {
  process.stdout.write(`\nSFX Factory MOCK em http://localhost:${PORT}  (key="${KEY}")\n`);
  process.stdout.write(`gatilhos no prompt/text: ${TRIGGERS.join(' ')}\n`);
  process.stdout.write(`/health PARCIAL: SFX_MOCK_DOWN=audioldm2  ·  Ctrl+C p/ parar\n\n`);
});
