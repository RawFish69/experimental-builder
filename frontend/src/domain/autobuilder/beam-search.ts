import type { AutoBuildCandidate, AutoBuildConstraints, AutoBuildProgressEvent } from '@/domain/autobuilder/types';
import { scoreSummary } from '@/domain/autobuilder/scoring';
import type { CatalogSnapshot, ItemSlot, NormalizedItem } from '@/domain/items/types';
import { ITEM_SLOTS, itemCanBeWornByClass, slotToCategory } from '@/domain/items/types';
import { evaluateBuild, evaluateBuildSkillpointFeasibility } from '@/domain/build/build-metrics';
import type { WorkbenchSnapshot } from '@/domain/build/types';

interface BeamNode {
  slots: WorkbenchSnapshot['slots'];
  orderIndex: number;
  roughScore: number;
  optimisticBound: number;
  feasibilityAssigned?: number;
  focusSupport?: number[];
}

type SkillStatKey = 'str' | 'dex' | 'int' | 'def' | 'agi';

interface CandidatePoolEntry {
  id: number;
  rough: number;
  reqTotal: number;
  skillPointTotal: number;
  utility: number;
  level: number;
  spStr: number;
  spDex: number;
  spInt: number;
  spDef: number;
  spAgi: number;
  supportFocus: number;
}

const SKILL_STATS: SkillStatKey[] = ['str', 'dex', 'int', 'def', 'agi'];

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
  if (
    item.category === 'weapon' &&
    constraints.weaponAttackSpeeds.length > 0 &&
    !constraints.weaponAttackSpeeds.includes(item.atkSpd)
  ) {
    return false;
  }
  return true;
}

