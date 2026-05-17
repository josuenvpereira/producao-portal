# ADR 0001 — Stack: Fastify + React/Vite, standalone

**Status:** aceito (2026-05-16) · decidido com o Josué.

## Contexto
O repo é Node + TS strict + React 18 (Remotion). Não há servidor web. O portal
é read-only, internal-tooling, com SSE p/ esteira ao vivo e streaming de vídeo
autenticado. Precisa rodar em 1 container no VPS.

## Decisão
- **Backend:** Fastify 5 (TS, ESM). Schema validation nativa, plugins de
  segurança maduros (`@fastify/helmet|rate-limit|cookie|static`), rápido.
- **Frontend:** React 18 + Vite (reusa conhecimento do time).
- **Single deployable:** em prod o Fastify serve a SPA buildada (`web/dist`).
- **Standalone:** `portal/` tem `package.json`/lockfile próprios e **NÃO** é
  workspace npm do root. Garante zero impacto no build de vídeo Remotion
  (regra de memória: nunca quebrar vídeo publicado).

## Consequências
- (+) Isolamento total; deploy simples; uma imagem.
- (+) `npm --prefix portal ...` sem tocar deps do Remotion.
- (−) Dois `package.json` (server + web) — aceitável, separação limpa.
