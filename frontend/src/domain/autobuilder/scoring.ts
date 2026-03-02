import type { BuildSummary } from '@/domain/build/types';
import type { AutoBuildConstraints, AutoBuildScoreBreakdown, AutoBuilderWeights } from '@/domain/autobuilder/types';

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

/**
 * Compute how much the build's aggregated stats satisfy customNumericRanges targets.
 *
 * Each custom-min range contributes a positive score proportional to the build's
 * actual value for that stat (not just whether it passes the threshold). This ensures
 * builds that are *more* over the threshold are ranked higher, which keeps the final
 * scoring aligned with what the beam search was optimizing for.
 *
 * Each custom-max range subtracts score for any value above the threshold, rewarding
 * builds that keep that stat low.
 */
export function computeCustomRangeScore(summary: BuildSummary, constraints: AutoBuildConstraints): number {
  const ranges = constraints.target.customNumericRanges ?? [];
  if (ranges.length === 0) return 0;

  // Weight per unit of stat value — chosen to be meaningful relative to the base score
  // components (legacyBaseDps × 1 ≈ 1000–4000, ehpProxy × 0.6 ≈ 300–1200).
  // Using 8 per unit means a stat like +mr=3 contributes 24, comparable to sustain bonus.
  const MIN_SCORE_PER_UNIT = 8;
  const MAX_PENALTY_PER_UNIT = 4;

  let score = 0;
  for (const range of ranges) {
    const key = range.key?.trim();
    if (!key) continue;
    // Look up in the build's aggregated/derived stats by key
    const agg = summary.aggregated as unknown as Record<string, number>;
    const der = summary.derived as unknown as Record<string, number>;
    const v: number = agg[key] ?? der[key] ?? 0;
    if (typeof range.min === 'number') {
      score += v * MIN_SCORE_PER_UNIT;
    }
    if (typeof range.max === 'number' && v > range.max) {
      score -= (v - range.max) * MAX_PENALTY_PER_UNIT;
    }
  }
  return score;
}

export function scoreSummary(summary: BuildSummary, weights: AutoBuilderWeights, constraints: AutoBuildConstraints): { score: number; breakdown: AutoBuildScoreBreakdown } {
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
    };
    const score = customRangeScore + breakdown.skillPointTotal - breakdown.reqPenalty;
    return { score, breakdown };
  }

  const sustain = computeSustain(summary);
  const reqPenalty = summary.derived.reqTotal * weights.reqTotalPenalty;
  const thresholdPenalty = computeThresholdPenalty(summary, constraints);

  const customMinCount = (constraints.target.customNumericRanges ?? []).filter(
    (r) => typeof r.min === 'number',
  ).length;
  const genericScale = customMinCount > 0 ? Math.max(0.15, 1 - customMinCount * 0.2) : 1;

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
  };
  const score =
    breakdown.legacyBaseDps +
    breakdown.legacyEhp +
    breakdown.dpsProxy +
    breakdown.spellProxy +
    breakdown.meleeProxy +
    breakdown.ehpProxy +
    breakdown.speed +
    breakdown.sustain +
    breakdown.skillPointTotal +
    customRangeScore -
    breakdown.reqPenalty -
    breakdown.thresholdPenalty;
  return { score, breakdown };
}
