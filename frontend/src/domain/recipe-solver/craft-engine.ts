import type {
  NormalizedRecipe,
  NormalizedIngredient,
  CraftedItemStats,
  CraftedCategory,
  CraftedAtkSpd,
} from '@/domain/recipe-solver/types';
import { getCraftedCategory, NO_INGREDIENT_ID } from '@/domain/recipe-solver/types';

const TIER_TO_MULT = [0, 1, 1.25, 1.4] as const;

const SKP_ELEMENTS = ['e', 't', 'w', 'f', 'a'] as const;

const POWDER_STATS: Array<{ min: number; max: number; convert: number; defPlus: number; defMinus: number }> = [
  { min: 3, max: 6, convert: 17, defPlus: 2, defMinus: 1 }, { min: 5, max: 8, convert: 21, defPlus: 4, defMinus: 2 },
  { min: 6, max: 10, convert: 25, defPlus: 8, defMinus: 3 }, { min: 7, max: 10, convert: 31, defPlus: 14, defMinus: 5 },
  { min: 9, max: 11, convert: 38, defPlus: 22, defMinus: 9 }, { min: 11, max: 13, convert: 46, defPlus: 30, defMinus: 13 },
  { min: 1, max: 8, convert: 9, defPlus: 3, defMinus: 1 }, { min: 1, max: 12, convert: 11, defPlus: 5, defMinus: 1 },
  { min: 2, max: 15, convert: 13, defPlus: 9, defMinus: 2 }, { min: 3, max: 15, convert: 17, defPlus: 14, defMinus: 4 },
  { min: 4, max: 17, convert: 22, defPlus: 20, defMinus: 7 }, { min: 5, max: 20, convert: 28, defPlus: 28, defMinus: 10 },
  { min: 3, max: 4, convert: 13, defPlus: 3, defMinus: 1 }, { min: 4, max: 6, convert: 15, defPlus: 6, defMinus: 1 },
  { min: 5, max: 8, convert: 17, defPlus: 11, defMinus: 2 }, { min: 6, max: 8, convert: 21, defPlus: 18, defMinus: 4 },
  { min: 7, max: 10, convert: 26, defPlus: 28, defMinus: 7 }, { min: 9, max: 11, convert: 32, defPlus: 40, defMinus: 10 },
  { min: 2, max: 5, convert: 14, defPlus: 3, defMinus: 1 }, { min: 4, max: 8, convert: 16, defPlus: 5, defMinus: 2 },
  { min: 5, max: 9, convert: 19, defPlus: 9, defMinus: 3 }, { min: 6, max: 9, convert: 24, defPlus: 16, defMinus: 5 },
  { min: 8, max: 10, convert: 30, defPlus: 25, defMinus: 9 }, { min: 10, max: 12, convert: 37, defPlus: 36, defMinus: 13 },
  { min: 2, max: 6, convert: 11, defPlus: 3, defMinus: 1 }, { min: 3, max: 10, convert: 14, defPlus: 6, defMinus: 2 },
  { min: 4, max: 11, convert: 17, defPlus: 10, defMinus: 3 }, { min: 5, max: 11, convert: 22, defPlus: 16, defMinus: 5 },
  { min: 7, max: 12, convert: 28, defPlus: 24, defMinus: 9 }, { min: 8, max: 14, convert: 35, defPlus: 34, defMinus: 13 },
];

function powderElement(pid: number): number {
  return (pid / 6) | 0;
}

function powderElementChar(pid: number): string {
  return SKP_ELEMENTS[powderElement(pid)];
}

/**
 * Compute the 3x2 effectiveness grid given 6 ingredients.
 * Returns a flat array of 6 effectiveness values (one per slot).
 */
export function computeEffectiveness(ingredients: NormalizedIngredient[]): number[] {
  const eff: number[][] = [[100, 100], [100, 100], [100, 100]];

  for (let n = 0; n < 6; n++) {
    const ingred = ingredients[n];
    const pm = ingred.posMods;
    const i = Math.floor(n / 2);
    const j = n % 2;

    if (pm.above !== 0) {
      for (let k = i - 1; k >= 0; k--) {
        eff[k][j] += pm.above;
      }
    }
    if (pm.under !== 0) {
      for (let k = i + 1; k < 3; k++) {
        eff[k][j] += pm.under;
      }
    }
    if (pm.left !== 0 && j === 1) {
      eff[i][j - 1] += pm.left;
    }
    if (pm.right !== 0 && j === 0) {
      eff[i][j + 1] += pm.right;
    }
    if (pm.touching !== 0) {
      for (let k = 0; k < 3; k++) {
        for (let l = 0; l < 2; l++) {
          if ((Math.abs(k - i) === 1 && l === j) || (k === i && Math.abs(l - j) === 1)) {
            eff[k][l] += pm.touching;
          }
        }
      }
    }
    if (pm.notTouching !== 0) {
      for (let k = 0; k < 3; k++) {
        for (let l = 0; l < 2; l++) {
          if (Math.abs(k - i) > 1 || (Math.abs(k - i) === 1 && Math.abs(l - j) === 1)) {
            eff[k][l] += pm.notTouching;
          }
        }
      }
    }
  }

  return eff.flat();
}

