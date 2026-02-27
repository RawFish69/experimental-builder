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

interface PartialBuild {
  ingredientIds: number[];
  /** Running score estimate for pruning */
  score: number;
}

/**
 * Find the recipe matching the given type and level range.
 */
function findRecipe(catalog: RecipeCatalogSnapshot, recipeType: string, levelRange: string): NormalizedRecipe | null {
  const candidates = catalog.recipesByType.get(recipeType.toUpperCase());
  if (!candidates) return null;
  const name = `${recipeType.charAt(0).toUpperCase()}${recipeType.slice(1).toLowerCase()}-${levelRange}`;
  return candidates.find(r => r.name === name) ?? null;
}

/**
 * Build the candidate ingredient pool for a given recipe.
 * Filters by skill compatibility and level, then ranks by rough score.
 * When thresholds are present, a separate threshold-support pool is merged
 * to ensure ingredients contributing to threshold stats aren't pruned.
 */
function buildIngredientPool(
  catalog: RecipeCatalogSnapshot,
  recipe: NormalizedRecipe,
  constraints: RecipeSolverConstraints,
): NormalizedIngredient[] {
  const skill = recipe.skill.toUpperCase();
  const maxLevel = recipe.lvl[1];
  const excludedSet = new Set(constraints.excludedIngredients);
  const mustIncludeSet = new Set(constraints.mustIncludeIngredients);
  const thresholdKeys = new Set(Object.keys(constraints.target));
  const hasThresholds = thresholdKeys.size > 0;

  const eligible: NormalizedIngredient[] = [];

  for (const ing of catalog.ingredients) {
    if (ing.id === NO_INGREDIENT_ID) continue;
    if (excludedSet.has(ing.id)) continue;

    // All ingredients must match the recipe's profession (including must-includes)
    const hasSkill = ing.skills.some(s => s.toUpperCase() === skill);
    if (!hasSkill) continue;
    if (ing.lvl > maxLevel) continue;

    eligible.push(ing);
  }

  // Score with threshold awareness
  const scored = eligible.map(ing => ({
    ing,
    score: roughIngredientScore(ing, constraints.weights, hasThresholds ? thresholdKeys : undefined),
  }));
  scored.sort((a, b) => b.score - a.score);

  const topK = constraints.topKPerSlot;
  const seen = new Set<number>();
  const result: NormalizedIngredient[] = [catalog.noIngredient];
  seen.add(NO_INGREDIENT_ID);
  let count = 0;

  // Add must-includes first
  for (const { ing } of scored) {
    if (mustIncludeSet.has(ing.id) && !seen.has(ing.id)) {
      seen.add(ing.id);
      result.push(ing);
    }
  }

  // Add top K by general score
  for (const { ing } of scored) {
    if (seen.has(ing.id)) continue;
    seen.add(ing.id);
    result.push(ing);
    count++;
    if (count >= topK) break;
  }

  // If thresholds are set, also add top ingredients specifically for threshold stats
  // so they aren't outcompeted by unrelated high-scoring ingredients.
  if (hasThresholds) {
    const thresholdScored = eligible
      .filter(ing => !seen.has(ing.id))
      .map(ing => {
        let tScore = 0;
        for (const key of thresholdKeys) {
          const val = ing.ids[key]?.max ?? 0;
          if (val > 0) tScore += val;
        }
        return { ing, tScore };
      })
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

/**
 * Quick partial score estimate: compute stats for placed ingredients,
 * fill remaining with "No Ingredient", and score.
 */
function estimatePartialScore(
  recipe: NormalizedRecipe,
  partialIds: number[],
  catalog: RecipeCatalogSnapshot,
  constraints: RecipeSolverConstraints,
  matTiers: [number, number],
  atkSpd: CraftedAtkSpd,
): number {
  const ingredients: NormalizedIngredient[] = [];
  for (let i = 0; i < 6; i++) {
    if (i < partialIds.length) {
      ingredients.push(catalog.ingredientsById.get(partialIds[i]) ?? catalog.noIngredient);
    } else {
      ingredients.push(catalog.noIngredient);
    }
  }
  const stats = computeCraftedStats(recipe, matTiers, ingredients, atkSpd);
  const { score } = scoreCraftedItem(stats, constraints.weights, constraints);
  return score;
}

export interface RecipeSolverRunArgs {
  catalog: RecipeCatalogSnapshot;
  constraints: RecipeSolverConstraints;
  signal?: AbortSignal;
  onProgress?: (event: RecipeSolverProgressEvent) => void;
}

/**
 * Run the recipe solver beam search.
 */
export function runRecipeSolverBeamSearch(args: RecipeSolverRunArgs): RecipeSolverCandidate[] {
  const { catalog, constraints, signal, onProgress } = args;

  // Find recipe
  const recipe = findRecipe(catalog, constraints.recipeType, constraints.levelRange);
  if (!recipe) {
    return [];
  }

  const category = getCraftedCategory(recipe.type.toLowerCase());

  // Build ingredient pool
  const pool = buildIngredientPool(catalog, recipe, constraints);
  if (pool.length === 0) return [];

  // Determine material tier and attack speed options to sweep
  const matTierOptions: Array<[number, number]> = constraints.matTiers
    ? [constraints.matTiers]
    : [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3]];

  const atkSpdOptions: CraftedAtkSpd[] = category === 'weapon'
    ? (constraints.atkSpd ? [constraints.atkSpd] : [...CRAFTED_ATK_SPEEDS])
    : ['SLOW']; // irrelevant for non-weapons, use default

  // Use highest tier combo and first atk speed for beam search scoring
  const defaultMatTiers: [number, number] = matTierOptions[matTierOptions.length - 1];
  const defaultAtkSpd: CraftedAtkSpd = atkSpdOptions[0];

  const beamWidth = constraints.beamWidth;
  const totalSlots = 6;
  let processedStates = 0;
  const mustIncludeSet = new Set(constraints.mustIncludeIngredients);
  const mustIncludeBonus = mustIncludeSet.size > 0 ? 1e6 : 0; // Heavy bonus so must-include builds survive beam

  // Initialize beam with empty builds
  let beam: PartialBuild[] = [{ ingredientIds: [], score: 0 }];

  // Beam search over 6 slots
  for (let slotIdx = 0; slotIdx < totalSlots; slotIdx++) {
    if (signal?.aborted) throw new DOMException('Recipe solver cancelled', 'AbortError');

    const nextBeam: PartialBuild[] = [];

    for (const partial of beam) {
      for (const ing of pool) {
        if (signal?.aborted) throw new DOMException('Recipe solver cancelled', 'AbortError');

        const newIds = [...partial.ingredientIds, ing.id];
        let score = estimatePartialScore(
          recipe, newIds, catalog, constraints, defaultMatTiers, defaultAtkSpd,
        );
        // Bonus when all must-includes are present so they survive beam pruning
        if (mustIncludeBonus > 0) {
          const hasAll = mustIncludeSet.size > 0 && [...mustIncludeSet].every((id) => newIds.includes(id));
          if (hasAll) score += mustIncludeBonus;
        }
        nextBeam.push({ ingredientIds: newIds, score });
        processedStates++;
      }
    }

    // Prune to beam width
    nextBeam.sort((a, b) => b.score - a.score);
    beam = nextBeam.slice(0, beamWidth);

    // Deduplicate: same ingredient set in same positions
    const seen = new Set<string>();
    beam = beam.filter(b => {
      const key = b.ingredientIds.join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    onProgress?.({
      phase: 'beam-search',
      processedStates,
      beamSize: beam.length,
      expandedSlots: slotIdx + 1,
      totalSlots,
    });
  }

  // Phase 2: Sweep material tiers and attack speeds for each complete build
  onProgress?.({
    phase: 'material-sweep',
    processedStates,
    beamSize: beam.length,
    expandedSlots: totalSlots,
    totalSlots,
    detail: `Sweeping ${matTierOptions.length} tier combos × ${atkSpdOptions.length} atk speeds`,
  });

  const candidateMap = new Map<string, RecipeSolverCandidate>();

  for (const partial of beam) {
    if (signal?.aborted) throw new DOMException('Recipe solver cancelled', 'AbortError');

    const ingredientIds = partial.ingredientIds as [number, number, number, number, number, number];
    const ingredients = ingredientIds.map(id => catalog.ingredientsById.get(id) ?? catalog.noIngredient);

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

  // Collect, sort, and return top N
  const allCandidates = Array.from(candidateMap.values());
  allCandidates.sort((a, b) => b.score - a.score);

  const hasThresholds = Object.keys(constraints.target).length > 0;

  // Hard-filter: prefer candidates that satisfy all thresholds
  const seenHashes = new Set<string>();
  const satisfying: RecipeSolverCandidate[] = [];
  const unsatisfying: RecipeSolverCandidate[] = [];

  function satisfiesMaxReqs(stats: { reqs: [number, number, number, number, number] }): boolean {
    const maxReqs = constraints.maxReqs;
    for (let i = 0; i < 5; i++) {
      const max = maxReqs[i];
      if (max != null && Math.max(0, stats.reqs[i]) > max) return false;
    }
    return true;
  }

  function includesAllMustIngredients(ingredientIds: number[]): boolean {
    if (mustIncludeSet.size === 0) return true;
    const idSet = new Set(ingredientIds);
    for (const id of mustIncludeSet) {
      if (!idSet.has(id)) return false;
    }
    return true;
  }

  for (const c of allCandidates) {
    if (seenHashes.has(c.hash)) continue;
    seenHashes.add(c.hash);

    if (!includesAllMustIngredients(c.ingredientIds)) continue;
    if (!satisfiesMaxReqs(c.stats)) continue;

    if (hasThresholds && satisfiesThresholds(c.stats, constraints.target)) {
      satisfying.push(c);
    } else {
      unsatisfying.push(c);
    }
  }

  // Return threshold-satisfying candidates first; fall back to best-effort if none qualify
  const deduped = satisfying.length > 0
    ? satisfying.slice(0, constraints.topN)
    : unsatisfying.slice(0, constraints.topN);

  const satisfiedCount = satisfying.length;

  onProgress?.({
    phase: 'complete',
    processedStates,
    beamSize: deduped.length,
    expandedSlots: totalSlots,
    totalSlots,
    detail: hasThresholds
      ? `Found ${deduped.length} candidates (${satisfiedCount} satisfy thresholds) from ${processedStates} states`
      : `Found ${deduped.length} candidates from ${processedStates} states`,
  });

  return deduped;
}
