# ADR 0003 — Read-model SQLite + vault durável de artifacts

**Status:** aceito (2026-05-16).

## Contexto
GitHub é a fonte da verdade (repo + Actions `render-ep.yml`). O portal só
**projeta** (read-only). O MP4 final sai **só como artifact do GitHub Actions**
(`ep-mp4-<ep>-<run_id>`, retenção **14 dias**); áudio idem (7 dias). Custo de
tokens vem de `claw.jotaene.ia.br/usage`.

## Decisão
- **CQRS-lite:** indexer projeta GitHub/OpenClaw → **SQLite via `node:sqlite`**
  (módulo embutido no Node ≥ 22.5 — **zero dependência nativa**, sem node-gyp).
  Escolhido sobre `better-sqlite3` após o build nativo falhar no Windows e por
  reduzir a superfície de supply-chain / simplificar o Docker (sem toolchain de
  compilação na imagem). API síncrona equivalente. `node:sqlite` é experimental
  mas estável o suficiente p/ read-model interno. Requer **Node ≥ 22**
  (engines do `portal/package.json`; CI e Docker em Node 22). Migrations
  versionadas; upsert idempotente por content-hash.
- **Vault durável:** ao detectar `workflow_run` completed (webhook), o adapter
  **baixa o MP4/áudio imediatamente** p/ disco (`data/vault/`). NÃO pode ser
  lazy — artifacts expiram. Episódio com artifact expirado sem vault →
  flag "vídeo expirado" + ação de re-disparar o workflow.
- **Esteira = `pipeline-state/*.json` ⊕ runs do `render-ep.yml`** (jobs
  `audit-and-audio`/`render`, conclusão, gate `approve_paid_apis`).

## Consequências
- (+) Resiliente à expiração de artifacts; histórico de custo persistente.
- (+) Sem DB server; backup = copiar 1 arquivo + vault.
- (+) **Zero dependência nativa** no backend (sem node-gyp/toolchain).
- (−) `node:sqlite` é experimental (emite warning) — aceitável p/ uso interno.
- (−) Vault cresce com vídeos → política de retenção/poda na Fase 6.
