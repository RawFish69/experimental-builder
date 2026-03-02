import type { AutoBuildCandidate, AutoBuildConstraints, AutoBuildProgressEvent } from '@/domain/autobuilder/types';
import { DEFAULT_AUTO_BUILDER_WEIGHTS, type AutoBuilderWeights } from '@/domain/autobuilder/types';
import { scoreSummary } from '@/domain/autobuilder/scoring';
import type { CatalogSnapshot, ItemSlot, NormalizedItem } from '@/domain/items/types';
import { ITEM_SLOTS, itemCanBeWornByClass, slotToCategory } from '@/domain/items/types';
import { evaluateBuild, evaluateBuildSkillpointFeasibility, skillpointOptionsFromTomeMode } from '@/domain/build/build-metrics';
import type { WorkbenchSnapshot } from '@/domain/build/types';

interface BeamNode {
  slots: WorkbenchSnapshot['slots'];
  orderIndex: number;
  roughScore: number;
  optimisticBound: number;
  feasibilityAssigned?: number;
  focusSupport?: number[];
  atkTierAssigned?: number;
  /** Running totals for Advanced: Specific ID min/max constraints (customNumericRanges). */
  customTotals?: number[];
}

function buildPreviewCandidatesFromBeam(
  beam: BeamNode[],
  catalog: CatalogSnapshot,
  constraints: AutoBuildConstraints,
  limit: number,
): AutoBuildCandidate[] {
  if (!beam.length || limit <= 0) return [];
  const sorted = [...beam].sort((a, b) => b.roughScore - a.roughScore).slice(0, limit);
  const previews: AutoBuildCandidate[] = [];
  for (const node of sorted) {
    const summary = evaluateBuild(
      {
        slots: node.slots,
        level: constraints.level,
        characterClass: constraints.characterClass,
      },
      catalog,
    );
    const { score, breakdown } = scoreSummary(summary, constraints.weights, constraints);
    previews.push({
      slots: { ...node.slots },
      score,
      scoreBreakdown: breakdown,
      summary,
    });
  }
  return previews;
}
function computeActiveSetCounts(
  slots: WorkbenchSnapshot['slots'],
  catalog: CatalogSnapshot,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slot of ITEM_SLOTS) {
    const id = slots[slot];
    if (id == null) continue;
    // Set membership is stored in catalog.itemSetName (reverse-mapped from the sets block).
    // Items carry no `set` field themselves in the compressed data.
    const setName = catalog.itemSetName.get(id);
    if (!setName) continue;
    counts.set(setName, (counts.get(setName) ?? 0) + 1);
  }
  return counts;
}

/**
 * Returns true if placing `itemId` into any slot would immediately create an illegal
 * item-combination (i.e. the set this item belongs to would exceed its legal count limit).
 * Used during beam expansion for early pruning.
 */
function wouldCreateIllegalCombo(
  itemId: number,
  currentSlots: WorkbenchSnapshot['slots'],
  catalog: CatalogSnapshot,
): boolean {
  const setName = catalog.itemSetName.get(itemId);
  if (!setName) return false;
  const meta = catalog.setsMeta.get(setName);
  if (!meta) return false;
  let existingCount = 0;
  for (const s of ITEM_SLOTS) {
    const sid = currentSlots[s];
    if (sid != null && catalog.itemSetName.get(sid) === setName) {
      existingCount++;
    }
  }
  return meta.illegalCounts.includes(existingCount + 1);
}

type SkillStatKey = 'str' | 'dex' | 'int' | 'def' | 'agi';

interface CandidatePoolEntry {
  id: number;
  rough: number;
  reqTotal: number;
  skillPointTotal: number;
  utility: number;
  level: number;
  atkTier: number;
  spStr: number;
  spDex: number;
  spInt: number;
  spDef: number;
  spAgi: number;
  supportFocus: number;
}

interface CustomRangeSpec {
  key: string;
  min?: number;
  max?: number;
}

interface AtkTierRequirement {
  hasConstraint: boolean;
  minAllowed: number;
  maxAllowed: number;
  rows: CustomRangeSpec[];
}

interface AttackSpeedReachabilityContext {
  baseSpeedIndex: number;
  fixedAtkTierTotal: number;
  allowedFinalIndices: number[];
  allowedFinalIndexSet: Set<number>;
  preferredDirection: -1 | 0 | 1;
}

type FinalHardConstraintReason = 'attackSpeed' | 'thresholds' | 'item' | 'sp';

interface FinalHardConstraintCheck {
  ok: boolean;
  reason?: FinalHardConstraintReason;
  /** When reason is 'thresholds', one or more human-readable failed check messages (e.g. "minLegacyBaseDps (1200 < 1500)"). */
  failedChecks?: string[];
}

const SKILL_STATS: SkillStatKey[] = ['str', 'dex', 'int', 'def', 'agi'];
const WEAPON_ATTACK_SPEED_ORDER = ['SUPER_SLOW', 'VERY_SLOW', 'SLOW', 'NORMAL', 'FAST', 'VERY_FAST', 'SUPER_FAST'] as const;

function skillpointFeasibilityOptionsFromMode(constraints: AutoBuildConstraints) {
  return skillpointOptionsFromTomeMode(constraints.skillpointFeasibilityMode, constraints.level);
}

function normalizedAtkTier(item: NormalizedItem): number {
  return Math.round(item.numeric.atkTier || 0);
}

function positiveStatBonus(item: NormalizedItem, stat: SkillStatKey): number {
  switch (stat) {
    case 'str':
      return Math.max(0, item.numeric.spStr);
    case 'dex':
      return Math.max(0, item.numeric.spDex);
    case 'int':
      return Math.max(0, item.numeric.spInt);
    case 'def':
      return Math.max(0, item.numeric.spDef);
    case 'agi':
      return Math.max(0, item.numeric.spAgi);
  }
}

function skillReq(item: NormalizedItem, stat: SkillStatKey): number {
  switch (stat) {
    case 'str':
      return item.numeric.reqStr;
    case 'dex':
      return item.numeric.reqDex;
    case 'int':
      return item.numeric.reqInt;
    case 'def':
      return item.numeric.reqDef;
    case 'agi':
      return item.numeric.reqAgi;
  }
}

function computeSupportFocusScore(item: NormalizedItem, focusStats: SkillStatKey[]): number {
  if (focusStats.length === 0) return 0;
  let score = 0;
  for (const stat of focusStats) {
    score += positiveStatBonus(item, stat) * 10;
    score -= Math.max(0, skillReq(item, stat)) * 0.7;
  }
  score -= Math.max(0, item.roughScoreFields.reqTotal) * 0.12;
  return score;
}

function cloneSlots(slots: WorkbenchSnapshot['slots']): WorkbenchSnapshot['slots'] {
  return { ...slots };
}

function computeFinalWeaponAttackSpeed(
  slots: WorkbenchSnapshot['slots'],
  catalog: CatalogSnapshot,
): string | null {
  const weaponId = slots.weapon;
  if (weaponId == null) return null;
  const weapon = catalog.itemsById.get(weaponId);
  if (!weapon) return null;
  const baseIndex = WEAPON_ATTACK_SPEED_ORDER.indexOf(
    weapon.atkSpd as (typeof WEAPON_ATTACK_SPEED_ORDER)[number],
  );
  if (baseIndex < 0) return null;

  let totalAtkTier = 0;
  for (const slot of ITEM_SLOTS) {
    const itemId = slots[slot];
    if (itemId == null) continue;
    const item = catalog.itemsById.get(itemId);
    if (!item) continue;
    totalAtkTier += normalizedAtkTier(item);
  }

  const finalIndex = Math.max(0, Math.min(WEAPON_ATTACK_SPEED_ORDER.length - 1, baseIndex + totalAtkTier));
  return WEAPON_ATTACK_SPEED_ORDER[finalIndex];
}

function computeTotalAtkTier(slots: WorkbenchSnapshot['slots'], catalog: CatalogSnapshot): number {
  let total = 0;
  for (const slot of ITEM_SLOTS) {
    const itemId = slots[slot];
    if (itemId == null) continue;
    const item = catalog.itemsById.get(itemId);
    if (!item) continue;
    total += normalizedAtkTier(item);
  }
  return total;
}

function buildAttackSpeedReachabilityContext(
  baseSlots: WorkbenchSnapshot['slots'],
  catalog: CatalogSnapshot,
  constraints: AutoBuildConstraints,
): AttackSpeedReachabilityContext | null {
  if (constraints.weaponAttackSpeeds.length === 0) return null;
  const weaponId = baseSlots.weapon;
  if (weaponId == null) return null;
  const weapon = catalog.itemsById.get(weaponId);
  if (!weapon) return null;
  const baseSpeedIndex = WEAPON_ATTACK_SPEED_ORDER.indexOf(
    weapon.atkSpd as (typeof WEAPON_ATTACK_SPEED_ORDER)[number],
  );
  if (baseSpeedIndex < 0) return null;

  const allowedFinalIndices = [...new Set(
    constraints.weaponAttackSpeeds
      .map((speed) => WEAPON_ATTACK_SPEED_ORDER.indexOf(speed as (typeof WEAPON_ATTACK_SPEED_ORDER)[number]))
      .filter((index): index is number => index >= 0),
  )].sort((a, b) => a - b);
  if (allowedFinalIndices.length === 0) return null;

  const fixedAtkTierTotal = computeTotalAtkTier(baseSlots, catalog);
  const currentClampedFinal = Math.max(0, Math.min(WEAPON_ATTACK_SPEED_ORDER.length - 1, baseSpeedIndex + fixedAtkTierTotal));
  let preferredDirection: -1 | 0 | 1 = 0;
  if (!allowedFinalIndices.includes(currentClampedFinal)) {
    const nearest = allowedFinalIndices.reduce((best, idx) =>
      Math.abs(idx - currentClampedFinal) < Math.abs(best - currentClampedFinal) ? idx : best,
    allowedFinalIndices[0]);
    preferredDirection = nearest > currentClampedFinal ? 1 : nearest < currentClampedFinal ? -1 : 0;
  }

  return {
    baseSpeedIndex,
    fixedAtkTierTotal,
    allowedFinalIndices,
    allowedFinalIndexSet: new Set(allowedFinalIndices),
    preferredDirection,
  };
}

function buildAtkTierSuffixBounds(
  order: ItemSlot[],
  candidatePools: Map<ItemSlot, Array<{ id: number; rough: number }>>,
  catalog: CatalogSnapshot,
): { minSuffix: number[]; maxSuffix: number[] } {
  const minSuffix = new Array(order.length + 1).fill(0);
  const maxSuffix = new Array(order.length + 1).fill(0);
  for (let i = order.length - 1; i >= 0; i--) {
    const pool = candidatePools.get(order[i]) ?? [];
    let slotMin = 0;
    let slotMax = 0;
    if (pool.length > 0) {
      slotMin = Infinity;
      slotMax = -Infinity;
      for (const entry of pool) {
        const item = catalog.itemsById.get(entry.id);
        const atkTier = item ? normalizedAtkTier(item) : 0;
        if (atkTier < slotMin) slotMin = atkTier;
        if (atkTier > slotMax) slotMax = atkTier;
      }
      if (!Number.isFinite(slotMin)) slotMin = 0;
      if (!Number.isFinite(slotMax)) slotMax = 0;
    }
    minSuffix[i] = minSuffix[i + 1] + slotMin;
    maxSuffix[i] = maxSuffix[i + 1] + slotMax;
  }
  return { minSuffix, maxSuffix };
}

function canStillReachAllowedAttackSpeed(
  ctx: AttackSpeedReachabilityContext,
  partialAssignedAtkTier: number,
  remainingMinAtkTier: number,
  remainingMaxAtkTier: number,
): boolean {
  const minTotalAtkTier = ctx.fixedAtkTierTotal + partialAssignedAtkTier + remainingMinAtkTier;
  const maxTotalAtkTier = ctx.fixedAtkTierTotal + partialAssignedAtkTier + remainingMaxAtkTier;
  const low = Math.min(minTotalAtkTier, maxTotalAtkTier);
  const high = Math.max(minTotalAtkTier, maxTotalAtkTier);
  for (let atkTier = low; atkTier <= high; atkTier++) {
    const finalIndex = Math.max(0, Math.min(WEAPON_ATTACK_SPEED_ORDER.length - 1, ctx.baseSpeedIndex + atkTier));
    if (ctx.allowedFinalIndexSet.has(finalIndex)) return true;
  }
  return false;
}

