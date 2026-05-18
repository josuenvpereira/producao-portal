import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOpenClawSnapshot } from './openclawExport.js';

// Fixtures construídas a partir das amostras REAIS do VPS (formato exato).
let dir: string;
const JID = 'dbcbe9e1-8330-4cff-b247-cc3b1a8d9e42';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ocexp-'));
  writeFileSync(
    join(dir, 'cron.json'),
    JSON.stringify({
      jobs: [
        {
          id: JID, agentId: 'gerente-com', name: 'gerente-pauta-09h',
          description: 'Gerente cria 3 pautas slot 09h', enabled: true, status: 'ok',
          schedule: { kind: 'cron', expr: '0 8 * * *', tz: 'America/Sao_Paulo' },
          state: { lastRunAtMs: 1779015600027, lastRunStatus: 'ok', lastDurationMs: 352463, nextRunAtMs: 1779100000000, consecutiveErrors: 0 },
        },
        {
          id: 'x2', agentId: 'gerente-canal-msu', name: 'gerente-canal-msu-pauta',
          description: '', enabled: false, status: 'disabled',
          schedule: { expr: '0 11 * * *', tz: '' }, state: {},
        },
      ],
    }),
  );
  writeFileSync(
    join(dir, 'cron-runs.json'),
    JSON.stringify({
      // formato REAL do VPS: jobs[<id>] = saída crua de `cron runs`, que
      // tem `entries[]` (não `runs[]`) + total/offset/limit/hasMore.
      jobs: {
        [JID]: {
          entries: [
            {
              ts: 1779015600027, runAtMs: 1779015600027, jobId: JID, action: 'finished',
              status: 'ok', summary: '📋 Slot 09h concluído. 3 cards no Backlog.',
              durationMs: 372046, nextRunAtMs: 1779100000000, model: 'deepseek-v4-pro',
              provider: 'deepseek',
              usage: { input_tokens: 26906, output_tokens: 8782, total_tokens: 51964 },
              sessionId: 'sid1', sessionKey: `agent:gerente-com:cron:${JID}:run:sid1`,
            },
          ],
          total: 16, offset: 0, limit: 50, hasMore: true, nextOffset: 2,
        },
      },
    }),
  );
  writeFileSync(
    join(dir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        { key: 'agent:analista-com:x', agentId: 'analista-com', model: 'deepseek-v4-flash', inputTokens: 0, outputTokens: 0, totalTokens: 35850 },
        { key: 'agent:main:y', agentId: 'main', model: 'deepseek-v4-pro', inputTokens: 23408, outputTokens: 215, totalTokens: 23408 },
        { key: 'agent:analista-com:z', agentId: 'analista-com', model: 'deepseek-v4-flash', totalTokens: null },
      ],
    }),
  );
  writeFileSync(join(dir, 'exported-at.txt'), '2026-05-17T12:00:00Z\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('readOpenClawSnapshot', () => {
  it('parseia crons (estado da última execução)', () => {
    const { data } = readOpenClawSnapshot(dir, { pro: 1, flash: 0.5 });
    expect(data.crons).toHaveLength(2);
    const g = data.crons.find((c) => c.id === JID)!;
    expect(g.agentId).toBe('gerente-com');
    expect(g.scheduleExpr).toBe('0 8 * * *');
    expect(g.lastDurationMs).toBe(352463);
    expect(g.enabled).toBe(true);
    expect(data.crons.find((c) => c.id === 'x2')!.enabled).toBe(false);
  });

  it('parseia execuções (esteira) + agente do sessionKey', () => {
    const { data } = readOpenClawSnapshot(dir, { pro: 1, flash: 0.5 });
    expect(data.cronRuns).toHaveLength(1);
    const r = data.cronRuns[0]!;
    expect(r.agentId).toBe('gerente-com');
    expect(r.totalTokens).toBe(51964);
    expect(r.summary).toContain('Slot 09h');
  });

  it('agrega tokens por agente/modelo + custo pelo preço configurável', () => {
    const { data } = readOpenClawSnapshot(dir, { pro: 1, flash: 0.5 });
    const an = data.usage.find((u) => u.agentId === 'analista-com')!;
    expect(an.sessions).toBe(2);
    expect(an.totalTokens).toBe(35850);
    const main = data.usage.find((u) => u.agentId === 'main')!;
    expect(main.totalTokens).toBe(23408);
    expect(main.costUsd).toBeCloseTo(0.02, 2); // 23408/1e6 * 1
    expect(data.exportedAt).toBe('2026-05-17T12:00:00Z');
  });

  it('degrada (sem lançar) quando o dir de export não existe', () => {
    const r = readOpenClawSnapshot(join(dir, 'nao-existe'), { pro: 0, flash: 0 });
    expect(r.degraded).toBe(true);
    expect(r.data.crons).toEqual([]);
  });
});
