import { describe, expect, it } from 'vitest';
import { runRecipeSolverBeamSearch } from '@/domain/recipe-solver/beam-search';
import {
  DEFAULT_RECIPE_SOLVER_CONSTRAINTS,
  NO_INGREDIENT_ID,
  type NormalizedIngredient,
  type NormalizedRecipe,
  type RecipeCatalogSnapshot,
  type RecipeSolverProgressEvent,
} from '@/domain/recipe-solver/types';

function makeIngredient(
  id: number,
  name: string,
  ids: Record<string, { min: number; max: number }>,
): NormalizedIngredient {
  return {
    id,
    name,
    displayName: name,
    lvl: 1,
    tier: 1,
    skills: ['ARMOURING'],
    ids,
    itemIDs: { dura: 0, strReq: 0, dexReq: 0, intReq: 0, defReq: 0, agiReq: 0 },
    consumableIDs: { dura: 0, charges: 0 },
    posMods: { left: 0, right: 0, above: 0, under: 0, touching: 0, notTouching: 0 },
  };
}

function makeCatalog(extraIngredients: NormalizedIngredient[]): RecipeCatalogSnapshot {
  const recipe: NormalizedRecipe = {
    id: 100,
    name: 'Helmet-103-105',
    type: 'HELMET',
    skill: 'ARMOURING',
    materials: [
      { item: 'Refined Wood', amount: 1 },
      { item: 'Refined Ore', amount: 1 },
    ],
    healthOrDamage: [0, 0],
    durability: [100, 100],
    duration: [0, 0],
    basicDuration: [0, 0],
    lvl: [103, 105],
  };

  const noIngredient: NormalizedIngredient = {
    id: NO_INGREDIENT_ID,
    name: 'No Ingredient',
    displayName: 'No Ingredient',
    lvl: 0,
    tier: 0,
    skills: [],
    ids: {},
    itemIDs: { dura: 0, strReq: 0, dexReq: 0, intReq: 0, defReq: 0, agiReq: 0 },
    consumableIDs: { dura: 0, charges: 0 },
    posMods: { left: 0, right: 0, above: 0, under: 0, touching: 0, notTouching: 0 },
  };

  const recipes = [recipe];
  const ingredients = [noIngredient, ...extraIngredients];
  const recipesById = new Map<number, NormalizedRecipe>([[recipe.id, recipe]]);
  const recipesByType = new Map<string, NormalizedRecipe[]>([['HELMET', recipes]]);
  const ingredientsById = new Map<number, NormalizedIngredient>();
  const ingredientsBySkill = new Map<string, NormalizedIngredient[]>();
  const ingredientIdByName = new Map<string, number>();

  for (const ingredient of ingredients) {
    ingredientsById.set(ingredient.id, ingredient);
    ingredientIdByName.set(ingredient.name.toLowerCase(), ingredient.id);
    ingredientIdByName.set(ingredient.displayName.toLowerCase(), ingredient.id);
    for (const skill of ingredient.skills) {
      const key = skill.toUpperCase();
      const existing = ingredientsBySkill.get(key);
      if (existing) {
        existing.push(ingredient);
      } else {
        ingredientsBySkill.set(key, [ingredient]);
      }
    }
  }

  return {
    recipes,
    recipesById,
    recipesByType,
    ingredients,
    ingredientsById,
    ingredientsBySkill,
    ingredientIdByName,
    noIngredient,
  };
}

