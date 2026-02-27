import type {
  NormalizedRecipe,
  NormalizedIngredient,
  RecipeCatalogSnapshot,
  RecipeSolverConstraints,
  RecipeSolverCandidate,
  RecipeSolverProgressEvent,
  CraftedAtkSpd,
} from '@/domain/recipe-solver/types';
import {
  CRAFTED_ATK_SPEEDS,
  NO_INGREDIENT_ID,
  getCraftedCategory,
} from '@/domain/recipe-solver/types';
import { computeCraftedStats, encodeCraftHash } from '@/domain/recipe-solver/craft-engine';
import { scoreCraftedItem, roughIngredientScore, satisfiesThresholds } from '@/domain/recipe-solver/scoring';

const TOTAL_SLOTS = 6;
const SCORE_LANE_RATIO = 0.65;
const FALLBACK_TIME_BUDGET_MS = 2000;
const FALLBACK_THRESHOLD_LIMIT = 36;
const FALLBACK_SUPPORT_LIMIT = 12;
const FALLBACK_REQ_REDUCER_LIMIT = 12;
const OPTIMISTIC_THRESHOLD_MULTIPLIER = 10;

interface PartialBuild {
  ingredientIds: number[];
  /** Running score estimate for pruning */
  score: number;
  /** Estimated threshold penalty for partial ordering */
  thresholdPenalty: number;
  /** Remaining required must-include ingredient count */
  missingMust: number;
}

interface EstimatedPartial {
  score: number;
  thresholdPenalty: number;
}

interface DeterministicFallbackResult {
  candidates: RecipeSolverCandidate[];
  processedStates: number;
  timedOut: boolean;
  detail: string;
}

/**
 * Find the recipe matching the given type and level range.
 */
function findRecipe(catalog: RecipeCatalogSnapshot, recipeType: string, levelRange: string): NormalizedRecipe | null {
  const candidates = catalog.recipesByType.get(recipeType.toUpperCase());
  if (!candidates) return null;
  const name = `${recipeType.charAt(0).toUpperCase()}${recipeType.slice(1).toLowerCase()}-${levelRange}`;
  return candidates.find((r) => r.name === name) ?? null;
}

function getEligibleIngredients(
  catalog: RecipeCatalogSnapshot,
  recipe: NormalizedRecipe,
  constraints: RecipeSolverConstraints,
): NormalizedIngredient[] {
  const skill = recipe.skill.toUpperCase();
  const maxLevel = recipe.lvl[1];
  const excludedSet = new Set(constraints.excludedIngredients);
  const eligible: NormalizedIngredient[] = [];

  for (const ing of catalog.ingredients) {
    if (ing.id === NO_INGREDIENT_ID) continue;
    if (excludedSet.has(ing.id)) continue;
    if (ing.lvl > maxLevel) continue;
    if (!ing.skills.some((s) => s.toUpperCase() === skill)) continue;
    eligible.push(ing);
  }
  return eligible;
}

function thresholdValueFromIngredient(ingredient: NormalizedIngredient, key: string): number {
  if (key === 'durability') return ingredient.itemIDs.dura ?? 0;
  if (key === 'duration') return ingredient.consumableIDs.dura ?? 0;
  return ingredient.ids[key]?.max ?? 0;
}

function hasPositivePosMods(ingredient: NormalizedIngredient): boolean {
  const pm = ingredient.posMods;
  return pm.left > 0 || pm.right > 0 || pm.above > 0 || pm.under > 0 || pm.touching > 0 || pm.notTouching > 0;
}

function posModSupportScore(ingredient: NormalizedIngredient): number {
  const pm = ingredient.posMods;
  return Math.max(0, pm.left) + Math.max(0, pm.right) + Math.max(0, pm.above) +
    Math.max(0, pm.under) + Math.max(0, pm.touching) + Math.max(0, pm.notTouching);
}

function thresholdSupportScore(ingredient: NormalizedIngredient, targetKeys: string[]): number {
  let score = 0;
  for (const key of targetKeys) {
    const value = thresholdValueFromIngredient(ingredient, key);
    if (value > 0) score += value;
  }
  return score;
}

/**
 * Build the candidate ingredient pool for beam search.
 * Filters/ranks from the eligible set and keeps threshold-support ingredients.
 */
