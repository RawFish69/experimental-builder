import { z } from 'zod';
import type { CharacterClass, ItemCategoryKey } from '@/domain/items/types';

export const SEARCH_SORT_KEYS = ['relevance', 'level'] as const;
/** Sort can be relevance, level, or any numeric ID key from catalog (e.g. averageDps, ehpProxy, mr). */
export type SearchSortKey = (typeof SEARCH_SORT_KEYS)[number] | string;

export const SEARCH_VIEW_MODES = ['list', 'grid'] as const;
export type SearchViewMode = (typeof SEARCH_VIEW_MODES)[number];

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
  /** Min/max ranges for any numeric ID (e.g. mr, sdPct, ehpProxy). Keys from catalog.facetsMeta.numericRanges. */
  numericRanges: Partial<Record<string, NumericRange>>;
  /** IDs to avoid: exclude items where value exceeds max (or is below min). E.g. exclude mr > 50. */
  exclusionRanges: Partial<Record<string, NumericRange>>;
  onlyWearableAtLevel: number | null;
  onlyClassCompatible: boolean;
  excludeRestricted: boolean;
  /** Sort keys in order: first is primary, rest are tie-breakers. */
  sortKeys: string[];
  sortDescending: boolean;
  viewMode: SearchViewMode;
  /** When true, search results list appears below the Workbench (middle panel) instead of in the left sidebar. */
  resultsBelowBuild: boolean;
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
  exclusionRanges: {},
  onlyWearableAtLevel: 106,
  onlyClassCompatible: false,
  excludeRestricted: false,
  sortKeys: ['relevance'],
  sortDescending: true,
  viewMode: 'list',
  resultsBelowBuild: true,
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
  exclusionRanges: z.record(z.string(), numericRangeSchema).catch({}),
  onlyWearableAtLevel: z.number().int().min(1).max(106).nullable().catch(106),
  onlyClassCompatible: z.boolean().catch(false),
  excludeRestricted: z.boolean().catch(false),
  sortKeys: z.array(z.string()).catch(['relevance']),
  sortDescending: z.boolean().catch(true),
  viewMode: z.enum(SEARCH_VIEW_MODES).catch('list'),
  resultsBelowBuild: z.boolean().catch(true),
});

export function sanitizeSearchFilterState(input: unknown): SearchFilterState {
  const raw = input as Record<string, unknown>;
  const parsed = searchFilterStateSchema.parse(input);
  const sortKeys = Array.isArray(parsed.sortKeys) && parsed.sortKeys.length > 0
    ? parsed.sortKeys
    : typeof raw?.sort === 'string'
      ? [raw.sort]
      : ['relevance'];
  return {
    text: parsed.text,
    categories: parsed.categories as ItemCategoryKey[],
    types: parsed.types,
    tiers: parsed.tiers,
    classReqs: parsed.classReqs,
    majorIds: parsed.majorIds,
    numericRanges: parsed.numericRanges as Partial<Record<string, NumericRange>>,
    exclusionRanges: (parsed.exclusionRanges ?? {}) as Partial<Record<string, NumericRange>>,
    onlyWearableAtLevel: parsed.onlyWearableAtLevel,
    onlyClassCompatible: parsed.onlyClassCompatible,
    excludeRestricted: parsed.excludeRestricted,
    sortKeys,
    sortDescending: parsed.sortDescending,
    viewMode: parsed.viewMode,
    resultsBelowBuild: Boolean(parsed.resultsBelowBuild),
  };
}

export function mergeSearchState(
  base: SearchFilterState,
  patch: Partial<SearchFilterState>,
): SearchFilterState {
  return sanitizeSearchFilterState({
    ...base,
    ...patch,
    numericRanges: patch.numericRanges !== undefined ? patch.numericRanges : base.numericRanges,
    exclusionRanges: patch.exclusionRanges !== undefined ? patch.exclusionRanges : (base.exclusionRanges ?? {}),
  });
}