function makeCatalogForRecipe(
  recipeType: string,
  recipeSkill: string,
  levelRange: string,
  extraIngredients: NormalizedIngredient[],
): RecipeCatalogSnapshot {
  const recipeName = `${recipeType.charAt(0)}${recipeType.slice(1).toLowerCase()}-${levelRange}`;
  const [minLevelRaw, maxLevelRaw] = levelRange.split('-').map((value) => Number(value));
  const minLevel = Number.isFinite(minLevelRaw) ? minLevelRaw : 103;
  const maxLevel = Number.isFinite(maxLevelRaw) ? maxLevelRaw : 105;
  const recipe: NormalizedRecipe = {
    id: 200,
    name: recipeName,
    type: recipeType,
    skill: recipeSkill,
    materials: [
      { item: 'Refined Wood', amount: 1 },
      { item: 'Refined Ore', amount: 1 },
    ],
    healthOrDamage: [100, 200],
    durability: [100, 100],
    duration: [0, 0],
    basicDuration: [0, 0],
    lvl: [minLevel, maxLevel],
  };

  const noIngredient: NormalizedIngredient = {
    id: NO_INGREDIENT_ID,
    name: 'No Ingredient',
    displayName: 'No Ingredient',
    lvl: 0,
    tier: 0,
    skills: [],
    ids: {},
    itemIDs: { dura: 0, strReq: 0, dexReq: 0, intReq: 0, defReq: 0, agiReq: 0 },
    consumableIDs: { dura: 0, charges: 0 },
    posMods: { left: 0, right: 0, above: 0, under: 0, touching: 0, notTouching: 0 },
  };

  const recipes = [recipe];
  const ingredients = [noIngredient, ...extraIngredients];
  const recipesById = new Map<number, NormalizedRecipe>([[recipe.id, recipe]]);
  const recipesByType = new Map<string, NormalizedRecipe[]>([[recipeType.toUpperCase(), recipes]]);
  const ingredientsById = new Map<number, NormalizedIngredient>();
  const ingredientsBySkill = new Map<string, NormalizedIngredient[]>();
  const ingredientIdByName = new Map<string, number>();

  for (const ingredient of ingredients) {
    ingredientsById.set(ingredient.id, ingredient);
    ingredientIdByName.set(ingredient.name.toLowerCase(), ingredient.id);
    ingredientIdByName.set(ingredient.displayName.toLowerCase(), ingredient.id);
    for (const skill of ingredient.skills) {
      const key = skill.toUpperCase();
      const existing = ingredientsBySkill.get(key);
      if (existing) {
        existing.push(ingredient);
      } else {
        ingredientsBySkill.set(key, [ingredient]);
      }
    }
  }

  return {
    recipes,
    recipesById,
    recipesByType,
    ingredients,
    ingredientsById,
    ingredientsBySkill,
    ingredientIdByName,
    noIngredient,
  };
}

function makeWeaponsmithingDistractor(id: number): NormalizedIngredient {
  return {
    ...makeIngredient(id, `Distractor ${id}`, { sdPct: { min: 450, max: 450 } }),
    lvl: 104,
    tier: 2,
    skills: ['WEAPONSMITHING'],
  };
}

