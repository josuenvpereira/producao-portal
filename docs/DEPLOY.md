# Deploy do Portal no VPS — guia passo a passo

> Objetivo: subir `https://producao.jotaene.ia.br` no **mesmo VPS** do OpenClaw,
> atrás do **mesmo Traefik** (TLS Let's Encrypt automático). Tudo via Docker.
> Tempo estimado: ~20 min.

## 0. Pré-requisitos (no VPS, via SSH)

```bash
ssh <seu-user>@<ip-do-vps>
docker --version && docker compose version   # confirmar Docker + compose v2
docker ps | grep openclaw                    # achar o container OpenClaw
```

Anote o nome do container OpenClaw (ex.: `openclaw-0wr6-openclaw-1`).

## 1. DNS — apontar o subdomínio

No painel de DNS da zona `jotaene.ia.br`, crie um **registro A**:

| Tipo | Nome       | Valor            | TTL |
|------|------------|------------------|-----|
| A    | `producao` | `<IP do VPS>`    | 300 |

> É o **mesmo IP** de `claw.jotaene.ia.br`. Validar (aguarde a propagação):
> `dig +short producao.jotaene.ia.br` → deve retornar o IP do VPS.

## 2. Descobrir a rede do Traefik e o certresolver

O portal precisa entrar na **mesma rede Docker** que o Traefik usa pro OpenClaw:

```bash
docker inspect openclaw-0wr6-openclaw-1 \
  --format '{{json .NetworkSettings.Networks}}' | tr ',' '\n'
```

Anote o **nome da rede** (algo como `root_default`, `traefik`, `web`...).
Descubra o **certresolver** olhando as labels de um serviço já publicado:

```bash
docker inspect openclaw-0wr6-openclaw-1 \
  --format '{{json .Config.Labels}}' | tr ',' '\n' | grep -i certresolver
```

Ex.: `traefik.http.routers.openclaw.tls.certresolver=letsencrypt` → o nome é
`letsencrypt`. (Se o OpenClaw for gerido pelo painel Hostinger e não tiver
labels, use o certresolver padrão do Traefik dessa instância — confirme na
config do Traefik em `/etc/traefik` ou no compose do proxy.)

## 3. Colocar o código no VPS

O portal vive no repo (`portal/`). No VPS, no diretório do repo do supervisor:

```bash
cd <PORTAL_REPO_DIR>          # ex.: /docker/openclaw-0wr6/data/.openclaw/workspace-remotion
git pull origin main          # traz portal/ + scripts/
cd portal
```

## 4. Gerar a chave única e o .env

```bash
# 4a. Chave única (rode UMA vez; guarde a CHAVE no gerenciador de senhas):
node ../scripts/gen-portal-key.js

# 4b. Segredo do cookie:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 4c. Criar o .env a partir do exemplo e preencher:
cp .env.example .env
nano .env
```

Preencha no `.env`:
- `PORTAL_ACCESS_KEY_HASH=` → o **hash** impresso em 4a (NÃO a chave)
- `PORTAL_COOKIE_SECRET=` → a string de 4b
- `GITHUB_TOKEN=` → PAT fine-grained **read-only** (`Contents:read` +
  `Actions:read`) do repo `josuenvpereira/remotion_project`
- `GITHUB_WEBHOOK_SECRET=` → uma string aleatória (use 4b de novo)
- `PUBLIC_ORIGIN=https://producao.jotaene.ia.br`
- `PORTAL_TRAEFIK_NETWORK=` → rede do passo 2
- `PORTAL_TRAEFIK_CERTRESOLVER=` → certresolver do passo 2
- `PORTAL_REPO_DIR=` → caminho **no host** do repo (o mesmo do passo 3)

> `.env` é gitignored — **nunca** comitar. Permissão restrita: `chmod 600 .env`.

## 5. Build e subir

```bash
docker compose build portal
docker compose up -d portal
docker compose logs -f portal      # acompanhar boot (Ctrl+C pra sair)
docker compose ps                  # status + healthcheck
```

## 6. Validar TLS e acesso

```bash
curl -sI https://producao.jotaene.ia.br/healthz   # 200 + cert válido
```

Abra `https://producao.jotaene.ia.br` no navegador → tela de login. Cole a
**chave** (a de 4a). Deve entrar no dashboard. Cadeado válido + header HSTS.

> Primeiro acesso pode levar ~30s enquanto o Traefik emite o certificado
> Let's Encrypt. Se der erro de cert, confira DNS (passo 1) e
> `PORTAL_TRAEFIK_CERTRESOLVER`.

## 7. Indexação inicial + webhook

```bash
# Popular o read-model agora (não esperar o 1º webhook):
docker compose exec portal node dist/indexer.js
```

No GitHub do repo → **Settings → Webhooks → Add webhook**:
- Payload URL: `https://producao.jotaene.ia.br/api/webhook/github`
- Content type: `application/json`
- Secret: o mesmo `GITHUB_WEBHOOK_SECRET` do `.env`
- Eventos: **Pushes** + **Workflow runs**

Teste: dispare o `render-ep.yml` (ou faça um push) → em < 1 min a Esteira
atualiza (o webhook agenda reindexação; SSE empurra o refresh).

## 8. Operação

| Ação | Comando |
|---|---|
| Atualizar (novo código) | `git pull && docker compose build portal && docker compose up -d portal` |
| Ver logs | `docker compose logs -f portal` |
| Reindex manual | `docker compose exec portal node dist/indexer.js` |
| Rotacionar chave | `node ../scripts/gen-portal-key.js` → trocar hash no `.env` → `docker compose up -d portal` |
| Backup | copiar o volume `portal-data` (sqlite + vault) |
| Parar | `docker compose stop portal` |

## 9. Troubleshooting

- **502/404 no Traefik:** rede errada no `.env` (`PORTAL_TRAEFIK_NETWORK`) ou
  porta — o serviço escuta 8080 (label já aponta pra isso).
- **Cert inválido:** DNS não propagou ou certresolver errado.
- **Esteira vazia:** `PORTAL_REPO_DIR` não aponta pro repo do supervisor, ou
  rode o indexer (passo 7). Sem `GITHUB_TOKEN`, runs de render ficam vazias
  (degrada, não quebra).
- **Custos por agente vazios:** o exporter (`scripts/openclaw-export.sh`,
  cron no host) ainda não rodou ou `sessions.json` não bate com o parser de
  `openclawExport.ts`. Fonte única de custo/uso é o exporter (o `/usage`
  HTML foi aposentado).
- **Permissão negada no /repo:** o container roda como UID 1000; garanta que
  `PORTAL_REPO_DIR` seja legível por ele (é montado `:ro`).

## 10. Segurança no host (resumo)

- `.env` com `chmod 600`, dono do deploy; nunca no git.
- Container: não-root (UID 1000), rootfs `read_only`, `cap_drop: ALL`,
  `no-new-privileges`, limites de CPU/mem — já no `docker-compose.yml`.
- Repo montado **somente leitura** (`/repo:ro`) — o portal não muta a pipeline.
- TLS/HSTS herdados do Traefik do OpenClaw (mesmo certresolver).
