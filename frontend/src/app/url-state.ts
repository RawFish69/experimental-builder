import { z } from 'zod';
import type { SearchFilterState } from '@/domain/search/filter-schema';
import { DEFAULT_SEARCH_FILTER_STATE, sanitizeSearchFilterState } from '@/domain/search/filter-schema';
import type { WorkbenchSnapshot } from '@/domain/build/types';
import type { AbilityTreeUrlState } from '@/domain/ability-tree/types';
import { ITEM_CATEGORY_KEYS, ITEM_SLOTS } from '@/domain/items/types';

const wbUrlSnapshotSchema = z.object({
  slots: z.record(z.string(), z.number().int().nullable()).optional(),
  binsByCategory: z.record(z.string(), z.array(z.number().int())).optional(),
  locks: z.record(z.string(), z.boolean()).optional(),
  level: z.number().int().min(1).max(106).optional(),
  characterClass: z.enum(['Warrior', 'Assassin', 'Mage', 'Archer', 'Shaman']).nullable().optional(),
  selectedSlot: z.string().nullable().optional(),
  legacyHash: z.string().nullable().optional(),
});

const atreeUrlStateSchema = z.object({
  version: z.string().nullable().optional(),
  selectedByClass: z
    .object({
      Warrior: z.array(z.number().int()).optional(),
      Assassin: z.array(z.number().int()).optional(),
      Mage: z.array(z.number().int()).optional(),
      Archer: z.array(z.number().int()).optional(),
      Shaman: z.array(z.number().int()).optional(),
    })
    .partial()
    .default({}),
});

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function jsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export interface ParsedWorkbenchUrlState {
  search: SearchFilterState;
  workbenchPatch: Partial<WorkbenchSnapshot> | null;
  legacyHash: string | null;
  mode: string | null;
  abilityTree: AbilityTreeUrlState | null;
}

