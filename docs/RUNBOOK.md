# RUNBOOK — Portal de Produção

Operação do portal no VPS. Pré-requisito: deploy feito (ver `DEPLOY.md`).

## Saúde & observabilidade

| Sinal | Onde |
|---|---|
| Liveness | `GET /healthz` (sem auth) → 200 |
| Última sincronização | Dashboard (rodapé) ou `meta.last_sync` no SQLite |
| Fontes degradadas | Banner no topo das páginas + `degraded` nas respostas |
| Logs | `docker compose logs -f portal` (JSON estruturado, pino) |
| Auditoria | `docker compose logs portal | grep '"audit":true'` |

Eventos de auditoria (campo `event`): `login_ok`, `login_fail`, `logout`,
`asset_served`, `webhook_accepted`. Nunca contêm chave/cookie (redigidos).

> Retenção de logs: configure rotação no Docker daemon
> (`/etc/docker/daemon.json` → `log-opts` `max-size`/`max-file`) ou
> direcione pra um coletor. O app não gerencia arquivo de log (12-factor).

## Backup & restore

Estado durável vive no volume `portal-data` (SQLite + vault de MP4s):

```bash
# Backup (consistente: app usa WAL; copiar o diretório do volume)
docker run --rm -v portal-data:/d -v "$PWD":/b alpine \
  tar czf /b/portal-data-$(date +%F).tgz -C /d .

# Restore
docker compose stop portal
docker run --rm -v portal-data:/d -v "$PWD":/b alpine \
  sh -c 'rm -rf /d/* && tar xzf /b/portal-data-AAAA-MM-DD.tgz -C /d'
docker compose up -d portal
```

> O read-model é **regenerável** (`docker compose exec portal node dist/indexer.js`).
> O que é insubstituível no vault: MP4s de runs cujo artifact do GitHub já
> expirou (14d). Priorize o backup se houver episódios antigos.

## Rotação da chave única

```bash
node ../scripts/gen-portal-key.js          # gera nova chave + hash
nano .env                                  # troca PORTAL_ACCESS_KEY_HASH
docker compose up -d portal                # recria o container
```

A chave antiga para de funcionar imediatamente (sessões ativas expiram no
TTL do cookie). Rotacione também `PORTAL_COOKIE_SECRET` p/ invalidar sessões
na hora.

## Reindexação

- Automática: webhook do GitHub (`push`/`workflow_run`) → reindex debounced.
- Manual: `docker compose exec portal node dist/indexer.js`
- Após mudar agentes/projetos: `node ../scripts/generate_org_manifest.js` e
  commitar `openclaw_workspaces/org.json` (o organograma é data-driven).

## Resposta a incidentes

| Sintoma | Ação |
|---|---|
| Tentativas de login suspeitas | `grep login_fail` nos logs; rate-limit já freia (8/5min/IP). Se persistir, rotacione chave + considere IP allowlist (abaixo). |
| Vazamento de chave suspeito | Rotacionar chave **e** `PORTAL_COOKIE_SECRET` imediatamente. |
| Custo disparando | Dashboard → Custos (alerta de teto). Origem real do gasto = gate `approve_paid_apis` do `render-ep.yml` (nunca `true` automático). |
| Portal fora | `docker compose ps`/`logs`; healthcheck reinicia sozinho (`restart: unless-stopped`). |
| Artifact MP4 expirado | Episódio marcado "vídeo expirado" — re-disparar `render-ep.yml`. |

## Defesa em profundidade (opcional, atrás de flag)

Além da chave única + cookie, dá pra somar no Traefik (não habilitado por
padrão — só se o time quiser):

- **IP allowlist** (label no `docker-compose.yml`):
  `traefik.http.middlewares.msu-ipallow.ipallowlist.sourcerange=<CIDR>` e
  adicionar `msu-ipallow` aos middlewares do router.
- **forward-auth**: encadear um middleware de auth do Traefik antes do portal.

Documentado como opção; a segurança base (chave hasheada + cookie assinado +
HTTPS Traefik + headers) já atende o requisito "igual OpenClaw".

## Dependências & CI

- `dependabot.yml`: PRs semanais (portal, portal/web, github-actions).
- `portal-ci.yml`: `npm ci` + typecheck + testes + build + `npm audit` +
  gitleaks (secret scan) — roda só em mudanças sob `portal/`.
- Antes de mergear bump de dependência: CI verde + revisar changelog de libs
  de segurança (fastify/helmet/cookie).
