import { describe, expect, it } from 'vitest';
import { evaluateBuild, evaluateBuildSkillpointFeasibility } from '@/domain/build/build-metrics';
import { makeTestCatalog, rawItem } from '@/tests/helpers';

/**
 * Build combination that was incorrectly marked invalid due to missing fix_should_pop
 * logic for items with negative skill bonuses (Twilight-Gilded Cloak, Rycar's Bravado).
 * This may not be the more robust unit tests but i am trying... a little bit
 */
describe('build skillpoint feasibility', () => {
  it('handles negative-skillpoint item causing pop (minimal case)', () => {
    const catalog = makeTestCatalog([
      rawItem({ id: 1, name: 'High Req Helm', type: 'helmet', lvl: 100, strReq: 10 }),
      rawItem({ id: 2, name: 'Negative Chest', type: 'chestplate', lvl: 100, str: -5 }),
      rawItem({ id: 3, name: 'Weapon', type: 'wand', lvl: 100, classReq: 'Mage', averageDps: 100 }),
    ]);
    const slots = { helmet: 1, chestplate: 2, leggings: null, boots: null, ring1: null, ring2: null, bracelet: null, necklace: null, weapon: 3 };
    const result = evaluateBuildSkillpointFeasibility(slots, catalog, 106);
    expect(result.feasible).toBe(true);
  });
  it('marks build with negative-skillpoint items as valid when feasible', () => {
    // Simplified version: same negative items (Twilight-Gilded, Rycar's) but lower reqs to fit in 200 SP
    const catalog = makeTestCatalog([
      rawItem({ id: 1, name: 'Helm', type: 'helmet', lvl: 100, dexReq: 40, dex: 10 }),
      rawItem({ id: 2, name: 'Twilight-Like', type: 'chestplate', lvl: 100, strReq: 20, dexReq: 20, agiReq: 20, int: -30, def: -30 }),
      rawItem({ id: 3, name: 'Legs', type: 'leggings', lvl: 100, dexReq: 40, agiReq: 40, dex: 12, agi: 12 }),
      rawItem({ id: 4, name: 'Boots', type: 'boots', lvl: 100, strReq: 50, dexReq: 50, str: 20, dex: 10 }),
      rawItem({ id: 5, name: 'Ring1', type: 'ring', lvl: 100, dexReq: 30, agiReq: 30 }),
      rawItem({ id: 6, name: 'Ring2', type: 'ring', lvl: 100, strReq: 20, agiReq: 25, str: 4 }),
      rawItem({ id: 7, name: "Rycar's-Like", type: 'bracelet', lvl: 100, strReq: 15, str: 6, dex: 2, int: -8, agi: 2 }),
      rawItem({ id: 8, name: 'Neck', type: 'necklace', lvl: 100, dexReq: 70 }),
      rawItem({ id: 9, name: 'Weapon', type: 'wand', lvl: 100, classReq: 'Mage', averageDps: 1000 }),
    ]);
    const slots = { helmet: 1, chestplate: 2, leggings: 3, boots: 4, ring1: 5, ring2: 6, bracelet: 7, necklace: 8, weapon: 9 };
    const result = evaluateBuildSkillpointFeasibility(slots, catalog, 106);
    expect(result.feasible).toBe(true);
  });

  it('Epoch build validation check (proposed by badping))', () => {
    const catalog = makeTestCatalog([
      rawItem({
        id: 1,
        name: 'Luminiferous Aether',
        type: 'helmet',
        lvl: 100,
        dexReq: 60,
        dex: 10,
      }),
      rawItem({
        id: 2,
        name: 'Twilight-Gilded Cloak',
        type: 'chestplate',
        lvl: 100,
        strReq: 40,
        dexReq: 40,
        agiReq: 40,
        int: -30,
        def: -30,
      }),
      rawItem({
        id: 3,
        name: 'Leictreach Makani',
        type: 'leggings',
        lvl: 100,
        dexReq: 60,
        agiReq: 60,
        dex: 12,
        agi: 12,
      }),
      rawItem({
        id: 4,
        name: 'Warchief',
        type: 'boots',
        lvl: 100,
        strReq: 80,
        dexReq: 80,
        str: 20,
        dex: 10,
      }),
      rawItem({
        id: 5,
        name: 'Breezehands',
        type: 'ring',
        lvl: 100,
        dexReq: 55,
        agiReq: 55,
      }),
      rawItem({
        id: 6,
        name: 'Dasher',
        type: 'ring',
        lvl: 100,
        strReq: 30,
        agiReq: 40,
        str: 4,
      }),
      rawItem({
        id: 7,
        name: "Rycar's Bravado",
        type: 'bracelet',
        lvl: 100,
        strReq: 20,
        str: 6,
        dex: 2,
        int: -8,
        agi: 2,
      }),
      rawItem({
        id: 8,
        name: 'Diamond Static Necklace',
        type: 'necklace',
        lvl: 100,
        dexReq: 100,
      }),
      rawItem({
        id: 9,
        name: 'Test Weapon',
        type: 'wand',
        lvl: 100,
        classReq: 'Mage',
        averageDps: 1000,
        str: 2,
        dex: 2,
      }),
    ]);

    const slots = {
      helmet: 1,
      chestplate: 2,
      leggings: 3,
      boots: 4,
      ring1: 5,
      ring2: 6,
      bracelet: 7,
      necklace: 8,
      weapon: 9,
    };

    // Without weapon SP bonuses this build needs 202 assigned (exceeds 200 at level 106).
    // Weapon str:2 dex:2 brings it under 200. User confirmed build works on Wynnbuilder.
    const summary = evaluateBuild(
      { slots, level: 106, characterClass: 'Mage' },
      catalog,
    );
    expect(summary.derived.skillpointFeasible).toBe(true);
  });

  it('Epoch build without weapon bonuses is feasible with guild_rainbow or flexible_2 tome', () => {
    const catalog = makeTestCatalog([
      rawItem({ id: 1, name: 'Luminiferous Aether', type: 'helmet', lvl: 100, dexReq: 60, dex: 10 }),
      rawItem({ id: 2, name: 'Twilight-Gilded Cloak', type: 'chestplate', lvl: 100, strReq: 40, dexReq: 40, agiReq: 40, int: -30, def: -30 }),
      rawItem({ id: 3, name: 'Leictreach Makani', type: 'leggings', lvl: 100, dexReq: 60, agiReq: 60, dex: 12, agi: 12 }),
      rawItem({ id: 4, name: 'Warchief', type: 'boots', lvl: 100, strReq: 80, dexReq: 80, str: 20, dex: 10 }),
      rawItem({ id: 5, name: 'Breezehands', type: 'ring', lvl: 100, dexReq: 55, agiReq: 55 }),
      rawItem({ id: 6, name: 'Dasher', type: 'ring', lvl: 100, strReq: 30, agiReq: 40, str: 4 }),
      rawItem({ id: 7, name: "Rycar's Bravado", type: 'bracelet', lvl: 100, strReq: 20, str: 6, dex: 2, int: -8, agi: 2 }),
      rawItem({ id: 8, name: 'Diamond Static Necklace', type: 'necklace', lvl: 100, dexReq: 100 }),
      rawItem({ id: 9, name: 'Test Weapon', type: 'wand', lvl: 100, classReq: 'Mage', averageDps: 1000 }),
    ]);
    const slots = { helmet: 1, chestplate: 2, leggings: 3, boots: 4, ring1: 5, ring2: 6, bracelet: 7, necklace: 8, weapon: 9 };

    const noTomes = evaluateBuild({ slots, level: 106, characterClass: 'Mage' }, catalog, { skillpointTomeMode: 'no_tomes' });
    expect(noTomes.derived.skillpointFeasible).toBe(false);

    const guildRainbow = evaluateBuild({ slots, level: 106, characterClass: 'Mage' }, catalog, { skillpointTomeMode: 'guild_rainbow' });
    expect(guildRainbow.derived.skillpointFeasible).toBe(true);

    const flexible2 = evaluateBuild({ slots, level: 106, characterClass: 'Mage' }, catalog, { skillpointTomeMode: 'flexible_2' });
    expect(flexible2.derived.skillpointFeasible).toBe(true);
  });
});