/**
 * Compute the full crafted item stats given recipe, materials, ingredients, and attack speed.
 */
export function computeCraftedStats(
  recipe: NormalizedRecipe,
  matTiers: [number, number],
  ingredients: NormalizedIngredient[],
  atkSpd: CraftedAtkSpd,
): CraftedItemStats {
  const type = recipe.type.toLowerCase();
  const category: CraftedCategory = getCraftedCategory(type);

  let allNone = true;
  for (const ing of ingredients) {
    if (ing.id !== NO_INGREDIENT_ID) {
      allNone = false;
      break;
    }
  }

  // Powder slots / charges based on recipe minimum level
  let slots = 0;
  let charges = 0;
  if (category === 'weapon' || category === 'armor') {
    if (recipe.lvl[0] < 30) slots = 1;
    else if (recipe.lvl[0] < 70) slots = 2;
    else slots = 3;
  }
  if (category === 'consumable') {
    if (recipe.lvl[0] < 30) charges = 1;
    else if (recipe.lvl[0] < 70) charges = 2;
    else charges = 3;
    if (allNone) charges = 3;
  }

  // Material multiplier
  const amounts = recipe.materials.map(m => m.amount);
  const matmult = (TIER_TO_MULT[matTiers[0]] * amounts[0] + TIER_TO_MULT[matTiers[1]] * amounts[1])
    / (amounts[0] + amounts[1]);

  // Initialize duration/durability from recipe
  let durability: [number, number] = [recipe.durability[0], recipe.durability[1]];
  let duration: [number, number] = [recipe.duration[0], recipe.duration[1]];

  if (category === 'consumable') {
    if (allNone) {
      duration = [recipe.basicDuration[0], recipe.basicDuration[1]];
    }
    duration = [Math.round(duration[0] * matmult), Math.round(duration[1] * matmult)];
  } else {
    durability = [Math.round(durability[0] * matmult), Math.round(durability[1] * matmult)];
  }

  // Base health/damage
  const baseLow = recipe.healthOrDamage[0];
  const baseHigh = recipe.healthOrDamage[1];
  let hp = 0;
  let hpLow = 0;
  let nDam = '0-0';
  let nDamLow = '0-0';
  const elemDef: Record<string, number> = { e: 0, t: 0, w: 0, f: 0, a: 0 };

  if (category === 'armor') {
    hp = Math.floor(baseHigh * matmult);
    hpLow = Math.floor(baseLow * matmult);
  } else if (category === 'weapon') {
    let ratio = 2.05;
    if (atkSpd === 'SLOW') ratio /= 1.5;
    else if (atkSpd === 'NORMAL') ratio = 1;
    else if (atkSpd === 'FAST') ratio /= 2.5;

    const nDamBaseLow = Math.floor(Math.floor(baseLow * matmult) * ratio);
    const nDamBaseHigh = Math.floor(Math.floor(baseHigh * matmult) * ratio);

    nDamLow = `${Math.floor(nDamBaseLow * 0.9)}-${Math.floor(nDamBaseLow * 1.1)}`;
    nDam = `${Math.floor(nDamBaseHigh * 0.9)}-${Math.floor(nDamBaseHigh * 1.1)}`;
  } else if (category === 'consumable' && allNone) {
    hp = Math.floor(baseHigh * matmult);
    hpLow = Math.floor(baseLow * matmult);
  }

  // Apply armor/accessory powder defense from powder ingredients
  if (category === 'armor' || category === 'accessory') {
    for (const ingred of ingredients) {
      if (ingred.isPowder && ingred.pid != null) {
        const powder = POWDER_STATS[ingred.pid];
        const elemChar = powderElementChar(ingred.pid);
        const oppositeChar = SKP_ELEMENTS[(SKP_ELEMENTS.indexOf(elemChar as typeof SKP_ELEMENTS[number]) + 4) % 5];
        elemDef[elemChar] = (elemDef[elemChar] || 0) + powder.defPlus;
        elemDef[oppositeChar] = (elemDef[oppositeChar] || 0) - powder.defMinus;
      }
    }
  }

  // Compute effectiveness grid
  const effFlat = computeEffectiveness(ingredients);

  // Accumulate ingredient stats
  const reqs = [0, 0, 0, 0, 0];
  const maxRolls: Record<string, number> = {};
  const minRolls: Record<string, number> = {};

  for (let n = 0; n < 6; n++) {
    const ingred = ingredients[n];
    const effMult = effFlat[n] / 100;

    // Apply itemIDs (requirements and durability)
    const iids = ingred.itemIDs;
    if (category !== 'consumable') {
      const reqKeys = ['strReq', 'dexReq', 'intReq', 'defReq', 'agiReq'] as const;
      for (let ri = 0; ri < reqKeys.length; ri++) {
        const val = iids[reqKeys[ri]];
        if (val !== 0) {
          if (!ingred.isPowder) {
            reqs[ri] += Math.round(val * effMult);
          } else {
            reqs[ri] += Math.round(val);
          }
        }
      }
    }
    // Durability (not affected by effectiveness)
    if (iids.dura !== 0) {
      durability[0] += iids.dura;
      durability[1] += iids.dura;
    }

    // Apply consumableIDs (not affected by effectiveness)
    if (ingred.consumableIDs.dura !== 0) {
      duration[0] += ingred.consumableIDs.dura;
      duration[1] += ingred.consumableIDs.dura;
    }
    if (ingred.consumableIDs.charges !== 0) {
      charges += ingred.consumableIDs.charges;
    }

    // Apply rolled stat IDs
    for (const [key, range] of Object.entries(ingred.ids)) {
      if (range.max === 0 && range.min === 0) continue;
      let rollMin = range.min;
      let rollMax = range.max;
      const sorted = [Math.floor(rollMin * effMult), Math.floor(rollMax * effMult)].sort((a, b) => a - b);
      rollMin = sorted[0];
      rollMax = sorted[1];
      minRolls[key] = (minRolls[key] ?? 0) + rollMin;
      maxRolls[key] = (maxRolls[key] ?? 0) + rollMax;
    }
  }

  // Clamp durability, duration, charges
  durability[0] = Math.max(1, Math.floor(durability[0]));
  durability[1] = Math.max(1, Math.floor(durability[1]));
  if (!allNone) {
    duration[0] = Math.max(10, duration[0]);
    duration[1] = Math.max(10, duration[1]);
  }
  charges = Math.max(charges, category === 'consumable' ? 1 : 0);

  // Build element damage strings (all zero for non-weapons without powders)
  const eDam = '0-0', tDam = '0-0', wDam = '0-0', fDam = '0-0', aDam = '0-0';

  return {
    category,
    type,
    lvl: recipe.lvl[1],
    hp,
    hpLow,
    nDam,
    nDamLow,
    eDam, tDam, wDam, fDam, aDam,
    eDef: elemDef.e,
    tDef: elemDef.t,
    wDef: elemDef.w,
    fDef: elemDef.f,
    aDef: elemDef.a,
    atkSpd,
    durability,
    duration,
    charges,
    slots,
    reqs: [reqs[0], reqs[1], reqs[2], reqs[3], reqs[4]],
    effectiveness: effFlat,
    maxRolls,
    minRolls,
  };
}

