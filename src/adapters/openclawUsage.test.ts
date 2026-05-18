import { describe, it, expect } from 'vitest';
import { fetchOpenClawUsage } from './openclawUsage.js';

// O adapter degrada graciosamente sem nunca lançar. Estes casos retornam
// ANTES de qualquer fetch (sem rede): URL ausente e gate por token.

describe('openclawUsage — degradação sem rede', () => {
  it('sem usageUrl → degradado, sem dados', async () => {
    const r = await fetchOpenClawUsage({ usageUrl: '', token: '' });
    expect(r.degraded).toBe(true);
    expect(r.data).toEqual([]);
    expect(r.notes.join(' ')).toContain('OPENCLAW_USAGE_URL ausente');
  });

  it('com URL mas sem token → gate (fetch pulado), degradado', async () => {
    const r = await fetchOpenClawUsage({
      usageUrl: 'https://claw.example/usage',
      token: '',
    });
    expect(r.degraded).toBe(true);
    expect(r.data).toEqual([]);
    expect(r.notes.join(' ')).toContain('OPENCLAW_USAGE_TOKEN');
  });
});
