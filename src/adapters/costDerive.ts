import type { EpisodeProjection } from './types.js';

// Custo derivado: o objetivo do Josué é "não ser surpreendido". O OpenClaw
// (/usage) cobre tokens de LLM; aqui derivamos o custo de TTS (ElevenLabs),
// que foi a origem do incidente de ~8k créditos em 2026-05-16.
//
// Constante idêntica a scripts/generate_episode_audio.js (plano Creator).
export const COST_PER_1K_CHARS_USD = 0.3;

export interface EpisodeCost {
  episodeId: string;
  ttsChars: number;
  ttsCostUsd: number; // estimativa pelo spokenText do script.json
  approvedCostUsd: number | null; // do sinal _COST_APPROVAL_, se houver
  budgetUsd: number | null;
  overBudget: boolean;
}

export interface CostSummary {
  episodes: EpisodeCost[];
  monthlyBudgetUsd: number;
  monthlyEstimateUsd: number; // soma das estimativas TTS (proxy de exposição)
  overMonthlyBudget: boolean;
}

export function deriveCosts(
  episodes: EpisodeProjection[],
  monthlyBudgetUsd: number,
): CostSummary {
  const out: EpisodeCost[] = [];
  let monthly = 0;

  for (const ep of episodes) {
    const ttsChars = ep.blocks.reduce((acc, b) => acc + b.spokenChars, 0);
    const ttsCostUsd = round2((ttsChars / 1000) * COST_PER_1K_CHARS_USD);
    const sig = ep.costApproval;
    const approvedCostUsd = sig ? sig.projectedCostUsd : null;
    const budgetUsd = sig ? sig.budgetUsd : null;
    monthly += ttsCostUsd;
    out.push({
      episodeId: ep.episodeId,
      ttsChars,
      ttsCostUsd,
      approvedCostUsd,
      budgetUsd,
      overBudget: sig ? sig.projectedCostUsd > sig.budgetUsd : false,
    });
  }

  return {
    episodes: out,
    monthlyBudgetUsd,
    monthlyEstimateUsd: round2(monthly),
    overMonthlyBudget: monthly > monthlyBudgetUsd,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
