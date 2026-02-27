export interface Material {
  item: string;
  amount: number;
}

export interface NormalizedRecipe {
  id: number;
  name: string;
  type: string;
  skill: string;
  materials: [Material, Material];
  healthOrDamage: [number, number];
  durability: [number, number];
  duration: [number, number];
  basicDuration: [number, number];
  lvl: [number, number];
}

export interface PositionModifiers {
  left: number;
  right: number;
  above: number;
  under: number;
  touching: number;
  notTouching: number;
}

export interface IngredientItemIDs {
  dura: number;
  strReq: number;
  dexReq: number;
  intReq: number;
  defReq: number;
  agiReq: number;
}

export interface IngredientConsumableIDs {
  dura: number;
  charges: number;
}

export interface NormalizedIngredient {
  id: number;
  name: string;
  displayName: string;
  lvl: number;
  tier: number;
  skills: string[];
  ids: Record<string, { min: number; max: number }>;
  itemIDs: IngredientItemIDs;
  consumableIDs: IngredientConsumableIDs;
  posMods: PositionModifiers;
  isPowder?: boolean;
  pid?: number;
}

export interface RecipeCatalogSnapshot {
  recipes: NormalizedRecipe[];
  recipesById: Map<number, NormalizedRecipe>;
  recipesByType: Map<string, NormalizedRecipe[]>;
  ingredients: NormalizedIngredient[];
  ingredientsById: Map<number, NormalizedIngredient>;
  ingredientsBySkill: Map<string, NormalizedIngredient[]>;
  ingredientIdByName: Map<string, number>;
  noIngredient: NormalizedIngredient;
}

export type CraftedCategory = 'weapon' | 'armor' | 'accessory' | 'consumable';

export const ARMOR_TYPES = ['helmet', 'chestplate', 'leggings', 'boots'] as const;
export const WEAPON_TYPES = ['spear', 'wand', 'dagger', 'bow', 'relik'] as const;
export const ACCESSORY_TYPES = ['ring', 'bracelet', 'necklace'] as const;
export const CONSUMABLE_TYPES = ['potion', 'scroll', 'food'] as const;

export const RECIPE_TYPES = [
  'HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS',
  'RELIK', 'WAND', 'SPEAR', 'DAGGER', 'BOW',
  'RING', 'NECKLACE', 'BRACELET',
  'POTION', 'SCROLL', 'FOOD',
] as const;

export const CRAFTING_SKILLS = [
  'ARMOURING', 'TAILORING', 'WEAPONSMITHING', 'WOODWORKING',
  'JEWELING', 'COOKING', 'ALCHEMISM', 'SCRIBING',
] as const;

export const LEVEL_RANGES = [
  '1-3','3-5','5-7','7-9','10-13','13-15','15-17','17-19',
  '20-23','23-25','25-27','27-29','30-33','33-35','35-37','37-39',
  '40-43','43-45','45-47','47-49','50-53','53-55','55-57','57-59',
  '60-63','63-65','65-67','67-69','70-73','73-75','75-77','77-79',
  '80-83','83-85','85-87','87-89','90-93','93-95','95-97','97-99',
  '100-103','103-105',
] as const;

export const CRAFTED_ATK_SPEEDS = ['SLOW', 'NORMAL', 'FAST'] as const;
export type CraftedAtkSpd = (typeof CRAFTED_ATK_SPEEDS)[number];

export function getCraftedCategory(type: string): CraftedCategory {
  const t = type.toLowerCase();
  if ((ARMOR_TYPES as readonly string[]).includes(t)) return 'armor';
  if ((WEAPON_TYPES as readonly string[]).includes(t)) return 'weapon';
  if ((ACCESSORY_TYPES as readonly string[]).includes(t)) return 'accessory';
  return 'consumable';
}

export interface CraftedItemStats {
  category: CraftedCategory;
  type: string;
  lvl: number;
  hp: number;
  hpLow: number;
  nDam: string;
  nDamLow: string;
  eDam: string; tDam: string; wDam: string; fDam: string; aDam: string;
  eDef: number; tDef: number; wDef: number; fDef: number; aDef: number;
  atkSpd: string;
  durability: [number, number];
  duration: [number, number];
  charges: number;
  slots: number;
  reqs: [number, number, number, number, number];
  effectiveness: number[];
  maxRolls: Record<string, number>;
  minRolls: Record<string, number>;
}

export interface RecipeSolverWeights {
  offense: number;
  defense: number;
  utility: number;
  skillPoints: number;
  reqPenalty: number;
}

export interface RecipeSolverConstraints {
  recipeType: string;
  levelRange: string;
  matTiers: [number, number] | null;
  atkSpd: CraftedAtkSpd | null;
  weights: RecipeSolverWeights;
  mustIncludeIngredients: number[];
  excludedIngredients: number[];
  topN: number;
  topKPerSlot: number;
  beamWidth: number;
  target: Record<string, { min?: number; max?: number }>;
}

export interface RecipeSolverScoreBreakdown {
  offense: number;
  defense: number;
  utility: number;
  skillPoints: number;
  reqPenalty: number;
  thresholdPenalty: number;
}

export interface RecipeSolverCandidate {
  recipeId: number;
  ingredientIds: [number, number, number, number, number, number];
  matTiers: [number, number];
  atkSpd: string;
  effectiveness: number[];
  stats: CraftedItemStats;
  score: number;
  scoreBreakdown: RecipeSolverScoreBreakdown;
  hash: string;
}

export interface RecipeSolverProgressEvent {
  phase: string;
  processedStates: number;
  beamSize: number;
  expandedSlots: number;
  totalSlots: number;
  detail?: string;
}

export const DEFAULT_RECIPE_SOLVER_WEIGHTS: RecipeSolverWeights = {
  offense: 1.0,
  defense: 0.6,
  utility: 0.4,
  skillPoints: 0.3,
  reqPenalty: 0.5,
};

export const DEFAULT_RECIPE_SOLVER_CONSTRAINTS: RecipeSolverConstraints = {
  recipeType: 'HELMET',
  levelRange: '103-105',
  matTiers: null,
  atkSpd: null,
  weights: DEFAULT_RECIPE_SOLVER_WEIGHTS,
  mustIncludeIngredients: [],
  excludedIngredients: [],
  topN: 30,
  topKPerSlot: 120,
  beamWidth: 400,
  target: {},
};

export const NO_INGREDIENT_ID = 4000;
