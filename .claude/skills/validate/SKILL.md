---
name: validate
description: Roda a validação completa do producao-portal (typecheck + testes do backend + build da SPA) na ordem correta. Use SEMPRE antes de commitar/push na main — push na main dispara o CD e atualiza o VPS de verdade, então código quebrado na main = deploy quebrado.
---

# validate — gate de pré-commit do producao-portal

> Por quê: `push` na `main` dispara o `deploy.yml` (CD → VPS real). A regra de
> ouro do `CLAUDE.md` é **typecheck limpo + testes verdes + web build** antes
> de qualquer commit que vá para a `main`.

## Passos (nesta ordem, parar no primeiro que falhar)

1. **Backend — typecheck + testes:**
   ```bash
   npm run typecheck && npm test
   ```
   `tsconfig` do backend tem `verbatimModuleSyntax` (use `import type` p/
   tipos) e `noUncheckedIndexedAccess`. Vitest roda os testes de `src/**`.

2. **SPA — build (tsc + vite):**
   ```bash
   npm --prefix web run build
   ```
   Se falhar com módulo ausente, rode antes `npm --prefix web install` e
   repita. O tsconfig da `web` tem `noUnusedLocals/noUnusedParams` — não
   deixe import/variável sobrando.

## Em caso de falha

- **NÃO commite.** Investigue a causa raiz e corrija o código (não silencie
  com `any`, `// @ts-ignore`, `--no-verify` nem skip de teste).
- Respeite os gotchas do `CLAUDE.md` (ex.: `node:sqlite` via `createRequire`;
  `scripts/` é CommonJS; adapters degradam sem crash). Não os reverta para
  "passar" a validação.
- Depois de corrigir, rode os passos **de novo do início**.

## Sucesso

Só está pronto para commit/push na `main` quando os **dois** passos passam
limpos. Lembre o co-author obrigatório no commit:
`Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
