import LZString from 'lz-string';
import { z } from 'zod';
import type { SearchFilterState } from '@/domain/search/filter-schema';
import { DEFAULT_SEARCH_FILTER_STATE, sanitizeSearchFilterState } from '@/domain/search/filter-schema';
import type { WorkbenchSnapshot } from '@/domain/build/types';
import type { AbilityTreeUrlState } from '@/domain/ability-tree/types';
import { ITEM_CATEGORY_KEYS, ITEM_SLOTS } from '@/domain/items/types';

/** Short slot keys for compact URL encoding (like legacy) */
const SLOT_SHORT: Record<string, string> = {
  helmet: 'h', chestplate: 'c', leggings: 'l', boots: 'b',
  ring1: 'r1', ring2: 'r2', bracelet: 'br', necklace: 'n', weapon: 'w',
};
const SLOT_LONG: Record<string, string> = Object.fromEntries(
  Object.entries(SLOT_SHORT).map(([k, v]) => [v, k]),
);

const wbUrlSnapshotSchema = z.object({
  slots: z.record(z.string(), z.number().int().nullable()).optional(),
  binsByCategory: z.record(z.string(), z.array(z.number().int())).optional(),
  locks: z.record(z.string(), z.boolean()).optional(),
  level: z.number().int().min(1).max(106).optional(),
  characterClass: z.enum(['Warrior', 'Assassin', 'Mage', 'Archer', 'Shaman']).nullable().optional(),
  selectedSlot: z.string().nullable().optional(),
  legacyHash: z.string().nullable().optional(),
}).passthrough();

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

function decodeParam(value: string): string | null {
  const decompressed = LZString.decompressFromEncodedURIComponent(value);
  if (decompressed != null && decompressed !== '') return decompressed;
  try {
    return base64UrlDecode(value);
  } catch {
    return null;
  }
}

function encodeParam(value: string): string {
  const compressed = LZString.compressToEncodedURIComponent(value);
  return compressed;
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
  const sortParam = url.searchParams.get('sort');
  const sortKeys = sortParam ? sortParam.split(',').map((s) => s.trim()).filter(Boolean) : [];
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
  const exclusionRanges = jsonParse<SearchFilterState['exclusionRanges']>(
    url.searchParams.get('excludeRanges') ?? '',
  ) ?? {};
  const resultsBelow = url.searchParams.get('resultsBelow');

  return sanitizeSearchFilterState({
    ...DEFAULT_SEARCH_FILTER_STATE,
    text: q,
    sortKeys: sortKeys.length > 0 ? sortKeys : DEFAULT_SEARCH_FILTER_STATE.sortKeys,
    sortDescending: sdesc === null ? DEFAULT_SEARCH_FILTER_STATE.sortDescending : sdesc !== '0',
    viewMode: view ?? DEFAULT_SEARCH_FILTER_STATE.viewMode,
    onlyWearableAtLevel: wear ? Number(wear) : DEFAULT_SEARCH_FILTER_STATE.onlyWearableAtLevel,
    onlyClassCompatible: classCompat === '1',
    // Default: include restricted items (false). Legacy links with excludeRestricted=0 still mean "include".
    excludeRestricted: exRes === null ? false : exRes !== '0',
    categories: cats,
    types,
    tiers,
    classReqs,
    majorIds,
    numericRanges,
    exclusionRanges,
    resultsBelowBuild: resultsBelow === null ? DEFAULT_SEARCH_FILTER_STATE.resultsBelowBuild : resultsBelow === '1',
  });
}

function normalizeWbPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const slots = raw.s ?? raw.slots;
  const locks = raw.k ?? raw.locks;
  const level = raw.l ?? raw.level;
  const characterClass = raw.c ?? raw.characterClass;
  const legacyHash = raw.h ?? raw.legacyHash;
  let selectedSlot = raw.selectedSlot;
  if (typeof selectedSlot === 'string' && SLOT_LONG[selectedSlot]) {
    selectedSlot = SLOT_LONG[selectedSlot];
  }
  const binsByCategory = raw.binsByCategory;
  if (slots && typeof slots === 'object') {
    const expanded: Record<string, number | null> = {};
    for (const [key, val] of Object.entries(slots)) {
      const slot = SLOT_LONG[key] ?? key;
      expanded[slot] = (typeof val === 'number' || val === null) ? val : null;
    }
    raw = { ...raw, slots: expanded };
  }
  if (locks && typeof locks === 'object') {
    const expanded: Record<string, boolean> = {};
    for (const [key, val] of Object.entries(locks)) {
      const slot = SLOT_LONG[key] ?? key;
      expanded[slot] = Boolean(val);
    }
    raw = { ...raw, locks: expanded };
  }
  if (level !== undefined) raw = { ...raw, level };
  if (characterClass !== undefined) raw = { ...raw, characterClass };
  if (legacyHash !== undefined) raw = { ...raw, legacyHash };
  if (selectedSlot !== undefined) raw = { ...raw, selectedSlot: selectedSlot as string };
  if (binsByCategory !== undefined) raw = { ...raw, binsByCategory };
  return raw;
}

export function parseWorkbenchPatchFromUrl(url: URL): Partial<WorkbenchSnapshot> | null {
  const wb = url.searchParams.get('wb');
  if (!wb) return null;
  try {
    const decoded = decodeParam(wb);
    if (!decoded) return null;
    const raw = JSON.parse(decoded) as Record<string, unknown>;
    const normalized = normalizeWbPayload(raw);
    const parsed = wbUrlSnapshotSchema.parse(normalized);
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
    const decoded = decodeParam(raw);
    if (!decoded) return null;
    const atreeRaw = JSON.parse(decoded) as Record<string, unknown>;
    const parsed = atreeUrlStateSchema.parse({
      version: atreeRaw.v ?? atreeRaw.version,
      selectedByClass: atreeRaw.s ?? atreeRaw.selectedByClass,
    });
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
  // Compact payload with short keys + LZ compression (like legacy). Bins omitted.
  const s: Record<string, number | null> = {};
  for (const [slot, id] of Object.entries(snapshot.slots)) {
    const key = SLOT_SHORT[slot] ?? slot;
    s[key] = id;
  }
  const k: Record<string, boolean> = {};
  for (const [slot, v] of Object.entries(snapshot.locks)) {
    if (v) k[SLOT_SHORT[slot] ?? slot] = true;
  }
  const payload = {
    s,
    k: Object.keys(k).length > 0 ? k : undefined,
    l: snapshot.level,
    c: snapshot.characterClass,
    h: snapshot.legacyHash,
  };
  return encodeParam(JSON.stringify(payload));
}

export function writeUrlState(args: {
  search?: SearchFilterState;
  workbenchSnapshot: WorkbenchSnapshot;
  legacyHash?: string | null;
  mode?: string | null;
  abilityTreeState?: AbilityTreeUrlState | null;
  replace?: boolean;
}): void {
  const url = new URL(window.location.origin + window.location.pathname);
  const params = url.searchParams;

  // Only persist build data: workbench snapshot + ability tree. No search state.
  params.set('wb', encodeWorkbenchSnapshot(args.workbenchSnapshot));

  if (args.abilityTreeState && Object.keys(args.abilityTreeState.selectedByClass ?? {}).length > 0) {
    params.set(
      'atree',
      encodeParam(
        JSON.stringify({
          v: args.abilityTreeState.version ?? null,
          s: args.abilityTreeState.selectedByClass,
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