describe('recipe solver threshold handling', () => {
  const catalog = makeCatalog([
    makeIngredient(1, 'Mana Dust', { mr: { min: 10, max: 10 } }),
    makeIngredient(2, 'Damage Dust', { sdPct: { min: 300, max: 300 } }),
  ]);

  it('treats advanced ID thresholds as hard constraints', () => {
    const results = runRecipeSolverBeamSearch({
      catalog,
      constraints: {
        ...DEFAULT_RECIPE_SOLVER_CONSTRAINTS,
        recipeType: 'HELMET',
        levelRange: '103-105',
        topN: 10,
        topKPerSlot: 12,
        beamWidth: 80,
        target: {
          mr: { min: 999 },
        },
      },
    });

    expect(results).toHaveLength(0);
  });

  it('returns only threshold-satisfying candidates when thresholds are feasible', () => {
    const results = runRecipeSolverBeamSearch({
      catalog,
      constraints: {
        ...DEFAULT_RECIPE_SOLVER_CONSTRAINTS,
        recipeType: 'HELMET',
        levelRange: '103-105',
        topN: 20,
        topKPerSlot: 20,
        beamWidth: 160,
        target: {
          mr: { min: 40 },
        },
      },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((candidate) => (candidate.stats.maxRolls.mr ?? 0) >= 40)).toBe(true);
  });

  it('enforces Eyes Yet Open as must-include with lq min target', () => {
    const eyesYetOpenId = 3;
    const mustIncludeCatalog = makeCatalogForRecipe('SPEAR', 'WEAPONSMITHING', '103-105', [
      {
        ...makeIngredient(eyesYetOpenId, 'Eyes Yet Open', { lq: { min: 1, max: 2 } }),
        lvl: 104,
        tier: 2,
        skills: ['WEAPONSMITHING', 'WOODWORKING'],
      },
    ]);

    const results = runRecipeSolverBeamSearch({
      catalog: mustIncludeCatalog,
      constraints: {
        ...DEFAULT_RECIPE_SOLVER_CONSTRAINTS,
        recipeType: 'SPEAR',
        levelRange: '103-105',
        topN: 20,
        topKPerSlot: 20,
        beamWidth: 200,
        mustIncludeIngredients: [eyesYetOpenId],
        target: {
          lq: { min: 12 },
        },
      },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((candidate) => candidate.ingredientIds.includes(eyesYetOpenId))).toBe(true);
    expect(results.every((candidate) => (candidate.stats.maxRolls.lq ?? 0) >= 12)).toBe(true);
    expect(results.every((candidate) => candidate.ingredientIds.every((id) => id === eyesYetOpenId))).toBe(true);
  });

  it('finds Eyes Yet Open lq>=12 under heavy distractor pressure', () => {
    const eyesYetOpenId = 9991;
    const distractors = Array.from({ length: 90 }, (_, index) => makeWeaponsmithingDistractor(8000 + index));
    const catalog = makeCatalogForRecipe('SPEAR', 'WEAPONSMITHING', '103-105', [
      ...distractors,
      {
        ...makeIngredient(eyesYetOpenId, 'Eyes Yet Open', { lq: { min: 1, max: 2 }, hpBonus: { min: -430, max: -375 } }),
        lvl: 104,
        tier: 2,
        skills: ['WEAPONSMITHING', 'WOODWORKING'],
      },
    ]);

    const results = runRecipeSolverBeamSearch({
      catalog,
      constraints: {
        ...DEFAULT_RECIPE_SOLVER_CONSTRAINTS,
        recipeType: 'SPEAR',
        levelRange: '103-105',
        topN: 10,
        topKPerSlot: 10,
        beamWidth: 8,
        mustIncludeIngredients: [eyesYetOpenId],
        target: {
          lq: { min: 12 },
        },
      },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((candidate) => candidate.ingredientIds.includes(eyesYetOpenId))).toBe(true);
    expect(results.every((candidate) => (candidate.stats.maxRolls.lq ?? 0) >= 12)).toBe(true);
  });

  it('reports unsatisfiable threshold detail for impossible lq min', () => {
    const eyesYetOpenId = 10001;
    const catalog = makeCatalogForRecipe('SPEAR', 'WEAPONSMITHING', '103-105', [
      {
        ...makeIngredient(eyesYetOpenId, 'Eyes Yet Open', { lq: { min: 1, max: 2 } }),
        lvl: 104,
        tier: 2,
        skills: ['WEAPONSMITHING', 'WOODWORKING'],
      },
    ]);

    const progress: RecipeSolverProgressEvent[] = [];
    const results = runRecipeSolverBeamSearch({
      catalog,
      constraints: {
        ...DEFAULT_RECIPE_SOLVER_CONSTRAINTS,
        recipeType: 'SPEAR',
        levelRange: '103-105',
        topN: 10,
        topKPerSlot: 10,
        beamWidth: 20,
        mustIncludeIngredients: [eyesYetOpenId],
        target: {
          lq: { min: 13 },
        },
      },
      onProgress: (event) => progress.push(event),
    });

    expect(results).toHaveLength(0);
    const final = [...progress].reverse().find((event) => event.phase === 'complete');
    expect(final?.detail ?? '').toContain('Unsatisfiable threshold');
  });
});
