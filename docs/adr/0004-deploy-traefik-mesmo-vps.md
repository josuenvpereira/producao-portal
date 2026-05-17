# ADR 0004 — Deploy: Docker no mesmo VPS, atrás do Traefik do OpenClaw

**Status:** aceito (2026-05-16) · decidido com o Josué.

## Contexto
Rodar em `producao.jotaene.ia.br`, **mesmo VPS** do OpenClaw
(`claw.jotaene.ia.br`), que já usa Traefik com TLS Let's Encrypt automático.
"Segurança igual OpenClaw" = mesmo transporte.

## Decisão
- 1 imagem Docker multi-stage (build SPA → bundle Fastify), base slim pinada,
  user **não-root** (UID 1000, igual ao container OpenClaw), healthcheck.
- Serviço no `docker-compose` anexado à **mesma rede externa do Traefik** do
  OpenClaw; roteamento por **labels Traefik** (`Host(producao.jotaene.ia.br)`)
  com o **mesmo certresolver** → TLS idêntico, zero config nova de proxy.
- Segredos via `.env` no host (espelha `/docker/openclaw-0wr6/.env`), nunca git.
- Mounts read-only onde aplicável; limites de CPU/mem; `restart: unless-stopped`.

## Consequências
- (+) TLS/HTTPS herdados do Traefik existente — literalmente "igual OpenClaw".
- (+) Isolado do container OpenClaw (falha de um não derruba o outro).
- (−) Acopla à topologia Docker do VPS (rede externa do Traefik) — documentado
  no guia passo a passo da Fase 5.
