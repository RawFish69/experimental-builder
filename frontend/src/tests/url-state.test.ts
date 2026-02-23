import { describe, expect, it } from 'vitest';
import { writeUrlState, parseUrlState } from '@/app/url-state';
import type { SearchFilterState } from '@/domain/search/filter-schema';
import { DEFAULT_SEARCH_FILTER_STATE } from '@/domain/search/filter-schema';
import { createInitialWorkbenchSnapshot } from '@/domain/build/workbench-state';

describe('url-state', () => {
  it('round-trips search and workbench state through URL', () => {
    window.history.replaceState({}, '', '/workbench/');

    const snapshot = createInitialWorkbenchSnapshot();
    snapshot.level = 105;
    snapshot.characterClass = 'Mage';
    snapshot.slots.weapon = 1234;
    snapshot.binsByCategory.weapon = [1234, 999];
    snapshot.locks.weapon = true;
    snapshot.legacyHash = 'abc123';

    const search: SearchFilterState = {
      ...DEFAULT_SEARCH_FILTER_STATE,
      text: 'cancer',
      categories: ['helmet'],
      tiers: ['Mythic'],
      numericRanges: {
        level: { min: 90, max: 106 },
      },
      sort: 'ehpProxy' as const,
      sortDescending: true,
    };

    writeUrlState({
      search,
      workbenchSnapshot: snapshot,
      mode: 'autobuilder',
      replace: true,
    });

    const parsed = parseUrlState(window.location);
    expect(parsed.search.text).toBe('cancer');
    expect(parsed.search.categories).toEqual(['helmet']);
    expect(parsed.search.tiers).toEqual(['Mythic']);
    expect(parsed.workbenchPatch?.level).toBe(105);
    expect(parsed.workbenchPatch?.characterClass).toBe('Mage');
    expect(parsed.workbenchPatch?.slots?.weapon).toBe(1234);
    expect(parsed.legacyHash).toBe('abc123');
    expect(parsed.mode).toBe('autobuilder');
  });
});