function attackSpeedBiasValue(
  ctx: AttackSpeedReachabilityContext | null,
  assignedAtkTier: number | undefined,
  remainingMinAtkTier = 0,
  remainingMaxAtkTier = 0,
  amplifier = 1,
): number {
  if (!ctx || !ctx.preferredDirection) return 0;
  const total = ctx.fixedAtkTierTotal + (assignedAtkTier ?? 0);
  const minFinalIndex = Math.max(
    0,
    Math.min(WEAPON_ATTACK_SPEED_ORDER.length - 1, ctx.baseSpeedIndex + total + remainingMinAtkTier),
  );
  const maxFinalIndex = Math.max(
    0,
    Math.min(WEAPON_ATTACK_SPEED_ORDER.length - 1, ctx.baseSpeedIndex + total + remainingMaxAtkTier),
  );
  const low = Math.min(minFinalIndex, maxFinalIndex);
  const high = Math.max(minFinalIndex, maxFinalIndex);

  let bestDistance = Infinity;
  let worstDistance = 0;
  for (let idx = low; idx <= high; idx++) {
    let distanceToAllowed = Infinity;
    for (const allowedIndex of ctx.allowedFinalIndices) {
      const distance = Math.abs(allowedIndex - idx);
      if (distance < distanceToAllowed) distanceToAllowed = distance;
    }
    if (distanceToAllowed < bestDistance) bestDistance = distanceToAllowed;
    if (distanceToAllowed > worstDistance) worstDistance = distanceToAllowed;
  }
  if (!Number.isFinite(bestDistance)) return 0;

  if (worstDistance === 0) return 0;

  const safetyProgress = ctx.preferredDirection > 0 ? low : -high;
  return (-worstDistance * 1_000 - bestDistance * 100 + safetyProgress) * amplifier;
}

function summarySatisfiesTargetThresholds(
  summary: ReturnType<typeof evaluateBuild>,
  constraints: AutoBuildConstraints,
  slots?: WorkbenchSnapshot['slots'],
  catalog?: CatalogSnapshot,
): { ok: boolean; failedChecks?: string[] } {
  const { target } = constraints;
  const nonAttackCustomSpecs = getCustomRangeSpecs(constraints, { includeAttackTier: false });
  const failedChecks: string[] = [];
  if (typeof target.minLegacyBaseDps === 'number' && summary.derived.legacyBaseDps < target.minLegacyBaseDps) {
    failedChecks.push(`minLegacyBaseDps (${summary.derived.legacyBaseDps} < ${target.minLegacyBaseDps})`);
  }
  if (typeof target.minLegacyEhp === 'number' && summary.derived.legacyEhp < target.minLegacyEhp) {
    failedChecks.push(`minLegacyEhp (${summary.derived.legacyEhp} < ${target.minLegacyEhp})`);
  }
  if (typeof target.minDpsProxy === 'number' && summary.derived.dpsProxy < target.minDpsProxy) {
    failedChecks.push(`minDpsProxy (${summary.derived.dpsProxy} < ${target.minDpsProxy})`);
  }
  if (typeof target.minEhpProxy === 'number' && summary.derived.ehpProxy < target.minEhpProxy) {
    failedChecks.push(`minEhpProxy (${summary.derived.ehpProxy} < ${target.minEhpProxy})`);
  }
  if (typeof target.minMr === 'number' && summary.aggregated.mr < target.minMr) {
    failedChecks.push(`minMr (${summary.aggregated.mr} < ${target.minMr})`);
  }
  if (typeof target.minMs === 'number' && summary.aggregated.ms < target.minMs) {
    failedChecks.push(`minMs (${summary.aggregated.ms} < ${target.minMs})`);
  }
  if (typeof target.minSpeed === 'number' && summary.aggregated.speed < target.minSpeed) {
    failedChecks.push(`minSpeed (${summary.aggregated.speed} < ${target.minSpeed})`);
  }
  if (typeof target.minSkillPointTotal === 'number' && summary.derived.skillPointTotal < target.minSkillPointTotal) {
    failedChecks.push(`minSkillPointTotal (${summary.derived.skillPointTotal} < ${target.minSkillPointTotal})`);
  }
  if (typeof target.maxReqTotal === 'number' && summary.derived.reqTotal > target.maxReqTotal) {
    failedChecks.push(`maxReqTotal (${summary.derived.reqTotal} > ${target.maxReqTotal})`);
  }
  if (nonAttackCustomSpecs.length > 0 && slots && catalog) {
    for (const range of nonAttackCustomSpecs) {
      const key = range.key;
      let total = 0;
      for (const slot of ITEM_SLOTS) {
        const itemId = slots[slot];
        if (itemId == null) continue;
        const item = catalog.itemsById.get(itemId);
        if (!item) continue;
        total += item.numericIndex[key] ?? 0;
      }
      if (typeof range.min === 'number' && total < range.min) {
        failedChecks.push(`${key} (${total} < ${range.min})`);
      }
      if (typeof range.max === 'number' && total > range.max) {
        failedChecks.push(`${key} (${total} > ${range.max})`);
      }
    }
  }
  return failedChecks.length > 0 ? { ok: false, failedChecks } : { ok: true };
}

function validateFinalHardConstraints(
  slots: WorkbenchSnapshot['slots'],
  catalog: CatalogSnapshot,
  constraints: AutoBuildConstraints,
  summary: ReturnType<typeof evaluateBuild>,
): FinalHardConstraintCheck {
  const mustIncludeIds = [...new Set(constraints.mustIncludeIds)];
  for (const id of mustIncludeIds) {
    let present = false;
    for (const slot of ITEM_SLOTS) {
      if (slots[slot] === id) {
        present = true;
        break;
      }
    }
    if (!present) {
      return { ok: false, reason: 'item', failedChecks: [`mustIncludeMissing (${id})`] };
    }
  }

  for (const slot of ITEM_SLOTS) {
    const itemId = slots[slot];
    if (itemId == null) continue;
    const item = catalog.itemsById.get(itemId);
    if (!item) return { ok: false, reason: 'item' };
    // Recheck item-level hard constraints on locked / must-include items too.
    if (!itemMatchesGlobalConstraints(item, constraints)) return { ok: false, reason: 'item' };
  }

  // Enforce legacy "illegal item combination" rules driven by set metadata.
  // Mirror old builder: for each active set, if bonuses[count-1].illegal is true, the combo is illegal.
  const setCounts = computeActiveSetCounts(slots, catalog);
  for (const [setName, count] of setCounts) {
    const meta = catalog.setsMeta.get(setName);
    if (!meta) continue;
    if (meta.illegalCounts.includes(count)) {
      return { ok: false, reason: 'item' };
    }
  }

  const attackCheck = combinedAttackConstraintSatisfied({
    constraints,
    slots,
    catalog,
    atkTierRequirement: buildAtkTierRequirement(getAttackTierRangeSpecs(constraints)),
  });
  if (attackCheck.configured && !attackCheck.ok) {
    return { ok: false, reason: 'attackSpeed', failedChecks: attackCheck.failedChecks };
  }

  const thresholdResult = summarySatisfiesTargetThresholds(summary, constraints, slots, catalog);
  if (!thresholdResult.ok) {
    return { ok: false, reason: 'thresholds', failedChecks: thresholdResult.failedChecks };
  }

  return { ok: true };
}

function itemMatchesGlobalConstraints(item: NormalizedItem, constraints: AutoBuildConstraints): boolean {
  if (!constraints.allowRestricted && (item.restricted || item.deprecated)) return false;
  if (item.level > constraints.level) return false;
  if (!itemCanBeWornByClass(item, constraints.characterClass)) return false;
  if (constraints.excludedIds.includes(item.id)) return false;
  if (constraints.allowedTiers.length > 0 && !constraints.allowedTiers.includes(item.tier)) return false;
  if (constraints.minPowderSlots != null && item.powderSlots < constraints.minPowderSlots) return false;
  if (constraints.excludedMajorIds.length > 0 && constraints.excludedMajorIds.some((majorId) => item.majorIds.includes(majorId))) {
    return false;
  }
  return true;
}

/** Boost factor for weights when a target threshold is set (used in threshold rescue pass). */
const THRESHOLD_WEIGHT_BOOST = 2.5;

/**
 * Returns weights biased toward the dimensions that have target thresholds set,
 * so beam search keeps more builds that can satisfy those thresholds.
 * Exported for use by the modal's threshold rescue attempt.
 */
export function thresholdBiasedWeights(
  target: AutoBuildConstraints['target'],
  baseWeights: AutoBuildConstraints['weights'],
): AutoBuilderWeights {
  const w = { ...baseWeights };
  if (typeof target.minLegacyBaseDps === 'number') w.legacyBaseDps = Math.max(w.legacyBaseDps, DEFAULT_AUTO_BUILDER_WEIGHTS.legacyBaseDps * THRESHOLD_WEIGHT_BOOST);
  if (typeof target.minLegacyEhp === 'number') w.legacyEhp = Math.max(w.legacyEhp, DEFAULT_AUTO_BUILDER_WEIGHTS.legacyEhp * THRESHOLD_WEIGHT_BOOST);
  if (typeof target.minDpsProxy === 'number') w.dpsProxy = Math.max(w.dpsProxy, DEFAULT_AUTO_BUILDER_WEIGHTS.dpsProxy * THRESHOLD_WEIGHT_BOOST);
  if (typeof target.minEhpProxy === 'number') w.ehpProxy = Math.max(w.ehpProxy, DEFAULT_AUTO_BUILDER_WEIGHTS.ehpProxy * THRESHOLD_WEIGHT_BOOST);
  if (typeof target.minMr === 'number' || typeof target.minMs === 'number') {
    w.sustain = Math.max(w.sustain, DEFAULT_AUTO_BUILDER_WEIGHTS.sustain * THRESHOLD_WEIGHT_BOOST);
  }
  if (typeof target.minSpeed === 'number') w.speed = Math.max(w.speed, DEFAULT_AUTO_BUILDER_WEIGHTS.speed * THRESHOLD_WEIGHT_BOOST);
  if (typeof target.minSkillPointTotal === 'number') w.skillPointTotal = Math.max(w.skillPointTotal, DEFAULT_AUTO_BUILDER_WEIGHTS.skillPointTotal * THRESHOLD_WEIGHT_BOOST);
  if (typeof target.maxReqTotal === 'number') w.reqTotalPenalty = Math.max(w.reqTotalPenalty, DEFAULT_AUTO_BUILDER_WEIGHTS.reqTotalPenalty * THRESHOLD_WEIGHT_BOOST);
  if ((target.customNumericRanges?.length ?? 0) > 0) {
    w.sustain = Math.max(w.sustain, DEFAULT_AUTO_BUILDER_WEIGHTS.sustain * THRESHOLD_WEIGHT_BOOST);
  }
  return w;
}

/** When user sets Advanced ID min/max, boost rough score for items that help meet those constraints. */
const CUSTOM_RANGE_MIN_WEIGHT = 3;
const CUSTOM_RANGE_MAX_WEIGHT = 2;
/** Much stronger bias when advanced IDs are the primary goal - ensures mr/hr support items dominate. */
const CUSTOM_RANGE_MIN_WEIGHT_STRONG = 14;

function roughItemScore(item: NormalizedItem, constraints: AutoBuildConstraints): number {
  const customRanges = constraints.target.customNumericRanges ?? [];

  // Pure constraint-satisfaction: only score by how much items contribute to custom ranges.
  if (constraints.constraintOnlyMode) {
    let score = 0;
    for (const range of customRanges) {
      const key = range.key?.trim();
      if (!key) continue;
      const v = item.numericIndex[key] ?? 0;
      if (typeof range.min === 'number') score += v * CUSTOM_RANGE_MIN_WEIGHT_STRONG;
      if (typeof range.max === 'number') score -= v * CUSTOM_RANGE_MAX_WEIGHT;
    }
    score -= item.roughScoreFields.reqTotal * 0.05;
    return score;
  }

  const hasCustomMins = customRanges.some((r) => typeof r.min === 'number');

  const customMinCount = customRanges.filter((r) => typeof r.min === 'number').length;
  const genericScale = hasCustomMins ? Math.max(0.15, 1 - customMinCount * 0.2) : 1;

  const defWeight = (constraints.weights.legacyEhp + constraints.weights.ehpProxy) * genericScale;

  let score =
    item.numeric.baseDps * constraints.weights.legacyBaseDps * genericScale +
    item.roughScoreFields.ehpProxy * defWeight +
    item.roughScoreFields.offense * constraints.weights.dpsProxy * genericScale +
    item.numeric.spd * constraints.weights.speed +
    item.roughScoreFields.utility * constraints.weights.sustain +
    item.roughScoreFields.skillPointTotal * constraints.weights.skillPointTotal -
    item.roughScoreFields.reqTotal * constraints.weights.reqTotalPenalty;

  const minWeight = hasCustomMins ? CUSTOM_RANGE_MIN_WEIGHT_STRONG : CUSTOM_RANGE_MIN_WEIGHT;
  for (const range of customRanges) {
    const key = range.key?.trim();
    if (!key) continue;
    const v = item.numericIndex[key] ?? 0;
    if (typeof range.min === 'number') {
      score += v * minWeight;
    }
    if (typeof range.max === 'number') {
      score -= v * CUSTOM_RANGE_MAX_WEIGHT;
    }
  }
  return score;
}

