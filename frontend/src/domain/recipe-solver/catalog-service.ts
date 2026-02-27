import type {
  NormalizedRecipe,
  NormalizedIngredient,
  RecipeCatalogSnapshot,
  Material,
  PositionModifiers,
  IngredientItemIDs,
  IngredientConsumableIDs,
} from '@/domain/recipe-solver/types';
import { NO_INGREDIENT_ID } from '@/domain/recipe-solver/types';

interface RawRecipe {
  id: number;
  name: string;
  type: string;
  skill: string;
  materials: Array<{ item: string; amount: number }>;
  healthOrDamage?: { minimum: number; maximum: number };
  durability?: { minimum: number; maximum: number };
  duration?: { minimum: number; maximum: number };
  basicDuration?: { minimum: number; maximum: number };
  lvl?: { minimum: number; maximum: number };
}

interface RawIngredient {
  id: number;
  name: string;
  displayName?: string;
  lvl: number;
  tier: number;
  skills: string[];
  ids: Record<string, { minimum: number; maximum: number } | number>;
  itemIDs: Record<string, number>;
  consumableIDs: Record<string, number>;
  posMods: Record<string, number>;
  isPowder?: boolean;
  pid?: number;
}

function rangeOrZero(field: { minimum: number; maximum: number } | undefined): [number, number] {
  return field ? [field.minimum, field.maximum] : [0, 0];
}

function normalizeRecipe(raw: RawRecipe): NormalizedRecipe {
  const mat0: Material = { item: raw.materials[0].item, amount: raw.materials[0].amount };
  const mat1: Material = { item: raw.materials[1].item, amount: raw.materials[1].amount };
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    skill: raw.skill,
    materials: [mat0, mat1],
    healthOrDamage: rangeOrZero(raw.healthOrDamage),
    durability: rangeOrZero(raw.durability),
    duration: rangeOrZero(raw.duration),
    basicDuration: rangeOrZero(raw.basicDuration),
    lvl: rangeOrZero(raw.lvl),
  };
}

function normalizeIngredient(raw: RawIngredient): NormalizedIngredient {
  const ids: Record<string, { min: number; max: number }> = {};
  if (raw.ids) {
    for (const [key, val] of Object.entries(raw.ids)) {
      if (val && typeof val === 'object' && 'minimum' in val) {
        ids[key] = { min: val.minimum, max: val.maximum };
      }
    }
  }

  const posMods: PositionModifiers = {
    left: raw.posMods?.left ?? 0,
    right: raw.posMods?.right ?? 0,
    above: raw.posMods?.above ?? 0,
    under: raw.posMods?.under ?? 0,
    touching: raw.posMods?.touching ?? 0,
    notTouching: raw.posMods?.notTouching ?? 0,
  };

  const itemIDs: IngredientItemIDs = {
    dura: raw.itemIDs?.dura ?? 0,
    strReq: raw.itemIDs?.strReq ?? 0,
    dexReq: raw.itemIDs?.dexReq ?? 0,
    intReq: raw.itemIDs?.intReq ?? 0,
    defReq: raw.itemIDs?.defReq ?? 0,
    agiReq: raw.itemIDs?.agiReq ?? 0,
  };

  const consumableIDs: IngredientConsumableIDs = {
    dura: raw.consumableIDs?.dura ?? 0,
    charges: raw.consumableIDs?.charges ?? 0,
  };

  return {
    id: raw.id,
    name: raw.name,
    displayName: raw.displayName ?? raw.name,
    lvl: raw.lvl,
    tier: raw.tier,
    skills: raw.skills ?? [],
    ids,
    itemIDs,
    consumableIDs,
    posMods,
    isPowder: raw.isPowder,
    pid: raw.pid,
  };
}

function makeNoIngredient(): NormalizedIngredient {
  return {
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
}

function buildSnapshot(recipes: NormalizedRecipe[], ingredients: NormalizedIngredient[]): RecipeCatalogSnapshot {
  const recipesById = new Map<number, NormalizedRecipe>();
  const recipesByType = new Map<string, NormalizedRecipe[]>();
  for (const r of recipes) {
    recipesById.set(r.id, r);
    const key = r.type.toUpperCase();
    const list = recipesByType.get(key) ?? [];
    list.push(r);
    recipesByType.set(key, list);
  }

  const noIng = makeNoIngredient();
  const allIngredients = [noIng, ...ingredients];
  const ingredientsById = new Map<number, NormalizedIngredient>();
  const ingredientsBySkill = new Map<string, NormalizedIngredient[]>();
  const ingredientIdByName = new Map<string, number>();

  for (const ing of allIngredients) {
    ingredientsById.set(ing.id, ing);
    ingredientIdByName.set(ing.name.toLowerCase(), ing.id);
    if (ing.displayName) {
      ingredientIdByName.set(ing.displayName.toLowerCase(), ing.id);
    }
    for (const skill of ing.skills) {
      const key = skill.toUpperCase();
      const list = ingredientsBySkill.get(key) ?? [];
      list.push(ing);
      ingredientsBySkill.set(key, list);
    }
  }

  return {
    recipes,
    recipesById,
    recipesByType,
    ingredients: allIngredients,
    ingredientsById,
    ingredientsBySkill,
    ingredientIdByName,
    noIngredient: noIng,
  };
}

async function fetchJson<T>(urls: string[]): Promise<T> {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to fetch data');
}

export class RecipeCatalogService {
  private snapshotPromise: Promise<RecipeCatalogSnapshot> | null = null;

  async getCatalog(): Promise<RecipeCatalogSnapshot> {
    if (!this.snapshotPromise) {
      this.snapshotPromise = this.load();
    }
    return this.snapshotPromise;
  }

  private async load(): Promise<RecipeCatalogSnapshot> {
    const resolve = (path: string) => {
      if (typeof window === 'undefined') return path;
      const base = window.location.href.split('?')[0].replace(/\/[^/]*$/, '/') || window.location.origin + '/';
      return new URL(path, base).href;
    };
    const recipePaths = [
      resolve('recipes_compress.json'),
      './recipes_compress.json',
      '../recipes_compress.json',
      'recipes_compress.json',
    ];
    const ingredPaths = [
      resolve('ingreds_compress.json'),
      './ingreds_compress.json',
      '../ingreds_compress.json',
      'ingreds_compress.json',
    ];

    const [recipesPayload, ingredsRaw] = await Promise.all([
      fetchJson<{ recipes: RawRecipe[] }>(recipePaths),
      fetchJson<RawIngredient[]>(ingredPaths),
    ]);

    const recipes = recipesPayload.recipes.map(normalizeRecipe);
    const ingredients = ingredsRaw.map(normalizeIngredient);
    return buildSnapshot(recipes, ingredients);
  }
}

export const recipeCatalogService = new RecipeCatalogService();
