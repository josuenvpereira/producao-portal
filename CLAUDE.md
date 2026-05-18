# producao-portal — Instruções para Claude

> Portal **read-only** de observabilidade do ambiente (vídeo MSU +
> Comunicação + Custo + Organograma + SFX), em **`producao.jotaene.ia.br`**.
> Stack: **Fastify + TS (Node ≥22, ESM)** · SPA **React/Vite** · **SQLite
> (`node:sqlite`)** · 1 imagem Docker (Fastify serve a SPA) · auth **chave
> única (hex-64) → cookie scrypt**. Repo **standalone** (extraído do
> `remotion_project` com histórico). CI/CD próprios.

---

## 🔀 Git workflow

- **Commitar direto em `main`** (projeto em iteração; sem branches por
  interação). Prefixo convencional (`feat:`/`fix:`/`chore:`/`docs:`).
- **Co-author obrigatório** (convenção do Josué — manter exatamente, não
  trocar pelo trailer default):
  ```
  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  ```
- **`push` na `main` DISPARA O CD** (`deploy.yml` → atualiza o VPS de
  verdade). Logo: **nunca** commitar quebrado em `main`. **Validar ANTES**
  (typecheck + test + web build). O `ci.yml` também roda em push/PR.
- **Nunca** `--force` / rebase destrutivo / pular hooks. Pushes = fast-forward.

## 📂 Leitura obrigatória antes de mexer

| Arquivo | Quando |
|---|---|
| `README.md` | visão geral, dev, deploy |
| este `CLAUDE.md` | sempre (arquitetura, regras, gotchas) |
| `docs/DEPLOY_HANDOFF.md` | qualquer coisa de deploy (tem o `§0`: layout + 2-repos + CD) |
| `docs/DEPLOY_SECRETS.md` | mexer no CD / segredos |
| `docs/RUNBOOK.md` | operação (backup, rotação de chave, incidentes) |
| `docs/adr/*` | decisões de arquitetura (stack, auth, read-model, deploy) |
| `.env.example` | toda config nova (12-factor) |

## 🔌 Fontes de dados — CRÍTICO (modelo de 2 repositórios)

Este repo = **código/CD do portal**. Em runtime (VPS) ele **consome dados
de fora** — isso NÃO muda e confunde quem chega:

| Fonte (no VPS) | Fornece | Notas |
|---|---|---|
| clone `:ro` do **`remotion_project`** em `/repo` (`REPO_DIR`) | vídeo: `script.json`, áudio/imagens, `pipeline-state/` | ⚠️ **esteira de vídeo "ao vivo" só popula quando o `orquestrador_msu` rodar no VPS** (migração à parte). Vazia no deploy inicial = **esperado, não é bug**. |
| **exporter** `scripts/openclaw-export.sh` (cron `*/5` **no HOST**) → `/openclaw-export` `:ro` (`OPENCLAW_EXPORT_DIR`) | **Comunicação** (crons gerente-com/analista-com + o que cada execução produziu) + **custo real por agente** | ⚠️ arquivos do OpenClaw são `0600 node` → **não montar `.openclaw/` direto**; é o exporter via CLI. |
| **GitHub Actions API** (`render-ep.yml` está no **remotion_project**) | runs + MP4 de render | `GITHUB_REPO=josuenvpereira/remotion_project` (NÃO este). PAT fine-grained read-only. |
| **SFX Factory** `http://10.8.0.2:8000` (WireGuard do host) | geração de áudio | portal **proxia** com `SFX_API_KEY` server-side; browser nunca vê a chave. |
| `org.json` (raiz, versionado) | organograma | roster-driven (`scripts/generate_org_manifest.js`); `ORG_MANIFEST_PATH`; Dockerfile copia p/ `/app/org.json`. |

**Adapters degradam graciosamente** (fonte fora → dado stale + aviso, nunca
crash). Manter esse padrão em qualquer fonte nova.

## 🤖 Roster real (organograma) — NÃO FABRICAR

Fonte da verdade = **`scripts/generate_org_manifest.js`** (roster-driven, de
`openclaw agents list` real no VPS):

- **CEO = `Jotaene`** (agente/branch **`main`**) — NÃO "Josué" (esse é o humano)
- **Conteúdo·Mensageria**: `gerente-com` + `analista-com`
- **Canal MSU·Vídeo**: `gerente-canal-msu` (líder) + `curador-msu` ·
  `roteirista-msu` · `diretor-criativo-msu` · `produtor-msu` · `revisor-msu` ·
  `designer-msu`
- **NÃO existe `orquestrador-msu`** (foi inventado 2× em sessões passadas —
  **não repetir**). Ajustes finos persistem via `org.overrides.json`.

> Princípio: **projeto estritamente data-driven. Nunca fabricar dado nem
> chutar formato de parser** — pedir amostra real (openclaw.json, `cron runs`,
> `sessions --json`, /usage). O Josué corrigiu o roster 2× por causa disso.

## 🔐 Auth & segurança

- Chave única **hex-64** (`scripts/gen-portal-key.js`, padrão OpenClaw,
  configurável `--bytes/--format/--prefix`) → cookie **scrypt** assinado
  HttpOnly/Secure/SameSite=Strict. **`src/auth/key.ts` é AGNÓSTICO de
  formato** → dá pra trocar o padrão da chave sem tocar no servidor (só o
  gerador + o hash no `.env`).
