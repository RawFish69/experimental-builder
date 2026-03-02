import type {
  CatalogSnapshot,
  CatalogSetMeta,
  CharacterClass,
  ItemNumericStats,
  ItemTier,
  NormalizedItem,
  RawCompressPayload,
} from '@/domain/items/types';
import { getClassFromWeaponType, itemCategoryFromRaw, ITEM_CATEGORY_KEYS } from '@/domain/items/types';

const NUMERIC_INDEX_KEYS = [
  'hp',
  'hpBonus',
  'hprRaw',
  'hprPct',
  'mr',
  'ms',
  'ls',
  'sdPct',
  'sdRaw',
  'mdPct',
  'mdRaw',
  'poison',
  'spd',
  'atkTier',
  'averageDps',
  'strReq',
  'dexReq',
  'intReq',
  'defReq',
  'agiReq',
  'str',
  'dex',
  'int',
  'def',
  'agi',
  'eDef',
  'tDef',
  'wDef',
  'fDef',
  'aDef',
  'eDamPct',
  'tDamPct',
  'wDamPct',
  'fDamPct',
  'aDamPct',
  'damPct',
  'rDamPct',
  'nDamPct',
  'slots',
  'lvl',
];

// Rolled ID keys whose values in compress.json are base rolls and should be
// converted to max-rolls using WynnBuilder's expandItem logic.
// See hppeng-wynn.github.io/js/build_utils.js (rolledIDs / expandItem).
const ROLLED_NUMERIC_KEYS: (keyof ItemNumericStats)[] = [
  'hpBonus',
  'hprRaw',
  'hprPct',
  'mr',
  'ms',
  'ls',
  'sdPct',
  'sdRaw',
  'mdPct',
  'mdRaw',
  'poison',
  'spd',
  'atkTier',
  'eDamPct',
  'tDamPct',
  'wDamPct',
  'fDamPct',
  'aDamPct',
  'damPct',
];

function idRoundLikeWynnbuilder(value: number): number {
  const rounded = Math.round(value);
  if (rounded === 0 && value !== 0) {
    return value > 0 ? 1 : -1;
  }
  return rounded;
}

function maxRollFromBase(_idKey: keyof ItemNumericStats, base: number): number {
  if (!Number.isFinite(base) || base === 0) return 0;
  const isPositive = base > 0;
  if (isPositive) {
    // Positive rolled IDs: maxRoll = idRound(base * 1.3)
    return idRoundLikeWynnbuilder(base * 1.3);
  } else {
    // Negative rolled IDs: maxRoll = idRound(base * 0.7)
    return idRoundLikeWynnbuilder(base * 0.7);
  }
}

// Per-item overrides for items whose rolled IDs should be treated as fixed
// (i.e. no base→max-roll conversion), even if they use rolled ID keys.
// This mirrors WynnBuilder's fixID / identified semantics where our data
// does not expose those flags directly.
const FIXED_ID_ITEM_NAMES = new Set<string>([
  'Twilight-Gilded Cloak',
]);

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function normalizeClassReq(raw: unknown, type: string): CharacterClass | null {
  const text = asString(raw).trim();
  if (!text) {
    return getClassFromWeaponType(type);
  }
  switch (text.toLowerCase()) {
    case 'warrior':
      return 'Warrior';
    case 'assassin':
      return 'Assassin';
    case 'mage':
      return 'Mage';
    case 'archer':
      return 'Archer';
    case 'shaman':
      return 'Shaman';
    default:
      return getClassFromWeaponType(type);
  }
}

function pickStats(raw: Record<string, unknown>): ItemNumericStats {
  return {
    hp: asNumber(raw.hp),
    hpBonus: asNumber(raw.hpBonus),
    hprRaw: asNumber(raw.hprRaw),
    hprPct: asNumber(raw.hprPct),
    mr: asNumber(raw.mr),
    ms: asNumber(raw.ms),
    ls: asNumber(raw.ls),
    sdPct: asNumber(raw.sdPct),
    sdRaw: asNumber(raw.sdRaw),
    mdPct: asNumber(raw.mdPct),
    mdRaw: asNumber(raw.mdRaw),
    poison: asNumber(raw.poison),
    spd: asNumber(raw.spd),
    atkTier: asNumber(raw.atkTier),
    baseDps: asNumber(raw.averageDps),
    reqStr: asNumber(raw.strReq),
    reqDex: asNumber(raw.dexReq),
    reqInt: asNumber(raw.intReq),
    reqDef: asNumber(raw.defReq),
    reqAgi: asNumber(raw.agiReq),
    spStr: asNumber(raw.str),
    spDex: asNumber(raw.dex),
    spInt: asNumber(raw.int),
    spDef: asNumber(raw.def),
    spAgi: asNumber(raw.agi),
    eDef: asNumber(raw.eDef),
    tDef: asNumber(raw.tDef),
    wDef: asNumber(raw.wDef),
    fDef: asNumber(raw.fDef),
    aDef: asNumber(raw.aDef),
    eDamPct: asNumber(raw.eDamPct),
    tDamPct: asNumber(raw.tDamPct),
    wDamPct: asNumber(raw.wDamPct),
    fDamPct: asNumber(raw.fDamPct),
    aDamPct: asNumber(raw.aDamPct),
    damPct: asNumber(raw.damPct),
    rDamPct: asNumber(raw.rDamPct),
    nDamPct: asNumber(raw.nDamPct),
  };
}

