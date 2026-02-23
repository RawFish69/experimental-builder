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

export function scoreSummary(summary: BuildSummary, weights: AutoBuilderWeights, constraints: AutoBuildConstraints): { score: number; breakdown: AutoBuildScoreBreakdown } {
  const sustain = computeSustain(summary);
  const reqPenalty = summary.derived.reqTotal * weights.reqTotalPenalty;
  const thresholdPenalty = computeThresholdPenalty(summary, constraints);
  const breakdown: AutoBuildScoreBreakdown = {
    legacyBaseDps: summary.derived.legacyBaseDps * weights.legacyBaseDps,
    legacyEhp: summary.derived.legacyEhp * weights.legacyEhp,
    dpsProxy: summary.derived.dpsProxy * weights.dpsProxy,
    ehpProxy: summary.derived.ehpProxy * weights.ehpProxy,
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
    breakdown.ehpProxy +
    breakdown.speed +
    breakdown.sustain +
    breakdown.skillPointTotal -
    breakdown.reqPenalty -
    breakdown.thresholdPenalty;
  return { score, breakdown };
}
