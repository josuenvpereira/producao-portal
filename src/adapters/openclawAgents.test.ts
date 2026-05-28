import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOpenclawAgents } from './openclawAgents.js';

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'oca-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function put(name: string, body: string): void {
  writeFileSync(join(dir, name), body);
}

describe('openclawAgents — parser do agents.json', () => {
  it('arquivo ausente → null (degrada)', () => {
    expect(readOpenclawAgents(join(dir, 'nope'))).toBeNull();
  });

  it('JSON inválido → null', () => {
    put('agents.json', 'isto-nao-eh-json');
    expect(readOpenclawAgents(dir)).toBeNull();
  });

  it('array vazio → null (sem agentes = sem snapshot)', () => {
    put('agents.json', '[]');
    expect(readOpenclawAgents(dir)).toBeNull();
  });

  it('schema real do VPS (array de raiz): mapeia campos + pula sem id', () => {
    put(
      'agents.json',
      JSON.stringify([
        // amostra REAL do `openclaw agents list --json` do VPS (2026-05-27)
        {
          id: 'main', name: 'main', identityName: 'Jotaene',
          identityEmoji: '⚡ (raio — assinatura oficial)',
          identitySource: 'identity',
          workspace: '/data/.openclaw/workspace',
          agentDir: '/data/.openclaw/agents/main/agent',
          model: 'deepseek/deepseek-v4-pro', bindings: 0, isDefault: true,
        },
        {
          id: 'gerente-com', name: 'gerente-com',
          identityName: 'Gerente Comunicação', identityEmoji: '📋',
          model: 'deepseek/deepseek-v4-pro', bindings: 0,
        },
        // agente sem identity (caso real: gerente-canal-msu, dba-dev, etc)
        { id: 'dba-dev', name: 'dba-dev', model: 'deepseek/deepseek-v4-pro' },
        // sem id → pula (não quebra o resto)
        { name: 'sem-id-aqui', model: 'x' },
      ]),
    );
    const snap = readOpenclawAgents(dir);
    expect(snap).not.toBeNull();
    expect(snap!.agents).toHaveLength(3);
    const byId = new Map(snap!.agents.map((a) => [a.id, a]));
    expect(byId.get('main')?.isDefault).toBe(true);
    expect(byId.get('main')?.identityEmoji).toBe('⚡ (raio — assinatura oficial)');
    expect(byId.get('gerente-com')?.isDefault).toBe(false);
    expect(byId.get('gerente-com')?.identityName).toBe('Gerente Comunicação');
    expect(byId.get('dba-dev')?.identityName).toBeNull();
    expect(byId.get('dba-dev')?.identityEmoji).toBeNull();
  });

  it('tolera envelope { agents: [...] } (se a CLI mudar futuramente)', () => {
    put('agents.json', JSON.stringify({ agents: [{ id: 'x', name: 'x' }] }));
    const snap = readOpenclawAgents(dir);
    expect(snap?.agents).toHaveLength(1);
    expect(snap?.agents[0]?.id).toBe('x');
  });
});