- Container **não-root**, rootfs `read_only`, `cap_drop: ALL`,
  `no-new-privileges`, **sem docker socket**. Só lê (mounts `:ro`, GitHub
  API, proxy SFX). `SFX_API_KEY`/segredos **só** no `.env` do backend, nunca
  no bundle. Helmet (CSP/HSTS), rate-limit no login, assets via stream
  autenticado com **anti path-traversal** (padrão `render_daemon.js`).
- HTTPS/TLS herdados do **mesmo Traefik do OpenClaw** (mesmo certresolver).

## 🧪 Dev & validação (rodar ANTES de commitar — main = deploy)

```bash
npm install && npm run typecheck && npm test            # backend (30 testes hoje)
npx vitest run src/auth/key.test.ts                     # 1 arquivo de teste
npx vitest run -t "<substring do nome>"                 # 1 teste por nome
npm --prefix web install && npm --prefix web run build  # SPA (tsc + vite)
node scripts/gen-portal-key.js        # chave + hash → .env (PORTAL_ACCESS_KEY_HASH)
cp .env.example .env                  # preencher
node scripts/generate_org_manifest.js # (re)gera org.json
npm run dev                           # :8080 (login com a chave)
npm run indexer                       # popula o read-model SQLite
```
Manter **typecheck limpo + testes verdes + web build** sempre.

## 🚀 Deploy & CD

- **Deploy inicial:** `docs/DEPLOY_HANDOFF.md` (plano faseado F0–F9 p/ sessão
  com SSH no Hostinger; reconciliação das fontes; checklist).
- **CD:** `push` na `main` → `.github/workflows/deploy.yml` → SSH no VPS →
  `git reset --hard origin/main` + `docker compose up -d --build` + healthz.
  **Pula limpo** enquanto não houver segredos (`docs/DEPLOY_SECRETS.md`:
  `VPS_HOST/USER/SSH_KEY/PORT/PORTAL_DIR`).
- **CI:** `.github/workflows/ci.yml` (typecheck/test/web build/audit/gitleaks).

## ⚠️ Gotchas (lições caras — NÃO reverter)

- **⛔ REGRA DE OURO:** `scripts/openclaw-export.sh` invoca a CLI via
  `docker exec <oc> runuser -u node -- openclaw …`. Sem o `runuser -u node`
  roda como **root**, tranca `/tmp` em 700 e **DERRUBA o gateway
  OpenClaw/WhatsApp** (cron `*/5` mataria a cada 5 min). **Não reverter.**
- **Casa desligada = SFX "offline" é estado NORMAL** (badge cinza, sem
  erro/crash). GPU **concorrência = 1**: o portal serializa e **recusa 409**
  se já há geração. **Nunca** disparar gerações paralelas.
- **`node:sqlite`** exige Node ≥22 e é importado via `createRequire` (o
  transform do Vite/tsx não resolve o builtin). Não trocar por import estático.
- **`verbatimModuleSyntax`** (tsconfig backend) → `import type` p/ tipos. O
  tsconfig da `web` tem `noUnusedLocals/Params` (nada sobrando).
- **`scripts/` é CommonJS** (`require`) via `scripts/package.json`
  (`type:commonjs`) — a raiz é ESM. Imports da SPA = **extensionless**
  (Vite); do backend = **`.js`** (NodeNext).
- **`pipeline-state/` é gitignored** e só existe onde o orquestrador roda →
  esteira de vídeo vazia até a migração do orquestrador (esperado).
- **Artifacts do GitHub expiram** (MP4 14d) → o adapter baixa no momento da
  ingestão (vault). Sem `GITHUB_TOKEN`, render degrada (sem crash).
- **2 repos:** este = portal/CD; `remotion_project` = dados de vídeo +
  `render-ep.yml`. **Não** apontar `/repo` p/ este repo; `GITHUB_REPO`
  continua `remotion_project`.

## 🗺️ Mapa de arquivos

| Caminho | O quê |
|---|---|
| `src/server.ts` · `src/config.ts` | bootstrap · config 12-factor (`.env`) |
| `src/auth/` | `key.ts` (scrypt, tempo-constante, agnóstico de formato) · cookie |
| `src/adapters/` | `repoFs` · `githubActions`(+vault) · `openclawExport` · `costDerive` · `openclawUsage`(legado) |
| `src/db/` | `migrations.ts` · `queries.ts` · `db.ts` (`node:sqlite`) |
| `src/indexer.ts` | projeção fontes → SQLite (idempotente) |
| `src/routes/` | `api` · `assets` · `sse` · `webhook` · `sfx` · `spa` |
| `src/sfx/` | `gateway.ts` (proxy+lock+erros) · `library.ts` (persist/anti-traversal) |
| `web/src/pages/` | Overview · Esteira · Episode · Custos · Comunicacao · Organograma · Sfx · Assets |
| `scripts/` | `gen-portal-key.js` · `generate_org_manifest.js` · `openclaw-export.sh` |
| `docs/` | `DEPLOY_HANDOFF.md` · `DEPLOY.md` · `DEPLOY_SECRETS.md` · `RUNBOOK.md` · `adr/` |
