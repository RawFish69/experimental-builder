import { z } from 'zod';
import type { CharacterClass, ItemCategoryKey } from '@/domain/items/types';

export const SEARCH_SORT_KEYS = [
  'relevance',
  'level',
  'baseDps',
  'ehpProxy',
  'offenseScore',
  'skillPointTotal',
] as const;
export type SearchSortKey = (typeof SEARCH_SORT_KEYS)[number];

export const SEARCH_VIEW_MODES = ['list', 'grid'] as const;
export type SearchViewMode = (typeof SEARCH_VIEW_MODES)[number];

export const NUMERIC_FILTER_KEYS = [
  'level',
  'baseDps',
  'ehpProxy',
  'offenseScore',
  'skillPointTotal',
  'reqTotal',
  'hp',
  'hpBonus',
  'sdPct',
  'sdRaw',
  'mdPct',
  'mdRaw',
  'spd',
  'powderSlots',
] as const;
export type NumericFilterKey = (typeof NUMERIC_FILTER_KEYS)[number];

export interface NumericRange {
  min?: number;
  max?: number;
}

export interface SearchFilterState {
  text: string;
  categories: ItemCategoryKey[];
  types: string[];
  tiers: string[];
  classReqs: CharacterClass[];
  majorIds: string[];
  numericRanges: Partial<Record<NumericFilterKey, NumericRange>>;
  onlyWearableAtLevel: number | null;
  onlyClassCompatible: boolean;
  excludeRestricted: boolean;
  sort: SearchSortKey;
  sortDescending: boolean;
  viewMode: SearchViewMode;
}

export interface SearchResultRow {
  id: number;
  relevance: number;
}

export interface SearchFacetCounts {
  categories: Partial<Record<ItemCategoryKey, number>>;
  types: Record<string, number>;
  tiers: Record<string, number>;
  majorIds: Record<string, number>;
}

export interface SearchResultPage {
  total: number;
  rows: SearchResultRow[];
  facetCounts: SearchFacetCounts;
}

export const DEFAULT_SEARCH_FILTER_STATE: SearchFilterState = {
  text: '',
  categories: [],
  types: [],
  tiers: [],
  classReqs: [],
  majorIds: [],
  numericRanges: {},
  onlyWearableAtLevel: 106,
  onlyClassCompatible: false,
  excludeRestricted: false,
  sort: 'relevance',
  sortDescending: true,
  viewMode: 'list',
};

const numericRangeSchema = z.object({
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
});

export const searchFilterStateSchema = z.object({
  text: z.string().catch(DEFAULT_SEARCH_FILTER_STATE.text),
  categories: z.array(z.string()).catch([]),
  types: z.array(z.string()).catch([]),
  tiers: z.array(z.string()).catch([]),
  classReqs: z
    .array(z.enum(['Warrior', 'Assassin', 'Mage', 'Archer', 'Shaman']))
    .catch([]),
  majorIds: z.array(z.string()).catch([]),
  numericRanges: z.record(z.string(), numericRangeSchema).catch({}),
  onlyWearableAtLevel: z.number().int().min(1).max(106).nullable().catch(106),
  onlyClassCompatible: z.boolean().catch(false),
  excludeRestricted: z.boolean().catch(false),
  sort: z.enum(SEARCH_SORT_KEYS).catch('relevance'),
  sortDescending: z.boolean().catch(true),
  viewMode: z.enum(SEARCH_VIEW_MODES).catch('list'),
});

export function sanitizeSearchFilterState(input: unknown): SearchFilterState {
  const parsed = searchFilterStateSchema.parse(input);
  return {
    text: parsed.text,
    categories: parsed.categories as ItemCategoryKey[],
    types: parsed.types,
    tiers: parsed.tiers,
    classReqs: parsed.classReqs,
    majorIds: parsed.majorIds,
    numericRanges: parsed.numericRanges as Partial<Record<NumericFilterKey, NumericRange>>,
    onlyWearableAtLevel: parsed.onlyWearableAtLevel,
    onlyClassCompatible: parsed.onlyClassCompatible,
    excludeRestricted: parsed.excludeRestricted,
    sort: parsed.sort,
    sortDescending: parsed.sortDescending,
    viewMode: parsed.viewMode,
  };
}

export function mergeSearchState(
  base: SearchFilterState,
  patch: Partial<SearchFilterState>,
): SearchFilterState {
  return sanitizeSearchFilterState({
    ...base,
    ...patch,
    numericRanges: {
      ...base.numericRanges,
      ...(patch.numericRanges ?? {}),
    },
  });
}

