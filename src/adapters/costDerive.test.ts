import { describe, it, expect } from 'vitest';
import { deriveCosts, COST_PER_1K_CHARS_USD } from './costDerive.js';
import type { EpisodeProjection } from './types.js';

function ep(id: string, chars: number, approval?: { p: number; b: number }): EpisodeProjection {
  return {
    episodeId: id,
    channel: 'my-storage-units',
    title: id,
    scriptPath: null,
    state: null,
    costApproval: approval
      ? {
          type: 'COST_APPROVAL', episodeId: id, channel: 'my-storage-units',
          at: '', projectedCostUsd: approval.p, budgetUsd: approval.b,
          chars, scenes: 1, files: [],
        }
      : null,
    escalationSignal: null,
    blocks: [
      { blockId: 'b', ord: 0, kind: 'single', audioFile: null, durationFrames: null, spokenChars: chars, images: [] },
    ],
    assets: [],
  };
}

describe('deriveCosts', () => {
  it('usa $0.30/1k chars (igual generate_episode_audio.js)', () => {
    expect(COST_PER_1K_CHARS_USD).toBe(0.3);
    const s = deriveCosts([ep('e1', 1000)], 30);
    expect(s.episodes[0]!.ttsCostUsd).toBe(0.3);
    expect(s.monthlyEstimateUsd).toBe(0.3);
    expect(s.overMonthlyBudget).toBe(false);
  });

  it('marca over-budget pelo sinal de aprovação', () => {
    const s = deriveCosts([ep('e2', 14000, { p: 4.2, b: 3 })], 30);
    expect(s.episodes[0]!.overBudget).toBe(true);
    expect(s.episodes[0]!.approvedCostUsd).toBe(4.2);
  });

  it('detecta estouro do teto mensal', () => {
    const s = deriveCosts([ep('a', 60000), ep('b', 60000)], 30);
    expect(s.monthlyEstimateUsd).toBe(36);
    expect(s.overMonthlyBudget).toBe(true);
  });
});