export function parseSearchStateFromUrl(url: URL): SearchFilterState {
  const q = url.searchParams.get('q') ?? '';
  const sort = url.searchParams.get('sort');
  const sdesc = url.searchParams.get('sdesc');
  const view = url.searchParams.get('view');
  const wear = url.searchParams.get('wearLevel');
  const classCompat = url.searchParams.get('classCompat');
  const exRes = url.searchParams.get('excludeRestricted');
  const cats = (url.searchParams.get('cats') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const types = (url.searchParams.get('types') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const tiers = (url.searchParams.get('tiers') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const classReqs = (url.searchParams.get('classReqs') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const majorIds = (url.searchParams.get('majorIds') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const numericRanges = jsonParse<SearchFilterState['numericRanges']>(
    url.searchParams.get('ranges') ?? '',
  ) ?? {};

  return sanitizeSearchFilterState({
    ...DEFAULT_SEARCH_FILTER_STATE,
    text: q,
    sort: sort ?? DEFAULT_SEARCH_FILTER_STATE.sort,
    sortDescending: sdesc === null ? DEFAULT_SEARCH_FILTER_STATE.sortDescending : sdesc !== '0',
    viewMode: view ?? DEFAULT_SEARCH_FILTER_STATE.viewMode,
    onlyWearableAtLevel: wear ? Number(wear) : DEFAULT_SEARCH_FILTER_STATE.onlyWearableAtLevel,
    onlyClassCompatible: classCompat === '1',
    excludeRestricted: exRes === null ? true : exRes !== '0',
    categories: cats,
    types,
    tiers,
    classReqs,
    majorIds,
    numericRanges,
  });
}

export function parseWorkbenchPatchFromUrl(url: URL): Partial<WorkbenchSnapshot> | null {
  const wb = url.searchParams.get('wb');
  if (!wb) return null;
  try {
    const decoded = base64UrlDecode(wb);
    const parsed = wbUrlSnapshotSchema.parse(JSON.parse(decoded));
    const slots = Object.fromEntries(
      ITEM_SLOTS.map((slot) => [slot, parsed.slots?.[slot] ?? null]),
    ) as WorkbenchSnapshot['slots'];
    const binsByCategory = Object.fromEntries(
      ITEM_CATEGORY_KEYS.map((category) => [category, parsed.binsByCategory?.[category] ?? []]),
    ) as WorkbenchSnapshot['binsByCategory'];
    const locks = Object.fromEntries(
      ITEM_SLOTS.map((slot) => [slot, Boolean(parsed.locks?.[slot])]),
    ) as WorkbenchSnapshot['locks'];
    return {
      slots,
      binsByCategory,
      locks,
      level: parsed.level,
      characterClass: parsed.characterClass ?? null,
      selectedSlot: (parsed.selectedSlot as WorkbenchSnapshot['selectedSlot']) ?? undefined,
      legacyHash: parsed.legacyHash ?? null,
    };
  } catch {
    return null;
  }
}

export function parseAbilityTreeStateFromUrl(url: URL): AbilityTreeUrlState | null {
  const raw = url.searchParams.get('atree');
  if (!raw) return null;
  try {
    const decoded = base64UrlDecode(raw);
    const parsed = atreeUrlStateSchema.parse(JSON.parse(decoded));
    return {
      version: parsed.version ?? null,
      selectedByClass: parsed.selectedByClass,
    };
  } catch {
    return null;
  }
}

export function parseUrlState(locationLike: Location = window.location): ParsedWorkbenchUrlState {
  const url = new URL(locationLike.href);
  const legacyHash = url.hash ? url.hash.slice(1) : null;
  return {
    search: parseSearchStateFromUrl(url),
    workbenchPatch: parseWorkbenchPatchFromUrl(url),
    legacyHash: legacyHash || null,
    mode: url.searchParams.get('mode'),
    abilityTree: parseAbilityTreeStateFromUrl(url),
  };
}

export function encodeWorkbenchSnapshot(snapshot: WorkbenchSnapshot): string {
  const payload = {
    slots: snapshot.slots,
    binsByCategory: snapshot.binsByCategory,
    locks: snapshot.locks,
    level: snapshot.level,
    characterClass: snapshot.characterClass,
    selectedSlot: snapshot.selectedSlot,
    legacyHash: snapshot.legacyHash,
  };
  return base64UrlEncode(JSON.stringify(payload));
}

export function writeUrlState(args: {
  search: SearchFilterState;
  workbenchSnapshot: WorkbenchSnapshot;
  legacyHash?: string | null;
  mode?: string | null;
  abilityTreeState?: AbilityTreeUrlState | null;
  replace?: boolean;
}): void {
  const url = new URL(window.location.href);
  const { search } = args;
  const params = url.searchParams;

  const setArray = (key: string, values: string[]): void => {
    if (values.length === 0) params.delete(key);
    else params.set(key, values.join(','));
  };

  if (search.text) params.set('q', search.text);
  else params.delete('q');
  if (search.sort !== DEFAULT_SEARCH_FILTER_STATE.sort) params.set('sort', search.sort);
  else params.delete('sort');
  if (search.sortDescending !== DEFAULT_SEARCH_FILTER_STATE.sortDescending) {
    params.set('sdesc', search.sortDescending ? '1' : '0');
  } else {
    params.delete('sdesc');
  }
  if (search.viewMode !== DEFAULT_SEARCH_FILTER_STATE.viewMode) params.set('view', search.viewMode);
  else params.delete('view');

  setArray('cats', search.categories);
  setArray('types', search.types);
  setArray('tiers', search.tiers);
  setArray('classReqs', search.classReqs);
  setArray('majorIds', search.majorIds);

  if (search.onlyWearableAtLevel !== null) params.set('wearLevel', String(search.onlyWearableAtLevel));
  else params.delete('wearLevel');
  if (search.onlyClassCompatible) params.set('classCompat', '1');
  else params.delete('classCompat');
  if (!search.excludeRestricted) params.set('excludeRestricted', '0');
  else params.delete('excludeRestricted');

  const hasRanges = Object.keys(search.numericRanges).length > 0;
  if (hasRanges) params.set('ranges', JSON.stringify(search.numericRanges));
  else params.delete('ranges');

  params.set('wb', encodeWorkbenchSnapshot(args.workbenchSnapshot));

  if (args.abilityTreeState && Object.keys(args.abilityTreeState.selectedByClass ?? {}).length > 0) {
    params.set(
      'atree',
      base64UrlEncode(
        JSON.stringify({
          version: args.abilityTreeState.version ?? null,
          selectedByClass: args.abilityTreeState.selectedByClass,
        }),
      ),
    );
  } else {
    params.delete('atree');
  }

  if (args.mode) params.set('mode', args.mode);
  else params.delete('mode');

  const hash = args.legacyHash ?? args.workbenchSnapshot.legacyHash;
  url.hash = hash ? `#${hash}` : '';

  if (args.replace) {
    window.history.replaceState({}, '', url);
  } else {
    window.history.pushState({}, '', url);
  }
}
