#!/usr/bin/env node
// Gerador da CHAVE ÚNICA do portal de produção.
//
// Gera 1 chave de ALTA ENTROPIA, exibe UMA vez e calcula o hash (scrypt —
// KDF memory-hard nativa do Node) que vai pro .env do servidor. O servidor
// NUNCA armazena a chave em claro: só o hash. A verificação
// (portal/src/auth/key.ts) é AGNÓSTICA de formato — qualquer string de chave
// funciona (hex / base64url / com prefixo). Por isso dá pra espelhar o
// padrão do OpenClaw só mudando as opções abaixo, sem tocar no servidor.
//
// PADRÃO (default): hex, 32 bytes → 64 chars (mesmo padrão da chave de login
// do OpenClaw). Configurável por opções.
//
// USO:
//   node scripts/gen-portal-key.js                       # default: hex 32 bytes (64 chars)
//   node scripts/gen-portal-key.js --bytes 48            # mais entropia (>=16)
//   node scripts/gen-portal-key.js --format base64url    # base64url (~1.37*bytes)
//   node scripts/gen-portal-key.js --prefix msu          # prefixa: "msu_<chave>"
//
// COMO MODIFICAR a chave de acesso (rotação / trocar de padrão):
//   1) rode o comando acima com as opções desejadas
//   2) copie a CHAVE (é o que você digita no login do portal)
//   3) cole a linha PORTAL_ACCESS_KEY_HASH=... no .env do servidor
//        - local:  portal/.env   · VPS: o .env do deploy
//   4) reinicie:  VPS → `docker compose up -d portal` ;
//                 local → o tsx-watch reinicia, mas mudança de .env exige
//                         reiniciar o `npm run dev`
//   A chave antiga para de funcionar na hora (o servidor só conhece o hash).

const crypto = require('node:crypto');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const bytes = Math.max(16, parseInt(arg('bytes', '32'), 10) || 32);
const format = arg('format', 'hex'); // hex (default, padrão OpenClaw) | base64url
const prefix = arg('prefix', '');

// KDF: scrypt, parâmetros OWASP (N=2^15, r=8, p=1). Em sync com
// portal/src/auth/key.ts. NÃO depende do formato/tamanho da chave.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };

function hashKey(key, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const dk = crypto.scryptSync(key, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${dk.toString('hex')}`;
}

const raw = crypto.randomBytes(bytes).toString(format === 'hex' ? 'hex' : 'base64url');
const key = prefix ? `${prefix}_${raw}` : raw;
const hash = hashKey(key);

process.stdout.write(`
========================================================================
  CHAVE ÚNICA DO PORTAL — exibida UMA vez. Guarde no gerenciador de senhas.
  (${bytes} bytes · ${format}${prefix ? ` · prefixo "${prefix}_"` : ''} · ${key.length} chars)
========================================================================

  CHAVE (use no login do portal):

      ${key}

  Coloque esta linha no .env do servidor (NÃO no git):

      PORTAL_ACCESS_KEY_HASH=${hash}

  - O servidor guarda só o hash; comparação tempo-constante.
  - Trocar/revogar? Rode de novo e substitua o hash no .env + reinicie.
========================================================================
`);
