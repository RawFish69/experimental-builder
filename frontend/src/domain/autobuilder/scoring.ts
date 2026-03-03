import type { BuildSummary } from '@/domain/build/types';
import type { AutoBuildConstraints, AutoBuildScoreBreakdown, AutoBuilderWeights } from '@/domain/autobuilder/types';

// ---------------------------------------------------------------------------
// Priority weighting for Advanced IDs (customNumericRanges)
// ---------------------------------------------------------------------------

/**
 * Moderate decay: index 0 -> 1.0, index 1 -> 0.5, index 2 -> 0.33, etc.
 * Roughly 2x ratio between adjacent priorities.
 */
const PRIORITY_DECAY_FACTOR = 1.0;

export function priorityWeight(index: number): number {
  return 1 / (1 + index * PRIORITY_DECAY_FACTOR);
}

// ---------------------------------------------------------------------------
// Fulfillment scoring constants
// ---------------------------------------------------------------------------

/** Baseline reward for exactly meeting a min target. */
const FULFILLMENT_BASELINE = 40;
/** Bonus per unit of stat above the min target. */
const OVER_PERFORMANCE_PER_UNIT = 6;
/** Base penalty (scaled by shortfall ratio) when below the min target. */
export const SHORTFALL_PENALTY_BASE = 80;
/** Small reward for staying within a max constraint. */
const MAX_COMPLIANCE_BASELINE = 10;
/** Penalty per unit of stat above the max target. */
const MAX_OVERAGE_PENALTY_PER_UNIT = 8;
export const CUSTOM_RANGE_ROUGH_SCORE_MULTIPLIER = 100;
const ADVANCED_ID_FINAL_GENERIC_SCALE = 0.25;

// ---------------------------------------------------------------------------
// Sustain & threshold helpers (unchanged from original)
// ---------------------------------------------------------------------------

export function computeSustain(summary: BuildSummary): number {
  return (
    summary.aggregated.hprTotal * 0.9 +
    summary.aggregated.mr * 14 +
    summary.aggregated.ms * 10 +
    summary.aggregated.ls * 9
  );
}

export function computeThresholdPenalty(summary: BuildSummary, constraints: AutoBuildConstraints): number {
  let penalty = 0;
  const { target } = constraints;
  if (typeof target.minLegacyBaseDps === 'number' && summary.derived.legacyBaseDps < target.minLegacyBaseDps) {
    penalty += (target.minLegacyBaseDps - summary.derived.legacyBaseDps) * 4;
  }
  if (typeof target.minLegacyEhp === 'number' && summary.derived.legacyEhp < target.minLegacyEhp) {
    penalty += (target.minLegacyEhp - summary.derived.legacyEhp) * 0.8;
  }
  if (typeof target.minDpsProxy === 'number' && summary.derived.dpsProxy < target.minDpsProxy) {
    penalty += (target.minDpsProxy - summary.derived.dpsProxy) * 4;
  }
  if (typeof target.minEhpProxy === 'number' && summary.derived.ehpProxy < target.minEhpProxy) {
    penalty += (target.minEhpProxy - summary.derived.ehpProxy) * 1.1;
  }
  if (typeof target.minMr === 'number' && summary.aggregated.mr < target.minMr) {
    penalty += (target.minMr - summary.aggregated.mr) * 45;
  }
  if (typeof target.minMs === 'number' && summary.aggregated.ms < target.minMs) {
    penalty += (target.minMs - summary.aggregated.ms) * 35;
  }
  if (typeof target.minSpeed === 'number' && summary.aggregated.speed < target.minSpeed) {
    penalty += (target.minSpeed - summary.aggregated.speed) * 12;
  }
  if (
    typeof target.minSkillPointTotal === 'number' &&
    summary.derived.skillPointTotal < target.minSkillPointTotal
  ) {
    penalty += (target.minSkillPointTotal - summary.derived.skillPointTotal) * 15;
  }
  if (typeof target.maxReqTotal === 'number' && summary.derived.reqTotal > target.maxReqTotal) {
    penalty += (summary.derived.reqTotal - target.maxReqTotal) * 8;
  }
  return penalty;
}

// ---------------------------------------------------------------------------
// Fulfillment-based Advanced ID scoring
// ---------------------------------------------------------------------------

/**
 * Compute a fulfillment-graded score for how well the target values satisfy
 * customNumericRanges, with priority weighting based on array order.
 */
