import { logger } from './logger.js';

// Log de auditoria append-only. 12-factor: escreve em stdout estruturado
// (campo `audit`), capturado pelo Docker/host. Para reter/expedir, ver
// docs/RUNBOOK.md (ex.: docker logs → arquivo rotacionado / coletor).
// NUNCA inclui chave/cookie (o logger já redige; aqui só metadados).

const alog = logger.child({ audit: true });

export type AuditEvent =
  | 'login_ok'
  | 'login_fail'
  | 'logout'
  | 'asset_served'
  | 'webhook_accepted';

export function audit(event: AuditEvent, fields: Record<string, string | number>): void {
  alog.info({ event, ...fields }, `audit:${event}`);
}
