# Portal de Produção — `producao.jotaene.ia.br`

Portal **read-only** de observabilidade do ambiente: esteira de vídeo (pipeline
MSU), **Comunicação** (crons gerente-com/analista-com + o que cada execução
produziu), **Custo real por agente** (tokens OpenClaw), **organograma**
(roster real, Jotaene/CEO) e aba **SFX** (geração de áudio via fábrica).

> **Repo standalone.** Foi extraído do `remotion_project` (com histórico via
> subtree split). Stack: Fastify + TS (Node 22) + SPA React/Vite, SQLite
> (`node:sqlite`), 1 imagem Docker, auth chave única (hex-64) → cookie.

## Arquitetura de 2 repositórios (importante)

Este repo = **código + CD do portal**. Em runtime, no VPS, ele ainda
**consome dados** de fora (montados `:ro` / API) — isso não muda:

| Fonte (runtime, no VPS) | O que fornece |
|---|---|
| clone do **`remotion_project`** em `/repo` (`:ro`) | vídeo: `script.json`, áudio/imagens, pipeline-state |
| **exporter OpenClaw** (`scripts/openclaw-export.sh`, cron no host → `/openclaw-export :ro`) | Comunicação (crons/execuções) + custo por agente |
| **GitHub Actions API** (`render-ep.yml` do remotion_project, PAT ro) | runs/MP4 de render |
| **SFX Factory** `http://10.8.0.2:8000` (WireGuard) | geração de áudio (proxy, chave server-side) |
| `org.json` (raiz, roster-driven, versionado) | organograma |

## Estrutura

```
/ (raiz = o portal)
├── src/            # backend Fastify (API, adapters, indexer, auth, sfx)
├── web/            # SPA React/Vite
├── scripts/        # gen-portal-key.js · generate_org_manifest.js · openclaw-export.sh (CJS)
├── docs/           # DEPLOY_HANDOFF.md (deploy faseado) · DEPLOY.md · RUNBOOK.md · adr/
├── org.json        # roster (gerado por scripts/generate_org_manifest.js)
├── Dockerfile · docker-compose.yml · .env.example
└── .github/workflows/  portal-ci.yml · deploy.yml (CD: push main → VPS)
```

## Dev (local)

```bash
node scripts/gen-portal-key.js            # gera chave + hash
cp .env.example .env                      # preencher PORTAL_ACCESS_KEY_HASH etc.
npm install && npm run dev                # backend :8080 (serve a SPA se web/dist existir)
npm --prefix web install && npm --prefix web run dev   # SPA :5173 (proxy /api → :8080)
node scripts/generate_org_manifest.js     # (re)gera org.json
npm run indexer                           # popula o read-model
```

## Deploy & CD

- **Deploy inicial:** seguir **`docs/DEPLOY_HANDOFF.md`** (plano faseado F0–F9,
  para a sessão com SSH no Hostinger).
- **CD:** push na `main` → `.github/workflows/deploy.yml` conecta via SSH no
  VPS e faz `git pull + docker compose up -d --build + healthz`. Segredos
  necessários em `docs/DEPLOY_SECRETS.md`.

## Segurança (resumo)
Chave única (hash scrypt, nunca em claro) → cookie HttpOnly/Secure/
SameSite=Strict. HTTPS pelo Traefik (mesmo do OpenClaw). Helmet, rate-limit,
container não-root + rootfs read-only + `cap_drop: ALL`, sem docker socket,
assets via stream autenticado anti path-traversal, `SFX_API_KEY` só no backend.
ADRs em `docs/adr/`.
