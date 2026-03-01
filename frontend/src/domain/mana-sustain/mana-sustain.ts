import type { ManaSustainInput, ManaSustainResult } from './types';

/** Base mana regen added by game (wynnmana uses mr+25) */
const BASE_MR = 25;

/**
 * Mana gain per second from regen and steal.
 * Formula from wynnmana: (MR+25)/5 + MS/3
 */
export function manaGainPerSecond(mr: number, ms: number): number {
  return (mr + BASE_MR) / 5 + ms / 3;
}

/**
 * Apply repeat penalty: consecutive same spell in cycle adds +5 per repeat, min cost 1.
 * Returns array of costs for each position in the cycle (cycle is rotated so first !== last for wrap).
 */
function computeCycleCosts(cycle: Array<[number, number]>): number[] {
  if (cycle.length === 0) return [];

  // Rotate so first spell !== last (wrap-around repeat handled at end)
  let rotated = [...cycle];
  while (rotated.length > 1 && rotated[0][1] === rotated[rotated.length - 1][1]) {
    rotated = [rotated.pop()!, ...rotated];
  }

  const cycleCost: number[] = [];
  let repeat = 0;

  for (let i = 0; i < rotated.length; i++) {
    const [baseCost, spellIndex] = rotated[i];
    const cost = Math.max(1, baseCost);

    if (i < 2) {
      cycleCost.push(cost <= 1 ? 1 : cost);
      continue;
    }

    const prev1 = rotated[i - 1][1];
    const prev2 = rotated[i - 2][1];
    if (prev1 === prev2 && prev1 === spellIndex) {
      repeat++;
      const penalized = cost + repeat * 5;
      cycleCost.push(penalized <= 1 ? 1 : penalized);
    } else {
      repeat = 0;
      cycleCost.push(cost <= 1 ? 1 : cost);
    }
  }

  // Wrap: if last === second-to-last, add repeat to first slot
  const n = rotated.length;
  if (n >= 2 && rotated[n - 1][1] === rotated[n - 2][1]) {
    repeat++;
    const firstBase = Math.max(1, rotated[0][0]);
    if (firstBase + repeat * 5 > 1) {
      cycleCost[0] = cycleCost[0] + repeat * 5;
    }
  }

  return cycleCost;
}

/**
 * Build cycle as [cost, spellIndex] from sequence and spell costs.
 * Invalid indices (not 1-4) or missing cost are skipped / use 1.
 */
function buildCycle(sequence: number[], spellCosts: Record<number, number>): Array<[number, number]> {
  return sequence
    .filter((idx) => idx >= 1 && idx <= 4)
    .map((idx) => {
      const cost = spellCosts[idx] ?? 1;
      return [cost, idx] as [number, number];
    });
}

/**
 * Compute sustained mana metrics and spell DPS from build + user inputs.
 */
export function computeManaSustain(input: ManaSustainInput): ManaSustainResult | null {
  const { spellCosts, spellDamages, mr, ms, cps, spellSequence } = input;

  if (spellSequence.length === 0 || cps <= 0) {
    return null;
  }

  const cycle = buildCycle(spellSequence, spellCosts);
  if (cycle.length === 0) return null;

  const cycleCosts = computeCycleCosts(cycle);
  const cycleLength = cycleCosts.length;
  const avgCycleCost = cycleCosts.reduce((a, b) => a + b, 0) / cycleLength;

  // Spells per second: each spell = 3 clicks
  const spellsPerSecond = cps / 3;
  const manaUsagePerSecond = spellsPerSecond * avgCycleCost;
  const manaGainPerSec = manaGainPerSecond(mr, ms);
  const netManaPerSecond = manaGainPerSec - manaUsagePerSecond;

  // Sustained spell DPS: average damage per spell in cycle * spells per second
  let cycleDamage = 0;
  for (const [, spellIndex] of cycle) {
    cycleDamage += spellDamages[spellIndex] ?? 0;
  }
  const avgDamagePerSpell = cycleDamage / cycleLength;
  const sustainedSpellDps = avgDamagePerSpell * spellsPerSecond;

  return {
    manaGainPerSecond: manaGainPerSec,
    manaUsagePerSecond,
    netManaPerSecond,
    sustainedSpellDps,
    cycleCosts,
    spellsPerSecond,
    sustainable: netManaPerSecond >= 0,
  };
}
