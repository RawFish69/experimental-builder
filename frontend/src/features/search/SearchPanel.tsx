import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CatalogSnapshot, ItemSlot } from '@/domain/items/types';
import { categoryLabel, ITEM_CATEGORY_KEYS, slotToCategory } from '@/domain/items/types';
import { formatNumericIdLabel } from '@/domain/items/numeric-id-labels';
import type { SearchFilterState, SearchResultPage } from '@/domain/search/filter-schema';
import { DEFAULT_SEARCH_FILTER_STATE, mergeSearchState } from '@/domain/search/filter-schema';
import { Button, ChipButton, FieldLabel, Panel } from '@/components/ui';
import { ItemCard, ItemDetailStats } from '@/features/workbench/ItemCard';

const PRESET_STORAGE_KEY = 'workbench-search-presets:v2';

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

const ROW_HEIGHT_SIDEBAR = 88;
const ROW_HEIGHT_BELOW = 84;

function SearchResultItem(props: {
  catalog: CatalogSnapshot;
  itemId: number;
  selectedSlot: ItemSlot | null;
  onPin(itemId: number): void;
  onEquip(itemId: number): void;
  onHover(itemId: number | null, slot: ItemSlot | null): void;
  onHoverForStats(itemId: number | null, rect: DOMRect | null): void;
}) {
  const item = props.catalog.itemsById.get(props.itemId);
  if (!item) return null;
  const selectedSlotMatches =
    props.selectedSlot != null && slotToCategory(props.selectedSlot) === item.category;

  return (
    <div
      className="relative"
      onMouseEnter={(e) => props.onHoverForStats(props.itemId, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => props.onHoverForStats(null, null)}
    >
      <ItemCard
        item={item}
        compact
        dense
        dragData={{ kind: 'search', itemId: item.id }}
        onPin={() => props.onPin(item.id)}
        onEquip={() => props.onEquip(item.id)}
        onHover={(hovering) => props.onHover(hovering ? item.id : null, hovering ? props.selectedSlot : null)}
        badge={selectedSlotMatches ? `Fits ${props.selectedSlot}` : undefined}
      />
    </div>
  );
}

export function SearchResultList(props: {
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
  const [hoveredForStats, setHoveredForStats] = useState<{ itemId: number; rect: DOMRect } | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const setHovered = (val: { itemId: number; rect: DOMRect } | null) => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setHoveredForStats(val);
  };

  const scheduleHide = () => {
    hideTimerRef.current = window.setTimeout(() => setHoveredForStats(null), 120);
  };

  const isSidebar = !props.state.resultsBelowBuild;
  const itemsPerRow = isSidebar ? 1 : 3;
  const rowHeight = isSidebar ? ROW_HEIGHT_SIDEBAR : ROW_HEIGHT_BELOW;
  const rowCount = Math.ceil(deferredRows.length / itemsPerRow);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 4,
  });

  const hoveredItem = hoveredForStats ? props.catalog.itemsById.get(hoveredForStats.itemId) : null;

  return (
    <div className="min-h-0 flex-1">
      <div className="mb-2 flex items-center justify-between text-xs text-[var(--wb-muted)]">
        <span>{props.loading ? 'Searching...' : props.result ? `${props.result.total.toLocaleString()} results` : 'Loading...'}</span>
        <span>
          {(props.state.sortKeys ?? ['relevance']).map((k) => formatNumericIdLabel(k)).join(' → ')}
          {props.state.sortDescending ? ' ↓' : ' ↑'}
        </span>
      </div>
      <div ref={parentRef} className="wb-scrollbar h-[calc(100vh-26rem)] overflow-auto rounded-xl border border-[var(--wb-border-muted)] bg-black/10">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const baseIdx = virtualRow.index * itemsPerRow;
            const rowItems = deferredRows.slice(baseIdx, baseIdx + itemsPerRow);
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                  padding: '6px 8px',
                }}
                className={isSidebar ? 'grid grid-cols-1' : 'grid grid-cols-2 gap-2 xl:grid-cols-3'}
              >
                {rowItems.map((r) => (
                  <SearchResultItem
                    key={r.id}
                    catalog={props.catalog}
                    itemId={r.id}
                    selectedSlot={props.selectedSlot}
                    onPin={props.onPin}
                    onEquip={props.onEquip}
                    onHover={props.onHover}
                    onHoverForStats={(id, rect) => {
                    if (id != null && rect) setHovered({ itemId: id, rect });
                    else scheduleHide();
                  }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {hoveredItem && hoveredForStats
        ? createPortal(
            <div
              className="fixed z-[100] w-72 max-h-[80vh] overflow-auto rounded-xl border border-[var(--wb-border)] bg-[var(--wb-panel)] p-2.5 shadow-xl"
              style={{
                left: Math.min(hoveredForStats.rect.right + 8, window.innerWidth - 296),
                top: hoveredForStats.rect.top,
              }}
              onMouseEnter={() => {
                if (hideTimerRef.current) {
                  window.clearTimeout(hideTimerRef.current);
                  hideTimerRef.current = null;
                }
              }}
              onMouseLeave={() => setHoveredForStats(null)}
            >
              <div className="mb-1.5 break-words text-xs font-semibold text-[var(--wb-text)]">{hoveredItem.displayName}</div>
              <ItemDetailStats item={hoveredItem} dense />
            </div>,
            document.body,
          )
        : null}
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
}) {
  const [presets, setPresets] = useState<SearchPreset[]>(() => (typeof window === 'undefined' ? [] : loadPresets()));
  const majorIdSuggestions = useMemo(() => props.catalog.facetsMeta.majorIds.slice(0, 20), [props.catalog]);
  const facetCounts = props.result?.facetCounts;

  const sortIdOptions = useMemo(() => {
    const catalogKeys = Object.keys(props.catalog.facetsMeta.numericRanges)
      .filter((k) => !['relevance', 'level', 'baseDps'].includes(k));
    const sorted = catalogKeys.sort((a, b) => formatNumericIdLabel(a).localeCompare(formatNumericIdLabel(b)));
    return ['relevance', 'level', 'baseDps', ...sorted];
  }, [props.catalog.facetsMeta.numericRanges]);

  const filterIdOptions = useMemo(() => {
    const catalogKeys = Object.keys(props.catalog.facetsMeta.numericRanges);
    const extras = ['level', 'baseDps', 'slots'].filter((k) => !catalogKeys.includes(k));
    return [...extras, ...catalogKeys]
      .sort((a, b) => formatNumericIdLabel(a).localeCompare(formatNumericIdLabel(b)));
  }, [props.catalog.facetsMeta.numericRanges]);

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
      headerRight={null}
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

        <div className="flex items-center gap-2">
          <FieldLabel className="mb-0 shrink-0">Results</FieldLabel>
          <ChipButton
            active={props.state.resultsBelowBuild}
            onClick={() => updateState({ resultsBelowBuild: !props.state.resultsBelowBuild })}
            title="Toggle: show below Workbench or in sidebar"
          >
            {props.state.resultsBelowBuild ? 'Below build' : 'In sidebar'}
          </ChipButton>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel>Sort by</FieldLabel>
            <div className="flex flex-col gap-1">
              {(props.state.sortKeys ?? ['relevance']).map((key, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <select
                    className="wb-select flex-1"
                    value={key}
                    onChange={(e) => {
                      const next = [...(props.state.sortKeys ?? ['relevance'])];
                      next[idx] = e.target.value;
                      updateState({ sortKeys: next });
                    }}
                  >
                    {sortIdOptions.map((k) => (
                      <option key={k} value={k}>
                        {formatNumericIdLabel(k)}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    className="shrink-0 px-1"
                    onClick={() => {
                      const next = (props.state.sortKeys ?? ['relevance']).filter((_, i) => i !== idx);
                      if (next.length === 0) next.push('relevance');
                      updateState({ sortKeys: next });
                    }}
                    title="Remove sort"
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                className="self-start text-xs"
                onClick={() => {
                  const current = props.state.sortKeys ?? ['relevance'];
                  const next = sortIdOptions.find((k) => !current.includes(k)) ?? sortIdOptions[0];
                  updateState({ sortKeys: [...current, next] });
                }}
                disabled={(props.state.sortKeys ?? ['relevance']).length >= 8}
              >
                + Add sort level
              </Button>
            </div>
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

        <details className="group">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)] flex items-center gap-2">
            <SlidersHorizontal size={13} />
            Advanced ID Filters
          </summary>
          <div className="mt-3 grid gap-2">
            <div className="text-xs text-[var(--wb-muted)]">
              Set min/max for any ID (e.g. mr, sdPct, ehpProxy). Items outside ranges are excluded.
            </div>
            {Object.entries(props.state.numericRanges).map(([rangeKey, current]) => {
              const metaKey = rangeKey === 'powderSlots' ? 'slots' : rangeKey === 'level' ? 'lvl' : rangeKey === 'baseDps' ? 'averageDps' : rangeKey;
              const metaRange = props.catalog.facetsMeta.numericRanges[metaKey];
              const cur = current ?? {};
              return (
                <div key={rangeKey} className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--wb-border-muted)] p-2">
                  <div className="min-w-[120px] flex-1">
                    <FieldLabel>ID</FieldLabel>
                    <select
                      className="wb-select w-full"
                      value={rangeKey}
                      onChange={(e) => {
                        const next = { ...props.state.numericRanges };
                        delete next[rangeKey];
                        next[e.target.value] = cur;
                        updateState({ numericRanges: next });
                      }}
                    >
                      {filterIdOptions.map((k) => (
                        <option key={k} value={k} disabled={k !== rangeKey && k in props.state.numericRanges}>
                          {formatNumericIdLabel(k)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-[70px]">
                    <FieldLabel>Min</FieldLabel>
                    <input
                      className="wb-input w-full"
                      type="number"
                      placeholder={metaRange ? String(Math.floor(metaRange.min)) : 'min'}
                      value={cur.min ?? ''}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        updateState({
                          numericRanges: {
                            ...props.state.numericRanges,
                            [rangeKey]: { ...cur, min: v === '' ? undefined : Number(v) },
                          },
                        });
                      }}
                    />
                  </div>
                  <div className="min-w-[70px]">
                    <FieldLabel>Max</FieldLabel>
                    <input
                      className="wb-input w-full"
                      type="number"
                      placeholder={metaRange ? String(Math.ceil(metaRange.max)) : 'max'}
                      value={cur.max ?? ''}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        updateState({
                          numericRanges: {
                            ...props.state.numericRanges,
                            [rangeKey]: { ...cur, max: v === '' ? undefined : Number(v) },
                          },
                        });
                      }}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => {
                      const next = { ...props.state.numericRanges };
                      delete next[rangeKey];
                      updateState({ numericRanges: next });
                    }}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
            <Button
              variant="ghost"
              onClick={() => {
                const used = new Set(Object.keys(props.state.numericRanges));
                const first = filterIdOptions.find((k) => !used.has(k));
                if (first) updateState({ numericRanges: { ...props.state.numericRanges, [first]: {} } });
              }}
              disabled={filterIdOptions.every((k) => k in props.state.numericRanges)}
            >
              Add ID Filter
            </Button>
          </div>
        </details>

        <details className="group">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)] flex items-center gap-2">
            Exclusion (IDs to avoid)
          </summary>
          <div className="mt-3 grid gap-2">
            <div className="text-xs text-[var(--wb-muted)]">
              Exclude items that exceed max (or are below min). E.g. mr max 20 = exclude items with mana regen &gt; 20.
            </div>
            {Object.entries(props.state.exclusionRanges ?? {}).map(([rangeKey, current]) => {
              const metaKey = rangeKey === 'powderSlots' ? 'slots' : rangeKey === 'level' ? 'lvl' : rangeKey === 'baseDps' ? 'averageDps' : rangeKey;
              const metaRange = props.catalog.facetsMeta.numericRanges[metaKey];
              const cur = current ?? {};
              return (
                <div key={rangeKey} className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--wb-border-muted)] border-amber-500/30 p-2">
                  <div className="min-w-[120px] flex-1">
                    <FieldLabel>Avoid ID</FieldLabel>
                    <select
                      className="wb-select w-full"
                      value={rangeKey}
                      onChange={(e) => {
                        const next = { ...(props.state.exclusionRanges ?? {}) };
                        delete next[rangeKey];
                        next[e.target.value] = cur;
                        updateState({ exclusionRanges: next });
                      }}
                    >
                      {filterIdOptions.map((k) => (
                        <option key={k} value={k} disabled={k !== rangeKey && k in (props.state.exclusionRanges ?? {})}>
                          {formatNumericIdLabel(k)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-[70px]">
                    <FieldLabel>Max (exclude if &gt;)</FieldLabel>
                    <input
                      className="wb-input w-full"
                      type="number"
                      placeholder={metaRange ? String(Math.ceil(metaRange.max)) : 'max'}
                      value={cur.max ?? ''}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        updateState({
                          exclusionRanges: {
                            ...(props.state.exclusionRanges ?? {}),
                            [rangeKey]: { ...cur, max: v === '' ? undefined : Number(v) },
                          },
                        });
                      }}
                    />
                  </div>
                  <div className="min-w-[70px]">
                    <FieldLabel>Min (exclude if &lt;)</FieldLabel>
                    <input
                      className="wb-input w-full"
                      type="number"
                      placeholder="min"
                      value={cur.min ?? ''}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        updateState({
                          exclusionRanges: {
                            ...(props.state.exclusionRanges ?? {}),
                            [rangeKey]: { ...cur, min: v === '' ? undefined : Number(v) },
                          },
                        });
                      }}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => {
                      const next = { ...(props.state.exclusionRanges ?? {}) };
                      delete next[rangeKey];
                      updateState({ exclusionRanges: next });
                    }}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
            <Button
              variant="ghost"
              onClick={() => {
                const used = new Set(Object.keys(props.state.exclusionRanges ?? {}));
                const first = filterIdOptions.find((k) => !used.has(k));
                if (first) updateState({ exclusionRanges: { ...(props.state.exclusionRanges ?? {}), [first]: {} } });
              }}
              disabled={filterIdOptions.every((k) => k in (props.state.exclusionRanges ?? {}))}
            >
              Add exclusion
            </Button>
          </div>
        </details>

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

        {!props.state.resultsBelowBuild ? (
          <SearchResultList
            catalog={props.catalog}
            result={props.result}
            selectedSlot={props.selectedSlot}
            state={props.state}
            loading={props.loading}
            onPin={props.onPin}
            onEquip={props.onEquip}
            onHover={props.onHover}
          />
        ) : null}
      </div>
    </Panel>
  );
}
