import type {
  CraftedItemStats,
  RecipeSolverConstraints,
  RecipeSolverScoreBreakdown,
  RecipeSolverWeights,
} from '@/domain/recipe-solver/types';

const OFFENSE_KEYS = [
  'sdPct', 'sdRaw', 'mdPct', 'mdRaw', 'damPct', 'poison',
  'fDamPct', 'wDamPct', 'aDamPct', 'tDamPct', 'eDamPct',
  'spPct1', 'spRaw1', 'spPct2', 'spRaw2', 'spPct3', 'spRaw3', 'spPct4', 'spRaw4',
  'rSdRaw', 'critDamPct',
];

const DEFENSE_KEYS = [
  'hpBonus', 'hprRaw', 'hprPct',
  'fDefPct', 'wDefPct', 'aDefPct', 'tDefPct', 'eDefPct',
];

const UTILITY_KEYS = [
  'mr', 'ms', 'ls', 'spd', 'xpb', 'lb', 'ref', 'thorns',
  'spRegen', 'eSteal', 'sprint', 'sprintReg', 'jh', 'lq', 'gXp', 'gSpd',
];

const SKILL_POINT_KEYS = ['str', 'dex', 'int', 'def', 'agi'];

function sumPositiveMax(stats: CraftedItemStats, keys: readonly string[]): number {
  let total = 0;
  for (const key of keys) {
    const val = stats.maxRolls[key] ?? 0;
    if (val > 0) total += val;
  }
  return total;
}

function sumMax(stats: CraftedItemStats, keys: readonly string[]): number {
  let total = 0;
  for (const key of keys) {
    total += stats.maxRolls[key] ?? 0;
  }
  return total;
}

export function computeOffenseScore(stats: CraftedItemStats): number {
  let score = sumPositiveMax(stats, OFFENSE_KEYS);
  if (stats.category === 'armor') {
    score += stats.hp * 0.02;
  }
  return score;
}

export function computeDefenseScore(stats: CraftedItemStats): number {
  let score = sumPositiveMax(stats, DEFENSE_KEYS);
  if (stats.category === 'armor') {
    score += stats.hp * 0.15;
  }
  score += Math.max(0, stats.eDef) + Math.max(0, stats.tDef) + Math.max(0, stats.wDef)
         + Math.max(0, stats.fDef) + Math.max(0, stats.aDef);
  return score;
}

export function computeUtilityScore(stats: CraftedItemStats): number {
  let score = 0;
  const mr = stats.maxRolls['mr'] ?? 0;
  const ms = stats.maxRolls['ms'] ?? 0;
  const ls = stats.maxRolls['ls'] ?? 0;
  const spd = stats.maxRolls['spd'] ?? 0;
  score += mr * 12 + ms * 8 + ls * 6 + spd * 3;
  for (const key of UTILITY_KEYS) {
    if (key === 'mr' || key === 'ms' || key === 'ls' || key === 'spd') continue;
    const val = stats.maxRolls[key] ?? 0;
    if (val > 0) score += val;
  }
  return score;
}

export function computeSkillPointScore(stats: CraftedItemStats): number {
  return sumMax(stats, SKILL_POINT_KEYS);
}

export function computeReqPenalty(stats: CraftedItemStats): number {
  let total = 0;
  for (const r of stats.reqs) {
    total += Math.max(0, r);
  }
  return total;
}

/**
 * Resolve the effective value for a threshold key.
 * Most keys come from maxRolls, but durability/duration are stored separately.
 * For range stats (durability, duration) we use the low end for min checks
 * and the high end for max checks, so we return both.
 */
function resolveThresholdValue(stats: CraftedItemStats, key: string): [number, number] {
  if (key === 'durability') return [stats.durability[0], stats.durability[1]];
  if (key === 'duration') return [stats.duration[0], stats.duration[1]];
  const v = stats.maxRolls[key] ?? 0;
  return [v, v];
}

export function computeThresholdPenalty(
  stats: CraftedItemStats,
  target: RecipeSolverConstraints['target'],
): number {
  let penalty = 0;
  for (const [key, range] of Object.entries(target)) {
    const [low, high] = resolveThresholdValue(stats, key);
    if (typeof range.min === 'number' && low < range.min) {
      const gap = range.min - low;
      penalty += gap * 200 + gap * gap;
    }
    if (typeof range.max === 'number' && high > range.max) {
      const gap = high - range.max;
      penalty += gap * 200 + gap * gap;
    }
  }
  return penalty;
}

/**
 * Check whether a crafted item satisfies all hard thresholds.
 */
export function satisfiesThresholds(
  stats: CraftedItemStats,
  target: RecipeSolverConstraints['target'],
): boolean {
  for (const [key, range] of Object.entries(target)) {
    const [low, high] = resolveThresholdValue(stats, key);
    if (typeof range.min === 'number' && low < range.min) return false;
    if (typeof range.max === 'number' && high > range.max) return false;
  }
  return true;
}

export function scoreCraftedItem(
  stats: CraftedItemStats,
  weights: RecipeSolverWeights,
  constraints: RecipeSolverConstraints,
): { score: number; breakdown: RecipeSolverScoreBreakdown } {
  const offense = computeOffenseScore(stats) * weights.offense;
  const defense = computeDefenseScore(stats) * weights.defense;
  const utility = computeUtilityScore(stats) * weights.utility;
  const skillPoints = computeSkillPointScore(stats) * weights.skillPoints;
  const reqPenalty = computeReqPenalty(stats) * weights.reqPenalty;
  const thresholdPenalty = computeThresholdPenalty(stats, constraints.target);

  const breakdown: RecipeSolverScoreBreakdown = {
    offense,
    defense,
    utility,
    skillPoints,
    reqPenalty,
    thresholdPenalty,
  };

  const score = offense + defense + utility + skillPoints - reqPenalty - thresholdPenalty;
  return { score, breakdown };
}

/**
 * Quick rough score for a single ingredient (used for candidate pool ranking).
 * Ignores effectiveness and positional interactions.
 * When thresholdKeys are provided, ingredients contributing to those stats
 * get a large bonus so they aren't pruned from the pool.
 */
export function roughIngredientScore(
  ing: { ids: Record<string, { min: number; max: number }>; itemIDs: { dura: number; strReq: number; dexReq: number; intReq: number; defReq: number; agiReq: number } },
  weights: RecipeSolverWeights,
  thresholdKeys?: Set<string>,
): number {
  let score = 0;
  for (const [key, range] of Object.entries(ing.ids)) {
    const val = range.max;
    if (OFFENSE_KEYS.includes(key) && val > 0) score += val * weights.offense;
    else if (DEFENSE_KEYS.includes(key) && val > 0) score += val * weights.defense;
    else if (UTILITY_KEYS.includes(key)) {
      if (key === 'mr') score += val * 12 * weights.utility;
      else if (key === 'ms') score += val * 8 * weights.utility;
      else if (key === 'ls') score += val * 6 * weights.utility;
      else if (key === 'spd') score += val * 3 * weights.utility;
      else if (val > 0) score += val * weights.utility;
    } else if (SKILL_POINT_KEYS.includes(key)) score += val * weights.skillPoints;

    if (thresholdKeys?.has(key) && val > 0) {
      score += val * 50;
    }
  }
  const reqTotal = Math.max(0, ing.itemIDs.strReq) + Math.max(0, ing.itemIDs.dexReq)
    + Math.max(0, ing.itemIDs.intReq) + Math.max(0, ing.itemIDs.defReq) + Math.max(0, ing.itemIDs.agiReq);
  score -= reqTotal * weights.reqPenalty * 0.5;
  return score;
}