function buildNumericIndex(raw: Record<string, unknown>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of NUMERIC_INDEX_KEYS) {
    result[key] = asNumber(raw[key]);
  }
  result.reqTotal = result.strReq + result.dexReq + result.intReq + result.defReq + result.agiReq;
  result.skillPointTotal = result.str + result.dex + result.int + result.def + result.agi;
  result.offenseScore =
    result.averageDps +
    result.sdPct * 1.4 +
    result.mdPct * 1.15 +
    result.sdRaw * 0.12 +
    result.mdRaw * 0.12 +
    (result.damPct + result.rDamPct + result.nDamPct) * 0.8 +
    (result.eDamPct + result.tDamPct + result.wDamPct + result.fDamPct + result.aDamPct) * 0.5 +
    result.atkTier * 7 +
    result.poison * 0.03;
  result.ehpProxy =
    (result.hp + result.hpBonus) +
    (result.eDef + result.tDef + result.wDef + result.fDef + result.aDef) * 0.45 +
    result.hprRaw * 1.2 +
    result.hprPct * 2.5;
  result.utilityScore = result.spd * 1.8 + result.mr * 8 + result.ms * 7 + result.ls * 6;
  result.sumSpPct = result.spPct1 + result.spPct2 + result.spPct3 + result.spPct4;
  result.sumSpRaw = result.spRaw1 + result.spRaw2 + result.spRaw3 + result.spRaw4;
  return result;
}

export function normalizeItem(raw: Record<string, unknown>): NormalizedItem | null {
  if (typeof raw.remapID !== 'undefined') return null;
  const type = asString(raw.type).toLowerCase();
  const sourceCategory = asString(raw.category).toLowerCase();
  const category = itemCategoryFromRaw(type, sourceCategory);
  if (!category) return null;

  const displayName = asString(raw.displayName) || asString(raw.name);
  const tier = (asString(raw.tier) || 'Normal') as ItemTier;
  const level = asNumber(raw.lvl);
  const majorIds = asStringArray(raw.majorIds);
  const numeric = pickStats(raw);
  const numericIndex = buildNumericIndex(raw);

  const hasFixIdFlag = Boolean((raw as { fixID?: unknown }).fixID) || Boolean((raw as { identified?: unknown }).identified);
  const fixedByName = FIXED_ID_ITEM_NAMES.has(displayName);
  const fixRolledIds = hasFixIdFlag || fixedByName;

  // Convert rolled IDs from base → max-roll, mirroring WynnBuilder's expandItem,
  // unless this item is marked as having fixed rolled IDs.
  if (!fixRolledIds) {
    for (const key of ROLLED_NUMERIC_KEYS) {
      const base = numeric[key];
      const max = maxRollFromBase(key, base);
      numeric[key] = max;
      if (Object.prototype.hasOwnProperty.call(numericIndex, key)) {
        numericIndex[key] = max;
      }
    }
  }

  const roughScoreFields = {
    baseDps: numeric.baseDps,
    offense: numericIndex.offenseScore,
    ehpProxy: numericIndex.ehpProxy,
    utility: numericIndex.utilityScore,
    skillPointTotal: numericIndex.skillPointTotal,
    reqTotal: numericIndex.reqTotal,
  };

  const textFields = [
    displayName,
    asString(raw.name),
    asString(raw.lore),
    type,
    tier,
    sourceCategory,
    asString(raw.classReq),
    ...majorIds,
  ];

  return {
    id: asNumber(raw.id),
    name: asString(raw.name),
    displayName,
    category,
    type,
    sourceCategory,
    tier,
    level,
    classReq: normalizeClassReq(raw.classReq, type),
    majorIds,
    powderSlots: asNumber(raw.slots),
    atkSpd: asString(raw.atkSpd),
    restricted: asString(raw.restrict) !== '',
    deprecated: asString(raw.restrict).toUpperCase() === 'DEPRECATED',
    numeric,
    numericIndex,
    fixRolledIds,
    searchText: textFields.filter(Boolean).join(' ').toLowerCase(),
    majorIdsText: majorIds.join(' ').toLowerCase(),
    roughScoreFields,
    legacyRaw: raw,
  };
}