function buildIngredientPool(
  catalog: RecipeCatalogSnapshot,
  eligible: NormalizedIngredient[],
  constraints: RecipeSolverConstraints,
): NormalizedIngredient[] {
  const mustIncludeSet = new Set(constraints.mustIncludeIngredients);
  const thresholdKeys = new Set(Object.keys(constraints.target));
  const hasThresholds = thresholdKeys.size > 0;

  const scored = eligible.map((ing) => ({
    ing,
    score: roughIngredientScore(ing, constraints.weights, hasThresholds ? thresholdKeys : undefined),
  }));
  scored.sort((a, b) => b.score - a.score);

  const topK = constraints.topKPerSlot;
  const seen = new Set<number>();
  const result: NormalizedIngredient[] = [catalog.noIngredient];
  seen.add(NO_INGREDIENT_ID);
  let count = 0;

  // Keep must-includes in pool regardless of rough score.
  for (const { ing } of scored) {
    if (mustIncludeSet.has(ing.id) && !seen.has(ing.id)) {
      seen.add(ing.id);
      result.push(ing);
    }
  }

  for (const { ing } of scored) {
    if (seen.has(ing.id)) continue;
    seen.add(ing.id);
    result.push(ing);
    count++;
    if (count >= topK) break;
  }

  if (hasThresholds) {
    const thresholdScored = eligible
      .filter((ing) => !seen.has(ing.id))
      .map((ing) => ({
        ing,
        tScore: Array.from(thresholdKeys).reduce((acc, key) => {
          const value = thresholdValueFromIngredient(ing, key);
          return value > 0 ? acc + value : acc;
        }, 0),
      }))
      .filter(({ tScore }) => tScore > 0);
    thresholdScored.sort((a, b) => b.tScore - a.tScore);

    const thresholdExtra = Math.min(thresholdScored.length, Math.max(30, Math.floor(topK / 2)));
    for (let i = 0; i < thresholdExtra; i++) {
      const { ing } = thresholdScored[i];
      if (!seen.has(ing.id)) {
        seen.add(ing.id);
        result.push(ing);
      }
    }
  }

  return result;
}

function missingMustCount(ingredientIds: number[], mustIncludeSet: Set<number>): number {
  if (mustIncludeSet.size === 0) return 0;
  const idSet = new Set(ingredientIds);
  let missing = 0;
  for (const id of mustIncludeSet) {
    if (!idSet.has(id)) missing++;
  }
  return missing;
}

function satisfiesMaxReqs(
  stats: { reqs: [number, number, number, number, number] },
  constraints: RecipeSolverConstraints,
): boolean {
  const maxReqs = constraints.maxReqs;
  for (let i = 0; i < 5; i++) {
    const max = maxReqs[i];
    if (max != null && Math.max(0, stats.reqs[i]) > max) return false;
  }
  return true;
}

function includesAllMustIngredients(ingredientIds: number[], mustIncludeSet: Set<number>): boolean {
  if (mustIncludeSet.size === 0) return true;
  const idSet = new Set(ingredientIds);
  for (const id of mustIncludeSet) {
    if (!idSet.has(id)) return false;
  }
  return true;
}

/**
 * Quick partial estimate: compute stats for placed ingredients, fill remaining with "No Ingredient".
 */
function estimatePartialState(
  recipe: NormalizedRecipe,
  partialIds: number[],
  catalog: RecipeCatalogSnapshot,
  constraints: RecipeSolverConstraints,
  matTiers: [number, number],
  atkSpd: CraftedAtkSpd,
): EstimatedPartial {
  const ingredients: NormalizedIngredient[] = [];
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    if (i < partialIds.length) {
      ingredients.push(catalog.ingredientsById.get(partialIds[i]) ?? catalog.noIngredient);
    } else {
      ingredients.push(catalog.noIngredient);
    }
  }
  const stats = computeCraftedStats(recipe, matTiers, ingredients, atkSpd);
  const { score, breakdown } = scoreCraftedItem(stats, constraints.weights, constraints);
  return { score, thresholdPenalty: breakdown.thresholdPenalty };
}