function canonicalCandidateKey(slots: WorkbenchSnapshot['slots']): string {
  const ringA = slots.ring1 ?? 0;
  const ringB = slots.ring2 ?? 0;
  const [ring1, ring2] = ringA <= ringB ? [ringA, ringB] : [ringB, ringA];
  return [
    slots.helmet ?? 0,
    slots.chestplate ?? 0,
    slots.leggings ?? 0,
    slots.boots ?? 0,
    ring1,
    ring2,
    slots.bracelet ?? 0,
    slots.necklace ?? 0,
    slots.weapon ?? 0,
  ].join('|');
}

function mergeBeamLanes(
  primarySorted: BeamNode[],
  hardSorted: BeamNode[],
  beamWidth: number,
  primaryShare = 0.6,
): BeamNode[] {
  const width = Math.max(1, beamWidth);
  const merged: BeamNode[] = [];
  const seen = new Set<string>();
  const primaryTarget = Math.max(1, Math.min(width, Math.round(width * primaryShare)));
  let i = 0;
  let j = 0;

  const tryPush = (node: BeamNode): boolean => {
    const key = `${node.orderIndex}|${canonicalCandidateKey(node.slots)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    merged.push(node);
    return true;
  };

  while (merged.length < width && (i < primarySorted.length || j < hardSorted.length)) {
    if (merged.length < primaryTarget && i < primarySorted.length) {
      tryPush(primarySorted[i]);
      i++;
      continue;
    }
    if (j < hardSorted.length) {
      tryPush(hardSorted[j]);
      j++;
      continue;
    }
    if (i < primarySorted.length) {
      tryPush(primarySorted[i]);
      i++;
      continue;
    }
    break;
  }

  return merged;
}

function itemFitsSlot(item: NormalizedItem, slot: ItemSlot): boolean {
  return slotToCategory(slot) === item.category;
}

interface MustIncludeAssignmentResult {
  slots: WorkbenchSnapshot['slots'];
  ok: boolean;
  reasonCode?: string;
  detail?: string;
}

function assignMustIncludes(
  baseSlots: WorkbenchSnapshot['slots'],
  catalog: CatalogSnapshot,
  constraints: AutoBuildConstraints,
): MustIncludeAssignmentResult {
  const slots = cloneSlots(baseSlots);
  const mustIncludeIds = [...new Set(constraints.mustIncludeIds)];
  for (const itemId of mustIncludeIds) {
    const item = catalog.itemsById.get(itemId);
    if (!item) {
      return {
        slots,
        ok: false,
        reasonCode: 'must_include_conflict',
        detail: `Must-include item ${itemId} does not exist in catalog.`,
      };
    }
    if (!itemMatchesGlobalConstraints(item, constraints)) {
      return {
        slots,
        ok: false,
        reasonCode: 'must_include_conflict',
        detail: `Must-include item ${item.displayName} is incompatible with current hard filters (class/level/tier/exclusions).`,
      };
    }
    const alreadyEquipped = ITEM_SLOTS.some((slot) => slots[slot] === item.id);
    if (alreadyEquipped) continue;

    const candidates = ITEM_SLOTS.filter((slot) => slots[slot] == null && itemFitsSlot(item, slot));
    const target = candidates[0];
    if (!target) {
      return {
        slots,
        ok: false,
        reasonCode: 'must_include_conflict',
        detail: `No free ${item.category} slot available to place must-include item ${item.displayName}.`,
      };
    }
    slots[target] = item.id;
  }
  return { slots, ok: true };
}

function collectRequirementFocusStats(
  baseSlots: WorkbenchSnapshot['slots'],
  catalog: CatalogSnapshot,
): SkillStatKey[] {
  const maxReq = {
    str: 0,
    dex: 0,
    int: 0,
    def: 0,
    agi: 0,
  } satisfies Record<SkillStatKey, number>;

  for (const slot of ITEM_SLOTS) {
    const itemId = baseSlots[slot];
    if (itemId == null) continue;
    const item = catalog.itemsById.get(itemId);
    if (!item) continue;
    maxReq.str = Math.max(maxReq.str, item.numeric.reqStr);
    maxReq.dex = Math.max(maxReq.dex, item.numeric.reqDex);
    maxReq.int = Math.max(maxReq.int, item.numeric.reqInt);
    maxReq.def = Math.max(maxReq.def, item.numeric.reqDef);
    maxReq.agi = Math.max(maxReq.agi, item.numeric.reqAgi);
  }

  const focused = SKILL_STATS
    .filter((stat) => maxReq[stat] > 100)
    .sort((a, b) => maxReq[b] - maxReq[a]);
  if (focused.length > 0) return focused;

  return SKILL_STATS
    .filter((stat) => maxReq[stat] >= 70)
    .sort((a, b) => maxReq[b] - maxReq[a])
    .slice(0, 2);
}

function collectOvercapNeeds(
  baseSlots: WorkbenchSnapshot['slots'],
  catalog: CatalogSnapshot,
  focusStats: SkillStatKey[],
): number[] {
  if (focusStats.length === 0) return [];
  const maxReq = {
    str: 0,
    dex: 0,
    int: 0,
    def: 0,
    agi: 0,
  } satisfies Record<SkillStatKey, number>;
  for (const slot of ITEM_SLOTS) {
    const itemId = baseSlots[slot];
    if (itemId == null) continue;
    const item = catalog.itemsById.get(itemId);
    if (!item) continue;
    maxReq.str = Math.max(maxReq.str, item.numeric.reqStr);
    maxReq.dex = Math.max(maxReq.dex, item.numeric.reqDex);
    maxReq.int = Math.max(maxReq.int, item.numeric.reqInt);
    maxReq.def = Math.max(maxReq.def, item.numeric.reqDef);
    maxReq.agi = Math.max(maxReq.agi, item.numeric.reqAgi);
  }
  return focusStats.map((stat) => Math.max(0, maxReq[stat] - 100));
}

function focusBonusVectorForItem(item: NormalizedItem, focusStats: SkillStatKey[]): number[] {
  return focusStats.map((stat) => positiveStatBonus(item, stat));
}

function addNumberVectors(a: number[], b: number[]): number[] {
  if (a.length === 0) return b.slice();
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

function canStillMeetOvercapNeed(current: number[], remainingMax: number[], need: number[]): boolean {
  for (let i = 0; i < need.length; i++) {
    if ((current[i] ?? 0) + (remainingMax[i] ?? 0) < need[i]) return false;
  }
  return true;
}

function supportDeficit(current: number[], need: number[]): number {
  let deficit = 0;
  for (let i = 0; i < need.length; i++) {
    deficit += Math.max(0, need[i] - (current[i] ?? 0));
  }
  return deficit;
}

function customRangeDeficit(
  currentTotals: number[] | undefined,
  specs: CustomRangeSpec[],
): number {
  if (!currentTotals || specs.length === 0) return 0;
  let deficit = 0;
  for (let i = 0; i < specs.length; i++) {
    const cur = currentTotals[i] ?? 0;
    const spec = specs[i];
    if (typeof spec.min === 'number' && cur < spec.min) {
      deficit += spec.min - cur;
    }
    if (typeof spec.max === 'number' && cur > spec.max) {
      deficit += cur - spec.max;
    }
  }
  return deficit;
}

function computeSlotFocusSupportPotential(
  slot: ItemSlot,
  candidatePools: Map<ItemSlot, Array<{ id: number; rough: number }>>,
  catalog: CatalogSnapshot,
  focusStats: SkillStatKey[],
): number {
  if (focusStats.length === 0) return 0;
  const pool = candidatePools.get(slot) ?? [];
  let best = 0;
  for (const entry of pool) {
    const item = catalog.itemsById.get(entry.id);
    if (!item) continue;
    let score = 0;
    for (const stat of focusStats) {
      score += positiveStatBonus(item, stat);
    }
    if (score > best) best = score;
  }
  return best;
}

function getCustomRangeSpecs(
  constraints: AutoBuildConstraints,
  options: { includeAttackTier?: boolean } = {},
): CustomRangeSpec[] {
  const includeAttackTier = options.includeAttackTier ?? true;
  return (constraints.target.customNumericRanges ?? [])
    .map((row) => ({
      key: (row.key ?? '').trim(),
      min: typeof row.min === 'number' ? row.min : undefined,
      max: typeof row.max === 'number' ? row.max : undefined,
    }))
    .filter((row) => row.key && (typeof row.min === 'number' || typeof row.max === 'number'))
    .filter((row) => includeAttackTier || row.key !== 'atkTier');
}

function getAttackTierRangeSpecs(constraints: AutoBuildConstraints): CustomRangeSpec[] {
  return getCustomRangeSpecs(constraints, { includeAttackTier: true }).filter((row) => row.key === 'atkTier');
}

function getCustomRangeSpecsForBeamPruning(constraints: AutoBuildConstraints): CustomRangeSpec[] {
  const skipAtkTier =
    constraints.attackSpeedConstraintMode === 'or' &&
    constraints.weaponAttackSpeeds.length > 0;
  return getCustomRangeSpecs(constraints, { includeAttackTier: !skipAtkTier });
}

function buildAtkTierRequirement(rows: CustomRangeSpec[]): AtkTierRequirement {
  if (rows.length === 0) {
    return { hasConstraint: false, minAllowed: Number.NEGATIVE_INFINITY, maxAllowed: Number.POSITIVE_INFINITY, rows: [] };
  }
  let minAllowed = Number.NEGATIVE_INFINITY;
  let maxAllowed = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (typeof row.min === 'number') minAllowed = Math.max(minAllowed, row.min);
    if (typeof row.max === 'number') maxAllowed = Math.min(maxAllowed, row.max);
  }
  return { hasConstraint: true, minAllowed, maxAllowed, rows };
}

function atkTierSatisfiesRequirement(totalAtkTier: number, requirement: AtkTierRequirement): boolean {
  if (!requirement.hasConstraint) return false;
  return totalAtkTier >= requirement.minAllowed && totalAtkTier <= requirement.maxAllowed;
}

function canStillReachAtkTierRequirement(
  requirement: AtkTierRequirement,
  fixedAtkTierTotal: number,
  partialAssignedAtkTier: number,
  remainingMinAtkTier: number,
  remainingMaxAtkTier: number,
): boolean {
  if (!requirement.hasConstraint) return false;
  const minTotal = fixedAtkTierTotal + partialAssignedAtkTier + Math.min(remainingMinAtkTier, remainingMaxAtkTier);
  const maxTotal = fixedAtkTierTotal + partialAssignedAtkTier + Math.max(remainingMinAtkTier, remainingMaxAtkTier);
  return minTotal <= requirement.maxAllowed && maxTotal >= requirement.minAllowed;
}

function combinedAttackConstraintSatisfied(params: {
  constraints: AutoBuildConstraints;
  slots: WorkbenchSnapshot['slots'];
  catalog: CatalogSnapshot;
  atkTierRequirement: AtkTierRequirement;
}): { configured: boolean; ok: boolean; failedChecks?: string[] } {
  const { constraints, slots, catalog, atkTierRequirement } = params;
  const speedConfigured = constraints.weaponAttackSpeeds.length > 0;
  const atkTierConfigured = atkTierRequirement.hasConstraint;
  if (!speedConfigured && !atkTierConfigured) return { configured: false, ok: true };

  const failedChecks: string[] = [];
  let speedOk = false;
  if (speedConfigured) {
    const finalAttackSpeed = computeFinalWeaponAttackSpeed(slots, catalog);
    speedOk = Boolean(finalAttackSpeed && constraints.weaponAttackSpeeds.includes(finalAttackSpeed));
    if (!speedOk) {
      failedChecks.push(`attackSpeed (expected ${constraints.weaponAttackSpeeds.join('/')} )`);
    }
  }

  let atkTierOk = false;
  if (atkTierConfigured) {
    const totalAtkTier = computeTotalAtkTier(slots, catalog);
    atkTierOk = atkTierSatisfiesRequirement(totalAtkTier, atkTierRequirement);
    if (!atkTierOk) {
      const low = Number.isFinite(atkTierRequirement.minAllowed) ? atkTierRequirement.minAllowed : '-inf';
      const high = Number.isFinite(atkTierRequirement.maxAllowed) ? atkTierRequirement.maxAllowed : '+inf';
      failedChecks.push(`atkTier (${totalAtkTier} not in [${low}, ${high}])`);
    }
  }

  const mode = constraints.attackSpeedConstraintMode;
  const ok =
    speedConfigured && atkTierConfigured
      ? (mode === 'and' ? speedOk && atkTierOk : speedOk || atkTierOk)
      : speedConfigured
      ? speedOk
      : atkTierOk;
  return ok ? { configured: true, ok: true } : { configured: true, ok: false, failedChecks };
}

function canStillSatisfyCombinedAttackConstraint(params: {
  constraints: AutoBuildConstraints;
  attackSpeedCtx: AttackSpeedReachabilityContext | null;
  atkTierRequirement: AtkTierRequirement;
  fixedAtkTierTotal: number;
  partialAssignedAtkTier: number;
  remainingMinAtkTier: number;
  remainingMaxAtkTier: number;
}): boolean {
  const {
    constraints,
    attackSpeedCtx,
    atkTierRequirement,
    fixedAtkTierTotal,
    partialAssignedAtkTier,
    remainingMinAtkTier,
    remainingMaxAtkTier,
  } = params;
  const speedConfigured = constraints.weaponAttackSpeeds.length > 0;
  const atkTierConfigured = atkTierRequirement.hasConstraint;
  if (!speedConfigured && !atkTierConfigured) return true;

  const speedReachable = speedConfigured
    ? (attackSpeedCtx
      ? canStillReachAllowedAttackSpeed(
          attackSpeedCtx,
          partialAssignedAtkTier,
          remainingMinAtkTier,
          remainingMaxAtkTier,
        )
      : true)
    : false;

  const atkTierReachable = atkTierConfigured
    ? canStillReachAtkTierRequirement(
        atkTierRequirement,
        fixedAtkTierTotal,
        partialAssignedAtkTier,
        remainingMinAtkTier,
        remainingMaxAtkTier,
      )
    : false;

  if (speedConfigured && atkTierConfigured) {
    return constraints.attackSpeedConstraintMode === 'and'
      ? speedReachable && atkTierReachable
      : speedReachable || atkTierReachable;
  }
  return speedConfigured ? speedReachable : atkTierReachable;
}

function candidateEntryNumericValue(
  entry: CandidatePoolEntry,
  catalog: CatalogSnapshot,
  key: string,
): number {
  const item = catalog.itemsById.get(entry.id);
  if (!item) return 0;
  return item.numericIndex[key] ?? 0;
}

function customTotalsFromSlots(
  slots: WorkbenchSnapshot['slots'],
  catalog: CatalogSnapshot,
  keys: string[],
): number[] {
  const totals = keys.map(() => 0);
  if (keys.length === 0) return totals;
  for (const slot of ITEM_SLOTS) {
    const itemId = slots[slot];
    if (itemId == null) continue;
    const item = catalog.itemsById.get(itemId);
    if (!item) continue;
    for (let i = 0; i < keys.length; i++) {
      totals[i] += item.numericIndex[keys[i]] ?? 0;
    }
  }
  return totals;
}

function buildCustomSuffixBounds(params: {
  slotOrder: ItemSlot[];
  candidatePools: Map<ItemSlot, Array<{ id: number; rough: number }>>;
  catalog: CatalogSnapshot;
  keys: string[];
}): { maxSuffix: number[][]; minSuffix: number[][] } {
  const { slotOrder, candidatePools, catalog, keys } = params;
  const maxSuffix: number[][] = Array.from({ length: slotOrder.length + 1 }, () => keys.map(() => 0));
  const minSuffix: number[][] = Array.from({ length: slotOrder.length + 1 }, () => keys.map(() => 0));
  if (keys.length === 0) return { maxSuffix, minSuffix };

  for (let i = slotOrder.length - 1; i >= 0; i--) {
    const pool = candidatePools.get(slotOrder[i]) ?? [];
    const slotMax = keys.map(() => Number.NEGATIVE_INFINITY);
    const slotMin = keys.map(() => Number.POSITIVE_INFINITY);
    for (const entry of pool) {
      const item = catalog.itemsById.get(entry.id);
      if (!item) continue;
      for (let k = 0; k < keys.length; k++) {
        const v = item.numericIndex[keys[k]] ?? 0;
        if (v > slotMax[k]) slotMax[k] = v;
        if (v < slotMin[k]) slotMin[k] = v;
      }
    }
    for (let k = 0; k < keys.length; k++) {
      const maxV = Number.isFinite(slotMax[k]) ? slotMax[k] : 0;
      const minV = Number.isFinite(slotMin[k]) ? slotMin[k] : 0;
      maxSuffix[i][k] = maxSuffix[i + 1][k] + maxV;
      minSuffix[i][k] = minSuffix[i + 1][k] + minV;
    }
  }
  return { maxSuffix, minSuffix };
}

function buildCandidatePoolForSlot(
  slot: ItemSlot,
  catalog: CatalogSnapshot,
  constraints: AutoBuildConstraints,
  allowedPinnedIdsForSlot?: Set<number> | null,
  focusStats: SkillStatKey[] = [],
): Array<{ id: number; rough: number }> {
  const all: CandidatePoolEntry[] = [];
  const customRangeSpecs = getCustomRangeSpecs(constraints);
  for (const item of catalog.items) {
    if (!itemFitsSlot(item, slot)) continue;
    if (allowedPinnedIdsForSlot && !allowedPinnedIdsForSlot.has(item.id)) continue;
    if (!itemMatchesGlobalConstraints(item, constraints)) continue;
    all.push({
      id: item.id,
      rough: roughItemScore(item, constraints),
      reqTotal: item.roughScoreFields.reqTotal,
      skillPointTotal: item.roughScoreFields.skillPointTotal,
      utility: item.roughScoreFields.utility + item.numeric.spd * 0.8,
      level: item.level,
      atkTier: normalizedAtkTier(item),
      spStr: item.numeric.spStr,
      spDex: item.numeric.spDex,
      spInt: item.numeric.spInt,
      spDef: item.numeric.spDef,
      spAgi: item.numeric.spAgi,
      supportFocus: computeSupportFocusScore(item, focusStats),
    });
  }

  const roughSorted = [...all].sort((a, b) => {
    if (a.rough !== b.rough) return b.rough - a.rough;
    return a.id - b.id;
  });
  const lowReqSorted = [...all].sort((a, b) => {
    if (a.reqTotal !== b.reqTotal) return a.reqTotal - b.reqTotal;
    if (a.level !== b.level) return a.level - b.level;
    return a.id - b.id;
  });
  const spSupportSorted = [...all].sort((a, b) => {
    if (a.skillPointTotal !== b.skillPointTotal) return b.skillPointTotal - a.skillPointTotal;
    if (a.reqTotal !== b.reqTotal) return a.reqTotal - b.reqTotal;
    return a.id - b.id;
  });
  const utilitySorted = [...all].sort((a, b) => {
    if (a.utility !== b.utility) return b.utility - a.utility;
    if (a.reqTotal !== b.reqTotal) return a.reqTotal - b.reqTotal;
    return a.id - b.id;
  });
  const attackSpeedSupportSorted =
    constraints.weaponAttackSpeeds.length > 0
      ? [...all].sort((a, b) => {
          const aPos = Math.max(0, a.atkTier);
          const bPos = Math.max(0, b.atkTier);
          if (aPos !== bPos) return bPos - aPos;
          if (a.atkTier !== b.atkTier) return b.atkTier - a.atkTier;
          if (a.reqTotal !== b.reqTotal) return a.reqTotal - b.reqTotal;
          if (a.skillPointTotal !== b.skillPointTotal) return b.skillPointTotal - a.skillPointTotal;
          return a.id - b.id;
        })
      : [];
  const focusSupportSorted =
    focusStats.length > 0
      ? [...all].sort((a, b) => {
          if (a.supportFocus !== b.supportFocus) return b.supportFocus - a.supportFocus;
          if (a.reqTotal !== b.reqTotal) return a.reqTotal - b.reqTotal;
          if (a.skillPointTotal !== b.skillPointTotal) return b.skillPointTotal - a.skillPointTotal;
          return a.id - b.id;
        })
      : [];
  const statSupportSorted = focusStats.map((stat) =>
    [...all].sort((a, b) => {
      const av =
        stat === 'str' ? a.spStr :
        stat === 'dex' ? a.spDex :
        stat === 'int' ? a.spInt :
        stat === 'def' ? a.spDef :
        a.spAgi;
      const bv =
        stat === 'str' ? b.spStr :
        stat === 'dex' ? b.spDex :
        stat === 'int' ? b.spInt :
        stat === 'def' ? b.spDef :
        b.spAgi;
      if (av !== bv) return bv - av;
      if (a.reqTotal !== b.reqTotal) return a.reqTotal - b.reqTotal;
      if (a.supportFocus !== b.supportFocus) return b.supportFocus - a.supportFocus;
      return a.id - b.id;
    }),
  );
  const customMinSorted = customRangeSpecs
    .filter((spec) => typeof spec.min === 'number')
    .map((spec) =>
      [...all].sort((a, b) => {
        const av = candidateEntryNumericValue(a, catalog, spec.key);
        const bv = candidateEntryNumericValue(b, catalog, spec.key);
        if (av !== bv) return bv - av;
        if (a.reqTotal !== b.reqTotal) return a.reqTotal - b.reqTotal;
        if (a.skillPointTotal !== b.skillPointTotal) return b.skillPointTotal - a.skillPointTotal;
        return a.id - b.id;
      }),
    );
  const customMaxSorted = customRangeSpecs
    .filter((spec) => typeof spec.max === 'number')
    .map((spec) =>
      [...all].sort((a, b) => {
        const av = candidateEntryNumericValue(a, catalog, spec.key);
        const bv = candidateEntryNumericValue(b, catalog, spec.key);
        if (av !== bv) return av - bv;
        if (a.reqTotal !== b.reqTotal) return a.reqTotal - b.reqTotal;
        if (a.skillPointTotal !== b.skillPointTotal) return b.skillPointTotal - a.skillPointTotal;
        return a.id - b.id;
      }),
    );

  const target = Math.max(10, constraints.topKPerSlot);
  const diversityBudget = Math.min(140, Math.max(40, Math.floor(target * 0.8)));
  const desiredPoolSize = Math.min(
    all.length,
    target +
      diversityBudget +
      (focusStats.length > 0 ? Math.min(60, focusStats.length * 12) : 0) +
      Math.min(80, customRangeSpecs.length * 14),
  );
  const picks = new Map<number, { id: number; rough: number }>();
  const seedRough = Math.min(12, Math.floor(target * 0.4), roughSorted.length);
  for (let i = 0; i < seedRough; i++) {
    const item = roughSorted[i];
    picks.set(item.id, { id: item.id, rough: item.rough });
  }

  const sources: Array<{ list: CandidatePoolEntry[]; remaining: number; cursor: number }> = [
    { list: roughSorted, remaining: Math.max(0, target - seedRough), cursor: 0 },
    { list: lowReqSorted, remaining: Math.floor(diversityBudget * 0.28), cursor: 0 },
    { list: spSupportSorted, remaining: Math.floor(diversityBudget * 0.24), cursor: 0 },
    { list: utilitySorted, remaining: Math.floor(diversityBudget * 0.18), cursor: 0 },
  ];
  if (attackSpeedSupportSorted.length > 0) {
    sources.push({
      list: attackSpeedSupportSorted,
      remaining: Math.max(18, Math.floor(diversityBudget * 0.22)),
      cursor: 0,
    });
  }
  if (focusSupportSorted.length > 0) {
    sources.push({
      list: focusSupportSorted,
      remaining: Math.max(16, Math.floor(diversityBudget * 0.2)),
      cursor: 0,
    });
  }
  for (const list of statSupportSorted) {
    sources.push({
      list,
      remaining: 10,
      cursor: 0,
    });
  }
  for (const list of customMinSorted) {
    sources.push({
      list,
      remaining: 35,
      cursor: 0,
    });
  }
  for (const list of customMaxSorted) {
    sources.push({
      list,
      remaining: 20,
      cursor: 0,
    });
  }

  while (picks.size < desiredPoolSize) {
    let progressed = false;
    for (const source of sources) {
      if (source.remaining <= 0) continue;
      while (source.cursor < source.list.length) {
        const item = source.list[source.cursor++];
        if (picks.has(item.id)) {
          continue;
        }
        picks.set(item.id, { id: item.id, rough: item.rough });
        source.remaining--;
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
  }

  if (picks.size < desiredPoolSize) {
    for (const item of roughSorted) {
      if (picks.size >= desiredPoolSize) break;
      if (picks.has(item.id)) continue;
      picks.set(item.id, { id: item.id, rough: item.rough });
    }
  }

  // Preserve interleaved insertion order so branch-capped beam search sees support and low-req
  // items early instead of only rough-score leaders.
  return [...picks.values()];
}

function buildPinnedAllowlistBySlot(baseWorkbench: WorkbenchSnapshot): Partial<Record<ItemSlot, Set<number>>> {
  const result: Partial<Record<ItemSlot, Set<number>>> = {};
  for (const slot of ITEM_SLOTS) {
    const category = slotToCategory(slot);
    const ids = new Set<number>(baseWorkbench.binsByCategory[category] ?? []);
    const equipped = baseWorkbench.slots[slot];
    if (equipped != null) ids.add(equipped);
    result[slot] = ids;
  }
  return result;
}

function slotsSatisfyRequiredMajorIds(
  slots: WorkbenchSnapshot['slots'],
  catalog: CatalogSnapshot,
  requiredMajorIds: string[],
): boolean {
  if (requiredMajorIds.length === 0) return true;
  const found = new Set<string>();
  for (const slot of ITEM_SLOTS) {
    const itemId = slots[slot];
    if (itemId == null) continue;
    const item = catalog.itemsById.get(itemId);
    if (!item) continue;
    for (const majorId of item.majorIds) {
      if (requiredMajorIds.includes(majorId)) found.add(majorId);
    }
  }
  return requiredMajorIds.every((majorId) => found.has(majorId));
}

function optimisticSuffixMax(order: ItemSlot[], candidatePools: Map<ItemSlot, Array<{ id: number; rough: number }>>): number[] {
  const suffix = new Array(order.length + 1).fill(0);
  for (let i = order.length - 1; i >= 0; i--) {
    const slot = order[i];
    const pool = candidatePools.get(slot) ?? [];
    let max = 0;
    for (const entry of pool) {
      if (entry.rough > max) max = entry.rough;
    }
    suffix[i] = suffix[i + 1] + max;
  }
  return suffix;
}

function computePerNodeBranchCap(params: {
  poolSize: number;
  beamSize: number;
  remainingStages: number;
  processedStates: number;
  maxStates: number;
}): number {
  const { poolSize, beamSize, remainingStages, processedStates, maxStates } = params;
  if (poolSize <= 0) return 0;
  const remainingBudget = Math.max(0, maxStates - processedStates);
  const denominator = Math.max(1, beamSize * Math.max(1, remainingStages));
  const budgetPerNode = Math.floor(remainingBudget / denominator);
  // Keep branching bounded so the search can reach complete builds under budget.
  const cap = Math.max(8, Math.min(96, budgetPerNode));
  return Math.min(poolSize, cap);
}

function estimateCombinationCount(order: ItemSlot[], candidatePools: Map<ItemSlot, Array<{ id: number; rough: number }>>, cap: number): number {
  let product = 1;
  for (const slot of order) {
    const size = candidatePools.get(slot)?.length ?? 0;
    if (size === 0) return 0;
    product *= size;
    if (product > cap) return product;
  }
  return product;
}

function finalizeBeamCandidates(params: {
  beam: BeamNode[];
  catalog: CatalogSnapshot;
  constraints: AutoBuildConstraints;
  skillpointFeasibilityOptions?: NonNullable<Parameters<typeof evaluateBuild>[2]>['skillpointFeasibility'] | null;
  signal?: AbortSignal;
}): {
  candidates: AutoBuildCandidate[];
  rejectStats: {
    majorIds: number;
    spInvalid: number;
    duplicate: number;
    hardConstraints: number;
    hardAttackSpeed: number;
    hardThresholds: number;
    hardItem: number;
    /** First example of a threshold failure (e.g. "minLegacyBaseDps (1200 < 1500)") for diagnostics. */
    thresholdFailureExample?: string;
  };
} {
  const { beam, catalog, constraints, skillpointFeasibilityOptions, signal } = params;
  const resolvedSpOpts = skillpointFeasibilityOptions ?? skillpointFeasibilityOptionsFromMode(constraints);
  const candidates: AutoBuildCandidate[] = [];
  const seenCandidateKeys = new Set<string>();
  const rejectStats = {
    majorIds: 0,
    spInvalid: 0,
    duplicate: 0,
    hardConstraints: 0,
    hardAttackSpeed: 0,
    hardThresholds: 0,
    hardItem: 0,
    thresholdFailureExample: undefined as string | undefined,
  };

  for (const node of beam) {
    if (signal?.aborted) throw new DOMException('Auto build cancelled', 'AbortError');
    if (!slotsSatisfyRequiredMajorIds(node.slots, catalog, constraints.requiredMajorIds)) {
      rejectStats.majorIds++;
      continue;
    }
    const summary = evaluateBuild(
      {
        slots: node.slots,
        level: constraints.level,
        characterClass: constraints.characterClass,
      },
      catalog,
      { skillpointFeasibility: resolvedSpOpts },
    );
    if (!summary.derived.skillpointFeasible) {
      rejectStats.spInvalid++;
      continue;
    }
    const hardCheck = validateFinalHardConstraints(node.slots, catalog, constraints, summary);
    if (!hardCheck.ok) {
      rejectStats.hardConstraints++;
      if (hardCheck.reason === 'attackSpeed') rejectStats.hardAttackSpeed++;
      else if (hardCheck.reason === 'thresholds') {
        rejectStats.hardThresholds++;
        if (rejectStats.thresholdFailureExample === undefined && hardCheck.failedChecks?.length) {
          rejectStats.thresholdFailureExample = hardCheck.failedChecks[0];
        }
      } else rejectStats.hardItem++;
      continue;
    }
    const key = canonicalCandidateKey(node.slots);
    if (seenCandidateKeys.has(key)) {
      rejectStats.duplicate++;
      continue;
    }
    const { score, breakdown } = scoreSummary(summary, constraints.weights, constraints);
    seenCandidateKeys.add(key);
    candidates.push({
      slots: cloneSlots(node.slots),
      score,
      scoreBreakdown: breakdown,
      summary,
    });
  }

  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    for (const slot of ITEM_SLOTS) {
      const av = a.slots[slot] ?? 0;
      const bv = b.slots[slot] ?? 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  });

  return { candidates, rejectStats };
}

function runFeasibilityBiasedBeamSearch(params: {
  slotOrder: ItemSlot[];
  candidatePools: Map<ItemSlot, Array<{ id: number; rough: number }>>;
  baseSlots: WorkbenchSnapshot['slots'];
  catalog: CatalogSnapshot;
  constraints: AutoBuildConstraints;
  focusStats: SkillStatKey[];
  attackSpeedCtx?: AttackSpeedReachabilityContext | null;
  atkTierRequirement: AtkTierRequirement;
  fixedAtkTierTotal: number;
  onProgress?: (event: AutoBuildProgressEvent) => void;
  signal?: AbortSignal;
}): { beam: BeamNode[]; processedStates: number; stateBudgetHit: boolean } {
  const {
    slotOrder,
    candidatePools,
    baseSlots,
    catalog,
    constraints,
    focusStats,
    attackSpeedCtx,
    atkTierRequirement,
    fixedAtkTierTotal,
    onProgress,
    signal,
  } = params;
  const skillpointFeasibilityOptions = skillpointFeasibilityOptionsFromMode(constraints);
  const suffixMax = optimisticSuffixMax(slotOrder, candidatePools);
  const atkTierBounds =
    attackSpeedCtx || atkTierRequirement.hasConstraint
      ? buildAtkTierSuffixBounds(slotOrder, candidatePools, catalog)
      : null;
  const overcapNeed = collectOvercapNeeds(baseSlots, catalog, focusStats);
  const supportSuffixMax: number[][] = Array.from({ length: slotOrder.length + 1 }, () => focusStats.map(() => 0));
  for (let i = slotOrder.length - 1; i >= 0; i--) {
    const pool = candidatePools.get(slotOrder[i]) ?? [];
    const slotMax = focusStats.map(() => 0);
    for (const entry of pool) {
      const item = catalog.itemsById.get(entry.id);
      if (!item) continue;
      const bonus = focusBonusVectorForItem(item, focusStats);
      for (let j = 0; j < bonus.length; j++) {
        if (bonus[j] > slotMax[j]) slotMax[j] = bonus[j];
      }
    }
    supportSuffixMax[i] = addNumberVectors(supportSuffixMax[i + 1], slotMax);
  }

  const customSpecs = getCustomRangeSpecsForBeamPruning(constraints);
  const customKeys = customSpecs.map((s) => s.key);
  const customBounds = buildCustomSuffixBounds({ slotOrder, candidatePools, catalog, keys: customKeys });
  const baseCustomTotals = customTotalsFromSlots(baseSlots, catalog, customKeys);

  let beam: BeamNode[] = [{
    slots: cloneSlots(baseSlots),
    orderIndex: 0,
    roughScore: 0,
    optimisticBound: suffixMax[0],
    feasibilityAssigned: 0,
    focusSupport: focusStats.map(() => 0),
    atkTierAssigned: 0,
    customTotals: baseCustomTotals,
  }];

  let processedStates = 0;
  let stateBudgetHit = false;

  for (let orderIndex = 0; orderIndex < slotOrder.length; orderIndex++) {
    if (signal?.aborted) throw new DOMException('Auto build cancelled', 'AbortError');
    const slot = slotOrder[orderIndex];
    const pool = candidatePools.get(slot) ?? [];
    const nextBeam: BeamNode[] = [];
    const perNodeBranchCap = computePerNodeBranchCap({
      poolSize: pool.length,
      beamSize: beam.length,
      remainingStages: slotOrder.length - orderIndex,
      processedStates,
      maxStates: constraints.maxStates,
    });
    if (perNodeBranchCap <= 0) stateBudgetHit = true;

    for (const node of beam) {
      let branched = 0;
      for (const entry of pool) {
        if (branched >= perNodeBranchCap) break;
        if (processedStates >= constraints.maxStates) {
          stateBudgetHit = true;
          break;
        }
        processedStates++;
        branched++;

        // Early-exit: skip items that would immediately violate an illegal-combination rule.
        if (wouldCreateIllegalCombo(entry.id, node.slots, catalog)) continue;

        const nextSlots = cloneSlots(node.slots);
        nextSlots[slot] = entry.id;
        const item = catalog.itemsById.get(entry.id);
        const nextAtkTierAssigned = (node.atkTierAssigned ?? 0) + (item ? normalizedAtkTier(item) : 0);
        const nextFocusSupport = addNumberVectors(
          node.focusSupport ?? focusStats.map(() => 0),
          item ? focusBonusVectorForItem(item, focusStats) : focusStats.map(() => 0),
        );
        const nextCustomTotals =
          customKeys.length > 0
            ? addNumberVectors(
                node.customTotals ?? customKeys.map(() => 0),
                customKeys.map((k) => (item ? item.numericIndex[k] ?? 0 : 0)),
              )
            : undefined;

        if (atkTierBounds) {
          const canReachAttackConstraint = canStillSatisfyCombinedAttackConstraint({
            constraints,
            attackSpeedCtx: attackSpeedCtx ?? null,
            atkTierRequirement,
            fixedAtkTierTotal,
            partialAssignedAtkTier: nextAtkTierAssigned,
            remainingMinAtkTier: atkTierBounds.minSuffix[orderIndex + 1],
            remainingMaxAtkTier: atkTierBounds.maxSuffix[orderIndex + 1],
          });
          if (!canReachAttackConstraint) continue;
        }

        if (focusStats.length > 0 && !canStillMeetOvercapNeed(nextFocusSupport, supportSuffixMax[orderIndex + 1], overcapNeed)) {
          continue;
        }

        if (customSpecs.length > 0 && nextCustomTotals) {
          let ok = true;
          for (let k = 0; k < customSpecs.length; k++) {
            const spec = customSpecs[k];
            const cur = nextCustomTotals[k];
            if (typeof spec.min === 'number' && cur + customBounds.maxSuffix[orderIndex + 1][k] < spec.min) {
              ok = false;
              break;
            }
            if (typeof spec.max === 'number' && cur + customBounds.minSuffix[orderIndex + 1][k] > spec.max) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
        }

        const partialFeasibility = evaluateBuildSkillpointFeasibility(
          nextSlots,
          catalog,
          constraints.level,
          skillpointFeasibilityOptions,
        );
        const nextRoughScore = node.roughScore + entry.rough;
        nextBeam.push({
          slots: nextSlots,
          orderIndex: orderIndex + 1,
          roughScore: nextRoughScore,
          optimisticBound: nextRoughScore + suffixMax[orderIndex + 1],
          feasibilityAssigned: partialFeasibility.feasible ? partialFeasibility.assignedTotal : Infinity,
          focusSupport: nextFocusSupport,
          atkTierAssigned: nextAtkTierAssigned,
          customTotals: nextCustomTotals,
        });
      }
      if (stateBudgetHit) break;
    }

    if (nextBeam.length === 0) {
      onProgress?.({
        phase: 'diagnostics',
        processedStates,
        beamSize: beam.length,
        totalSlots: slotOrder.length,
        expandedSlots: orderIndex,
        reasonCode: 'search_pruned',
        detail: stateBudgetHit
          ? `Feasibility-first search exhausted state budget before completing slot ${slot}.`
          : `Feasibility-first search found no branches that can still satisfy high-skill requirements by slot ${slot}.`,
      });
      return { beam: [], processedStates, stateBudgetHit };
    }

    const remainingMinAtkTier = atkTierBounds ? atkTierBounds.minSuffix[orderIndex + 1] : 0;
    const remainingMaxAtkTier = atkTierBounds ? atkTierBounds.maxSuffix[orderIndex + 1] : 0;
    const spdAmp = constraints.constraintOnlyMode ? 10 : 1;
    const primarySorted = [...nextBeam].sort((a, b) => {
      if (attackSpeedCtx) {
        const ab = attackSpeedBiasValue(attackSpeedCtx, a.atkTierAssigned, remainingMinAtkTier, remainingMaxAtkTier, spdAmp);
        const bb = attackSpeedBiasValue(attackSpeedCtx, b.atkTierAssigned, remainingMinAtkTier, remainingMaxAtkTier, spdAmp);
        if (ab !== bb) return bb - ab;
      }
      if (focusStats.length > 0) {
        const ad = supportDeficit(a.focusSupport ?? [], overcapNeed);
        const bd = supportDeficit(b.focusSupport ?? [], overcapNeed);
        if (ad !== bd) return ad - bd;
      }
      const aa = a.feasibilityAssigned ?? Infinity;
      const ba = b.feasibilityAssigned ?? Infinity;
      if (aa !== ba) return aa - ba;
      if (a.optimisticBound !== b.optimisticBound) return b.optimisticBound - a.optimisticBound;
      if (a.roughScore !== b.roughScore) return b.roughScore - a.roughScore;
      return 0;
    });
    const hardSorted = [...nextBeam].sort((a, b) => {
      const ad = customRangeDeficit(a.customTotals, customSpecs);
      const bd = customRangeDeficit(b.customTotals, customSpecs);
      if (ad !== bd) return ad - bd;
      if (attackSpeedCtx) {
        const ab = attackSpeedBiasValue(attackSpeedCtx, a.atkTierAssigned, remainingMinAtkTier, remainingMaxAtkTier, spdAmp);
        const bb = attackSpeedBiasValue(attackSpeedCtx, b.atkTierAssigned, remainingMinAtkTier, remainingMaxAtkTier, spdAmp);
        if (ab !== bb) return bb - ab;
      }
      return b.optimisticBound - a.optimisticBound;
    });
    beam = mergeBeamLanes(primarySorted, hardSorted, Math.max(40, constraints.beamWidth));

    onProgress?.({
      phase: 'beam-search',
      processedStates,
      beamSize: beam.length,
      totalSlots: slotOrder.length,
      expandedSlots: orderIndex + 1,
      detail: `feasibility-first | branchCap=${perNodeBranchCap}${focusStats.length > 0 ? ` | focus=${focusStats.join('/')}` : ''}${attackSpeedCtx ? ` | atkSpeed=${constraints.weaponAttackSpeeds.join('/')}` : ''}`,
      previewCandidates: buildPreviewCandidatesFromBeam(beam, catalog, constraints, 2),
    });
  }

  return { beam, processedStates, stateBudgetHit };
}
function enumerateExactCandidates(params: {
  slotOrder: ItemSlot[];
  candidatePools: Map<ItemSlot, Array<{ id: number; rough: number }>>;
  baseSlots: WorkbenchSnapshot['slots'];
  catalog: CatalogSnapshot;
  constraints: AutoBuildConstraints;
  signal?: AbortSignal;
  onProgress?: (event: AutoBuildProgressEvent) => void;
}): AutoBuildCandidate[] {
  const { slotOrder, candidatePools, baseSlots, catalog, constraints, signal, onProgress } = params;
  const skillpointFeasibilityOptions = skillpointFeasibilityOptionsFromMode(constraints);
  const candidates: AutoBuildCandidate[] = [];
  const seenCandidateKeys = new Set<string>();
  let processedStates = 0;
  let rejectedMajorIds = 0;
  let rejectedSpInvalid = 0;
  let rejectedDuplicate = 0;
  let rejectedHardConstraints = 0;
  let rejectedHardAttackSpeed = 0;
  let rejectedHardThresholds = 0;
  let rejectedHardItem = 0;

  const recurse = (orderIndex: number, slots: WorkbenchSnapshot['slots']) => {
    if (signal?.aborted) throw new DOMException('Auto build cancelled', 'AbortError');
    if (processedStates > constraints.maxStates) return;
    if (orderIndex >= slotOrder.length) {
      if (!slotsSatisfyRequiredMajorIds(slots, catalog, constraints.requiredMajorIds)) {
        rejectedMajorIds++;
        return;
      }
      const summary = evaluateBuild(
        { slots, level: constraints.level, characterClass: constraints.characterClass },
        catalog,
        { skillpointFeasibility: skillpointFeasibilityOptions },
      );
      if (!summary.derived.skillpointFeasible) {
        rejectedSpInvalid++;
        return;
      }
      const hardCheck = validateFinalHardConstraints(slots, catalog, constraints, summary);
      if (!hardCheck.ok) {
        rejectedHardConstraints++;
        if (hardCheck.reason === 'attackSpeed') rejectedHardAttackSpeed++;
        else if (hardCheck.reason === 'thresholds') rejectedHardThresholds++;
        else rejectedHardItem++;
        return;
      }
      const key = canonicalCandidateKey(slots);
      if (seenCandidateKeys.has(key)) {
        rejectedDuplicate++;
        return;
      }
      seenCandidateKeys.add(key);
      const { score, breakdown } = scoreSummary(summary, constraints.weights, constraints);
      candidates.push({ slots: cloneSlots(slots), score, scoreBreakdown: breakdown, summary });
      return;
    }

    const slot = slotOrder[orderIndex];
    const pool = candidatePools.get(slot) ?? [];
    for (const entry of pool) {
      processedStates++;
      if (processedStates > constraints.maxStates) break;
      // Early-exit: skip items that would immediately violate an illegal-combination rule.
      if (wouldCreateIllegalCombo(entry.id, slots, catalog)) continue;
      slots[slot] = entry.id;
      if (processedStates % 2000 === 0) {
        onProgress?.({
          phase: 'exact-search',
          processedStates,
          beamSize: 0,
          totalSlots: slotOrder.length,
          expandedSlots: orderIndex + 1,
        });
      }
      recurse(orderIndex + 1, slots);
    }
    slots[slot] = null;
  };

  recurse(0, cloneSlots(baseSlots));
  onProgress?.({
    phase: 'diagnostics',
    processedStates,
    beamSize: 0,
    totalSlots: slotOrder.length,
    expandedSlots: slotOrder.length,
    detail:
      candidates.length > 0
        ? `Exact search produced ${candidates.length} valid builds. Rejected duplicates=${rejectedDuplicate}, SP-invalid=${rejectedSpInvalid}, majorID=${rejectedMajorIds}, hard=${rejectedHardConstraints} (speed=${rejectedHardAttackSpeed}, thresholds=${rejectedHardThresholds}, item=${rejectedHardItem}).`
        : `Exact search produced 0 valid builds. Rejected SP-invalid=${rejectedSpInvalid}, majorID=${rejectedMajorIds}, duplicates=${rejectedDuplicate}, hard=${rejectedHardConstraints} (speed=${rejectedHardAttackSpeed}, thresholds=${rejectedHardThresholds}, item=${rejectedHardItem}).`,
  });
  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    for (const slot of ITEM_SLOTS) {
      const av = a.slots[slot] ?? 0;
      const bv = b.slots[slot] ?? 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  });
  return candidates.slice(0, Math.max(1, constraints.topN));
}

function runDeterministicFallbackSearch(params: {
  slotOrder: ItemSlot[];
  candidatePools: Map<ItemSlot, Array<{ id: number; rough: number }>>;
  baseSlots: WorkbenchSnapshot['slots'];
  catalog: CatalogSnapshot;
  constraints: AutoBuildConstraints;
  attackSpeedCtx: AttackSpeedReachabilityContext | null;
  atkTierRequirement: AtkTierRequirement;
  fixedAtkTierTotal: number;
  customSpecs: CustomRangeSpec[];
  customBounds: { maxSuffix: number[][]; minSuffix: number[][] };
  signal?: AbortSignal;
  timeCapMs?: number;
}): { candidates: AutoBuildCandidate[]; processedStates: number; timedOut: boolean } {
  const {
    slotOrder,
    candidatePools,
    baseSlots,
    catalog,
    constraints,
    attackSpeedCtx,
    atkTierRequirement,
    fixedAtkTierTotal,
    customSpecs,
    customBounds,
    signal,
    timeCapMs = 2000,
  } = params;
  const skillpointFeasibilityOptions = skillpointFeasibilityOptionsFromMode(constraints);
  const sortedPools = new Map<ItemSlot, Array<{ id: number; rough: number }>>();
  for (const slot of slotOrder) {
    const pool = candidatePools.get(slot) ?? [];
    sortedPools.set(slot, [...pool].sort((a, b) => (a.rough !== b.rough ? b.rough - a.rough : a.id - b.id)));
  }

  const atkTierBounds =
    attackSpeedCtx || atkTierRequirement.hasConstraint
      ? buildAtkTierSuffixBounds(slotOrder, candidatePools, catalog)
      : null;
  const customKeys = customSpecs.map((spec) => spec.key);
  const baseCustomTotals = customTotalsFromSlots(baseSlots, catalog, customKeys);
  const startTime = Date.now();
  let timedOut = false;
  let processedStates = 0;
  const seenCandidateKeys = new Set<string>();
  const candidates: AutoBuildCandidate[] = [];

  const recurse = (
    orderIndex: number,
    slots: WorkbenchSnapshot['slots'],
    atkTierAssigned: number,
    customTotals: number[] | undefined,
  ): void => {
    if (timedOut) return;
    if (signal?.aborted) throw new DOMException('Auto build cancelled', 'AbortError');
    if (Date.now() - startTime >= timeCapMs) {
      timedOut = true;
      return;
    }
    if (candidates.length >= Math.max(1, constraints.topN)) {
      return;
    }

    if (orderIndex >= slotOrder.length) {
      if (!slotsSatisfyRequiredMajorIds(slots, catalog, constraints.requiredMajorIds)) return;
      const summary = evaluateBuild(
        { slots, level: constraints.level, characterClass: constraints.characterClass },
        catalog,
        { skillpointFeasibility: skillpointFeasibilityOptions },
      );
      if (!summary.derived.skillpointFeasible) return;
      const hardCheck = validateFinalHardConstraints(slots, catalog, constraints, summary);
      if (!hardCheck.ok) return;
      const key = canonicalCandidateKey(slots);
      if (seenCandidateKeys.has(key)) return;
      seenCandidateKeys.add(key);
      const { score, breakdown } = scoreSummary(summary, constraints.weights, constraints);
      candidates.push({
        slots: cloneSlots(slots),
        score,
        scoreBreakdown: breakdown,
        summary,
      });
      return;
    }

    const slot = slotOrder[orderIndex];
    const pool = sortedPools.get(slot) ?? [];
    for (const entry of pool) {
      if (timedOut) break;
      processedStates++;

      if (wouldCreateIllegalCombo(entry.id, slots, catalog)) continue;

      const nextSlots = cloneSlots(slots);
      nextSlots[slot] = entry.id;
      const item = catalog.itemsById.get(entry.id);
      const nextAtkTierAssigned = atkTierAssigned + (item ? normalizedAtkTier(item) : 0);
      if (atkTierBounds) {
        const attackReachable = canStillSatisfyCombinedAttackConstraint({
          constraints,
          attackSpeedCtx,
          atkTierRequirement,
          fixedAtkTierTotal,
          partialAssignedAtkTier: nextAtkTierAssigned,
          remainingMinAtkTier: atkTierBounds.minSuffix[orderIndex + 1],
          remainingMaxAtkTier: atkTierBounds.maxSuffix[orderIndex + 1],
        });
        if (!attackReachable) continue;
      }

      const nextCustomTotals =
        customKeys.length > 0
          ? addNumberVectors(
              customTotals ?? customKeys.map(() => 0),
              customKeys.map((k) => (item ? item.numericIndex[k] ?? 0 : 0)),
            )
          : undefined;
      if (customSpecs.length > 0 && nextCustomTotals) {
        let customOk = true;
        for (let k = 0; k < customSpecs.length; k++) {
          const spec = customSpecs[k];
          const cur = nextCustomTotals[k];
          if (typeof spec.min === 'number' && cur + customBounds.maxSuffix[orderIndex + 1][k] < spec.min) {
            customOk = false;
            break;
          }
          if (typeof spec.max === 'number' && cur + customBounds.minSuffix[orderIndex + 1][k] > spec.max) {
            customOk = false;
            break;
          }
        }
        if (!customOk) continue;
      }

      const partial = evaluateBuildSkillpointFeasibility(
        nextSlots,
        catalog,
        constraints.level,
        skillpointFeasibilityOptions,
      );
      if (!partial.feasible) continue;

      recurse(orderIndex + 1, nextSlots, nextAtkTierAssigned, nextCustomTotals);
    }
  };

  recurse(0, cloneSlots(baseSlots), 0, baseCustomTotals);
  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return canonicalCandidateKey(a.slots).localeCompare(canonicalCandidateKey(b.slots));
  });
  return { candidates: candidates.slice(0, Math.max(1, constraints.topN)), processedStates, timedOut };
}

export function runAutoBuildBeamSearch(params: {
  catalog: CatalogSnapshot;
  baseWorkbench: WorkbenchSnapshot;
  constraints: AutoBuildConstraints;
  onProgress?: (event: AutoBuildProgressEvent) => void;
  signal?: AbortSignal;
  /** When true, skip the threshold rescue pass to avoid recursion. */
  alreadyThresholdRescue?: boolean;
}): AutoBuildCandidate[] {
  const { catalog, baseWorkbench, constraints, onProgress, signal, alreadyThresholdRescue } = params;
  if (signal?.aborted) throw new DOMException('Auto build cancelled', 'AbortError');

  let baseSlots = cloneSlots(baseWorkbench.slots);
  for (const slot of ITEM_SLOTS) {
    if (!constraints.lockedSlots[slot]) {
      baseSlots[slot] = null;
    }
  }
  const mustIncludeAssignment = assignMustIncludes(baseSlots, catalog, constraints);
  if (!mustIncludeAssignment.ok) {
    onProgress?.({
      phase: 'diagnostics',
      processedStates: 0,
      beamSize: 0,
      totalSlots: 0,
      expandedSlots: 0,
      reasonCode: mustIncludeAssignment.reasonCode ?? 'must_include_conflict',
      detail: mustIncludeAssignment.detail ?? 'Must-include assignment failed before search started.',
    });
    return [];
  }
  baseSlots = mustIncludeAssignment.slots;
  const supportFocusStats = collectRequirementFocusStats(baseSlots, catalog);

  const unlockedSlots = ITEM_SLOTS.filter((slot) => baseSlots[slot] == null);
  const pinnedAllowlistBySlot = constraints.onlyPinnedItems ? buildPinnedAllowlistBySlot(baseWorkbench) : null;
  const candidatePools = new Map<ItemSlot, Array<{ id: number; rough: number }>>();
  for (const slot of unlockedSlots) {
    candidatePools.set(
      slot,
      buildCandidatePoolForSlot(slot, catalog, constraints, pinnedAllowlistBySlot?.[slot] ?? null, supportFocusStats),
    );
  }
  const attackSpeedCtx = buildAttackSpeedReachabilityContext(baseSlots, catalog, constraints);
  const atkTierRequirement = buildAtkTierRequirement(getAttackTierRangeSpecs(constraints));
  const fixedAtkTierTotal = computeTotalAtkTier(baseSlots, catalog);

  const customRangeSpecs = getCustomRangeSpecsForBeamPruning(constraints);
  const hasCustomMinSpecs = customRangeSpecs.some((s) => typeof s.min === 'number');
  const slotOrder = [...unlockedSlots].sort((a, b) => {
    if (attackSpeedCtx?.preferredDirection) {
      const aPool = candidatePools.get(a) ?? [];
      const bPool = candidatePools.get(b) ?? [];
      const aPotential = aPool.reduce((best, entry) => {
        const item = catalog.itemsById.get(entry.id);
        if (!item) return best;
        const atkTier = normalizedAtkTier(item);
        const score = attackSpeedCtx.preferredDirection > 0 ? Math.max(0, atkTier) : Math.max(0, -atkTier);
        return Math.max(best, score);
      }, 0);
      const bPotential = bPool.reduce((best, entry) => {
        const item = catalog.itemsById.get(entry.id);
        if (!item) return best;
        const atkTier = normalizedAtkTier(item);
        const score = attackSpeedCtx.preferredDirection > 0 ? Math.max(0, atkTier) : Math.max(0, -atkTier);
        return Math.max(best, score);
      }, 0);
      if (aPotential !== bPotential) return bPotential - aPotential;
    }
    if (supportFocusStats.length > 0) {
      const aSupport = computeSlotFocusSupportPotential(a, candidatePools, catalog, supportFocusStats);
      const bSupport = computeSlotFocusSupportPotential(b, candidatePools, catalog, supportFocusStats);
      if (aSupport !== bSupport) return bSupport - aSupport;
    }
    if (hasCustomMinSpecs) {
      const supportSlots: ItemSlot[] = ['ring1', 'ring2', 'bracelet', 'necklace'];
      const aIsSupport = supportSlots.includes(a);
      const bIsSupport = supportSlots.includes(b);
      if (aIsSupport !== bIsSupport) return aIsSupport ? -1 : 1;
    }
    const al = candidatePools.get(a)?.length ?? 0;
    const bl = candidatePools.get(b)?.length ?? 0;
    if (al !== bl) return al - bl;
    return a.localeCompare(b);
  });
  const suffixMax = optimisticSuffixMax(slotOrder, candidatePools);
  if (slotOrder.some((slot) => (candidatePools.get(slot)?.length ?? 0) === 0)) {
    const emptySlot = slotOrder.find((slot) => (candidatePools.get(slot)?.length ?? 0) === 0);
    onProgress?.({
      phase: 'diagnostics',
      processedStates: 0,
      beamSize: 0,
      totalSlots: slotOrder.length,
      expandedSlots: 0,
      reasonCode: 'empty_pool',
      detail: emptySlot ? `No candidate items available for slot ${emptySlot} under current hard filters.` : 'One or more slots have empty candidate pools.',
    });
    return [];
  }
  if (atkTierRequirement.hasConstraint && atkTierRequirement.minAllowed > atkTierRequirement.maxAllowed) {
    onProgress?.({
      phase: 'diagnostics',
      processedStates: 0,
      beamSize: 0,
      totalSlots: slotOrder.length,
      expandedSlots: 0,
      reasonCode: 'unsat_attack_target',
      detail: `Attack target is unsatisfiable: atkTier min (${atkTierRequirement.minAllowed}) exceeds atkTier max (${atkTierRequirement.maxAllowed}).`,
    });
    return [];
  }

  if (customRangeSpecs.length > 0) {
    const precheckCustomKeys = customRangeSpecs.map((spec) => spec.key);
    const precheckBounds = buildCustomSuffixBounds({ slotOrder, candidatePools, catalog, keys: precheckCustomKeys });
    const precheckBaseTotals = customTotalsFromSlots(baseSlots, catalog, precheckCustomKeys);
    for (let i = 0; i < customRangeSpecs.length; i++) {
      const spec = customRangeSpecs[i];
      const minPossible = precheckBaseTotals[i] + precheckBounds.minSuffix[0][i];
      const maxPossible = precheckBaseTotals[i] + precheckBounds.maxSuffix[0][i];
      if (typeof spec.min === 'number' && maxPossible < spec.min) {
        onProgress?.({
          phase: 'diagnostics',
          processedStates: 0,
          beamSize: 0,
          totalSlots: slotOrder.length,
          expandedSlots: 0,
          reasonCode: 'unsat_threshold',
          detail: `Unsatisfiable threshold: ${spec.key} min ${spec.min} is above maximum reachable total ${maxPossible}.`,
        });
        return [];
      }
      if (typeof spec.max === 'number' && minPossible > spec.max) {
        onProgress?.({
          phase: 'diagnostics',
          processedStates: 0,
          beamSize: 0,
          totalSlots: slotOrder.length,
          expandedSlots: 0,
          reasonCode: 'unsat_threshold',
          detail: `Unsatisfiable threshold: ${spec.key} max ${spec.max} is below minimum reachable total ${minPossible}.`,
        });
        return [];
      }
    }
  }

  const precheckAtkTierBounds =
    attackSpeedCtx || atkTierRequirement.hasConstraint
      ? buildAtkTierSuffixBounds(slotOrder, candidatePools, catalog)
      : null;
  if (precheckAtkTierBounds) {
    const canReachAttack = canStillSatisfyCombinedAttackConstraint({
      constraints,
      attackSpeedCtx: attackSpeedCtx ?? null,
      atkTierRequirement,
      fixedAtkTierTotal,
      partialAssignedAtkTier: 0,
      remainingMinAtkTier: precheckAtkTierBounds.minSuffix[0],
      remainingMaxAtkTier: precheckAtkTierBounds.maxSuffix[0],
    });
    if (!canReachAttack) {
      onProgress?.({
        phase: 'diagnostics',
        processedStates: 0,
        beamSize: 0,
        totalSlots: slotOrder.length,
        expandedSlots: 0,
        reasonCode: 'unsat_attack_target',
        detail: 'Attack-speed / atkTier target cannot be reached from current candidate pools.',
      });
      return [];
    }
  }

  const combinationCount = estimateCombinationCount(slotOrder, candidatePools, constraints.exhaustiveStateLimit + 1);
  if (
    constraints.useExhaustiveSmallPool &&
    slotOrder.length > 0 &&
    combinationCount > 0 &&
    combinationCount <= constraints.exhaustiveStateLimit
  ) {
    onProgress?.({
      phase: 'exact-search',
      processedStates: 0,
      beamSize: 0,
      totalSlots: slotOrder.length,
      expandedSlots: 0,
    });
    const exactConstraints: AutoBuildConstraints = {
      ...constraints,
      maxStates: Math.max(constraints.maxStates, constraints.exhaustiveStateLimit),
    };
    return enumerateExactCandidates({
      slotOrder,
      candidatePools,
      baseSlots,
      catalog,
      constraints: exactConstraints,
      signal,
      onProgress,
    });
  }

  const customSpecs2 = getCustomRangeSpecsForBeamPruning(constraints);
  const customKeys2 = customSpecs2.map((s) => s.key);
  const customBounds2 = buildCustomSuffixBounds({ slotOrder, candidatePools, catalog, keys: customKeys2 });

  let beam: BeamNode[] = [{
    slots: baseSlots,
    orderIndex: 0,
    roughScore: 0,
    optimisticBound: suffixMax[0],
    atkTierAssigned: 0,
    customTotals: customTotalsFromSlots(baseSlots, catalog, customKeys2),
  }];

  const atkTierBounds =
    attackSpeedCtx || atkTierRequirement.hasConstraint
      ? buildAtkTierSuffixBounds(slotOrder, candidatePools, catalog)
      : null;

  let processedStates = 0;
  let stateBudgetHit = false;
  for (let orderIndex = 0; orderIndex < slotOrder.length; orderIndex++) {
    if (signal?.aborted) throw new DOMException('Auto build cancelled', 'AbortError');
    const slot = slotOrder[orderIndex];
    const pool = candidatePools.get(slot)!;
    const nextBeam: BeamNode[] = [];
    const perNodeBranchCap = computePerNodeBranchCap({
      poolSize: pool.length,
      beamSize: beam.length,
      remainingStages: slotOrder.length - orderIndex,
      processedStates,
      maxStates: constraints.maxStates,
    });
    if (perNodeBranchCap <= 0) {
      stateBudgetHit = true;
    }

    for (const node of beam) {
      let branched = 0;
      for (const entry of pool) {
        if (branched >= perNodeBranchCap) break;
        if (processedStates >= constraints.maxStates) {
          stateBudgetHit = true;
          break;
        }
        processedStates++;
        branched++;

        // Early-exit: skip items that would immediately violate an illegal-combination rule.
        if (wouldCreateIllegalCombo(entry.id, node.slots, catalog)) continue;

        const nextSlots = cloneSlots(node.slots);
        nextSlots[slot] = entry.id;
        const nextRoughScore = node.roughScore + entry.rough;
        const item = catalog.itemsById.get(entry.id);
        const nextAtkTierAssigned = (node.atkTierAssigned ?? 0) + (item ? normalizedAtkTier(item) : 0);
        const nextCustomTotals =
          customKeys2.length > 0
            ? addNumberVectors(
                node.customTotals ?? customKeys2.map(() => 0),
                customKeys2.map((k) => (item ? item.numericIndex[k] ?? 0 : 0)),
              )
            : undefined;
        if (atkTierBounds) {
          const canReachAttackConstraint = canStillSatisfyCombinedAttackConstraint({
            constraints,
            attackSpeedCtx: attackSpeedCtx ?? null,
            atkTierRequirement,
            fixedAtkTierTotal,
            partialAssignedAtkTier: nextAtkTierAssigned,
            remainingMinAtkTier: atkTierBounds.minSuffix[orderIndex + 1],
            remainingMaxAtkTier: atkTierBounds.maxSuffix[orderIndex + 1],
          });
          if (!canReachAttackConstraint) continue;
        }
        if (customSpecs2.length > 0 && nextCustomTotals) {
          let ok = true;
          for (let k = 0; k < customSpecs2.length; k++) {
            const spec = customSpecs2[k];
            const cur = nextCustomTotals[k];
            if (typeof spec.min === 'number' && cur + customBounds2.maxSuffix[orderIndex + 1][k] < spec.min) {
              ok = false;
              break;
            }
            if (typeof spec.max === 'number' && cur + customBounds2.minSuffix[orderIndex + 1][k] > spec.max) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
        }
        nextBeam.push({
          slots: nextSlots,
          orderIndex: orderIndex + 1,
          roughScore: nextRoughScore,
          optimisticBound: nextRoughScore + suffixMax[orderIndex + 1],
          atkTierAssigned: nextAtkTierAssigned,
          customTotals: nextCustomTotals,
        });
      }
      if (stateBudgetHit) break;
    }

    if (nextBeam.length === 0) {
      onProgress?.({
        phase: 'diagnostics',
        processedStates,
        beamSize: beam.length,
        totalSlots: slotOrder.length,
        expandedSlots: orderIndex,
        reasonCode: 'search_pruned',
        detail: stateBudgetHit
          ? `Search state budget exhausted before completing slot ${slot}. Try enabling deep fallback/exact mode or reduce hard filters.`
          : `No expansions produced at slot ${slot}.`,
      });
      return [];
    }

    const remainingMinAtkTier = atkTierBounds ? atkTierBounds.minSuffix[orderIndex + 1] : 0;
    const remainingMaxAtkTier = atkTierBounds ? atkTierBounds.maxSuffix[orderIndex + 1] : 0;
    const spdAmp2 = constraints.constraintOnlyMode ? 10 : 1;
    const primarySorted = [...nextBeam].sort((a, b) => {
      if (attackSpeedCtx) {
        const ab = attackSpeedBiasValue(attackSpeedCtx, a.atkTierAssigned, remainingMinAtkTier, remainingMaxAtkTier, spdAmp2);
        const bb = attackSpeedBiasValue(attackSpeedCtx, b.atkTierAssigned, remainingMinAtkTier, remainingMaxAtkTier, spdAmp2);
        if (ab !== bb) return bb - ab;
      }
      if (a.optimisticBound !== b.optimisticBound) return b.optimisticBound - a.optimisticBound;
      return b.roughScore - a.roughScore;
    });
    const hardSorted = [...nextBeam].sort((a, b) => {
      const ad = customRangeDeficit(a.customTotals, customSpecs2);
      const bd = customRangeDeficit(b.customTotals, customSpecs2);
      if (ad !== bd) return ad - bd;
      if (attackSpeedCtx) {
        const ab = attackSpeedBiasValue(attackSpeedCtx, a.atkTierAssigned, remainingMinAtkTier, remainingMaxAtkTier, spdAmp2);
        const bb = attackSpeedBiasValue(attackSpeedCtx, b.atkTierAssigned, remainingMinAtkTier, remainingMaxAtkTier, spdAmp2);
        if (ab !== bb) return bb - ab;
      }
      return b.optimisticBound - a.optimisticBound;
    });
    beam = mergeBeamLanes(primarySorted, hardSorted, Math.max(20, constraints.beamWidth));

    onProgress?.({
      phase: 'beam-search',
      processedStates,
      beamSize: beam.length,
      totalSlots: slotOrder.length,
      expandedSlots: orderIndex + 1,
      detail: `branchCap=${perNodeBranchCap}${attackSpeedCtx?.preferredDirection ? ` | atkSpeedTarget=${constraints.weaponAttackSpeeds.join('/')}` : ''}`,
      previewCandidates: buildPreviewCandidatesFromBeam(beam, catalog, constraints, 2),
    });
  }

  let finalizationBeam = beam;
  let { candidates, rejectStats } = finalizeBeamCandidates({
    beam,
    catalog,
    constraints,
    signal,
  });
  const thresholdExampleDetail = rejectStats.thresholdFailureExample ? ` Example failure: ${rejectStats.thresholdFailureExample}.` : '';
  const initialReasonCode =
    candidates.length > 0
      ? undefined
      : rejectStats.spInvalid > 0 && rejectStats.hardConstraints === 0
      ? 'sp_infeasible'
      : rejectStats.hardThresholds > 0
      ? 'unsat_threshold'
      : rejectStats.hardAttackSpeed > 0
      ? 'unsat_attack_target'
      : undefined;
  onProgress?.({
    phase: 'diagnostics',
    processedStates,
    beamSize: beam.length,
    totalSlots: slotOrder.length,
    expandedSlots: slotOrder.length,
    reasonCode: initialReasonCode,
    detail:
      candidates.length > 0
        ? `Final eval: ${candidates.length} valid builds. Rejected duplicates=${rejectStats.duplicate}, SP-invalid=${rejectStats.spInvalid}, majorID=${rejectStats.majorIds}, hard=${rejectStats.hardConstraints}.`
        : `Final eval found 0 valid builds. Rejected SP-invalid=${rejectStats.spInvalid}, majorID=${rejectStats.majorIds}, duplicates=${rejectStats.duplicate}, hard=${rejectStats.hardConstraints} (speed=${rejectStats.hardAttackSpeed}, thresholds=${rejectStats.hardThresholds}, item=${rejectStats.hardItem}).${thresholdExampleDetail}`,
  });

  const hasAttackTarget = constraints.weaponAttackSpeeds.length > 0 || atkTierRequirement.hasConstraint;
  if (
    candidates.length === 0 &&
    slotOrder.length > 0 &&
    (
      rejectStats.spInvalid > 0 ||
      (hasAttackTarget && rejectStats.hardAttackSpeed > 0) ||
      rejectStats.hardThresholds > 0
    )
  ) {
    const thresholdRescue = rejectStats.hardThresholds > 0;
    onProgress?.({
      phase: 'diagnostics',
      processedStates,
      beamSize: beam.length,
      totalSlots: slotOrder.length,
      expandedSlots: slotOrder.length,
      detail:
        thresholdRescue && constraints.target.customNumericRanges?.length
          ? 'Retrying with threshold-aware rescue (advanced ID constraints + support-aware feasibility search).'
          : rejectStats.hardAttackSpeed > 0
          ? 'Retrying with feasibility-first beam search (support-aware rescue + attack target reachability).'
          : 'Retrying with feasibility-first beam search (support-aware rescue for high-skill requirements).',
    });

    const fallbackConstraints: AutoBuildConstraints = {
      ...constraints,
      maxStates: Math.max(
        constraints.maxStates,
        thresholdRescue
          ? Math.min(18_000_000, constraints.maxStates * 5)
          : hasAttackTarget
          ? Math.min(16_000_000, constraints.maxStates * 4)
          : Math.min(8_000_000, constraints.maxStates * 2),
      ),
      beamWidth: Math.max(
        constraints.beamWidth,
        thresholdRescue ? 3600 : hasAttackTarget ? 3200 : 1800,
      ),
    };
    if (thresholdRescue) {
      fallbackConstraints.weights = thresholdBiasedWeights(constraints.target, constraints.weights);
    }
    const fallback = runFeasibilityBiasedBeamSearch({
      slotOrder,
      candidatePools,
      baseSlots,
      catalog,
      constraints: fallbackConstraints,
      focusStats: supportFocusStats,
      attackSpeedCtx,
      atkTierRequirement,
      fixedAtkTierTotal,
      onProgress,
      signal,
    });

    if (fallback.beam.length > 0) {
      finalizationBeam = fallback.beam;
      const finalized = finalizeBeamCandidates({
        beam: fallback.beam,
        catalog,
        constraints,
        signal,
      });
      candidates = finalized.candidates;
      rejectStats = finalized.rejectStats;
      const feasibilityThresholdExample = rejectStats.thresholdFailureExample ? ` Example failure: ${rejectStats.thresholdFailureExample}.` : '';
      onProgress?.({
        phase: 'diagnostics',
        processedStates: fallback.processedStates,
        beamSize: fallback.beam.length,
        totalSlots: slotOrder.length,
        expandedSlots: slotOrder.length,
        detail:
          candidates.length > 0
            ? `Feasibility-first eval: ${candidates.length} valid builds. Rejected duplicates=${rejectStats.duplicate}, SP-invalid=${rejectStats.spInvalid}, majorID=${rejectStats.majorIds}, hard=${rejectStats.hardConstraints}.`
            : `Feasibility-first eval still found 0 valid builds. Rejected SP-invalid=${rejectStats.spInvalid}, majorID=${rejectStats.majorIds}, duplicates=${rejectStats.duplicate}, hard=${rejectStats.hardConstraints} (speed=${rejectStats.hardAttackSpeed}, thresholds=${rejectStats.hardThresholds}, item=${rejectStats.hardItem}).${feasibilityThresholdExample}`,
      });
    }
  }

  if (
    candidates.length === 0 &&
    rejectStats.hardThresholds > 0 &&
    !alreadyThresholdRescue
  ) {
    const target = constraints.target;
    const hasTargetThresholds =
      typeof target.minLegacyBaseDps === 'number' ||
      typeof target.minLegacyEhp === 'number' ||
      typeof target.minDpsProxy === 'number' ||
      typeof target.minEhpProxy === 'number' ||
      typeof target.minMr === 'number' ||
      typeof target.minMs === 'number' ||
      typeof target.minSpeed === 'number' ||
      typeof target.minSkillPointTotal === 'number' ||
      typeof target.maxReqTotal === 'number' ||
      (target.customNumericRanges?.length ?? 0) > 0;
    if (hasTargetThresholds) {
      onProgress?.({
        phase: 'diagnostics',
        processedStates,
        beamSize: finalizationBeam.length,
        totalSlots: slotOrder.length,
        expandedSlots: slotOrder.length,
        detail: 'Retrying with threshold-biased beam search (weights tuned to target min/max).',
      });
      const rescueConstraints: AutoBuildConstraints = {
        ...constraints,
        weights: thresholdBiasedWeights(constraints.target, constraints.weights),
        beamWidth: Math.max(constraints.beamWidth, 3600),
        maxStates: Math.max(constraints.maxStates, Math.min(18_000_000, constraints.maxStates * 5)),
      };
      const rescueCandidates = runAutoBuildBeamSearch({
        catalog,
        baseWorkbench,
        constraints: rescueConstraints,
        onProgress,
        signal,
        alreadyThresholdRescue: true,
      });
      if (rescueCandidates.length > 0) {
        onProgress?.({
          phase: 'diagnostics',
          processedStates,
          beamSize: rescueCandidates.length,
          totalSlots: slotOrder.length,
          expandedSlots: slotOrder.length,
          detail: `Threshold rescue: ${rescueCandidates.length} valid builds.`,
        });
        return rescueCandidates.slice(0, Math.max(1, constraints.topN));
      }
    }
  }

  if (candidates.length === 0 && slotOrder.length > 0) {
    onProgress?.({
      phase: 'diagnostics',
      processedStates,
      beamSize: finalizationBeam.length,
      totalSlots: slotOrder.length,
      expandedSlots: slotOrder.length,
      reasonCode: 'search_pruned',
      detail: 'Running deterministic fallback search (2s cap) before returning no candidates.',
    });
    const deterministic = runDeterministicFallbackSearch({
      slotOrder,
      candidatePools,
      baseSlots,
      catalog,
      constraints,
      attackSpeedCtx: attackSpeedCtx ?? null,
      atkTierRequirement,
      fixedAtkTierTotal,
      customSpecs: customSpecs2,
      customBounds: customBounds2,
      signal,
      timeCapMs: 2000,
    });
    if (deterministic.candidates.length > 0) {
      candidates = deterministic.candidates;
      onProgress?.({
        phase: 'diagnostics',
        processedStates: processedStates + deterministic.processedStates,
        beamSize: deterministic.candidates.length,
        totalSlots: slotOrder.length,
        expandedSlots: slotOrder.length,
        detail: `Deterministic fallback recovered ${deterministic.candidates.length} valid build(s).`,
      });
    } else {
      const reasonCode = deterministic.timedOut
        ? 'fallback_timeout'
        : rejectStats.spInvalid > 0 && rejectStats.hardConstraints === 0
        ? 'sp_infeasible'
        : rejectStats.hardThresholds > 0
        ? 'unsat_threshold'
        : rejectStats.hardAttackSpeed > 0
        ? 'unsat_attack_target'
        : 'search_pruned';
      onProgress?.({
        phase: 'diagnostics',
        processedStates: processedStates + deterministic.processedStates,
        beamSize: 0,
        totalSlots: slotOrder.length,
        expandedSlots: slotOrder.length,
        reasonCode,
        detail: deterministic.timedOut
          ? 'Deterministic fallback timed out after 2 seconds with no valid candidates.'
          : `Deterministic fallback found 0 valid builds. Rejected SP-invalid=${rejectStats.spInvalid}, majorID=${rejectStats.majorIds}, duplicates=${rejectStats.duplicate}, hard=${rejectStats.hardConstraints} (speed=${rejectStats.hardAttackSpeed}, thresholds=${rejectStats.hardThresholds}, item=${rejectStats.hardItem}).${rejectStats.thresholdFailureExample ? ` Example failure: ${rejectStats.thresholdFailureExample}.` : ''}`,
      });
    }
  }

  return candidates.slice(0, Math.max(1, constraints.topN));
}