function pushRange(
  ranges: Record<string, { min: number; max: number }>,
  key: string,
  value: number,
): void {
  if (!Number.isFinite(value)) return;
  const current = ranges[key];
  if (!current) {
    ranges[key] = { min: value, max: value };
    return;
  }
  current.min = Math.min(current.min, value);
  current.max = Math.max(current.max, value);
}

export function normalizeCatalog(payload: RawCompressPayload): CatalogSnapshot {
  const items = payload.items.map(normalizeItem).filter((item): item is NormalizedItem => item !== null);
  items.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const itemsById = new Map<number, NormalizedItem>();
  const itemIdByName = new Map<string, number>();
  const itemsByType = new Map<string, number[]>();
  const itemsByCategory = new Map(ITEM_CATEGORY_KEYS.map((k) => [k, [] as number[]] as const)) as Map<
    CatalogSnapshot['facetsMeta']['categories'][number],
    number[]
  >;
  const tiers = new Set<string>();
  const types = new Set<string>();
  const classReqs = new Set<CharacterClass>();
  const majorIds = new Set<string>();
  const numericRanges: Record<string, { min: number; max: number }> = {};
  const setsMeta: Map<string, CatalogSetMeta> = new Map();

  for (const item of items) {
    itemsById.set(item.id, item);
    itemIdByName.set(item.displayName.toLowerCase(), item.id);
    if (!itemsByType.has(item.type)) itemsByType.set(item.type, []);
    itemsByType.get(item.type)!.push(item.id);
    itemsByCategory.get(item.category)!.push(item.id);
    tiers.add(item.tier);
    types.add(item.type);
    if (item.classReq) classReqs.add(item.classReq);
    for (const majorId of item.majorIds) {
      if (majorId) majorIds.add(majorId);
    }
    for (const [key, value] of Object.entries(item.numericIndex)) {
      pushRange(numericRanges, key, value);
    }
  }

  // Normalize legacy set metadata (for illegal-combination rules).
  // Items carry no `set` field themselves — membership is defined on the set side via item names.
  const rawSets = payload.sets ?? {};
  const itemSetName = new Map<string, string>(); // item displayName (lower) → set name (interim)
  for (const [setName, raw] of Object.entries(rawSets)) {
    const bonuses = (raw as any)?.bonuses;
    if (!Array.isArray(bonuses)) continue;
    const illegalCounts: number[] = [];
    bonuses.forEach((bonus, index) => {
      if (bonus && typeof bonus === 'object' && (bonus as any).illegal) {
        illegalCounts.push(index + 1); // bonuses[count-1]
      }
    });
    if (illegalCounts.length > 0) {
      setsMeta.set(setName, { illegalCounts });
    }
    // Register every member item name regardless of whether the set is illegal,
    // so we can resolve set membership for all items.
    const members = (raw as any)?.items;
    if (Array.isArray(members)) {
      for (const memberName of members) {
        if (typeof memberName === 'string') {
          itemSetName.set(memberName.toLowerCase(), setName);
        }
      }
    }
  }

  // Build ID-keyed reverse-map now that itemIdByName is fully populated.
  const itemSetNameById = new Map<number, string>();
  for (const [nameLower, setName] of itemSetName) {
    const id = itemIdByName.get(nameLower);
    if (id != null) {
      itemSetNameById.set(id, setName);
    }
  }

  return {
    version: String(payload.version ?? 'unknown'),
    items,
    itemsById,
    itemIdByName,
    itemsByType,
    itemsByCategory,
    facetsMeta: {
      categories: [...ITEM_CATEGORY_KEYS],
      types: [...types].sort(),
      tiers: [...tiers].sort(),
      classReqs: [...classReqs].sort(),
      majorIds: [...majorIds].sort(),
      numericRanges,
    },
    setsMeta,
    itemSetName: itemSetNameById,
  };
}