function positionalContributionToTarget(
  posMods: NormalizedIngredient['posMods'],
  sourceSlot: number,
  targetSlot: number,
): number {
  const sourceRow = Math.floor(sourceSlot / 2);
  const sourceCol = sourceSlot % 2;
  const targetRow = Math.floor(targetSlot / 2);
  const targetCol = targetSlot % 2;
  if (sourceRow === targetRow && sourceCol === targetCol) return 0;

  let total = 0;
  if (targetCol === sourceCol && targetRow < sourceRow) total += posMods.above;
  if (targetCol === sourceCol && targetRow > sourceRow) total += posMods.under;
  if (sourceRow === targetRow && sourceCol === 1 && targetCol === 0) total += posMods.left;
  if (sourceRow === targetRow && sourceCol === 0 && targetCol === 1) total += posMods.right;

  const touching =
    (Math.abs(targetRow - sourceRow) === 1 && targetCol === sourceCol) ||
    (targetRow === sourceRow && Math.abs(targetCol - sourceCol) === 1);
  if (touching) total += posMods.touching;

  const notTouching =
    Math.abs(targetRow - sourceRow) > 1 ||
    (Math.abs(targetRow - sourceRow) === 1 && Math.abs(targetCol - sourceCol) === 1);
  if (notTouching) total += posMods.notTouching;

  return total;
}

function computeOptimisticEffectMultipliers(eligible: NormalizedIngredient[]): number[] {
  const multipliers: number[] = [];
  for (let target = 0; target < TOTAL_SLOTS; target++) {
    let optimisticEffect = 100;
    for (let source = 0; source < TOTAL_SLOTS; source++) {
      if (source === target) continue;
      let bestSourceBoost = 0;
      for (const ing of eligible) {
        const contribution = positionalContributionToTarget(ing.posMods, source, target);
        if (contribution > bestSourceBoost) bestSourceBoost = contribution;
      }
      optimisticEffect += Math.max(0, bestSourceBoost);
    }
    multipliers[target] = Math.max(0, optimisticEffect) / 100;
  }
  return multipliers;
}

function optimisticIngredientContribution(
  ingredient: NormalizedIngredient,
  key: string,
  slotMultipliers: number[],
): number {
  const raw = thresholdValueFromIngredient(ingredient, key);
  if (raw <= 0) return 0;
  let best = 0;
  for (const mult of slotMultipliers) {
    const candidate = Math.ceil(raw * mult);
    if (candidate > best) best = candidate;
  }
  return best;
}

function precheckThresholdFeasibility(
  eligible: NormalizedIngredient[],
  constraints: RecipeSolverConstraints,
  mustIncludeSet: Set<number>,
): string | null {
  if (mustIncludeSet.size > TOTAL_SLOTS) {
    return `Unsatisfiable constraints: ${mustIncludeSet.size} distinct must-include ingredients exceed ${TOTAL_SLOTS} slots.`;
  }

  const eligibleById = new Map<number, NormalizedIngredient>();
  for (const ing of eligible) eligibleById.set(ing.id, ing);

  for (const id of mustIncludeSet) {
    if (!eligibleById.has(id)) {
      return `Unsatisfiable constraints: must-include ingredient #${id} is not eligible for this recipe/level range.`;
    }
  }

  const slotMultipliers = computeOptimisticEffectMultipliers(eligible);
  const remainingSlotsAfterMust = Math.max(0, TOTAL_SLOTS - mustIncludeSet.size);

  for (const [key, range] of Object.entries(constraints.target)) {
    if (typeof range.min !== 'number') continue;
    if (key === 'durability' || key === 'duration') continue;

    let bestAny = 0;
    for (const ing of eligible) {
      const contribution = optimisticIngredientContribution(ing, key, slotMultipliers);
      if (contribution > bestAny) bestAny = contribution;
    }

    let requiredMustContribution = 0;
    for (const id of mustIncludeSet) {
      const ing = eligibleById.get(id);
      if (!ing) continue;
      requiredMustContribution += optimisticIngredientContribution(ing, key, slotMultipliers);
    }

    const theoreticalMax = requiredMustContribution + remainingSlotsAfterMust * bestAny;
    if (theoreticalMax < range.min) {
      return `Unsatisfiable threshold: ${key} min ${range.min} exceeds theoretical max ${theoreticalMax} for the current recipe/level/ingredient pool.`;
    }
  }

  return null;
}