function roughItemScore(item: NormalizedItem, constraints: AutoBuildConstraints): number {
  return (
    item.numeric.baseDps * constraints.weights.legacyBaseDps +
    item.roughScoreFields.ehpProxy * constraints.weights.legacyEhp +
    item.roughScoreFields.offense * constraints.weights.dpsProxy +
    item.roughScoreFields.ehpProxy * constraints.weights.ehpProxy +
    item.numeric.spd * constraints.weights.speed +
    item.roughScoreFields.utility * constraints.weights.sustain +
    item.roughScoreFields.skillPointTotal * constraints.weights.skillPointTotal -
    item.roughScoreFields.reqTotal * constraints.weights.reqTotalPenalty
  );
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

function itemFitsSlot(item: NormalizedItem, slot: ItemSlot): boolean {
  return slotToCategory(slot) === item.category;
}

function assignMustIncludes(
  baseSlots: WorkbenchSnapshot['slots'],
  catalog: CatalogSnapshot,
  constraints: AutoBuildConstraints,
): WorkbenchSnapshot['slots'] {
  const slots = cloneSlots(baseSlots);
  const taken = new Set<ItemSlot>(
    ITEM_SLOTS.filter((slot) => slots[slot] != null),
  );
  for (const itemId of constraints.mustIncludeIds) {
    const item = catalog.itemsById.get(itemId);
    if (!item) continue;
    const candidates = ITEM_SLOTS.filter((slot) => !taken.has(slot) && itemFitsSlot(item, slot));
    const target = candidates[0];
    if (!target) continue;
    slots[target] = item.id;
    taken.add(target);
  }
  return slots;
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

function buildCandidatePoolForSlot(
  slot: ItemSlot,
  catalog: CatalogSnapshot,
  constraints: AutoBuildConstraints,
  allowedPinnedIdsForSlot?: Set<number> | null,
  focusStats: SkillStatKey[] = [],
): Array<{ id: number; rough: number }> {
  const all: CandidatePoolEntry[] = [];
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

  const target = Math.max(10, constraints.topKPerSlot);
  const diversityBudget = Math.min(140, Math.max(40, Math.floor(target * 0.8)));
  const desiredPoolSize = Math.min(
    all.length,
    target +
      diversityBudget +
      (focusStats.length > 0 ? Math.min(60, focusStats.length * 12) : 0),
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
  const cap = Math.max(8, Math.min(64, budgetPerNode));
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
  signal?: AbortSignal;
}): {
  candidates: AutoBuildCandidate[];
  rejectStats: { majorIds: number; spInvalid: number; duplicate: number };
} {
  const { beam, catalog, constraints, signal } = params;
  const candidates: AutoBuildCandidate[] = [];
  const seenCandidateKeys = new Set<string>();
  const rejectStats = {
    majorIds: 0,
    spInvalid: 0,
    duplicate: 0,
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
    );
    if (!summary.derived.skillpointFeasible) {
      rejectStats.spInvalid++;
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
  onProgress?: (event: AutoBuildProgressEvent) => void;
  signal?: AbortSignal;
}): { beam: BeamNode[]; processedStates: number; stateBudgetHit: boolean } {
  const { slotOrder, candidatePools, baseSlots, catalog, constraints, focusStats, onProgress, signal } = params;
  const suffixMax = optimisticSuffixMax(slotOrder, candidatePools);
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

  let beam: BeamNode[] = [{
    slots: cloneSlots(baseSlots),
    orderIndex: 0,
    roughScore: 0,
    optimisticBound: suffixMax[0],
    feasibilityAssigned: 0,
    focusSupport: focusStats.map(() => 0),
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

        const nextSlots = cloneSlots(node.slots);
        nextSlots[slot] = entry.id;
        const item = catalog.itemsById.get(entry.id);
        const nextFocusSupport = addNumberVectors(
          node.focusSupport ?? focusStats.map(() => 0),
          item ? focusBonusVectorForItem(item, focusStats) : focusStats.map(() => 0),
        );

        if (focusStats.length > 0 && !canStillMeetOvercapNeed(nextFocusSupport, supportSuffixMax[orderIndex + 1], overcapNeed)) {
          continue;
        }

        const partialFeasibility = evaluateBuildSkillpointFeasibility(nextSlots, catalog, constraints.level);
        const nextRoughScore = node.roughScore + entry.rough;
        nextBeam.push({
          slots: nextSlots,
          orderIndex: orderIndex + 1,
          roughScore: nextRoughScore,
          optimisticBound: nextRoughScore + suffixMax[orderIndex + 1],
          feasibilityAssigned: partialFeasibility.feasible ? partialFeasibility.assignedTotal : Infinity,
          focusSupport: nextFocusSupport,
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
        detail: stateBudgetHit
          ? `Feasibility-first search exhausted state budget before completing slot ${slot}.`
          : `Feasibility-first search found no branches that can still satisfy high-skill requirements by slot ${slot}.`,
      });
      return { beam: [], processedStates, stateBudgetHit };
    }

    nextBeam.sort((a, b) => {
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
    beam = nextBeam.slice(0, Math.max(40, constraints.beamWidth));

    onProgress?.({
      phase: 'beam-search',
      processedStates,
      beamSize: beam.length,
      totalSlots: slotOrder.length,
      expandedSlots: orderIndex + 1,
      detail: `feasibility-first | branchCap=${perNodeBranchCap}${focusStats.length > 0 ? ` | focus=${focusStats.join('/')}` : ''}`,
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
  const candidates: AutoBuildCandidate[] = [];
  const seenCandidateKeys = new Set<string>();
  let processedStates = 0;
  let rejectedMajorIds = 0;
  let rejectedSpInvalid = 0;
  let rejectedDuplicate = 0;

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
      );
      if (!summary.derived.skillpointFeasible) {
        rejectedSpInvalid++;
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
        ? `Exact search produced ${candidates.length} valid builds. Rejected duplicates=${rejectedDuplicate}, SP-invalid=${rejectedSpInvalid}, majorID=${rejectedMajorIds}.`
        : `Exact search produced 0 valid builds. Rejected SP-invalid=${rejectedSpInvalid}, majorID=${rejectedMajorIds}, duplicates=${rejectedDuplicate}.`,
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

export function runAutoBuildBeamSearch(params: {
  catalog: CatalogSnapshot;
  baseWorkbench: WorkbenchSnapshot;
  constraints: AutoBuildConstraints;
  onProgress?: (event: AutoBuildProgressEvent) => void;
  signal?: AbortSignal;
}): AutoBuildCandidate[] {
  const { catalog, baseWorkbench, constraints, onProgress, signal } = params;
  if (signal?.aborted) throw new DOMException('Auto build cancelled', 'AbortError');

  let baseSlots = cloneSlots(baseWorkbench.slots);
  for (const slot of ITEM_SLOTS) {
    if (!constraints.lockedSlots[slot]) {
      baseSlots[slot] = null;
    }
  }
  baseSlots = assignMustIncludes(baseSlots, catalog, constraints);
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

  const slotOrder = [...unlockedSlots].sort((a, b) => {
    if (supportFocusStats.length > 0) {
      const aSupport = computeSlotFocusSupportPotential(a, candidatePools, catalog, supportFocusStats);
      const bSupport = computeSlotFocusSupportPotential(b, candidatePools, catalog, supportFocusStats);
      if (aSupport !== bSupport) return bSupport - aSupport;
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
      detail: emptySlot ? `No candidate items available for slot ${emptySlot} under current hard filters.` : 'One or more slots have empty candidate pools.',
    });
    return [];
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

  let beam: BeamNode[] = [{
    slots: baseSlots,
    orderIndex: 0,
    roughScore: 0,
    optimisticBound: suffixMax[0],
  }];

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

        const nextSlots = cloneSlots(node.slots);
        nextSlots[slot] = entry.id;
        const nextRoughScore = node.roughScore + entry.rough;
        nextBeam.push({
          slots: nextSlots,
          orderIndex: orderIndex + 1,
          roughScore: nextRoughScore,
          optimisticBound: nextRoughScore + suffixMax[orderIndex + 1],
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
        detail: stateBudgetHit
          ? `Search state budget exhausted before completing slot ${slot}. Try enabling deep fallback/exact mode or reduce hard filters.`
          : `No expansions produced at slot ${slot}.`,
      });
      return [];
    }

    nextBeam.sort((a, b) => {
      if (a.optimisticBound !== b.optimisticBound) return b.optimisticBound - a.optimisticBound;
      return b.roughScore - a.roughScore;
    });
    beam = nextBeam.slice(0, Math.max(20, constraints.beamWidth));

    onProgress?.({
      phase: 'beam-search',
      processedStates,
      beamSize: beam.length,
      totalSlots: slotOrder.length,
      expandedSlots: orderIndex + 1,
      detail: `branchCap=${perNodeBranchCap}`,
    });
  }

  let { candidates, rejectStats } = finalizeBeamCandidates({
    beam,
    catalog,
    constraints,
    signal,
  });
  onProgress?.({
    phase: 'diagnostics',
    processedStates,
    beamSize: beam.length,
    totalSlots: slotOrder.length,
    expandedSlots: slotOrder.length,
    detail:
      candidates.length > 0
        ? `Final eval: ${candidates.length} valid builds. Rejected duplicates=${rejectStats.duplicate}, SP-invalid=${rejectStats.spInvalid}, majorID=${rejectStats.majorIds}.`
        : `Final eval found 0 valid builds. Rejected SP-invalid=${rejectStats.spInvalid}, majorID=${rejectStats.majorIds}, duplicates=${rejectStats.duplicate}.`,
  });

  if (candidates.length === 0 && rejectStats.spInvalid > 0 && slotOrder.length > 0) {
    onProgress?.({
      phase: 'diagnostics',
      processedStates,
      beamSize: beam.length,
      totalSlots: slotOrder.length,
      expandedSlots: slotOrder.length,
      detail: 'Retrying with feasibility-first beam search (support-aware rescue for high-skill requirements).',
    });

    const fallback = runFeasibilityBiasedBeamSearch({
      slotOrder,
      candidatePools,
      baseSlots,
      catalog,
      constraints: {
        ...constraints,
        maxStates: Math.max(constraints.maxStates, Math.min(8_000_000, constraints.maxStates * 2)),
        beamWidth: Math.max(constraints.beamWidth, 1800),
      },
      focusStats: supportFocusStats,
      onProgress,
      signal,
    });

    if (fallback.beam.length > 0) {
      const finalized = finalizeBeamCandidates({
        beam: fallback.beam,
        catalog,
        constraints,
        signal,
      });
      candidates = finalized.candidates;
      rejectStats = finalized.rejectStats;
      onProgress?.({
        phase: 'diagnostics',
        processedStates: fallback.processedStates,
        beamSize: fallback.beam.length,
        totalSlots: slotOrder.length,
        expandedSlots: slotOrder.length,
        detail:
          candidates.length > 0
            ? `Feasibility-first eval: ${candidates.length} valid builds. Rejected duplicates=${rejectStats.duplicate}, SP-invalid=${rejectStats.spInvalid}, majorID=${rejectStats.majorIds}.`
            : `Feasibility-first eval still found 0 valid builds. Rejected SP-invalid=${rejectStats.spInvalid}, majorID=${rejectStats.majorIds}, duplicates=${rejectStats.duplicate}.`,
      });
    }
  }

  return candidates.slice(0, Math.max(1, constraints.topN));
}