/**
 * Encode a crafted item into a CR-... hash string (version 2 encoding).
 *
 * Uses LSB-first bit storage to match WynnBuilder's BitVector implementation:
 * append(value, length) stores the LSB of value at the lowest bit index,
 * and toB64() reads 6 bits at a time with the lowest-index bit as the LSB
 * of the 6-bit Base64 value.
 */
export function encodeCraftHash(
  ingredientIds: number[],
  recipeId: number,
  matTiers: [number, number],
  atkSpd: CraftedAtkSpd,
  category: CraftedCategory,
): string {
  const ATK_SPD_MAP: Record<string, number> = { SLOW: 0, NORMAL: 1, FAST: 2 };

  const words: number[] = [0];
  let totalBits = 0;

  function append(value: number, count: number) {
    for (let i = 0; i < count; i++) {
      const bit = (value >>> i) & 1;
      const pos = totalBits + i;
      const wordIdx = pos >>> 5;
      while (wordIdx >= words.length) words.push(0);
      if (bit) words[wordIdx] |= 1 << (pos & 31);
    }
    totalBits += count;
  }

  append(0, 1);   // Legacy flag = 0
  append(2, 7);   // Version = 2
  for (const id of ingredientIds) append(id, 12);
  append(recipeId, 12);
  append(matTiers[0] - 1, 3);
  append(matTiers[1] - 1, 3);
  if (category === 'weapon') {
    append(ATK_SPD_MAP[atkSpd] ?? 0, 4);
  }

  // Pad to multiple of 6
  const rem = totalBits % 6;
  if (rem !== 0) append(0, 6 - rem);

  // Convert to Base64 (6 bits at a time, LSB = lowest index)
  const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+-';
  let result = '';
  for (let i = 0; i < totalBits; i += 6) {
    let val = 0;
    for (let j = 0; j < 6; j++) {
      const pos = i + j;
      if (pos < totalBits) {
        val |= ((words[pos >>> 5] >>> (pos & 31)) & 1) << j;
      }
    }
    result += B64[val];
  }

  return 'CR-' + result;
}
