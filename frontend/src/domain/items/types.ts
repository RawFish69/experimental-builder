export const ITEM_CATEGORY_KEYS = [
  'helmet',
  'chestplate',
  'leggings',
  'boots',
  'ring',
  'bracelet',
  'necklace',
  'weapon',
] as const;

export type ItemCategoryKey = (typeof ITEM_CATEGORY_KEYS)[number];

export const ITEM_SLOTS = [
  'helmet',
  'chestplate',
  'leggings',
  'boots',
  'ring1',
  'ring2',
  'bracelet',
  'necklace',
  'weapon',
] as const;

export type ItemSlot = (typeof ITEM_SLOTS)[number];

export type CharacterClass = 'Warrior' | 'Assassin' | 'Mage' | 'Archer' | 'Shaman';

export type ItemTier =
  | 'Normal'
  | 'Unique'
  | 'Rare'
  | 'Legendary'
  | 'Fabled'
  | 'Mythic'
  | 'Set'
  | 'Crafted'
  | string;

export interface ItemNumericStats {
  hp: number;
  hpBonus: number;
  hprRaw: number;
  hprPct: number;
  mr: number;
  ms: number;
  ls: number;
  sdPct: number;
  sdRaw: number;
  mdPct: number;
  mdRaw: number;
  poison: number;
  spd: number;
  atkTier: number;
  baseDps: number;
  reqStr: number;
  reqDex: number;
  reqInt: number;
  reqDef: number;
  reqAgi: number;
  spStr: number;
  spDex: number;
  spInt: number;
  spDef: number;
  spAgi: number;
  eDef: number;
  tDef: number;
  wDef: number;
  fDef: number;
  aDef: number;
  eDamPct: number;
  tDamPct: number;
  wDamPct: number;
  fDamPct: number;
  aDamPct: number;
  damPct: number;
  rDamPct: number;
  nDamPct: number;
}

export interface RoughScoreFields {
  baseDps: number;
  offense: number;
  ehpProxy: number;
  utility: number;
  skillPointTotal: number;
  reqTotal: number;
}

export interface NormalizedItem {
  id: number;
  name: string;
  displayName: string;
  category: ItemCategoryKey;
  type: string;
  sourceCategory: string;
  tier: ItemTier;
  level: number;
  classReq: CharacterClass | null;
  majorIds: string[];
  powderSlots: number;
  atkSpd: string;
  restricted: boolean;
  deprecated: boolean;
  numeric: ItemNumericStats;
  numericIndex: Record<string, number>;
  /**
   * If true, treat rolled IDs on this item as fixed at their base values
   * (i.e. do NOT apply base→max-roll conversion for rolled stats).
   * Mirrors WynnBuilder's per-item fixID / identified semantics where available.
   */
  fixRolledIds?: boolean;
  searchText: string;
  majorIdsText: string;
  roughScoreFields: RoughScoreFields;
  legacyRaw: Record<string, unknown>;
}

export interface FacetsMeta {
  categories: ItemCategoryKey[];
  types: string[];
  tiers: string[];
  classReqs: CharacterClass[];
  majorIds: string[];
  numericRanges: Record<string, { min: number; max: number }>;
}

export interface CatalogSetMeta {
  /** 1-based piece counts that are illegal for this set (from legacy `bonuses[count-1].illegal`). */
  illegalCounts: number[];
}

export interface CatalogSnapshot {
  version: string;
  items: NormalizedItem[];
  itemsById: Map<number, NormalizedItem>;
  itemIdByName: Map<string, number>;
  itemsByType: Map<string, number[]>;
  itemsByCategory: Map<ItemCategoryKey, number[]>;
  facetsMeta: FacetsMeta;
  /** Legacy set metadata used for illegal-combination checks, keyed by set name. */
  setsMeta: Map<string, CatalogSetMeta>;
  /**
   * Reverse-map from item ID to its set name, built from the legacy `sets` block.
   * Items themselves carry no `set` field in the data — membership is defined on the set side.
   */
  itemSetName: Map<number, string>;
}

export interface RawCompressPayload {
  version?: string | number;
  items: Array<Record<string, unknown>>;
  sets?: Record<string, unknown>;
}

export const slotToCategory = (slot: ItemSlot): ItemCategoryKey =>
  slot === 'ring1' || slot === 'ring2' ? 'ring' : slot;

export const slotLabel = (slot: ItemSlot): string => {
  switch (slot) {
    case 'ring1':
      return 'Ring 1';
    case 'ring2':
      return 'Ring 2';
    default:
      return slot.charAt(0).toUpperCase() + slot.slice(1);
  }
};

export function categoryLabel(category: ItemCategoryKey): string {
  if (category === 'weapon') return 'Weapon';
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export const WEAPON_CLASS_BY_TYPE: Record<string, CharacterClass> = {
  spear: 'Warrior',
  dagger: 'Assassin',
  wand: 'Mage',
  bow: 'Archer',
  relik: 'Shaman',
};

export function getClassFromWeaponType(type: string): CharacterClass | null {
  return WEAPON_CLASS_BY_TYPE[type] ?? null;
}

export function itemCategoryFromRaw(rawType: string, rawCategory: string): ItemCategoryKey | null {
  if (rawType in WEAPON_CLASS_BY_TYPE) return 'weapon';
  if (ITEM_CATEGORY_KEYS.includes(rawType as ItemCategoryKey)) {
    return rawType as ItemCategoryKey;
  }
  if (rawCategory === 'weapon') return 'weapon';
  if (rawType === 'ring') return 'ring';
  return null;
}

export function slotAcceptsItem(slot: ItemSlot, item: Pick<NormalizedItem, 'category'>): boolean {
  return slotToCategory(slot) === item.category;
}

export function itemCanBeWornByClass(item: NormalizedItem, characterClass: CharacterClass | null): boolean {
  if (!characterClass) return true;
  if (!item.classReq) return true;
  return item.classReq === characterClass;
}

export function itemMatchesLevel(item: NormalizedItem, level: number): boolean {
  return item.level <= level;
}

