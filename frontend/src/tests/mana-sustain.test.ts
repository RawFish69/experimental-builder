import { describe, expect, it } from 'vitest';
import { computeManaSustain, manaGainPerSecond } from '@/domain/mana-sustain';

describe('mana-sustain', () => {
  it('computes mana gain per second as (mr+25)/5 + ms/3', () => {
    expect(manaGainPerSecond(0, 0)).toBe(25 / 5 + 0); // 5
    expect(manaGainPerSecond(25, 0)).toBe(50 / 5 + 0); // 10
    expect(manaGainPerSecond(0, 30)).toBe(25 / 5 + 30 / 3); // 5 + 10 = 15
  });

  it('returns null for empty sequence or zero cps', () => {
    expect(
      computeManaSustain({
        spellCosts: { 1: 10 },
        spellDamages: { 1: 100 },
        mr: 0,
        ms: 0,
        cps: 8,
        spellSequence: [],
      }),
    ).toBeNull();
    expect(
      computeManaSustain({
        spellCosts: { 1: 10 },
        spellDamages: { 1: 100 },
        mr: 0,
        ms: 0,
        cps: 0,
        spellSequence: [1],
      }),
    ).toBeNull();
  });

  it('computes single-spell cycle without repeat penalty', () => {
    const r = computeManaSustain({
      spellCosts: { 1: 10 },
      spellDamages: { 1: 1000 },
      mr: 5,
      ms: 0,
      cps: 9,
      spellSequence: [1],
    });
    expect(r).not.toBeNull();
    if (!r) return;
    // Mana gain = (5+25)/5 = 6
    expect(r.manaGainPerSecond).toBe(6);
    // Spells/s = 9/3 = 3, cost 10 each -> usage 30
    expect(r.manaUsagePerSecond).toBeCloseTo(30);
    expect(r.netManaPerSecond).toBeCloseTo(6 - 30);
    expect(r.sustainable).toBe(false);
    expect(r.spellsPerSecond).toBe(3);
    expect(r.sustainedSpellDps).toBe(3000);
    expect(r.cycleCosts).toEqual([10]);
  });

  it('applies repeat penalty for consecutive same spell', () => {
    const r = computeManaSustain({
      spellCosts: { 1: 10 },
      spellDamages: { 1: 100 },
      mr: 0,
      ms: 0,
      cps: 6,
      spellSequence: [1, 1, 1],
    });
    expect(r).not.toBeNull();
    if (!r) return;
    // Cycle costs: first 10, second 10, third 10+5=15. Avg = 35/3
    expect(r.cycleCosts.length).toBe(3);
    expect(r.cycleCosts[0]).toBe(10);
    expect(r.cycleCosts[1]).toBe(10);
    expect(r.cycleCosts[2]).toBe(15);
    expect(r.manaUsagePerSecond).toBeCloseTo((6 / 3) * (35 / 3));
  });

  it('sustained DPS uses average damage per spell in cycle', () => {
    const r = computeManaSustain({
      spellCosts: { 1: 5, 2: 5 },
      spellDamages: { 1: 100, 2: 200 },
      mr: 100,
      ms: 0,
      cps: 6,
      spellSequence: [1, 2],
    });
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.spellsPerSecond).toBe(2);
    expect(r.sustainedSpellDps).toBe((100 + 200) / 2 * 2); // 300
  });
});
