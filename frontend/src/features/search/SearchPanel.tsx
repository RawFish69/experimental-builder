import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CatalogSnapshot, ItemSlot } from '@/domain/items/types';
import { categoryLabel, ITEM_CATEGORY_KEYS, slotToCategory } from '@/domain/items/types';
import type { SearchFilterState, SearchResultPage } from '@/domain/search/filter-schema';
import { DEFAULT_SEARCH_FILTER_STATE, mergeSearchState } from '@/domain/search/filter-schema';
import { Button, ChipButton, FieldLabel, Panel } from '@/components/ui';
import { ItemCard } from '@/features/workbench/ItemCard';

const PRESET_STORAGE_KEY = 'workbench-search-presets:v1';
const PRIMARY_RANGE_KEYS = ['level', 'baseDps', 'ehpProxy', 'offenseScore', 'skillPointTotal', 'powderSlots'] as const;

interface SearchPreset {
  name: string;
  state: SearchFilterState;
}

function loadPresets(): SearchPreset[] {
  try {
    const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SearchPreset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePresets(presets: SearchPreset[]): void {
  window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
}

function toggleString(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function ResultList(props: {
  catalog: CatalogSnapshot;
  result: SearchResultPage | null;
  selectedSlot: ItemSlot | null;
  state: SearchFilterState;
  loading: boolean;
  onPin(itemId: number): void;
  onEquip(itemId: number): void;
  onHover(itemId: number | null, slot: ItemSlot | null): void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rows = props.result?.rows ?? [];
  const deferredRows = useDeferredValue(rows);
  const virtualizer = useVirtualizer({
    count: deferredRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (props.state.viewMode === 'grid' ? 178 : 208),
    overscan: 6,
  });

  return (
    <div className="min-h-0 flex-1">
      <div className="mb-2 flex items-center justify-between text-xs text-[var(--wb-muted)]">
        <span>{props.loading ? 'Searching...' : props.result ? `${props.result.total.toLocaleString()} results` : 'Loading...'}</span>
        <span>{props.state.sort}{props.state.sortDescending ? ' ↓' : ' ↑'}</span>
      </div>
      <div ref={parentRef} className="wb-scrollbar h-[calc(100vh-26rem)] overflow-auto rounded-xl border border-[var(--wb-border-muted)] bg-black/10">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = deferredRows[virtualRow.index];
            const item = props.catalog.itemsById.get(row.id);
            if (!item) return null;
            const selectedSlotMatches =
              props.selectedSlot != null && slotToCategory(props.selectedSlot) === item.category;
            return (
              <div
                key={row.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                  padding: '8px',
                }}
              >
                <ItemCard
                  item={item}
                  dragData={{ kind: 'search', itemId: item.id }}
                  onPin={() => props.onPin(item.id)}
                  onEquip={() => props.onEquip(item.id)}
                  onHover={(hovering) => props.onHover(hovering ? item.id : null, hovering ? props.selectedSlot : null)}
                  badge={selectedSlotMatches ? `Fits ${props.selectedSlot}` : undefined}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SearchPanel(props: {
  catalog: CatalogSnapshot;
  state: SearchFilterState;
  setState(next: SearchFilterState): void;
  result: SearchResultPage | null;
  loading: boolean;
  selectedSlot: ItemSlot | null;
  onPin(itemId: number): void;
  onEquip(itemId: number): void;
  onHover(itemId: number | null, slot: ItemSlot | null): void;
  onOpenAutoBuilder(): void;
}) {
  const [presets, setPresets] = useState<SearchPreset[]>(() => (typeof window === 'undefined' ? [] : loadPresets()));
  const majorIdSuggestions = useMemo(() => props.catalog.facetsMeta.majorIds.slice(0, 20), [props.catalog]);
  const facetCounts = props.result?.facetCounts;

  useEffect(() => {
    if (typeof window !== 'undefined') savePresets(presets);
  }, [presets]);

  const updateState = (patch: Partial<SearchFilterState>) => props.setState(mergeSearchState(props.state, patch));

  return (
    <Panel
      className="flex min-h-0 flex-col"
      title={
        <div className="flex items-center gap-2">
          <Search size={15} />
          Advanced Item Search
        </div>
      }
      headerRight={
        <Button className="px-2 py-1 text-xs" onClick={props.onOpenAutoBuilder}>
          <Sparkles size={12} className="mr-1 inline" />
          Auto Builder
        </Button>
      }
    >
      <div className="flex min-h-0 flex-col gap-3 p-3">
        <div>
          <FieldLabel>Search Text</FieldLabel>
          <input
            className="wb-input"
            placeholder="Name, lore, major ID..."
            value={props.state.text}
            onChange={(e) => updateState({ text: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel>Sort</FieldLabel>
            <select
              className="wb-select"
              value={props.state.sort}
              onChange={(e) => updateState({ sort: e.target.value as SearchFilterState['sort'] })}
            >
              <option value="relevance">Relevance</option>
              <option value="level">Level</option>
              <option value="baseDps">Base DPS</option>
              <option value="ehpProxy">EHP Proxy</option>
              <option value="offenseScore">Offense Score</option>
              <option value="skillPointTotal">Skill Point Total</option>
            </select>
          </div>
          <div>
            <FieldLabel>View</FieldLabel>
            <div className="flex gap-2">
              <ChipButton active={props.state.viewMode === 'list'} onClick={() => updateState({ viewMode: 'list' })}>
                List
              </ChipButton>
              <ChipButton active={props.state.viewMode === 'grid'} onClick={() => updateState({ viewMode: 'grid' })}>
                Grid
              </ChipButton>
              <ChipButton
                active={props.state.sortDescending}
                onClick={() => updateState({ sortDescending: !props.state.sortDescending })}
                title="Toggle descending"
              >
                {props.state.sortDescending ? 'Desc' : 'Asc'}
              </ChipButton>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">
            <SlidersHorizontal size={13} />
            Category
          </div>
          <div className="flex flex-wrap gap-2">
            {ITEM_CATEGORY_KEYS.map((category) => (
              <ChipButton
                key={category}
                active={props.state.categories.includes(category)}
                onClick={() => updateState({ categories: toggleString(props.state.categories, category) as SearchFilterState['categories'] })}
              >
                {categoryLabel(category)}
                {facetCounts?.categories[category] ? ` (${facetCounts.categories[category]})` : ''}
              </ChipButton>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel>Wearable At Level</FieldLabel>
            <input
              className="wb-input"
              type="number"
              min={1}
              max={106}
              value={props.state.onlyWearableAtLevel ?? ''}
              onChange={(e) => {
                const v = e.target.value.trim();
                updateState({ onlyWearableAtLevel: v ? Number(v) : null });
              }}
            />
          </div>
          <div>
            <FieldLabel>Class Filter</FieldLabel>
            <select
              className="wb-select"
              value={props.state.classReqs[0] ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                updateState({ classReqs: value ? [value as SearchFilterState['classReqs'][number]] : [] });
              }}
            >
              <option value="">Any</option>
              {props.catalog.facetsMeta.classReqs.map((cls) => (
                <option key={cls} value={cls}>
                  {cls}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ChipButton
            active={props.state.onlyClassCompatible}
            onClick={() => updateState({ onlyClassCompatible: !props.state.onlyClassCompatible })}
          >
            Only class-compatible
          </ChipButton>
          <ChipButton
            active={props.state.excludeRestricted}
            onClick={() => updateState({ excludeRestricted: !props.state.excludeRestricted })}
          >
            Exclude restricted
          </ChipButton>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {PRIMARY_RANGE_KEYS.map((rangeKey) => {
            const current = props.state.numericRanges[rangeKey] ?? {};
            const metaRange = props.catalog.facetsMeta.numericRanges[rangeKey === 'powderSlots' ? 'slots' : rangeKey];
            return (
              <div key={rangeKey} className="wb-card p-2">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">{rangeKey}</div>
                <div className="grid grid-cols-2 gap-1">
                  <input
                    className="wb-input"
                    type="number"
                    placeholder={metaRange ? String(Math.floor(metaRange.min)) : 'min'}
                    value={current.min ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      updateState({
                        numericRanges: {
                          ...props.state.numericRanges,
                          [rangeKey]: { ...current, min: v === '' ? undefined : Number(v) },
                        },
                      });
                    }}
                  />
                  <input
                    className="wb-input"
                    type="number"
                    placeholder={metaRange ? String(Math.ceil(metaRange.max)) : 'max'}
                    value={current.max ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      updateState({
                        numericRanges: {
                          ...props.state.numericRanges,
                          [rangeKey]: { ...current, max: v === '' ? undefined : Number(v) },
                        },
                      });
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <FieldLabel>Major IDs (quick picks)</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {majorIdSuggestions.map((majorId) => (
              <ChipButton
                key={majorId}
                active={props.state.majorIds.includes(majorId)}
                onClick={() => updateState({ majorIds: toggleString(props.state.majorIds, majorId) })}
                title={majorId}
              >
                {majorId}
              </ChipButton>
            ))}
          </div>
        </div>

        <div className="wb-card p-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">Filter Presets</div>
            <div className="flex gap-2">
              <Button
                className="px-2 py-1 text-xs"
                variant="ghost"
                onClick={() => {
                  const name = window.prompt('Preset name?')?.trim();
                  if (!name) return;
                  const next = [
                    { name, state: props.state },
                    ...presets.filter((preset) => preset.name.toLowerCase() !== name.toLowerCase()),
                  ].slice(0, 20);
                  setPresets(next);
                }}
              >
                Save
              </Button>
              <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => props.setState(DEFAULT_SEARCH_FILTER_STATE)}>
                Reset
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {presets.length === 0 ? (
              <span className="text-xs text-[var(--wb-muted)]">No saved presets yet.</span>
            ) : (
              presets.map((preset) => (
                <div key={preset.name} className="flex items-center gap-1">
                  <ChipButton onClick={() => props.setState(preset.state)}>{preset.name}</ChipButton>
                  <button
                    className="rounded-md border border-[var(--wb-border)] px-1.5 py-0.5 text-xs text-[var(--wb-muted)] hover:bg-white/5"
                    onClick={() => setPresets((prev) => prev.filter((x) => x.name !== preset.name))}
                    title={`Delete ${preset.name}`}
                  >
                    x
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <ResultList
          catalog={props.catalog}
          result={props.result}
          selectedSlot={props.selectedSlot}
          state={props.state}
          loading={props.loading}
          onPin={props.onPin}
          onEquip={props.onEquip}
          onHover={props.onHover}
        />
      </div>
    </Panel>
  );
}
