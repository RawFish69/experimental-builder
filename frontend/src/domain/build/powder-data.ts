import type { ItemSlot } from '@/domain/items/types';

export type PowderElement = 'earth' | 'thunder' | 'water' | 'fire' | 'air';

export interface PowderSpec {
  id: number;
  element: PowderElement;
  tier: number;
  label: string;
  short: string;
  min: number;
  max: number;
  convert: number;
  defPlus: number;
  defMinus: number;
}

export const POWDER_TIERS = 7;

const ELEMENTS: PowderElement[] = ['earth', 'thunder', 'water', 'fire', 'air'];
const ELEMENT_LABELS: Record<PowderElement, string> = {
  earth: 'Earth', thunder: 'Thunder', water: 'Water', fire: 'Fire', air: 'Air',
};
const ELEMENT_SHORT: Record<PowderElement, string> = {
  earth: 'E', thunder: 'T', water: 'W', fire: 'F', air: 'A',
};

export const ELEMENT_CSS_VARS: Record<PowderElement, string> = {
  earth: 'var(--wb-elem-earth)',
  thunder: 'var(--wb-elem-thunder)',
  water: 'var(--wb-elem-water)',
  fire: 'var(--wb-elem-fire)',
  air: 'var(--wb-elem-air)',
};

// Stats sourced from wynnbuilder-beta.github.io/js/powders.js (POWDER_TIERS=7)
// Ordering: 7 tiers per element, elements in order: Earth, Thunder, Water, Fire, Air
const RAW_STATS: Array<{ min: number; max: number; convert: number; defPlus: number; defMinus: number }> = [
  // Earth T1-T7
  { min: 4, max: 5, convert: 17, defPlus: 2, defMinus: 1 }, { min: 6, max: 7, convert: 21, defPlus: 5, defMinus: 2 },
  { min: 7, max: 9, convert: 25, defPlus: 9, defMinus: 3 }, { min: 8, max: 9, convert: 31, defPlus: 14, defMinus: 4 },
  { min: 9, max: 11, convert: 38, defPlus: 22, defMinus: 7 }, { min: 11, max: 12, convert: 46, defPlus: 29, defMinus: 7 },
  { min: 12, max: 14, convert: 52, defPlus: 37, defMinus: 12 },
  // Thunder T1-T7
  { min: 1, max: 8, convert: 9, defPlus: 2, defMinus: 1 }, { min: 1, max: 12, convert: 11, defPlus: 4, defMinus: 1 },
  { min: 2, max: 14, convert: 13, defPlus: 8, defMinus: 2 }, { min: 2, max: 15, convert: 17, defPlus: 13, defMinus: 3 },
  { min: 3, max: 17, convert: 22, defPlus: 20, defMinus: 5 }, { min: 4, max: 19, convert: 28, defPlus: 28, defMinus: 6 },
  { min: 5, max: 21, convert: 32, defPlus: 36, defMinus: 11 },
  // Water T1-T7
  { min: 3, max: 4, convert: 13, defPlus: 3, defMinus: 1 }, { min: 5, max: 6, convert: 15, defPlus: 6, defMinus: 1 },
  { min: 6, max: 8, convert: 17, defPlus: 11, defMinus: 3 }, { min: 7, max: 8, convert: 21, defPlus: 16, defMinus: 4 },
  { min: 8, max: 10, convert: 26, defPlus: 23, defMinus: 6 }, { min: 10, max: 13, convert: 32, defPlus: 32, defMinus: 10 },
  { min: 11, max: 15, convert: 38, defPlus: 40, defMinus: 15 },
  // Fire T1-T7
  { min: 2, max: 5, convert: 14, defPlus: 3, defMinus: 1 }, { min: 4, max: 7, convert: 16, defPlus: 6, defMinus: 1 },
  { min: 5, max: 9, convert: 19, defPlus: 10, defMinus: 2 }, { min: 6, max: 9, convert: 24, defPlus: 15, defMinus: 3 },
  { min: 7, max: 11, convert: 30, defPlus: 22, defMinus: 5 }, { min: 9, max: 14, convert: 37, defPlus: 31, defMinus: 9 },
  { min: 10, max: 16, convert: 44, defPlus: 39, defMinus: 14 },
  // Air T1-T7
  { min: 2, max: 6, convert: 11, defPlus: 3, defMinus: 1 }, { min: 3, max: 9, convert: 14, defPlus: 6, defMinus: 2 },
  { min: 4, max: 11, convert: 17, defPlus: 10, defMinus: 3 }, { min: 5, max: 11, convert: 22, defPlus: 16, defMinus: 5 },
  { min: 7, max: 12, convert: 28, defPlus: 23, defMinus: 7 }, { min: 8, max: 15, convert: 35, defPlus: 30, defMinus: 8 },
  { min: 9, max: 17, convert: 42, defPlus: 38, defMinus: 13 },
];

export const POWDERS: PowderSpec[] = RAW_STATS.map((raw, id) => {
  const elemIdx = (id / POWDER_TIERS) | 0;
  const tier = (id % POWDER_TIERS) + 1;
  const element = ELEMENTS[elemIdx];
  return {
    id,
    element,
    tier,
    label: `${ELEMENT_LABELS[element]} ${toRoman(tier)}`,
    short: `${ELEMENT_SHORT[element]}${tier}`,
    ...raw,
  };
});