export function computeCustomRangeFulfillmentScore(
  ranges: ReadonlyArray<{ key?: string | null; min?: number; max?: number }>,
  valueForKey: (key: string) => number,
): number {
  if (ranges.length === 0) return 0;

  let score = 0;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const key = range.key?.trim();
    if (!key) continue;

    const v = valueForKey(key);
    const pw = priorityWeight(i);

    if (typeof range.min === 'number') {
      const target = range.min;
      if (v >= target) {
        score += FULFILLMENT_BASELINE * pw;
        score += (v - target) * OVER_PERFORMANCE_PER_UNIT * pw;
      } else {
        const shortfallRatio = (target - v) / Math.max(1, Math.abs(target));
        score -= shortfallRatio * SHORTFALL_PENALTY_BASE * pw;
      }
    }

    if (typeof range.max === 'number') {
      if (v <= range.max) {
        score += MAX_COMPLIANCE_BASELINE * pw;
      } else {
        score -= (v - range.max) * MAX_OVERAGE_PENALTY_PER_UNIT * pw;
      }
    }
  }

  return score;
}

export function computeCustomRangeScore(summary: BuildSummary, constraints: AutoBuildConstraints): number {
  const ranges = constraints.target.customNumericRanges ?? [];
  if (ranges.length === 0) return 0;

  const agg = summary.aggregated as unknown as Record<string, number>;
  const der = summary.derived as unknown as Record<string, number>;
  return computeCustomRangeFulfillmentScore(ranges, (key) => agg[key] ?? der[key] ?? 0);
}

// ---------------------------------------------------------------------------
// Final build scoring
// ---------------------------------------------------------------------------

export interface ScoreSummaryOptions {
  /** When true, threshold penalty is skipped (useful for near-miss candidates). */
  skipThresholdPenalty?: boolean;
}

function genericScoreFromBreakdown(breakdown: AutoBuildScoreBreakdown): number {
  return (
    breakdown.legacyBaseDps +
    breakdown.legacyEhp +
    breakdown.dpsProxy +
    breakdown.spellProxy +
    breakdown.meleeProxy +
    breakdown.ehpProxy +
    breakdown.speed +
    breakdown.sustain +
    breakdown.skillPointTotal -
    breakdown.reqPenalty -
    breakdown.thresholdPenalty
  );
}

export function scoreSummary(
  summary: BuildSummary,
  weights: AutoBuilderWeights,
  constraints: AutoBuildConstraints,
  options?: ScoreSummaryOptions,
): { score: number; breakdown: AutoBuildScoreBreakdown } {
  const customRangeScore = computeCustomRangeScore(summary, constraints);

  if (constraints.constraintOnlyMode) {
    const breakdown: AutoBuildScoreBreakdown = {
      legacyBaseDps: 0,
      legacyEhp: 0,
      dpsProxy: 0,
      spellProxy: 0,
      meleeProxy: 0,
      ehpProxy: 0,
      speed: 0,
      sustain: 0,
      skillPointTotal: summary.derived.skillPointTotal * 0.01,
      reqPenalty: summary.derived.reqTotal * 0.01,
      thresholdPenalty: 0,
      customRangeScore,
    };
    const score = customRangeScore + breakdown.skillPointTotal - breakdown.reqPenalty;
    return { score, breakdown };
  }

  const sustain = computeSustain(summary);
  const reqPenalty = summary.derived.reqTotal * weights.reqTotalPenalty;
  const thresholdPenalty = options?.skipThresholdPenalty
    ? 0
    : computeThresholdPenalty(summary, constraints);
  const hasCustomRanges = (constraints.target.customNumericRanges?.length ?? 0) > 0;
  const genericScale = hasCustomRanges ? ADVANCED_ID_FINAL_GENERIC_SCALE : 1;

  const breakdown: AutoBuildScoreBreakdown = {
    legacyBaseDps: summary.derived.legacyBaseDps * weights.legacyBaseDps * genericScale,
    legacyEhp: summary.derived.legacyEhp * weights.legacyEhp * genericScale,
    dpsProxy: summary.derived.dpsProxy * weights.dpsProxy * genericScale,
    spellProxy: summary.derived.spellProxy * weights.spellProxy * genericScale,
    meleeProxy: summary.derived.meleeProxy * weights.meleeProxy * genericScale,
    ehpProxy: summary.derived.ehpProxy * weights.ehpProxy * genericScale,
    speed: summary.aggregated.speed * weights.speed,
    sustain: sustain * weights.sustain,
    skillPointTotal: summary.derived.skillPointTotal * weights.skillPointTotal,
    reqPenalty,
    thresholdPenalty,
    customRangeScore,
  };
  const genericTotal = genericScoreFromBreakdown(breakdown);
  const score = hasCustomRanges
    ? customRangeScore * CUSTOM_RANGE_ROUGH_SCORE_MULTIPLIER + genericTotal
    : genericTotal + customRangeScore;
  return { score, breakdown };
}
