import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';

// Carrega .env (sem dependência: parser mínimo) antes de ler process.env.
// Em prod o .env vem do VPS (docker compose env_file), igual ao OpenClaw.
function loadDotenv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotenv();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Config ausente: ${name} (veja portal/.env.example)`);
  return v;
}
function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}
function absDir(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

const isProd = process.env.NODE_ENV === 'production';

// Em produção a auth é obrigatória. Em dev pode subir sem (banner de aviso).
const accessKeyHash = isProd ? required('PORTAL_ACCESS_KEY_HASH') : (process.env['PORTAL_ACCESS_KEY_HASH'] ?? '');
const cookieSecret = isProd ? required('PORTAL_COOKIE_SECRET') : optional('PORTAL_COOKIE_SECRET', 'dev-insecure-cookie-secret-change-me');

export const config = {
  isProd,
  port: Number(optional('PORT', '8080')),
  publicOrigin: optional('PUBLIC_ORIGIN', 'http://localhost:8080'),

  auth: {
    accessKeyHash,
    cookieSecret,
    sessionTtlS: Number(optional('PORTAL_SESSION_TTL_S', '43200')),
    cookieName: 'msu_portal_sess',
  },

  github: {
    token: optional('GITHUB_TOKEN', ''),
    repo: optional('GITHUB_REPO', 'josuenvpereira/remotion_project'),
    defaultBranch: optional('GITHUB_DEFAULT_BRANCH', 'main'),
    webhookSecret: optional('GITHUB_WEBHOOK_SECRET', ''),
  },

  // org.json é roster-driven (scripts/generate_org_manifest.js) e vive na
  // RAIZ deste repo (standalone). Em prod o Dockerfile copia p/ /app/org.json.
  org: {
    manifestPath: absDir(optional('ORG_MANIFEST_PATH', './org.json')),
  },

  openclaw: {
    usageUrl: optional('OPENCLAW_USAGE_URL', 'https://claw.jotaene.ia.br/usage'),
    usageToken: optional('OPENCLAW_USAGE_TOKEN', ''),
    // snapshots gerados por scripts/openclaw-export.sh (host) — montado :ro
    exportDir: absDir(optional('OPENCLAW_EXPORT_DIR', './data/openclaw-export')),
    // preço DeepSeek (USD por 1M tokens) p/ estimar custo — Josué configura
    priceProPer1M: Number(optional('DEEPSEEK_PRO_USD_PER_1M', '0')),
    priceFlashPer1M: Number(optional('DEEPSEEK_FLASH_USD_PER_1M', '0')),
  },

  sfx: {
    // Fábrica SFX (na casa, via WireGuard). Só o backend fala com isso.
    baseUrl: optional('SFX_BASE_URL', 'http://10.8.0.2:8000'),
    apiKey: optional('SFX_API_KEY', ''),
    connectTimeoutMs: Number(optional('SFX_CONNECT_TIMEOUT_S', '5')) * 1000,
    readTimeoutMs: Number(optional('SFX_READ_TIMEOUT_S', '900')) * 1000,
    get libDir(): string { return resolve(config.storage.dataDir, 'sfx-library'); },
  },

  storage: {
    dataDir: absDir(optional('DATA_DIR', './data')),
    repoDir: absDir(optional('REPO_DIR', '../')),
    get dbPath(): string { return resolve(config.storage.dataDir, 'portal.sqlite'); },
    get vaultDir(): string { return resolve(config.storage.dataDir, 'vault'); },
  },

  cost: {
    monthlyBudgetUsd: Number(optional('COST_MONTHLY_BUDGET_USD', '30')),
  },
} as const;

export type Config = typeof config;
