import { describe, expect, it } from 'vitest';
import { runAutoBuildBeamSearch } from '@/domain/autobuilder/beam-search';
import { DEFAULT_AUTO_BUILD_CONSTRAINTS } from '@/domain/autobuilder/types';
import { createInitialWorkbenchSnapshot } from '@/domain/build/workbench-state';
import { makeTestCatalog, rawItem } from '@/tests/helpers';

describe('autobuilder beam search', () => {
  const catalog = makeTestCatalog([
    rawItem({ id: 1, name: 'Helm A', type: 'helmet', lvl: 100, hpBonus: 1000, sdPct: 10 }),
    rawItem({ id: 2, name: 'Helm B', type: 'helmet', lvl: 100, hpBonus: 100, sdPct: 40 }),
    rawItem({ id: 3, name: 'Chest A', type: 'chestplate', lvl: 100, hpBonus: 900 }),
    rawItem({ id: 4, name: 'Leg A', type: 'leggings', lvl: 100, hpBonus: 850 }),
    rawItem({ id: 5, name: 'Boot A', type: 'boots', lvl: 100, spd: 30 }),
    rawItem({ id: 6, name: 'Ring A', type: 'ring', lvl: 100, sdPct: 15 }),
    rawItem({ id: 7, name: 'Ring B', type: 'ring', lvl: 100, hpBonus: 500 }),
    rawItem({ id: 8, name: 'Brace A', type: 'bracelet', lvl: 100, sdRaw: 120 }),
    rawItem({ id: 9, name: 'Neck A', type: 'necklace', lvl: 100, hpBonus: 700 }),
    rawItem({ id: 10, name: 'Weapon A', type: 'wand', lvl: 100, averageDps: 4500, classReq: 'Mage' }),
    rawItem({ id: 11, name: 'Weapon B', type: 'wand', lvl: 100, averageDps: 3800, hpBonus: 1200, classReq: 'Mage' }),
  ]);

  it('returns deterministic top candidates for a fixed dataset', () => {
    const base = createInitialWorkbenchSnapshot();
    base.characterClass = 'Mage';
    base.level = 106;

    const constraints = {
      ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
      characterClass: 'Mage' as const,
      level: 106,
      topN: 5,
      topKPerSlot: 10,
      beamWidth: 120,
      weights: {
        ...DEFAULT_AUTO_BUILD_CONSTRAINTS.weights,
        dpsProxy: 1.2,
        ehpProxy: 0.4,
      },
    };

    const results = runAutoBuildBeamSearch({
      catalog,
      baseWorkbench: base,
      constraints,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].slots.weapon).toBe(10);
    expect(results[0].score).toBeGreaterThanOrEqual(results[results.length - 1].score);
  });

  it('keeps low-rough support gear in the search order for high-requirement must-includes (warp-like case)', () => {
    const helmets = Array.from({ length: 11 }, (_, index) =>
      rawItem({
        id: 100 + index,
        name: `Distractor Helm ${index + 1}`,
        type: 'helmet',
        lvl: 100,
        hpBonus: 2500 - index * 50,
        sdPct: 25 - index,
      }),
    );
    const supportHelmet = rawItem({
      id: 199,
      name: 'Agi Support Helm',
      type: 'helmet',
      lvl: 100,
      agi: 30,
      hpBonus: 50,
      sdPct: 0,
    });

    const warpLikeCatalog = makeTestCatalog([
      ...helmets,
      supportHelmet,
      rawItem({ id: 210, name: 'Chest Filler', type: 'chestplate', lvl: 100 }),
      rawItem({ id: 220, name: 'Legs Filler', type: 'leggings', lvl: 100 }),
      rawItem({ id: 230, name: 'Boots Filler', type: 'boots', lvl: 100 }),
      rawItem({ id: 240, name: 'Ring Filler', type: 'ring', lvl: 100 }),
      rawItem({ id: 250, name: 'Bracelet Filler', type: 'bracelet', lvl: 100 }),
      rawItem({ id: 260, name: 'Necklace Filler', type: 'necklace', lvl: 100 }),
      rawItem({
        id: 1729,
        name: 'Warp-Like',
        type: 'wand',
        lvl: 99,
        classReq: 'mage', // lowercase mirrors compress.json
        averageDps: 500,
        agiReq: 125,
      }),
    ]);

    const base = createInitialWorkbenchSnapshot();
    base.characterClass = 'Mage';
    base.level = 106;

    const constraints = {
      ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
      characterClass: 'Mage' as const,
      level: 106,
      mustIncludeIds: [1729],
      topN: 5,
      topKPerSlot: 12,
      beamWidth: 80,
      maxStates: 120, // still branch-capped, but enough to let support-aware rescue recover
      useExhaustiveSmallPool: false,
      exhaustiveStateLimit: 1,
    };

    const results = runAutoBuildBeamSearch({
      catalog: warpLikeCatalog,
      baseWorkbench: base,
      constraints,
    });

    expect(warpLikeCatalog.itemsById.get(1729)?.classReq).toBe('Mage');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].slots.weapon).toBe(1729);
    expect(results[0].slots.helmet).toBe(199);
    expect(results[0].summary.derived.skillpointFeasible).toBe(true);
  });
});
