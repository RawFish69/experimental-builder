import { describe, expect, it } from 'vitest';
import { searchItems } from '@/domain/search/search-index';
import { DEFAULT_SEARCH_FILTER_STATE } from '@/domain/search/filter-schema';
import { makeTestCatalog, rawItem } from '@/tests/helpers';

describe('search-index', () => {
  const catalog = makeTestCatalog([
    rawItem({ id: 1, name: 'Cancer', type: 'helmet', lvl: 100, tier: 'Mythic', hpBonus: 4000, sdPct: 20 }),
    rawItem({ id: 2, name: 'Cinderchain', type: 'boots', lvl: 96, tier: 'Legendary', spd: 30 }),
    rawItem({ id: 3, name: 'Stardew', type: 'spear', lvl: 100, averageDps: 4200, classReq: 'Warrior' }),
    rawItem({ id: 4, name: 'Blue Mask', type: 'helmet', lvl: 70, tier: 'Rare', majorIds: ['TRANSCENDENCE'] }),
    rawItem({ id: 5, name: 'Blue Ring', type: 'ring', lvl: 90, majorIds: ['MAGNET'] }),
  ]);

  it('filters by category and level range', () => {
    const result = searchItems(catalog.items, {
      ...DEFAULT_SEARCH_FILTER_STATE,
      categories: ['helmet'],
      numericRanges: {
        level: { min: 80 },
      },
    });
    expect(result.rows.map((row) => row.id)).toEqual([1]);
  });

  it('supports major id facet filtering', () => {
    const result = searchItems(catalog.items, {
      ...DEFAULT_SEARCH_FILTER_STATE,
      majorIds: ['TRANSCENDENCE'],
    });
    expect(result.rows.map((row) => row.id)).toEqual([4]);
  });

  it('ranks exact/prefix/contains matches in relevance search', () => {
    const result = searchItems(catalog.items, {
      ...DEFAULT_SEARCH_FILTER_STATE,
      text: 'blue',
      sort: 'relevance',
    });
    expect(result.rows.map((row) => row.id)).toEqual([5, 4]);
  });

  it('sorts deterministically by base dps', () => {
    const result = searchItems(catalog.items, {
      ...DEFAULT_SEARCH_FILTER_STATE,
      categories: ['weapon'],
      sort: 'baseDps',
      sortDescending: true,
    });
    expect(result.rows[0]?.id).toBe(3);
  });
});