export const POWDER_BY_ID = new Map(POWDERS.map((p) => [p.id, p]));

export function getPowdersByElement(element: PowderElement): PowderSpec[] {
  return POWDERS.filter((p) => p.element === element);
}

export const POWDERABLE_SLOTS: ReadonlySet<ItemSlot> = new Set([
  'helmet', 'chestplate', 'leggings', 'boots', 'weapon',
]);

function toRoman(n: number): string {
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][n - 1] ?? String(n);
}

/* ─── Powder application logic (mirrors WynnBuilder beta) ─── */

const ELEMENT_ORDER: PowderElement[] = ['earth', 'thunder', 'water', 'fire', 'air'];
const PREV_ELEMENT: Record<PowderElement, PowderElement> = {
  earth: 'air', thunder: 'earth', water: 'thunder', fire: 'water', air: 'fire',
};

export interface DamageRange {
  min: number;
  max: number;
}

export interface PowderedDamages {
  neutral: DamageRange;
  earth: DamageRange;
  thunder: DamageRange;
  water: DamageRange;
  fire: DamageRange;
  air: DamageRange;
}

function parseDamageRange(raw: unknown): DamageRange {
  if (typeof raw === 'string' && raw.includes('-')) {
    const [a, b] = raw.split('-').map(Number);
    return { min: a || 0, max: b || 0 };
  }
  return { min: 0, max: 0 };
}

/**
 * Apply weapon powders to base damages, following the beta WynnBuilder algorithm.
 * Powders convert a percentage of remaining neutral damage to elemental, plus flat bonuses.
 */
export function applyWeaponPowders(
  rawItem: Record<string, unknown>,
  powderIds: number[],
): PowderedDamages {
  const damages: [number, number][] = [
    [parseDamageRange(rawItem.nDam).min, parseDamageRange(rawItem.nDam).max],
    [parseDamageRange(rawItem.eDam).min, parseDamageRange(rawItem.eDam).max],
    [parseDamageRange(rawItem.tDam).min, parseDamageRange(rawItem.tDam).max],
    [parseDamageRange(rawItem.wDam).min, parseDamageRange(rawItem.wDam).max],
    [parseDamageRange(rawItem.fDam).min, parseDamageRange(rawItem.fDam).max],
    [parseDamageRange(rawItem.aDam).min, parseDamageRange(rawItem.aDam).max],
  ];

  const neutralRemaining = [damages[0][0], damages[0][1]];

  const applyOrder: number[] = [];
  const applyMap = new Map<number, { conv: number; min: number; max: number }>();

  for (const powderId of powderIds) {
    const powder = POWDER_BY_ID.get(powderId);
    if (!powder) continue;
    const elemIdx = ELEMENT_ORDER.indexOf(powder.element);
    const convRatio = powder.convert / 100;

    if (applyMap.has(elemIdx)) {
      const info = applyMap.get(elemIdx)!;
      info.conv += convRatio;
      info.min += powder.min;
      info.max += powder.max;
    } else {
      applyMap.set(elemIdx, { conv: convRatio, min: powder.min, max: powder.max });
      applyOrder.push(elemIdx);
    }
  }

  for (const elemIdx of applyOrder) {
    const info = applyMap.get(elemIdx)!;
    const minDiff = Math.min(neutralRemaining[0], info.conv * neutralRemaining[0]);
    const maxDiff = Math.min(neutralRemaining[1], info.conv * neutralRemaining[1]);
    neutralRemaining[0] -= minDiff;
    neutralRemaining[1] -= maxDiff;
    damages[elemIdx + 1][0] += minDiff;
    damages[elemIdx + 1][1] += maxDiff;
    damages[elemIdx + 1][0] += info.min;
    damages[elemIdx + 1][1] += info.max;
  }

  damages[0] = [neutralRemaining[0], neutralRemaining[1]];

  return {
    neutral: { min: Math.round(damages[0][0]), max: Math.round(damages[0][1]) },
    earth: { min: Math.round(damages[1][0]), max: Math.round(damages[1][1]) },
    thunder: { min: Math.round(damages[2][0]), max: Math.round(damages[2][1]) },
    water: { min: Math.round(damages[3][0]), max: Math.round(damages[3][1]) },
    fire: { min: Math.round(damages[4][0]), max: Math.round(damages[4][1]) },
    air: { min: Math.round(damages[5][0]), max: Math.round(damages[5][1]) },
  };
}

export interface PowderedDefenses {
  earth: number;
  thunder: number;
  water: number;
  fire: number;
  air: number;
}

/**
 * Calculate armor defense deltas from powders.
 * Each powder adds defPlus to its element and subtracts defMinus from the previous element in ETWFA cycle.
 */
export function getArmorPowderDefenseDeltas(powderIds: number[]): PowderedDefenses {
  const deltas: PowderedDefenses = { earth: 0, thunder: 0, water: 0, fire: 0, air: 0 };
  for (const powderId of powderIds) {
    const powder = POWDER_BY_ID.get(powderId);
    if (!powder) continue;
    deltas[powder.element] += powder.defPlus;
    deltas[PREV_ELEMENT[powder.element]] -= powder.defMinus;
  }
  return deltas;
}
