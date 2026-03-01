export interface ManaSustainInput {
  /** base_spell (1-4) -> final mana cost */
  spellCosts: Record<number, number>;
  /** base_spell (1-4) -> avg damage for sustained DPS */
  spellDamages: Record<number, number>;
  /** Mana regen from items (engine adds base 25) */
  mr: number;
  /** Mana steal from items */
  ms: number;
  /** Clicks per second (user input); each spell = 3 clicks */
  cps: number;
  /** Spell sequence, e.g. [1, 2, 3, 4]; indices are base_spell 1-4 */
  spellSequence: number[];
}

export interface ManaSustainResult {
  manaGainPerSecond: number;
  manaUsagePerSecond: number;
  netManaPerSecond: number;
  sustainedSpellDps: number;
  /** Per-spell-in-cycle cost after repeat penalty */
  cycleCosts: number[];
  spellsPerSecond: number;
  sustainable: boolean;
}
