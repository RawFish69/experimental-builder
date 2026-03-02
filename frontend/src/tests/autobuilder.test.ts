import { describe, expect, it } from 'vitest';
import { runAutoBuildBeamSearch } from '@/domain/autobuilder/beam-search';
import { DEFAULT_AUTO_BUILD_CONSTRAINTS } from '@/domain/autobuilder/types';
import { createInitialWorkbenchSnapshot } from '@/domain/build/workbench-state';
import { makeTestCatalog, rawItem } from '@/tests/helpers';

describe('autobuilder beam search', () => {
  const attackSpeedOrder = ['SUPER_SLOW', 'VERY_SLOW', 'SLOW', 'NORMAL', 'FAST', 'VERY_FAST', 'SUPER_FAST'] as const;
  const finalAttackSpeed = (
    result: ReturnType<typeof runAutoBuildBeamSearch>[number],
    catalogRef: ReturnType<typeof makeTestCatalog>,
  ) => {
    const weaponId = result.slots.weapon;
    const weapon = weaponId != null ? catalogRef.itemsById.get(weaponId) : null;
    if (!weapon) return null;
    const baseIndex = attackSpeedOrder.indexOf(weapon.atkSpd as (typeof attackSpeedOrder)[number]);
    if (baseIndex < 0) return null;
    let atkTier = 0;
    for (const slotId of Object.values(result.slots)) {
      if (slotId == null) continue;
      atkTier += Math.round(catalogRef.itemsById.get(slotId)?.numeric.atkTier ?? 0);
    }
    return attackSpeedOrder[Math.max(0, Math.min(6, baseIndex + atkTier))];
  };
  const totalAtkTier = (
    result: ReturnType<typeof runAutoBuildBeamSearch>[number],
    catalogRef: ReturnType<typeof makeTestCatalog>,
  ) => {
    let total = 0;
    for (const slotId of Object.values(result.slots)) {
      if (slotId == null) continue;
      total += Math.round(catalogRef.itemsById.get(slotId)?.numeric.atkTier ?? 0);
    }
    return total;
  };

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

  it('treats min thresholds as hard constraints on final candidates', () => {
    const thresholdCatalog = makeTestCatalog([
      rawItem({ id: 1, name: 'Helm', type: 'helmet', lvl: 100 }),
      rawItem({ id: 2, name: 'Chest', type: 'chestplate', lvl: 100 }),
      rawItem({ id: 3, name: 'Legs', type: 'leggings', lvl: 100 }),
      rawItem({ id: 4, name: 'Boots Fast', type: 'boots', lvl: 100, spd: 40 }),
      rawItem({ id: 5, name: 'Boots Tanky', type: 'boots', lvl: 100, hpBonus: 5000, spd: 0 }),
      rawItem({ id: 6, name: 'Ring', type: 'ring', lvl: 100 }),
      rawItem({ id: 7, name: 'Brace', type: 'bracelet', lvl: 100 }),
      rawItem({ id: 8, name: 'Neck', type: 'necklace', lvl: 100 }),
      rawItem({ id: 9, name: 'Weapon', type: 'wand', lvl: 100, classReq: 'Mage', averageDps: 1500 }),
    ]);

    const base = createInitialWorkbenchSnapshot();
    base.characterClass = 'Mage';
    base.level = 106;

    const results = runAutoBuildBeamSearch({
      catalog: thresholdCatalog,
      baseWorkbench: base,
      constraints: {
        ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
        characterClass: 'Mage' as const,
        level: 106,
        topN: 10,
        topKPerSlot: 20,
        beamWidth: 200,
        target: {
          minSpeed: 20,
        },
      },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((candidate) => candidate.summary.aggregated.speed >= 20)).toBe(true);
    expect(results.every((candidate) => candidate.slots.boots === 4)).toBe(true);
  });

  it('enforces advanced custom ID min/max thresholds on final builds', () => {
    const customThresholdCatalog = makeTestCatalog([
      rawItem({ id: 1, name: 'Poison Helm', type: 'helmet', lvl: 100, poison: 500, hpBonus: 50 }),
      rawItem({ id: 2, name: 'Clean Helm', type: 'helmet', lvl: 100, poison: 0, sdPct: 60 }),
      rawItem({ id: 3, name: 'Chest', type: 'chestplate', lvl: 100 }),
      rawItem({ id: 4, name: 'Legs', type: 'leggings', lvl: 100 }),
      rawItem({ id: 5, name: 'Boots', type: 'boots', lvl: 100 }),
      rawItem({ id: 6, name: 'Ring A', type: 'ring', lvl: 100 }),
      rawItem({ id: 7, name: 'Ring B', type: 'ring', lvl: 100 }),
      rawItem({ id: 8, name: 'Brace', type: 'bracelet', lvl: 100 }),
      rawItem({ id: 9, name: 'Neck', type: 'necklace', lvl: 100 }),
      rawItem({ id: 10, name: 'Weapon', type: 'wand', lvl: 100, classReq: 'Mage', averageDps: 1200 }),
    ]);

    const base = createInitialWorkbenchSnapshot();
    base.characterClass = 'Mage';
    base.level = 106;
    base.slots.weapon = 10;
    base.locks.weapon = true;

    const results = runAutoBuildBeamSearch({
      catalog: customThresholdCatalog,
      baseWorkbench: base,
      constraints: {
        ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
        characterClass: 'Mage' as const,
        level: 106,
        topN: 5,
        topKPerSlot: 20,
        beamWidth: 120,
        target: {
          customNumericRanges: [
            // After switching item stats to max-roll space, poison 500 becomes ~650.
            { key: 'poison', min: 600 },
            { key: 'poison', max: 800 },
          ],
        },
      },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((candidate) => candidate.slots.helmet === 1)).toBe(true);
  });

  it('enforces final weapon attack speed constraint using total atkTier (not just base weapon speed)', () => {
    const speedCatalog = makeTestCatalog([
      rawItem({ id: 1, name: 'Atk Tier Helm', type: 'helmet', lvl: 100, atkTier: 4, hpBonus: 0 }),
      rawItem({ id: 2, name: 'Greedy Helm', type: 'helmet', lvl: 100, hpBonus: 3000, atkTier: 0 }),
      rawItem({ id: 3, name: 'Chest', type: 'chestplate', lvl: 100 }),
      rawItem({ id: 4, name: 'Legs', type: 'leggings', lvl: 100 }),
      rawItem({ id: 5, name: 'Boots', type: 'boots', lvl: 100 }),
      rawItem({ id: 6, name: 'Ring', type: 'ring', lvl: 100 }),
      rawItem({ id: 7, name: 'Brace', type: 'bracelet', lvl: 100 }),
      rawItem({ id: 8, name: 'Neck', type: 'necklace', lvl: 100 }),
      rawItem({ id: 9, name: 'Alkatraz-Like', type: 'wand', lvl: 100, classReq: 'Mage', atkSpd: 'SLOW', averageDps: 4000 }),
    ]);

    const base = createInitialWorkbenchSnapshot();
    base.characterClass = 'Mage';
    base.level = 106;
    base.slots.weapon = 9;
    base.locks.weapon = true;

    const results = runAutoBuildBeamSearch({
      catalog: speedCatalog,
      baseWorkbench: base,
      constraints: {
        ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
        characterClass: 'Mage' as const,
        level: 106,
        topN: 10,
        topKPerSlot: 20,
        beamWidth: 200,
        weaponAttackSpeeds: ['SUPER_FAST'],
      },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((candidate) => candidate.slots.weapon === 9)).toBe(true);
    expect(results.every((candidate) => finalAttackSpeed(candidate, speedCatalog) === 'SUPER_FAST')).toBe(true);
    expect(results.every((candidate) => candidate.slots.helmet === 1)).toBe(true);
  });

  it('prefers higher-damage options once the target attack speed is already satisfied', () => {
    const overkillHelmets = Array.from({ length: 24 }, (_, index) =>
      rawItem({
        id: 300 + index,
        name: `Overkill Speed Helm ${index + 1}`,
        type: 'helmet',
        lvl: 100,
        atkTier: 4,
        hpBonus: 0,
        sdPct: 0,
      }),
    );
    const exactSpeedDamageHelm = rawItem({
      id: 399,
      name: 'Exact Speed Damage Helm',
      type: 'helmet',
      lvl: 100,
      atkTier: 1,
      sdPct: 120,
      sdRaw: 350,
    });

    const catalog = makeTestCatalog([
      ...overkillHelmets,
      exactSpeedDamageHelm,
      rawItem({ id: 401, name: 'Locked Chest', type: 'chestplate', lvl: 100 }),
      rawItem({ id: 402, name: 'Locked Legs', type: 'leggings', lvl: 100 }),
      rawItem({ id: 403, name: 'Locked Boots', type: 'boots', lvl: 100 }),
      rawItem({ id: 404, name: 'Locked Ring 1', type: 'ring', lvl: 100 }),
      rawItem({ id: 405, name: 'Locked Ring 2', type: 'ring', lvl: 100 }),
      rawItem({ id: 406, name: 'Locked Bracelet', type: 'bracelet', lvl: 100 }),
      rawItem({ id: 407, name: 'Locked Necklace', type: 'necklace', lvl: 100 }),
      rawItem({
        id: 408,
        name: 'Very Fast Weapon',
        type: 'wand',
        lvl: 100,
        classReq: 'Mage',
        atkSpd: 'VERY_FAST',
        averageDps: 4200,
      }),
    ]);

    const base = createInitialWorkbenchSnapshot();
    base.characterClass = 'Mage';
    base.level = 106;
    base.slots.weapon = 408;
    base.slots.chestplate = 401;
    base.slots.leggings = 402;
    base.slots.boots = 403;
    base.slots.ring1 = 404;
    base.slots.ring2 = 405;
    base.slots.bracelet = 406;
    base.slots.necklace = 407;

    const results = runAutoBuildBeamSearch({
      catalog,
      baseWorkbench: base,
      constraints: {
        ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
        characterClass: 'Mage' as const,
        level: 106,
        topN: 5,
        topKPerSlot: 40,
        beamWidth: 20,
        lockedSlots: {
          weapon: true,
          chestplate: true,
          leggings: true,
          boots: true,
          ring1: true,
          ring2: true,
          bracelet: true,
          necklace: true,
        },
        weaponAttackSpeeds: ['SUPER_FAST'],
      },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((candidate) => finalAttackSpeed(candidate, catalog) === 'SUPER_FAST')).toBe(true);
    expect(results[0].slots.helmet).toBe(399);
  });

  it('preserves attack-speed margin when later slots can reduce atkTier', () => {
    const catalog = makeTestCatalog([
      rawItem({ id: 501, name: 'Exact Early Speed Helm', type: 'helmet', lvl: 100, atkTier: 1, sdPct: 180 }),
      rawItem({ id: 502, name: 'Buffered Speed Helm', type: 'helmet', lvl: 100, atkTier: 3, sdPct: 20 }),
      rawItem({ id: 503, name: 'AtkTier Penalty Boots', type: 'boots', lvl: 100, atkTier: -2, hpBonus: 3000 }),
      rawItem({ id: 504, name: 'Locked Chest', type: 'chestplate', lvl: 100 }),
      rawItem({ id: 505, name: 'Locked Legs', type: 'leggings', lvl: 100 }),
      rawItem({ id: 506, name: 'Locked Ring 1', type: 'ring', lvl: 100 }),
      rawItem({ id: 507, name: 'Locked Ring 2', type: 'ring', lvl: 100 }),
      rawItem({ id: 508, name: 'Locked Bracelet', type: 'bracelet', lvl: 100 }),
      rawItem({ id: 509, name: 'Locked Necklace', type: 'necklace', lvl: 100 }),
      rawItem({
        id: 510,
        name: 'Very Fast Locked Weapon',
        type: 'wand',
        lvl: 100,
        classReq: 'Mage',
        atkSpd: 'VERY_FAST',
        averageDps: 4200,
      }),
    ]);

    const base = createInitialWorkbenchSnapshot();
    base.characterClass = 'Mage';
    base.level = 106;
    base.slots.weapon = 510;
    base.slots.chestplate = 504;
    base.slots.leggings = 505;
    base.slots.ring1 = 506;
    base.slots.ring2 = 507;
    base.slots.bracelet = 508;
    base.slots.necklace = 509;

    const results = runAutoBuildBeamSearch({
      catalog,
      baseWorkbench: base,
      constraints: {
        ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
        characterClass: 'Mage' as const,
        level: 106,
        topN: 5,
        topKPerSlot: 20,
        beamWidth: 1,
        lockedSlots: {
          weapon: true,
          chestplate: true,
          leggings: true,
          ring1: true,
          ring2: true,
          bracelet: true,
          necklace: true,
        },
        weaponAttackSpeeds: ['SUPER_FAST'],
      },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((candidate) => finalAttackSpeed(candidate, catalog) === 'SUPER_FAST')).toBe(true);
    expect(results[0].slots.helmet).toBe(502);
    expect(results[0].slots.boots).toBe(503);
  });

  it('uses realistic SP feasibility modes only (no_tomes vs guild_rainbow +1 each)', () => {
    const boundaryCatalog = makeTestCatalog([
      rawItem({ id: 601, name: 'Boundary Helm 101', type: 'helmet', lvl: 100, strReq: 101 }),
      rawItem({ id: 602, name: 'Chest', type: 'chestplate', lvl: 100 }),
      rawItem({ id: 603, name: 'Legs', type: 'leggings', lvl: 100 }),
      rawItem({ id: 604, name: 'Boots', type: 'boots', lvl: 100 }),
      rawItem({ id: 605, name: 'Ring 1', type: 'ring', lvl: 100 }),
      rawItem({ id: 606, name: 'Ring 2', type: 'ring', lvl: 100 }),
      rawItem({ id: 607, name: 'Brace', type: 'bracelet', lvl: 100 }),
      rawItem({ id: 608, name: 'Neck', type: 'necklace', lvl: 100 }),
      rawItem({ id: 609, name: 'Weapon', type: 'wand', lvl: 100, classReq: 'Mage', averageDps: 1000 }),
    ]);

    const base = createInitialWorkbenchSnapshot();
    base.characterClass = 'Mage';
    base.level = 106;

    const noTomesProgress: Array<{ phase: string; reasonCode?: string }> = [];
    const noTomesResults = runAutoBuildBeamSearch({
      catalog: boundaryCatalog,
      baseWorkbench: base,
      constraints: {
        ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
        characterClass: 'Mage' as const,
        level: 106,
        mustIncludeIds: [601],
        topN: 5,
        topKPerSlot: 20,
        beamWidth: 120,
        useExhaustiveSmallPool: false,
        skillpointFeasibilityMode: 'no_tomes',
      },
      onProgress: (event) => noTomesProgress.push({ phase: event.phase, reasonCode: event.reasonCode }),
    });

    const guildResults = runAutoBuildBeamSearch({
      catalog: boundaryCatalog,
      baseWorkbench: base,
      constraints: {
        ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
        characterClass: 'Mage' as const,
        level: 106,
        mustIncludeIds: [601],
        topN: 5,
        topKPerSlot: 20,
        beamWidth: 120,
        useExhaustiveSmallPool: false,
        skillpointFeasibilityMode: 'guild_rainbow',
      },
    });

    expect(noTomesResults.length).toBe(0);
    expect(noTomesProgress.some((event) => event.reasonCode === 'sp_infeasible')).toBe(true);
    expect(guildResults.length).toBeGreaterThan(0);
    expect(guildResults.every((candidate) => Object.values(candidate.slots).includes(601))).toBe(true);

    const beyondRainbowCatalog = makeTestCatalog([
      rawItem({ id: 611, name: 'Boundary Helm 110', type: 'helmet', lvl: 100, strReq: 110 }),
      rawItem({ id: 612, name: 'Chest', type: 'chestplate', lvl: 100 }),
      rawItem({ id: 613, name: 'Legs', type: 'leggings', lvl: 100 }),
      rawItem({ id: 614, name: 'Boots', type: 'boots', lvl: 100 }),
      rawItem({ id: 615, name: 'Ring 1', type: 'ring', lvl: 100 }),
      rawItem({ id: 616, name: 'Ring 2', type: 'ring', lvl: 100 }),
      rawItem({ id: 617, name: 'Brace', type: 'bracelet', lvl: 100 }),
      rawItem({ id: 618, name: 'Neck', type: 'necklace', lvl: 100 }),
      rawItem({ id: 619, name: 'Weapon', type: 'wand', lvl: 100, classReq: 'Mage', averageDps: 1000 }),
    ]);

    const beyondRainbowResults = runAutoBuildBeamSearch({
      catalog: beyondRainbowCatalog,
      baseWorkbench: base,
      constraints: {
        ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
        characterClass: 'Mage' as const,
        level: 106,
        mustIncludeIds: [611],
        topN: 5,
        topKPerSlot: 20,
        beamWidth: 120,
        useExhaustiveSmallPool: false,
        skillpointFeasibilityMode: 'guild_rainbow',
      },
    });
    expect(beyondRainbowResults.length).toBe(0);
  });

  it('applies attack target OR/AND semantics between atkTier range and final attack speed', () => {
    const speedVsTierCatalog = makeTestCatalog([
      rawItem({ id: 701, name: 'Helm', type: 'helmet', lvl: 100 }),
      rawItem({ id: 702, name: 'Chest', type: 'chestplate', lvl: 100 }),
      rawItem({ id: 703, name: 'Legs', type: 'leggings', lvl: 100 }),
      rawItem({ id: 704, name: 'Boots', type: 'boots', lvl: 100 }),
      rawItem({ id: 705, name: 'Ring 1', type: 'ring', lvl: 100 }),
      rawItem({ id: 706, name: 'Ring 2', type: 'ring', lvl: 100 }),
      rawItem({ id: 707, name: 'Brace', type: 'bracelet', lvl: 100 }),
      rawItem({ id: 708, name: 'Neck', type: 'necklace', lvl: 100 }),
      rawItem({
        id: 709,
        name: 'Already Super Fast Weapon',
        type: 'wand',
        lvl: 100,
        classReq: 'Mage',
        atkSpd: 'SUPER_FAST',
        averageDps: 1000,
      }),
    ]);

    const base = createInitialWorkbenchSnapshot();
    base.characterClass = 'Mage';
    base.level = 106;
    base.slots.weapon = 709;
    base.locks.weapon = true;

    const orResults = runAutoBuildBeamSearch({
      catalog: speedVsTierCatalog,
      baseWorkbench: base,
      constraints: {
        ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
        characterClass: 'Mage' as const,
        level: 106,
        topN: 5,
        topKPerSlot: 20,
        beamWidth: 120,
        useExhaustiveSmallPool: false,
        lockedSlots: { weapon: true },
        attackSpeedConstraintMode: 'or',
        weaponAttackSpeeds: ['SUPER_FAST'],
        target: {
          customNumericRanges: [{ key: 'atkTier', min: 6 }],
        },
      },
    });

    const andProgress: Array<{ reasonCode?: string }> = [];
    const andResults = runAutoBuildBeamSearch({
      catalog: speedVsTierCatalog,
      baseWorkbench: base,
      constraints: {
        ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
        characterClass: 'Mage' as const,
        level: 106,
        topN: 5,
        topKPerSlot: 20,
        beamWidth: 120,
        useExhaustiveSmallPool: false,
        lockedSlots: { weapon: true },
        attackSpeedConstraintMode: 'and',
        weaponAttackSpeeds: ['SUPER_FAST'],
        target: {
          customNumericRanges: [{ key: 'atkTier', min: 6 }],
        },
      },
      onProgress: (event) => andProgress.push({ reasonCode: event.reasonCode }),
    });

    expect(orResults.length).toBeGreaterThan(0);
    expect(orResults.every((candidate) => finalAttackSpeed(candidate, speedVsTierCatalog) === 'SUPER_FAST')).toBe(true);
    expect(orResults.every((candidate) => totalAtkTier(candidate, speedVsTierCatalog) < 6)).toBe(true);
    expect(andResults.length).toBe(0);
    expect(
      andProgress.some((event) => event.reasonCode === 'unsat_attack_target' || event.reasonCode === 'unsat_threshold'),
    ).toBe(true);
  });

  it('satisfies must include/exclude and attack target constraints for Alkatraz + Warchief scenario', () => {
    const scenarioCatalog = makeTestCatalog([
      rawItem({
        id: 800,
        name: 'Alkatraz',
        type: 'spear',
        lvl: 100,
        classReq: 'Warrior',
        atkSpd: 'SLOW',
        averageDps: 4100,
      }),
      rawItem({ id: 801, name: 'Warchief', type: 'ring', lvl: 100, atkTier: 1, sdPct: 25 }),
      rawItem({ id: 802, name: 'Knucklebones', type: 'ring', lvl: 100, atkTier: 4, sdPct: 200 }),
      rawItem({ id: 803, name: 'Necrosis', type: 'bracelet', lvl: 100, atkTier: 3, sdRaw: 250 }),
      rawItem({ id: 804, name: 'Fast Helm', type: 'helmet', lvl: 100, atkTier: 2 }),
      rawItem({ id: 805, name: 'Fast Chest', type: 'chestplate', lvl: 100, atkTier: 2 }),
      rawItem({ id: 806, name: 'Fast Legs', type: 'leggings', lvl: 100, atkTier: 1 }),
      rawItem({ id: 807, name: 'Fast Boots', type: 'boots', lvl: 100, atkTier: 1 }),
      rawItem({ id: 808, name: 'Safe Ring', type: 'ring', lvl: 100 }),
      rawItem({ id: 809, name: 'Safe Bracelet', type: 'bracelet', lvl: 100 }),
      rawItem({ id: 810, name: 'Safe Necklace', type: 'necklace', lvl: 100 }),
      rawItem({ id: 811, name: 'Tank Helm', type: 'helmet', lvl: 100, hpBonus: 5000, atkTier: -2 }),
      rawItem({ id: 812, name: 'Tank Boots', type: 'boots', lvl: 100, hpBonus: 4500, atkTier: -2 }),
    ]);

    const base = createInitialWorkbenchSnapshot();
    base.characterClass = 'Warrior';
    base.level = 106;

    const results = runAutoBuildBeamSearch({
      catalog: scenarioCatalog,
      baseWorkbench: base,
      constraints: {
        ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
        characterClass: 'Warrior' as const,
        level: 106,
        topN: 10,
        topKPerSlot: 40,
        beamWidth: 300,
        mustIncludeIds: [800, 801],
        excludedIds: [802, 803],
        attackSpeedConstraintMode: 'or',
        weaponAttackSpeeds: ['SUPER_FAST'],
        target: {
          customNumericRanges: [{ key: 'atkTier', min: 6 }],
        },
      },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((candidate) => Object.values(candidate.slots).includes(800))).toBe(true);
    expect(results.every((candidate) => Object.values(candidate.slots).includes(801))).toBe(true);
    expect(results.every((candidate) => !Object.values(candidate.slots).includes(802))).toBe(true);
    expect(results.every((candidate) => !Object.values(candidate.slots).includes(803))).toBe(true);
    expect(
      results.every((candidate) => {
        const speedOk = finalAttackSpeed(candidate, scenarioCatalog) === 'SUPER_FAST';
        const tierOk = totalAtkTier(candidate, scenarioCatalog) >= 6;
        return speedOk || tierOk;
      }),
    ).toBe(true);
  });

  it('fails fast with explicit diagnostics when must-includes conflict', () => {
    const conflictCatalog = makeTestCatalog([
      rawItem({ id: 901, name: 'Helmet One', type: 'helmet', lvl: 100 }),
      rawItem({ id: 902, name: 'Helmet Two', type: 'helmet', lvl: 100 }),
      rawItem({ id: 903, name: 'Chest', type: 'chestplate', lvl: 100 }),
      rawItem({ id: 904, name: 'Legs', type: 'leggings', lvl: 100 }),
      rawItem({ id: 905, name: 'Boots', type: 'boots', lvl: 100 }),
      rawItem({ id: 906, name: 'Ring 1', type: 'ring', lvl: 100 }),
      rawItem({ id: 907, name: 'Ring 2', type: 'ring', lvl: 100 }),
      rawItem({ id: 908, name: 'Brace', type: 'bracelet', lvl: 100 }),
      rawItem({ id: 909, name: 'Neck', type: 'necklace', lvl: 100 }),
      rawItem({ id: 910, name: 'Weapon', type: 'wand', lvl: 100, classReq: 'Mage', averageDps: 1200 }),
    ]);

    const base = createInitialWorkbenchSnapshot();
    base.characterClass = 'Mage';
    base.level = 106;

    const events: Array<{ phase: string; reasonCode?: string; detail?: string }> = [];
    const results = runAutoBuildBeamSearch({
      catalog: conflictCatalog,
      baseWorkbench: base,
      constraints: {
        ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
        characterClass: 'Mage' as const,
        level: 106,
        mustIncludeIds: [901, 902],
      },
      onProgress: (event) => events.push({ phase: event.phase, reasonCode: event.reasonCode, detail: event.detail }),
    });

    expect(results.length).toBe(0);
    expect(events.some((event) => event.reasonCode === 'must_include_conflict')).toBe(true);
    expect(events.find((event) => event.reasonCode === 'must_include_conflict')?.detail).toContain('No free');
  });
});
