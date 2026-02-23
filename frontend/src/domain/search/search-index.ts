import MiniSearch from 'minisearch';
import type { CharacterClass, ItemCategoryKey, NormalizedItem } from '@/domain/items/types';
import { itemCanBeWornByClass, itemMatchesLevel } from '@/domain/items/types';
import type { NumericFilterKey, SearchFacetCounts, SearchFilterState, SearchResultPage, SearchResultRow, SearchSortKey } from '@/domain/search/filter-schema';

interface MiniDoc {
  id: number;
  displayName: string;
  searchText: string;
  majorIdsText: string;
}

function getNumericValue(item: NormalizedItem, key: NumericFilterKey): number {
  switch (key) {
    case 'level':
      return item.level;
    case 'powderSlots':
      return item.powderSlots;
    default:
      return item.numericIndex[key] ?? 0;
  }
}

function matchesCategoryFilter(item: NormalizedItem, categories: ItemCategoryKey[]): boolean {
  return categories.length === 0 || categories.includes(item.category);
}

function matchesStringSet<T extends string>(value: T | null | undefined, selected: T[]): boolean {
  if (selected.length === 0) return true;
  if (!value) return false;
  return selected.includes(value);
}

function matchesNumericRanges(item: NormalizedItem, state: SearchFilterState): boolean {
  for (const [key, range] of Object.entries(state.numericRanges) as [NumericFilterKey, { min?: number; max?: number }][]) {
    if (!range) continue;
    const value = getNumericValue(item, key);
    if (typeof range.min === 'number' && value < range.min) return false;
    if (typeof range.max === 'number' && value > range.max) return false;
  }
  return true;
}

function matchesToggles(item: NormalizedItem, state: SearchFilterState): boolean {
  if (state.excludeRestricted && (item.restricted || item.deprecated)) return false;
  if (state.onlyWearableAtLevel !== null && !itemMatchesLevel(item, state.onlyWearableAtLevel)) return false;
  if (state.onlyClassCompatible) {
    const selectedClass = state.classReqs[0] ?? null;
    if (!itemCanBeWornByClass(item, selectedClass)) return false;
  }
  return true;
}

function matchesMajorIds(item: NormalizedItem, selected: string[]): boolean {
  if (selected.length === 0) return true;
  if (item.majorIds.length === 0) return false;
  return selected.every((majorId) => item.majorIds.includes(majorId));
}

export function matchesSearchFilters(item: NormalizedItem, state: SearchFilterState): boolean {
  if (!matchesCategoryFilter(item, state.categories)) return false;
  if (!matchesStringSet(item.type, state.types)) return false;
  if (!matchesStringSet(item.tier, state.tiers)) return false;
  if (state.classReqs.length > 0) {
    if (item.classReq === null) return false;
    if (!state.classReqs.includes(item.classReq as CharacterClass)) return false;
  }
  if (!matchesMajorIds(item, state.majorIds)) return false;
  if (!matchesNumericRanges(item, state)) return false;
  if (!matchesToggles(item, state)) return false;
  return true;
}

function baseSortValue(item: NormalizedItem, sort: SearchSortKey): number {
  switch (sort) {
    case 'level':
      return item.level;
    case 'baseDps':
      return item.roughScoreFields.baseDps;
    case 'ehpProxy':
      return item.roughScoreFields.ehpProxy;
    case 'offenseScore':
      return item.roughScoreFields.offense;
    case 'skillPointTotal':
      return item.roughScoreFields.skillPointTotal;
    case 'relevance':
    default:
      return 0;
  }
}

function customRelevance(item: NormalizedItem, text: string, miniScore: number): number {
  const q = text.trim().toLowerCase();
  if (!q) return 0;
  const name = item.displayName.toLowerCase();
  if (name === q) return miniScore + 5000;
  if (name.startsWith(q)) return miniScore + 3000;
  if (name.includes(q)) return miniScore + 1200;
  if (item.searchText.includes(q)) return miniScore + 300;
  return miniScore;
}

