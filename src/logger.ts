import pino from 'pino';
import { config } from './config.js';

// Logger estruturado com redação de segredos (nunca logar chave/cookie/token).
export const logger = pino({
  level: config.isProd ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'key',
      '*.accessKeyHash',
      '*.cookieSecret',
      '*.token',
      '*.webhookSecret',
    ],
    censor: '[redacted]',
  },
});
