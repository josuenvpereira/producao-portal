# Portal de Produção — `producao.jotaene.ia.br`

Portal **read-only** de observabilidade da pipeline MSU: esteira, handoffs
agente→agente, rastreabilidade tarefa→artefato (script→áudio→imagem→vídeo),
**controle de custo** (tokens OpenClaw + ElevenLabs por run) e organograma das
squads. Standalone — **não** é workspace do projeto Remotion.

> Plano completo e fases: `C:\Users\josue\.claude\plans\entenda-o-projeto-swirling-bubble.md`

## Estrutura

```
portal/
├── src/            # backend Fastify (API, adapters, indexer, auth)
│   ├── config.ts   # config 12-factor (.env)
│   ├── server.ts   # bootstrap (single deployable)
│   ├── auth/        # verificação da chave única (scrypt, tempo-constante)
│   ├── adapters/    # GitHubRepo | GitHubActions+vault | OpenClawUsage | CostDerive  (Fase 1)
│   ├── db/          # read-model SQLite + migrations  (Fase 1)
│   └── indexer.ts   # projeção GitHub/OpenClaw → SQLite  (Fase 1)
├── web/            # SPA React/Vite (dashboard)  (Fase 3)
└── docs/adr/       # decisões de arquitetura
```

## Dev

```bash
# 1. Gerar a chave única (1x) e colar o hash no portal/.env
node scripts/gen-portal-key.js

# 2. Backend
npm --prefix portal install
cp portal/.env.example portal/.env   # preencher
npm --prefix portal run dev          # :8080

# 3. SPA
npm --prefix portal/web install
npm --prefix portal/web run dev      # :5173 (proxy /api → :8080)
```

## Segurança (resumo)
Chave única (hash scrypt, nunca em claro) → cookie assinado HttpOnly/Secure/
SameSite=Strict. HTTPS pelo Traefik (mesmo do OpenClaw). Helmet, rate-limit,
assets só via stream autenticado com anti path-traversal. Detalhes nos ADRs
0002/0003/0004.

## Status
Fase 0 (fundação) concluída. Próximas fases no plano.
