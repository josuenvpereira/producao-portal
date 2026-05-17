# ADR 0002 — Auth: chave única → cookie de sessão; KDF scrypt

**Status:** aceito (2026-05-16) · decidido com o Josué.

## Contexto
Acesso por **chave única gerada 1x**. "Segurança igual OpenClaw" = HTTPS pelo
Traefik + segredo em `.env`, sem painel web, sem multi-usuário.

## Decisão
- Chave: 32 bytes `base64url`, gerada por `scripts/gen-portal-key.js`, exibida
  **uma vez**. O servidor guarda **só o hash** no `.env`.
- **KDF = scrypt** (`node:crypto`), parâmetros OWASP (N=2³², r=8, p=1).
  Escolhido sobre Argon2id para **evitar dependência nativa extra** (menor
  superfície de supply-chain; Docker mais simples). scrypt é memory-hard e
  recomendado pela OWASP — trade-off aceitável.
- Verificação **sempre tempo-constante** (`timingSafeEqual`); erros genéricos.
- Pós-login: cookie **assinado, HttpOnly, Secure, SameSite=Strict**, TTL curto
  **deslizante**. Sessão stateless (HMAC) — sem store de usuário.
- Defesas: `@fastify/rate-limit` + lockout na rota de login; nunca logar
  chave/cookie (redação no logger).

## Consequências
- (+) Zero dep nativa p/ auth; resistente a XSS (cookie HttpOnly) e brute-force.
- (−) Revogar = regerar chave + trocar hash no `.env` (aceitável p/ 1 operador).