function compareRows(
  a: { item: NormalizedItem; relevance: number },
  b: { item: NormalizedItem; relevance: number },
  state: SearchFilterState,
): number {
  const dir = state.sortDescending ? -1 : 1;
  if (state.sort === 'relevance') {
    if (a.relevance !== b.relevance) return (a.relevance > b.relevance ? -1 : 1) * (state.sortDescending ? 1 : -1);
  } else {
    const av = baseSortValue(a.item, state.sort);
    const bv = baseSortValue(b.item, state.sort);
    if (av !== bv) return av < bv ? -dir : dir;
  }

  // Tie-breaks
  if (a.item.level !== b.item.level) return a.item.level < b.item.level ? 1 : -1;
  return a.item.displayName.localeCompare(b.item.displayName);
}

function makeFacetCounts(): SearchFacetCounts {
  return {
    categories: {},
    types: {},
    tiers: {},
    majorIds: {},
  };
}

function bump(record: Record<string, number>, key: string): void {
  if (!key) return;
  record[key] = (record[key] ?? 0) + 1;
}

export class SearchIndexEngine {
  private readonly miniSearch: MiniSearch<MiniDoc>;
  private readonly itemsById: Map<number, NormalizedItem>;
  private readonly allItems: NormalizedItem[];

  constructor(items: NormalizedItem[]) {
    this.allItems = items;
    this.itemsById = new Map(items.map((item) => [item.id, item]));
    this.miniSearch = new MiniSearch<MiniDoc>({
      fields: ['displayName', 'searchText', 'majorIdsText'],
      storeFields: ['id'],
      idField: 'id',
      searchOptions: {
        boost: { displayName: 6, searchText: 2, majorIdsText: 2 },
        prefix: true,
        fuzzy: 0.2,
        combineWith: 'OR',
      },
    });
    this.miniSearch.addAll(
      items.map<MiniDoc>((item) => ({
        id: item.id,
        displayName: item.displayName,
        searchText: item.searchText,
        majorIdsText: item.majorIdsText,
      })),
    );
  }

  search(state: SearchFilterState): SearchResultPage {
    const text = state.text.trim();
    const miniHits = text
      ? this.miniSearch.search(text, {
          prefix: true,
          fuzzy: 0.2,
          boost: { displayName: 8, searchText: 2, majorIdsText: 2 },
        })
      : [];

    const relevanceMap = new Map<number, number>();
    for (const hit of miniHits) {
      const item = this.itemsById.get(hit.id as number);
      if (!item) continue;
      relevanceMap.set(item.id, customRelevance(item, text, Number(hit.score ?? 0)));
    }

    const candidates = text ? [...this.allItems] : this.allItems;
    const filtered: Array<{ item: NormalizedItem; relevance: number }> = [];
    const facetCounts = makeFacetCounts();

    for (const item of candidates) {
      const relevance = relevanceMap.get(item.id) ?? 0;
      if (text && relevance === 0 && !item.searchText.includes(text.toLowerCase())) {
        continue;
      }
      if (!matchesSearchFilters(item, state)) continue;
      filtered.push({ item, relevance });
      facetCounts.categories[item.category] = (facetCounts.categories[item.category] ?? 0) + 1;
      bump(facetCounts.types, item.type);
      bump(facetCounts.tiers, item.tier);
      for (const majorId of item.majorIds) bump(facetCounts.majorIds, majorId);
    }

    filtered.sort((a, b) => compareRows(a, b, state));

    const rows: SearchResultRow[] = filtered.map(({ item, relevance }) => ({ id: item.id, relevance }));
    return {
      total: rows.length,
      rows,
      facetCounts,
    };
  }
}

export function searchItems(items: NormalizedItem[], state: SearchFilterState): SearchResultPage {
  return new SearchIndexEngine(items).search(state);
}
