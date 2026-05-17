# Handoff — Deploy do Portal de Produção no VPS Hostinger

Documento **autocontido** para a sessão que tem **SSH no Hostinger**. Você vai
**avaliar a melhor forma**, escrever um **script faseado** e **testar cada
fase**. Tudo que você precisa está aqui. Não assuma contexto prévio.

> Companheiros (no repo): `docs/DEPLOY.md`, `docs/RUNBOOK.md`,
> `docs/DEPLOY_SECRETS.md` (CD), `docker-compose.yml`, `.env.example`,
> `scripts/openclaw-export.sh`, `scripts/gen-portal-key.js`, `docs/adr/*`.
> Este handoff **consolida e supera** o DEPLOY.md onde divergir.

---

## 0. LEIA PRIMEIRO — layout standalone + 2 repos + CD

- **Repo do portal mudou.** O portal agora é o repo **standalone**
  `github.com/josuenvpereira/producao-portal` (extraído do `remotion_project`
  com histórico). **A raiz do repo É o portal.** Onde o DEPLOY.md/handoff
  antigos dizem `portal/...` ou `npm --prefix portal ...` ou
  `cp portal/.env.example`, agora é **a raiz**: `./.env.example`,
  `npm ...`, `docs/...`, `scripts/...` (sem `portal/` nem `../`).
- **Dois repos no VPS (a dependência de dados NÃO mudou):**
  1. **`producao-portal`** (este) → clonar em `VPS_PORTAL_DIR` (ex.:
     `/docker/portal/producao-portal`); é onde sobe o container.
  2. **`remotion_project`** → continua precisando de um clone separado,
     montado `:ro` em `/repo` (var `PORTAL_REPO_DIR`), p/ os dados de
     **vídeo** (`script.json`, áudio/imagens, pipeline-state). `GITHUB_REPO`
     no `.env` continua `josuenvpereira/remotion_project` (a API do Actions
     observa o `render-ep.yml` de lá). **NÃO** aponte `/repo` para este repo.
- **`org.json`** agora vive na **raiz deste repo** (versionado, roster-driven;
  o Dockerfile copia p/ `/app/org.json`). Não vem mais do `remotion_project`.
- **CD já existe:** `.github/workflows/deploy.yml` faz push-deploy via SSH.
  Configure os segredos (`docs/DEPLOY_SECRETS.md`) como parte do deploy —
  depois disso, todo `push` na `main` atualiza o `producao.jotaene.ia.br`
  sozinho (`git reset --hard origin/main` + `docker compose up -d --build` +
  healthz). O setup INICIAL (este handoff) ainda é manual/faseado.

---

## 1. O que é / onde está

Portal **read-only** de observabilidade da pipeline (vídeo MSU + Comunicação) +
aba **SFX** (geração de áudio). Stack: **Fastify + TS (Node 22)**, SPA
**React/Vite**, **SQLite via `node:sqlite`** (zero dep nativa), **1 imagem
Docker** (Fastify serve a SPA), auth por **chave única (hex-64) → cookie
assinado**. Tudo em **`portal/`** no repo
`github.com/josuenvpereira/remotion_project`, branch **`main`** (push feito
nesta entrega). Build/teste verdes: `npm --prefix portal test` (30),
`npm --prefix portal/web run build`.

## 2. Topologia alvo (mesmo VPS do OpenClaw)

```
Browser ─HTTPS─> Traefik (já existe, do OpenClaw; TLS LE automático)
   ├── claw.jotaene.ia.br        → container openclaw-0wr6-openclaw-1 (existe)
   └── producao.jotaene.ia.br    → container msu-producao-portal (NOVO)
                                        │ lê (somente leitura):
   ┌────────────────────────────────────┼─────────────────────────────────┐
   │ /repo            (clone do repo, :ro)  → vídeo: script.json, áudio,    │
   │                                          imagens, org.json            │
   │ /openclaw-export (:ro)                 → Comunicação (crons/execuções) │
   │   gerado por scripts/openclaw-export.sh (cron NO HOST, docker exec)    │
   │ GitHub Actions API (HTTPS, PAT ro)     → render-ep.yml runs + MP4      │
   │ http://10.8.0.2:8000 (WireGuard do host) → SFX Factory (proxy c/ chave)│
   └──────────────────────────────────────────────────────────────────────┘
```

**Princípio de segurança:** o portal **não usa docker socket**, roda
**não-root**, rootfs `read_only`, `cap_drop: ALL`. Só *lê* (mounts `:ro`,
GitHub API, e proxy SFX com chave server-side).