function buildFallbackPool(
  catalog: RecipeCatalogSnapshot,
  eligible: NormalizedIngredient[],
  constraints: RecipeSolverConstraints,
  mustIncludeSet: Set<number>,
): NormalizedIngredient[] {
  const thresholdKeys = Object.keys(constraints.target);
  const hasReqLimits = constraints.maxReqs.some((value) => value != null);
  const thresholdKeySet = new Set(thresholdKeys);
  const seen = new Set<number>();
  const pool: NormalizedIngredient[] = [];
  const eligibleById = new Map<number, NormalizedIngredient>();
  for (const ing of eligible) eligibleById.set(ing.id, ing);

  const addIngredient = (ing: NormalizedIngredient | undefined) => {
    if (!ing || seen.has(ing.id)) return;
    seen.add(ing.id);
    pool.push(ing);
  };

  addIngredient(catalog.noIngredient);

  for (const id of mustIncludeSet) {
    addIngredient(eligibleById.get(id));
  }

  const thresholdCandidates = eligible
    .map((ing) => ({ ing, score: thresholdSupportScore(ing, thresholdKeys) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  for (let i = 0; i < Math.min(FALLBACK_THRESHOLD_LIMIT, thresholdCandidates.length); i++) {
    addIngredient(thresholdCandidates[i].ing);
  }

  const supportCandidates = eligible
    .filter(hasPositivePosMods)
    .map((ing) => ({ ing, score: posModSupportScore(ing) }))
    .sort((a, b) => b.score - a.score);
  for (let i = 0; i < Math.min(FALLBACK_SUPPORT_LIMIT, supportCandidates.length); i++) {
    addIngredient(supportCandidates[i].ing);
  }

  if (hasReqLimits) {
    const reqReducers = eligible
      .map((ing) => {
        const reduction =
          Math.max(0, -ing.itemIDs.strReq) +
          Math.max(0, -ing.itemIDs.dexReq) +
          Math.max(0, -ing.itemIDs.intReq) +
          Math.max(0, -ing.itemIDs.defReq) +
          Math.max(0, -ing.itemIDs.agiReq);
        return { ing, reduction };
      })
      .filter(({ reduction }) => reduction > 0)
      .sort((a, b) => b.reduction - a.reduction);
    for (let i = 0; i < Math.min(FALLBACK_REQ_REDUCER_LIMIT, reqReducers.length); i++) {
      addIngredient(reqReducers[i].ing);
    }
  }

  if (pool.length < 12) {
    const rough = eligible
      .map((ing) => ({ ing, score: roughIngredientScore(ing, constraints.weights, thresholdKeySet) }))
      .sort((a, b) => b.score - a.score);
    for (const { ing } of rough) {
      addIngredient(ing);
      if (pool.length >= 12) break;
    }
  }

  return pool;
}

function optimisticMinThresholdStillPossible(
  partialIds: number[],
  remainingSlots: number,
  poolById: Map<number, NormalizedIngredient>,
  constraints: RecipeSolverConstraints,
  optimisticBestByKey: Map<string, number>,
): boolean {
  for (const [key, range] of Object.entries(constraints.target)) {
    if (typeof range.min !== 'number') continue;
    if (key === 'durability' || key === 'duration') continue;

    let optimisticCurrent = 0;
    for (const id of partialIds) {
      const ing = poolById.get(id);
      if (!ing) continue;
      const value = Math.max(0, thresholdValueFromIngredient(ing, key));
      optimisticCurrent += value * OPTIMISTIC_THRESHOLD_MULTIPLIER;
    }

    const optimisticUpper = optimisticCurrent + remainingSlots * (optimisticBestByKey.get(key) ?? 0);
    if (optimisticUpper < range.min) return false;
  }
  return true;
}

function runDeterministicThresholdFallback(args: {
  recipe: NormalizedRecipe;
  catalog: RecipeCatalogSnapshot;
  constraints: RecipeSolverConstraints;
  category: ReturnType<typeof getCraftedCategory>;
  matTierOptions: Array<[number, number]>;
  atkSpdOptions: CraftedAtkSpd[];
  mustIncludeSet: Set<number>;
  eligible: NormalizedIngredient[];
  signal?: AbortSignal;
}): DeterministicFallbackResult {
  const {
    recipe,
    catalog,
    constraints,
    category,
    matTierOptions,
    atkSpdOptions,
    mustIncludeSet,
    eligible,
    signal,
  } = args;

  const start = Date.now();
  let timedOut = false;
  let processedStates = 0;
  const targetKeys = Object.keys(constraints.target);
  const pool = buildFallbackPool(catalog, eligible, constraints, mustIncludeSet);
  if (pool.length === 0) {
    return {
      candidates: [],
      processedStates: 0,
      timedOut: false,
      detail: 'Deterministic fallback had no eligible fallback ingredients to explore.',
    };
  }

  const optimisticBestByKey = new Map<string, number>();
  for (const [key, range] of Object.entries(constraints.target)) {
    if (typeof range.min !== 'number') continue;
    if (key === 'durability' || key === 'duration') continue;
    let best = 0;
    for (const ing of pool) {
      const value = Math.max(0, thresholdValueFromIngredient(ing, key));
      if (value > best) best = value;
    }
    optimisticBestByKey.set(key, best * OPTIMISTIC_THRESHOLD_MULTIPLIER);
  }

  const scoreById = new Map<number, { threshold: number; support: number; reqReduce: number; rough: number }>();
  for (const ing of pool) {
    const reqReduce =
      Math.max(0, -ing.itemIDs.strReq) +
      Math.max(0, -ing.itemIDs.dexReq) +
      Math.max(0, -ing.itemIDs.intReq) +
      Math.max(0, -ing.itemIDs.defReq) +
      Math.max(0, -ing.itemIDs.agiReq);
    scoreById.set(ing.id, {
      threshold: thresholdSupportScore(ing, targetKeys),
      support: posModSupportScore(ing),
      reqReduce,
      rough: roughIngredientScore(ing, constraints.weights, new Set(targetKeys)),
    });
  }

  const ordered = [...pool].sort((a, b) => {
    if (a.id === NO_INGREDIENT_ID && b.id !== NO_INGREDIENT_ID) return 1;
    if (b.id === NO_INGREDIENT_ID && a.id !== NO_INGREDIENT_ID) return -1;
    const aMust = mustIncludeSet.has(a.id) ? 1 : 0;
    const bMust = mustIncludeSet.has(b.id) ? 1 : 0;
    if (aMust !== bMust) return bMust - aMust;
    const aScore = scoreById.get(a.id);
    const bScore = scoreById.get(b.id);
    if (!aScore || !bScore) return 0;
    if (aScore.threshold !== bScore.threshold) return bScore.threshold - aScore.threshold;
    if (aScore.reqReduce !== bScore.reqReduce) return bScore.reqReduce - aScore.reqReduce;
    if (aScore.support !== bScore.support) return bScore.support - aScore.support;
    return bScore.rough - aScore.rough;
  });

  const poolById = new Map<number, NormalizedIngredient>();
  for (const ing of pool) poolById.set(ing.id, ing);
  const candidateMap = new Map<string, RecipeSolverCandidate>();

  const checkTimeout = () => {
    if (Date.now() - start >= FALLBACK_TIME_BUDGET_MS) {
      timedOut = true;
      return true;
    }
    return false;
  };

  const visit = (depth: number, partialIds: number[]) => {
    if (timedOut) return;
    if (signal?.aborted) throw new DOMException('Recipe solver cancelled', 'AbortError');
    if (checkTimeout()) return;

    const remainingSlots = TOTAL_SLOTS - depth;
    const missingMust = missingMustCount(partialIds, mustIncludeSet);
    if (missingMust > remainingSlots) return;
    if (!optimisticMinThresholdStillPossible(partialIds, remainingSlots, poolById, constraints, optimisticBestByKey)) return;

    if (depth === TOTAL_SLOTS) {
      const ingredientIds = [...partialIds] as [number, number, number, number, number, number];
      if (!includesAllMustIngredients(ingredientIds, mustIncludeSet)) return;
      const ingredients = ingredientIds.map((id) => poolById.get(id) ?? catalog.noIngredient);

      for (const matTiers of matTierOptions) {
        for (const atkSpd of atkSpdOptions) {
          if (signal?.aborted) throw new DOMException('Recipe solver cancelled', 'AbortError');
          if (checkTimeout()) return;

          const stats = computeCraftedStats(recipe, matTiers, ingredients, atkSpd);
          processedStates++;
          if (!satisfiesMaxReqs(stats, constraints)) continue;
          if (!satisfiesThresholds(stats, constraints.target)) continue;

          const { score, breakdown } = scoreCraftedItem(stats, constraints.weights, constraints);
          const hash = encodeCraftHash(ingredientIds, recipe.id, matTiers, atkSpd, category);
          const key = ingredientIds.join(',') + '|' + matTiers.join(',') + '|' + atkSpd;
          const existing = candidateMap.get(key);
          if (!existing || score > existing.score) {
            candidateMap.set(key, {
              recipeId: recipe.id,
              ingredientIds,
              matTiers,
              atkSpd,
              effectiveness: stats.effectiveness,
              stats,
              score,
              scoreBreakdown: breakdown,
              hash,
            });
          }
        }
      }
      return;
    }

    for (const ing of ordered) {
      partialIds.push(ing.id);
      visit(depth + 1, partialIds);
      partialIds.pop();
      if (timedOut) return;
    }
  };

  visit(0, []);

  const candidates = Array.from(candidateMap.values());
  candidates.sort((a, b) => b.score - a.score);
  const topCandidates = candidates.slice(0, constraints.topN);

  return {
    candidates: topCandidates,
    processedStates,
    timedOut,
    detail: timedOut
      ? `Deterministic fallback hit ${FALLBACK_TIME_BUDGET_MS}ms time budget after ${processedStates} evaluated states.`
      : `Deterministic fallback evaluated ${processedStates} states and found ${topCandidates.length} threshold-satisfying candidates.`,
  };
}

export interface RecipeSolverRunArgs {
  catalog: RecipeCatalogSnapshot;
  constraints: RecipeSolverConstraints;
  signal?: AbortSignal;
  onProgress?: (event: RecipeSolverProgressEvent) => void;
  /** Internal guard so threshold rescue retries at most once. */
  alreadyThresholdRescue?: boolean;
}

/**
 * Run the recipe solver beam search.
 */
export function runRecipeSolverBeamSearch(args: RecipeSolverRunArgs): RecipeSolverCandidate[] {
  const { catalog, constraints, signal, onProgress, alreadyThresholdRescue = false } = args;

  const recipe = findRecipe(catalog, constraints.recipeType, constraints.levelRange);
  if (!recipe) {
    onProgress?.({
      phase: 'complete',
      processedStates: 0,
      beamSize: 0,
      expandedSlots: 0,
      totalSlots: TOTAL_SLOTS,
      detail: `No recipe found for ${constraints.recipeType}-${constraints.levelRange}.`,
    });
    return [];
  }

  const category = getCraftedCategory(recipe.type.toLowerCase());
  const mustIncludeSet = new Set(constraints.mustIncludeIngredients);
  const hasThresholds = Object.keys(constraints.target).length > 0;

  const eligible = getEligibleIngredients(catalog, recipe, constraints);
  if (eligible.length === 0) {
    onProgress?.({
      phase: 'complete',
      processedStates: 0,
      beamSize: 0,
      expandedSlots: 0,
      totalSlots: TOTAL_SLOTS,
      detail: 'No eligible ingredients remain after recipe, level, and exclusion filters.',
    });
    return [];
  }

  const infeasibleReason = precheckThresholdFeasibility(eligible, constraints, mustIncludeSet);
  if (infeasibleReason) {
    onProgress?.({
      phase: 'complete',
      processedStates: 0,
      beamSize: 0,
      expandedSlots: 0,
      totalSlots: TOTAL_SLOTS,
      detail: infeasibleReason,
    });
    return [];
  }

  const pool = buildIngredientPool(catalog, eligible, constraints);
  if (pool.length === 0) return [];

  const matTierOptions: Array<[number, number]> = constraints.matTiers
    ? [constraints.matTiers]
    : [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3]];

  const atkSpdOptions: CraftedAtkSpd[] = category === 'weapon'
    ? (constraints.atkSpd ? [constraints.atkSpd] : [...CRAFTED_ATK_SPEEDS])
    : ['SLOW'];

  const defaultMatTiers: [number, number] = matTierOptions[matTierOptions.length - 1];
  const defaultAtkSpd: CraftedAtkSpd = atkSpdOptions[0];

  const beamWidth = constraints.beamWidth;
  let processedStates = 0;
  const mustIncludeBonus = mustIncludeSet.size > 0 ? 1e6 : 0;

  let beam: PartialBuild[] = [{
    ingredientIds: [],
    score: 0,
    thresholdPenalty: hasThresholds ? Number.POSITIVE_INFINITY : 0,
    missingMust: mustIncludeSet.size,
  }];

  for (let slotIdx = 0; slotIdx < TOTAL_SLOTS; slotIdx++) {
    if (signal?.aborted) throw new DOMException('Recipe solver cancelled', 'AbortError');

    const nextBeam: PartialBuild[] = [];
    for (const partial of beam) {
      for (const ing of pool) {
        if (signal?.aborted) throw new DOMException('Recipe solver cancelled', 'AbortError');
        const newIds = [...partial.ingredientIds, ing.id];
        const estimate = estimatePartialState(
          recipe,
          newIds,
          catalog,
          constraints,
          defaultMatTiers,
          defaultAtkSpd,
        );
        const missingMust = missingMustCount(newIds, mustIncludeSet);
        let score = estimate.score;
        if (mustIncludeBonus > 0 && missingMust === 0) {
          score += mustIncludeBonus;
        }
        nextBeam.push({
          ingredientIds: newIds,
          score,
          thresholdPenalty: estimate.thresholdPenalty,
          missingMust,
        });
        processedStates++;
      }
    }

    const seenKeys = new Set<string>();
    const pushUnique = (bucket: PartialBuild[], out: PartialBuild[]) => {
      for (const state of bucket) {
        const key = state.ingredientIds.join(',');
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        out.push(state);
        if (out.length >= beamWidth) break;
      }
    };

    if (hasThresholds) {
      const scoreLaneSize = Math.max(1, Math.floor(beamWidth * SCORE_LANE_RATIO));
      const thresholdLaneSize = Math.max(1, beamWidth - scoreLaneSize);

      const scoreLane = [...nextBeam]
        .sort((a, b) => b.score - a.score)
        .slice(0, scoreLaneSize);
      const thresholdLane = [...nextBeam]
        .sort((a, b) => {
          if (a.missingMust !== b.missingMust) return a.missingMust - b.missingMust;
          if (a.thresholdPenalty !== b.thresholdPenalty) return a.thresholdPenalty - b.thresholdPenalty;
          return b.score - a.score;
        })
        .slice(0, thresholdLaneSize);

      const merged: PartialBuild[] = [];
      pushUnique(scoreLane, merged);
      if (merged.length < beamWidth) pushUnique(thresholdLane, merged);
      if (merged.length < beamWidth) pushUnique(nextBeam.sort((a, b) => b.score - a.score), merged);
      beam = merged.slice(0, beamWidth);
    } else {
      const merged: PartialBuild[] = [];
      pushUnique(nextBeam.sort((a, b) => b.score - a.score), merged);
      beam = merged.slice(0, beamWidth);
    }

    onProgress?.({
      phase: 'beam-search',
      processedStates,
      beamSize: beam.length,
      expandedSlots: slotIdx + 1,
      totalSlots: TOTAL_SLOTS,
      detail: hasThresholds
        ? `Dual-lane prune (score + threshold) on pool=${pool.length}`
        : `Score-lane prune on pool=${pool.length}`,
    });
  }

  onProgress?.({
    phase: 'material-sweep',
    processedStates,
    beamSize: beam.length,
    expandedSlots: TOTAL_SLOTS,
    totalSlots: TOTAL_SLOTS,
    detail: `Sweeping ${matTierOptions.length} tier combos x ${atkSpdOptions.length} atk speeds`,
  });

  const candidateMap = new Map<string, RecipeSolverCandidate>();
  for (const partial of beam) {
    if (signal?.aborted) throw new DOMException('Recipe solver cancelled', 'AbortError');
    const ingredientIds = partial.ingredientIds as [number, number, number, number, number, number];
    const ingredients = ingredientIds.map((id) => catalog.ingredientsById.get(id) ?? catalog.noIngredient);

    for (const matTiers of matTierOptions) {
      for (const atkSpd of atkSpdOptions) {
        const stats = computeCraftedStats(recipe, matTiers, ingredients, atkSpd);
        const { score, breakdown } = scoreCraftedItem(stats, constraints.weights, constraints);
        const hash = encodeCraftHash(ingredientIds, recipe.id, matTiers, atkSpd, category);
        const key = ingredientIds.join(',') + '|' + matTiers.join(',') + '|' + atkSpd;
        const existing = candidateMap.get(key);
        if (!existing || score > existing.score) {
          candidateMap.set(key, {
            recipeId: recipe.id,
            ingredientIds,
            matTiers,
            atkSpd,
            effectiveness: stats.effectiveness,
            stats,
            score,
            scoreBreakdown: breakdown,
            hash,
          });
        }
        processedStates++;
      }
    }
  }

  const allCandidates = Array.from(candidateMap.values());
  allCandidates.sort((a, b) => b.score - a.score);

  const seenHashes = new Set<string>();
  const satisfying: RecipeSolverCandidate[] = [];
  const unsatisfying: RecipeSolverCandidate[] = [];
  for (const candidate of allCandidates) {
    if (seenHashes.has(candidate.hash)) continue;
    seenHashes.add(candidate.hash);

    if (!includesAllMustIngredients(candidate.ingredientIds, mustIncludeSet)) continue;
    if (!satisfiesMaxReqs(candidate.stats, constraints)) continue;

    if (hasThresholds && satisfiesThresholds(candidate.stats, constraints.target)) {
      satisfying.push(candidate);
    } else {
      unsatisfying.push(candidate);
    }
  }

  if (hasThresholds && satisfying.length === 0 && !alreadyThresholdRescue) {
    const rescueConstraints: RecipeSolverConstraints = {
      ...constraints,
      topKPerSlot: Math.min(400, Math.max(constraints.topKPerSlot * 2, 180)),
      beamWidth: Math.min(5000, Math.max(constraints.beamWidth * 2, 1200)),
    };
    const widened =
      rescueConstraints.topKPerSlot !== constraints.topKPerSlot ||
      rescueConstraints.beamWidth !== constraints.beamWidth;

    if (widened) {
      onProgress?.({
        phase: 'threshold-rescue',
        processedStates,
        beamSize: beam.length,
        expandedSlots: TOTAL_SLOTS,
        totalSlots: TOTAL_SLOTS,
        detail: `No candidates satisfied thresholds. Retrying beam with topK=${rescueConstraints.topKPerSlot}, beam=${rescueConstraints.beamWidth}.`,
      });
      const rescued = runRecipeSolverBeamSearch({
        catalog,
        constraints: rescueConstraints,
        signal,
        onProgress,
        alreadyThresholdRescue: true,
      });
      if (rescued.length > 0) return rescued;
    }

    onProgress?.({
      phase: 'deterministic-fallback',
      processedStates,
      beamSize: 0,
      expandedSlots: TOTAL_SLOTS,
      totalSlots: TOTAL_SLOTS,
      detail: `Beam search produced no threshold-satisfying candidates. Running deterministic fallback (<=${FALLBACK_TIME_BUDGET_MS}ms).`,
    });

    const fallback = runDeterministicThresholdFallback({
      recipe,
      catalog,
      constraints,
      category,
      matTierOptions,
      atkSpdOptions,
      mustIncludeSet,
      eligible,
      signal,
    });
    processedStates += fallback.processedStates;

    if (fallback.candidates.length > 0) {
      onProgress?.({
        phase: 'complete',
        processedStates,
        beamSize: fallback.candidates.length,
        expandedSlots: TOTAL_SLOTS,
        totalSlots: TOTAL_SLOTS,
        detail: `Beam/rescue found 0 threshold-satisfying candidates. ${fallback.detail}`,
      });
      return fallback.candidates;
    }

    onProgress?.({
      phase: 'complete',
      processedStates,
      beamSize: 0,
      expandedSlots: TOTAL_SLOTS,
      totalSlots: TOTAL_SLOTS,
      detail: fallback.timedOut
        ? `No valid candidates found before timeout. ${fallback.detail}`
        : `No candidates satisfy all hard thresholds. ${fallback.detail}`,
    });
    return [];
  }

  const deduped = hasThresholds
    ? satisfying.slice(0, constraints.topN)
    : unsatisfying.slice(0, constraints.topN);

  const satisfiedCount = satisfying.length;
  onProgress?.({
    phase: 'complete',
    processedStates,
    beamSize: deduped.length,
    expandedSlots: TOTAL_SLOTS,
    totalSlots: TOTAL_SLOTS,
    detail: hasThresholds
      ? satisfiedCount > 0
        ? `Found ${deduped.length} candidates (${satisfiedCount} satisfy thresholds) from ${processedStates} states`
        : `Found 0 candidates satisfying thresholds (${unsatisfying.length} failed threshold checks) from ${processedStates} states`
      : `Found ${deduped.length} candidates from ${processedStates} states`,
  });

  return deduped;
}
