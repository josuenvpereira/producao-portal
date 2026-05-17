#!/usr/bin/env bash
# openclaw-export.sh — roda NO HOST do VPS (via cron). Despeja snapshots JSON
# do OpenClaw num diretório que o portal monta :ro. Mantém o portal SEM docker
# socket e SEM privilégio (ele só lê arquivos). Idempotente; escreve atômico.
#
# Instalação (no VPS, como root ou dono do docker):
#   install -m755 scripts/openclaw-export.sh /usr/local/bin/openclaw-export.sh
#   mkdir -p /docker/openclaw-0wr6/portal-export
#   # cron a cada 5 min:
#   ( crontab -l 2>/dev/null; echo '*/5 * * * * /usr/local/bin/openclaw-export.sh' ) | crontab -
#
# O portal lê OPENCLAW_EXPORT_DIR (default /openclaw-export, montado :ro).
set -euo pipefail

OC="${OPENCLAW_CONTAINER:-openclaw-0wr6-openclaw-1}"
OUT="${PORTAL_EXPORT_DIR:-/docker/openclaw-0wr6/portal-export}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ⛔ REGRA DE OURO: `docker exec <oc> openclaw ...` roda como ROOT dentro do
# container, tranca /tmp em 700 root e DERRUBA o gateway do OpenClaw (WhatsApp).
# Este script roda em cron */5 — sem isto, mataria o gateway a cada 5 min.
# SEMPRE invocar a CLI via `runuser -u node --` (usuário do gateway). NÃO reverter.
oc() { docker exec "$OC" runuser -u node -- openclaw "$@" 2>/dev/null; }
# escreve atômico só se a saída for não-vazia (não zera snapshot bom em falha)
put() { # put <arquivo> < conteúdo(stdin)
  local f="$1" t="$TMP/$(basename "$1")"
  cat > "$t"
  if [ -s "$t" ]; then mv -f "$t" "$OUT/$f"; fi
}

mkdir -p "$OUT"

# 1. agentes (texto — parser tolera) e crons (JSON rico)
oc agents list | put agents.txt
oc cron list --all --json | put cron.json

# 2. histórico de execução por job (= esteira de Comunicação)
docker exec "$OC" runuser -u node -- openclaw cron list --all --json 2>/dev/null > "$TMP/cron.json" || true
JOB_IDS="$(python3 -c 'import sys,json;print("\n".join(j["id"] for j in json.load(open(sys.argv[1])).get("jobs",[])))' "$TMP/cron.json" 2>/dev/null || true)"
for id in $JOB_IDS; do
  oc cron runs --id "$id" --limit 50 > "$TMP/run-$id.json" 2>/dev/null || true
done
python3 - "$TMP" <<'PY' 2>/dev/null && [ -s "$TMP/cron-runs.json" ] && cp -f "$TMP/cron-runs.json" "$OUT/cron-runs.json" || true
import sys,os,json,glob
d=sys.argv[1]; acc={"jobs":{}}
for f in glob.glob(os.path.join(d,"run-*.json")):
    jid=os.path.basename(f)[4:-5]
    try: acc["jobs"][jid]=json.load(open(f))
    except Exception: pass
json.dump(acc, open(os.path.join(d,"cron-runs.json"),"w"))
PY

# 3. uso de tokens por sessão/agente (= Custos)
oc sessions --all-agents --json --limit all | put sessions.json

# carimbo de frescor
date -u +%Y-%m-%dT%H:%M:%SZ | put exported-at.txt