## 3. Fontes de dados — RECONCILIAÇÃO (leia com atenção)

O modelo evoluiu; o DEPLOY.md antigo está parcialmente defasado. Verdade atual:

| Área no portal | Fonte | Como popula | Estado no deploy inicial |
|---|---|---|---|
| Overview / Episódio / Organograma / Custo-TTS | **clone do repo** em `/repo` (`org.json`, `src/channels/.../script.json`, `public/.../audio|images`) | `git pull` no clone | **OK** já no 1º deploy (ep02 + Jotaene/10 agentes) |
| **Esteira de vídeo (estado ao vivo)** | `pipeline-state/*.json` | escrito pelo `orquestrador_msu` **quando ele rodar no VPS** (ver `HANDOFF_OPENCLAW_MIGRATION.md`, não deployado) | **VAZIA até a migração do orquestrador** — esperado, não é bug. Mostra só o que está no repo. |
| Render de vídeo (runs + MP4) | **GitHub Actions API** (`render-ep.yml`) | precisa `GITHUB_TOKEN` (PAT fine-grained ro) | OK assim que o token estiver no `.env` |
| **Comunicação** (crons gerente-com/analista-com + o que cada execução produziu) | **`/openclaw-export`** (`cron.json`, `cron-runs.json`, `sessions.json`) | `scripts/openclaw-export.sh` por cron no host | **OK** assim que o exporter rodar (Fase 5) |
| **Custo por agente** (tokens reais) | idem (`sessions.json` do exporter) | idem | OK com exporter |
| SFX (status + geração + biblioteca) | proxy p/ `http://10.8.0.2:8000` (WireGuard) | em tempo real; "offline" se a casa estiver desligada (normal) | OK se o container alcançar 10.8.0.2 |

> ⚠️ Decisões que VOCÊ (SSH) precisa fechar:
> 1. **Quem mantém o clone `/repo` atualizado?** O portal só *lê* — ele
>    **não** faz `git pull`. Recomendado: clone dedicado em
>    `/docker/portal/repo` + um cron `git -C ... pull --ff-only` (ou pull no
>    mesmo exporter). Webhook do portal só dispara *reindex*, não pull.
> 2. **Rede p/ a SFX:** o container precisa rotear `10.8.0.2:8000`
>    (peer WireGuard do host). Validar via
>    `docker exec msu-producao-portal wget -qO- http://10.8.0.2:8000/health`.
>    Se não alcançar: rota/iptables no host p/ a sub-rede WG, ou ajustar a
>    rede do compose. **Não** usar host-network (quebra labels do Traefik).
> 3. **`/usage` do OpenClaw é HTML** (legado) — o custo agora vem do
>    **exporter** (`sessions.json`), não do `/usage`. As vars
>    `OPENCLAW_USAGE_*` são legado/no-op; pode deixar em branco.

## 4. Segredos & env (preencher no `.env` do host, NUNCA no git)

Base: `cp portal/.env.example portal/.env` e preencher. `chmod 600 .env`.

| Var | O que é / como obter |
|---|---|
| `PORTAL_ACCESS_KEY_HASH` | **Gere NO VPS**: `node scripts/gen-portal-key.js` (default **hex-64**, padrão OpenClaw). Cole **só o hash**; a CHAVE exibida é o login (guardar no gerenciador de senhas). NUNCA gerar/colar a chave de produção em chat/transcrição. |
| `PORTAL_COOKIE_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `GITHUB_TOKEN` | PAT **fine-grained, read-only**: `Contents:read` + `Actions:read` no repo `josuenvpereira/remotion_project` |
| `GITHUB_REPO` | `josuenvpereira/remotion_project` |
| `GITHUB_WEBHOOK_SECRET` | string aleatória (reuse o comando do cookie); usar igual no GitHub Webhook |
| `SFX_API_KEY` | **mesmo valor** do `deploy/.env` da fábrica SFX (`C:\Projetos\sfx_ia`) |
| `SFX_BASE_URL` | `http://10.8.0.2:8000` (default) |
| `DEEPSEEK_PRO_USD_PER_1M` / `_FLASH_` | preço DeepSeek p/ estimar custo (0 = só mostra tokens) |
| `PORTAL_TRAEFIK_NETWORK` | rede externa do Traefik do OpenClaw — descobrir: `docker inspect openclaw-0wr6-openclaw-1 --format '{{json .NetworkSettings.Networks}}'` |
| `PORTAL_TRAEFIK_CERTRESOLVER` | certresolver do Traefik — `docker inspect ... --format '{{json .Config.Labels}}' | tr ',' '\n' | grep -i certresolver` (ex.: `letsencrypt`) |
| `PORTAL_REPO_DIR` | caminho **no host** do clone do repo (ver §3 decisão 1), montado `/repo:ro` |
| `PORTAL_OPENCLAW_EXPORT_DIR` | `/docker/openclaw-0wr6/portal-export` (default) |
| `PUBLIC_ORIGIN` | `https://producao.jotaene.ia.br` · `NODE_ENV=production` · `PORT=8080` |

