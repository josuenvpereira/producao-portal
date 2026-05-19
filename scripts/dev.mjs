#!/usr/bin/env node
// dev.mjs — sobe o AMBIENTE DE DEV completo num único comando:
//   [mock] SFX Factory mock   (scripts/sfx-mock.mjs            :8099)
//   [api]  backend Fastify    (npm run dev, ENV_FILE=.env.development :8080)
//   [web]  SPA Vite           (npm run dev em web/             :5173)
//
//   npm run dev:mock      # abra http://localhost:5173  ·  Ctrl+C para tudo
//
// O backend recebe ENV_FILE=.env.development → NUNCA lê/poluí o `.env` de
// produção (ver src/config.ts). Saída prefixada por processo; Ctrl+C ou a
// queda de qualquer processo derruba os demais. Zero dependências.
//
// ESM (.mjs) de propósito: scripts/ é CommonJS (scripts/package.json).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';

const PROCS = [
  { tag: 'mock', cmd: 'node scripts/sfx-mock.mjs', cwd: ROOT, env: {} },
  { tag: 'api', cmd: 'npm run dev', cwd: ROOT, env: { ENV_FILE: '.env.development' } },
  { tag: 'web', cmd: 'npm run dev', cwd: resolve(ROOT, 'web'), env: {} },
];
const COLOR = { mock: '\x1b[35m', api: '\x1b[36m', web: '\x1b[32m' };
const RESET = '\x1b[0m';

const children = [];
let shuttingDown = false;

function prefix(tag, chunk) {
  const head = `${COLOR[tag] ?? ''}[${tag}]${RESET} `;
  const text = chunk.toString();
  for (const line of text.split('\n')) {
    if (line.length) process.stdout.write(head + line + '\n');
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write('\n[dev] encerrando ambiente…\n');
  for (const c of children) {
    if (!c || c.killed || c.exitCode != null) continue;
    if (WIN) spawn('taskkill', ['/pid', String(c.pid), '/T', '/F']);
    else c.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code ?? 0), 400);
}

for (const p of PROCS) {
  const child = spawn(p.cmd, {
    cwd: p.cwd,
    shell: true,
    env: { ...process.env, ...p.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => prefix(p.tag, d));
  child.stderr.on('data', (d) => prefix(p.tag, d));
  child.on('exit', (code) => {
    if (!shuttingDown) {
      process.stdout.write(`\n[dev] "${p.tag}" saiu (code=${code}) — derrubando o resto.\n`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

process.stdout.write(
  '[dev] subindo  mock:8099 · api:8080 · web:5173\n' +
    '[dev] abra http://localhost:5173   (Ctrl+C encerra tudo)\n\n',
);
