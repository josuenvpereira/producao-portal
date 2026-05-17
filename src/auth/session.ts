import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

// Sessão STATELESS: após validar a chave única, emitimos um cookie ASSINADO
// (HMAC pelo @fastify/cookie) contendo só o timestamp de emissão. Sem store de
// usuário (modelo OpenClaw: 1 operador). TTL deslizante: cada request válido
// re-emite o cookie. HttpOnly+Secure+SameSite=Strict → resistente a XSS/CSRF.

const COOKIE = config.auth.cookieName;
const TTL_MS = config.auth.sessionTtlS * 1000;

function cookieOpts() {
  return {
    httpOnly: true,
    secure: config.isProd, // em dev (http://localhost) Secure quebraria o cookie
    sameSite: 'strict' as const,
    path: '/',
    signed: true,
    maxAge: config.auth.sessionTtlS,
  };
}

export function issueSession(reply: FastifyReply): void {
  reply.setCookie(COOKIE, `v1.${Date.now()}`, cookieOpts());
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(COOKIE, { path: '/', signed: true });
}

/** true se o request tem cookie de sessão assinado e dentro do TTL. */
export function isAuthed(req: FastifyRequest): boolean {
  const raw = req.cookies[COOKIE];
  if (!raw) return false;
  const un = req.unsignCookie(raw);
  if (!un.valid || !un.value) return false;
  const m = /^v1\.(\d+)$/.exec(un.value);
  if (!m) return false;
  const issuedAt = Number(m[1]);
  if (!Number.isFinite(issuedAt)) return false;
  return Date.now() - issuedAt < TTL_MS;
}