## 5. Plano FASEADO recomendado (cada fase: ação → teste/critério → rollback)

Cada fase é idempotente e isolada. **Não avance sem o teste passar.**

### F0 — Pré-requisitos & descoberta
- `docker ps | grep openclaw` (confirmar `openclaw-0wr6-openclaw-1`), `docker compose version`, WireGuard up (`wg show`), DNS.
- DNS: criar A `producao.jotaene.ia.br` → IP do VPS (mesmo de `claw`).
- Descobrir `PORTAL_TRAEFIK_NETWORK` e `PORTAL_TRAEFIK_CERTRESOLVER` (§4).
- **Teste:** `dig +short producao.jotaene.ia.br` = IP do VPS; rede e certresolver anotados.

### F1 — Código no VPS
- Clonar o repo (clone dedicado, ex. `/docker/portal/src`): `git clone -b main https://github.com/josuenvpereira/remotion_project /docker/portal/src`.
- Definir o **clone `/repo`** (decisão §3.1): mesmo clone ou um separado read-mostly + cron `git -C <dir> pull --ff-only`.
- **Teste:** `ls /docker/portal/src/portal/docker-compose.yml` existe; `git -C /docker/portal/src rev-parse HEAD`.

### F2 — `.env` & segredos
- `cd /docker/portal/src/portal && cp .env.example .env`; gerar chave (`node ../scripts/gen-portal-key.js`) + cookie secret; preencher todas as vars da §4; `chmod 600 .env`.
- **Teste:** `grep -c '=' .env` coerente; nenhum segredo vazio obrigatório (`PORTAL_ACCESS_KEY_HASH`, `PORTAL_COOKIE_SECRET`, `GITHUB_TOKEN`, `PORTAL_TRAEFIK_*`, `PORTAL_REPO_DIR`).

### F3 — Build da imagem (isolado, sem Traefik)
- `docker compose build portal`.
- Smoke isolado: `docker run --rm --env-file .env -e NODE_ENV=production -p 18080:8080 -v portal-data:/data -v <repo>:/repo:ro msu-producao-portal:latest` e em outro shell `curl -s localhost:18080/healthz` → `{"ok":true}`; depois `Ctrl-C`.
- **Teste:** healthz 200 no container isolado. **Rollback:** nada subiu ainda.

### F4 — Subir atrás do Traefik
- `docker compose up -d portal`; `docker compose logs -f portal` (ver "listening").
- **Teste:** `curl -sI https://producao.jotaene.ia.br/healthz` → 200, cert válido, header `Strict-Transport-Security`. Abrir no browser → tela de login; logar com a CHAVE → entra. **Rollback:** `docker compose stop portal` (não afeta o OpenClaw).

### F5 — Indexação inicial (dados do repo)
- `docker compose exec portal node dist/indexer.js`.
- **Teste:** Overview com KPIs; Organograma com **Jotaene (CEO) + 10 agentes (2 times)**; Episódios mostra ep02. (Esteira de vídeo "ao vivo" pode estar vazia — §3, esperado.)

### F6 — Exporter do OpenClaw (Comunicação + Custo real)
- `install -m755 scripts/openclaw-export.sh /usr/local/bin/openclaw-export.sh`
- `mkdir -p /docker/openclaw-0wr6/portal-export`
- Rodar 1x à mão: `OPENCLAW_CONTAINER=openclaw-0wr6-openclaw-1 PORTAL_EXPORT_DIR=/docker/openclaw-0wr6/portal-export /usr/local/bin/openclaw-export.sh`
- Cron: `( crontab -l 2>/dev/null; echo '*/5 * * * * /usr/local/bin/openclaw-export.sh' ) | crontab -`
- `docker compose exec portal node dist/indexer.js` (reindex)
- **Teste:** `ls /docker/openclaw-0wr6/portal-export/{cron.json,cron-runs.json,sessions.json}`; aba **Comunicação** lista os crons (gerente-pauta-09h/17h, analista-publica-09h/18h) com última execução + resumo; **Custos** mostra tokens reais por agente.

