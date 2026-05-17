# CD — Segredos do GitHub (workflow `deploy.yml`)

O `push` na `main` dispara `.github/workflows/deploy.yml`, que entra via **SSH
no VPS Hostinger** e faz `git reset --hard origin/main` + `docker compose
build/up` + checa `healthz`. Enquanto os segredos abaixo **não** existirem, o
job **pula limpo** (não falha) — então o 1º push antes do deploy é seguro.

## Segredos a criar no repo `josuenvpereira/producao-portal`

| Secret | Valor |
|---|---|
| `VPS_HOST` | IP/host do Hostinger (o mesmo do OpenClaw) |
| `VPS_USER` | usuário SSH do deploy (ex.: `deploy` ou `root`) |
| `VPS_SSH_KEY` | **chave privada** de uma deploy key dedicada (conteúdo do arquivo) |
| `VPS_SSH_PORT` | porta SSH (opcional; default `22`) |
| `VPS_PORTAL_DIR` | caminho NO VPS do clone deste repo (ex.: `/docker/portal/producao-portal`) |

## Como configurar (a sessão com SSH faz)

**1. No VPS — clonar este repo e gerar uma deploy key dedicada:**
```bash
mkdir -p /docker/portal && cd /docker/portal
git clone https://github.com/josuenvpereira/producao-portal.git
ssh-keygen -t ed25519 -f ~/.ssh/portal_deploy -N "" -C "cd-producao-portal"
cat ~/.ssh/portal_deploy.pub   # → adicionar ao authorized_keys do VPS_USER
cat ~/.ssh/portal_deploy       # → vira o secret VPS_SSH_KEY (privada)
```
Adicione a **pública** em `~VPS_USER/.ssh/authorized_keys` no VPS.

**2. Criar os secrets (de qualquer máquina com gh logado):**
```bash
gh secret set VPS_HOST       -R josuenvpereira/producao-portal -b '<ip>'
gh secret set VPS_USER       -R josuenvpereira/producao-portal -b '<user>'
gh secret set VPS_SSH_PORT   -R josuenvpereira/producao-portal -b '22'
gh secret set VPS_PORTAL_DIR -R josuenvpereira/producao-portal -b '/docker/portal/producao-portal'
gh secret set VPS_SSH_KEY    -R josuenvpereira/producao-portal < ~/.ssh/portal_deploy
```

**3. Pré-requisitos no VPS** (uma vez, ver `docs/DEPLOY_HANDOFF.md`): `.env`
preenchido no `VPS_PORTAL_DIR`, rede Traefik, mounts `:ro`, exporter cron. O
CD só faz `pull+build+up` — o setup inicial é o handoff faseado.

## Teste do CD
Após os secrets: `gh workflow run deploy.yml -R josuenvpereira/producao-portal`
(ou um push na main) → ver o run em Actions; deve terminar com "healthz OK".

> Segurança: deploy key **dedicada** (revogável sem afetar outras), escopo só
> deste deploy; a privada vive **só** no secret do GitHub. Nunca commitar.