### F7 — Webhook GitHub (reindex automático)
- GitHub repo → Settings → Webhooks → `https://producao.jotaene.ia.br/api/webhook/github`, content-type JSON, secret = `GITHUB_WEBHOOK_SECRET`, eventos **push** + **workflow_run**.
- **Teste:** disparar `render-ep.yml` (ou push) → log do portal mostra "reindex pós-webhook"; dado novo aparece < 1 min.

### F8 — SFX (geração de áudio)
- Garantir rede: `docker exec msu-producao-portal wget -qO- http://10.8.0.2:8000/health` (se falhar, resolver rota WG no host — §3.2).
- `SFX_API_KEY` no `.env` (= fábrica). `docker compose up -d portal` se mudou `.env`.
- **Teste:** aba **SFX** badge "No ar" (ou "Offline" se a casa estiver desligada — ambos válidos, sem crash); `/api/sfx/status` coerente; gerar 1 SFX curto (`duration:3`) → toca + aparece na Biblioteca; **inspecionar Network: a `SFX_API_KEY` NÃO aparece** em nenhuma resposta/asset.

### F9 — Hardening & operação
- Backup do volume `portal-data` (sqlite + vault + sfx-library) — ver RUNBOOK.md.
- Conferir `restart: unless-stopped`, healthcheck (`docker compose ps` = healthy), logs de auditoria (`docker compose logs portal | grep '"audit":true'`).
- Opcional: IP allowlist/forward-auth no Traefik (RUNBOOK.md §defesa em profundidade).
- **Teste:** matar o container → reinicia sozinho; `producao.jotaene.ia.br` volta.

## 6. Gotchas (não tropece)

- **Arquivos do OpenClaw são `0600 node`** → mount direto não funciona; por isso o **exporter** (CLI `openclaw ... --json` no host) → JSON world-readable em `/docker/openclaw-0wr6/portal-export`. Portal só lê isso `:ro`.
- **Esteira de vídeo ≠ Comunicação.** Comunicação é live (exporter). A esteira de vídeo "ao vivo" depende do `orquestrador_msu` rodar no VPS (outra migração); no 1º deploy fica vazia — **deixe claro pro Josué que isso é esperado**, não regressão.
- **SFX: casa desligada = "offline" é estado NORMAL** (badge cinza), nunca erro/crash. GPU concorrência=1 (o portal já serializa e recusa 409 se ocupado).
- **Artifacts do GitHub expiram (MP4 14d)** → o adapter baixa no momento da ingestão (vault). Sem `GITHUB_TOKEN`, render fica degradado (sem crash).
- **Mesmo Traefik/cert do OpenClaw** — não suba outro proxy; só labels + rede externa. Primeiro acesso pode levar ~30s (emissão LE).
- Container **não-root + rootfs read-only**: só `/data` (volume) e `/tmp` (tmpfs) são graváveis. `.env` via `env_file` (host), `chmod 600`.
- Branch: tudo em `main` (commit direto, sem PR — convenção do `CLAUDE.md`).

## 7. Checklist de aceite final

```
[ ] https://producao.jotaene.ia.br → TLS válido + HSTS + tela de login
[ ] login com a chave (hex-64) entra; chave errada = 401 genérico; rate-limit ativo
[ ] Overview/Organograma/Episódios populados (Jotaene CEO + 10 agentes; ep02)
[ ] Comunicação lista crons + execuções (após exporter + cron */5)
[ ] Custos mostra tokens reais por agente
[ ] SFX: status coerente; gera+salva 1 áudio; chave nunca no Network
[ ] webhook GitHub → reindex < 1 min
[ ] container healthy + restart automático; backup do volume documentado
[ ] SFX_API_KEY / PORTAL_* não aparecem em nenhum asset/resposta do front
```

## 8. O que reportar de volta

Para cada fase: comando rodado, saída do teste, e PASS/FAIL. Em FAIL: log
(`docker compose logs portal --tail 80`), o `.env` **com segredos redigidos**,
e o ponto exato. Itens que podem precisar de decisão do Josué: rede p/ WG
(SFX), quem faz `git pull` do `/repo`, e se quer IP allowlist no Traefik.
