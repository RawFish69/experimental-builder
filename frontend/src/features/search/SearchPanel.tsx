import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CatalogSnapshot, ItemSlot } from '@/domain/items/types';
import { categoryLabel, ITEM_CATEGORY_KEYS, slotToCategory } from '@/domain/items/types';
import { formatNumericIdLabel } from '@/domain/items/numeric-id-labels';
import type { SearchFilterState, SearchResultPage } from '@/domain/search/filter-schema';
import { DEFAULT_SEARCH_FILTER_STATE, mergeSearchState } from '@/domain/search/filter-schema';
import { Button, ChipButton, cn, FieldLabel } from '@/components/ui';
import { ItemRow, ItemCard, ItemDetailStats } from '@/components/ItemDisplay';

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

const ROW_ESTIMATE_HEIGHT_SIDEBAR = 44;
const ROW_ESTIMATE_HEIGHT_BELOW = 200;
const PAGE_SIZE = 50;

function SearchResultItem(props: {
  catalog: CatalogSnapshot;
  itemId: number;
  selectedSlot: ItemSlot | null;
  isSidebar: boolean;
  onPin(itemId: number): void;
  onEquip(itemId: number): void;
  onHover(itemId: number | null, slot: ItemSlot | null): void;
  onHoverForStats(itemId: number | null, rect: DOMRect | null): void;
}) {
  const item = props.catalog.itemsById.get(props.itemId);
  if (!item) return null;
  const selectedSlotMatches =
    props.selectedSlot != null && slotToCategory(props.selectedSlot) === item.category;

  if (props.isSidebar) {
    return (
      <div
        onMouseEnter={(e) => props.onHoverForStats(props.itemId, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => props.onHoverForStats(null, null)}
      >
        <ItemRow
          item={item}
          dragData={{ kind: 'search', itemId: item.id }}
          onPin={() => props.onPin(item.id)}
          onEquip={() => props.onEquip(item.id)}
          onHover={(hovering) => props.onHover(hovering ? item.id : null, hovering ? props.selectedSlot : null)}
          badge={selectedSlotMatches ? `Fits ${props.selectedSlot}` : undefined}
        />
      </div>
    );
  }

  return (
    <div
      onMouseEnter={(e) => props.onHoverForStats(props.itemId, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => props.onHoverForStats(null, null)}
    >
      <ItemCard
        item={item}
        compact
        showDetails={false}
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
  embedded?: boolean;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rows = props.result?.rows ?? [];
  const deferredRows = useDeferredValue(rows);
  const [page, setPage] = useState(0);
  const [hoveredForStats, setHoveredForStats] = useState<{ itemId: number; rect: DOMRect } | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const totalItems = deferredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const clampedPage = Math.min(page, Math.max(0, totalPages - 1));
  const pageRows = deferredRows.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [props.result]);

  const setHovered = (val: { itemId: number; rect: DOMRect } | null) => {
    if (hideTimerRef.current) { window.clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setHoveredForStats(val);
  };

  const scheduleHide = () => {
    hideTimerRef.current = window.setTimeout(() => setHoveredForStats(null), 120);
  };

  const isSidebar = !props.state.resultsBelowBuild;
  const itemsPerRow = isSidebar ? 1 : 3;
  const rowHeightEstimate = isSidebar ? ROW_ESTIMATE_HEIGHT_SIDEBAR : ROW_ESTIMATE_HEIGHT_BELOW;
  const rowCount = Math.ceil(pageRows.length / itemsPerRow);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeightEstimate,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 6,
  });

  const hoveredItem = hoveredForStats ? props.catalog.itemsById.get(hoveredForStats.itemId) : null;

  const hasSearched = props.result != null || props.loading;
  const statusText = props.loading
    ? 'Searching...'
    : props.result
      ? `${props.result.total.toLocaleString()} results`
      : 'Search to see items';
  const startItem = totalItems === 0 ? 0 : clampedPage * PAGE_SIZE + 1;
  const endItem = Math.min((clampedPage + 1) * PAGE_SIZE, totalItems);

  return (
    <div className="min-h-0 flex-1">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1 px-1 text-[11px] text-[var(--wb-text-tertiary)]">
        <div className="flex items-center gap-2">
          <span>{statusText}</span>
          {hasSearched && totalItems > 0 && totalPages > 1 && (
            <span className="flex items-center gap-1">
              <button type="button" className="wb-inline-button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={clampedPage <= 0}>←</button>
              <span>{startItem}–{endItem}</span>
              <button type="button" className="wb-inline-button" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={clampedPage >= totalPages - 1}>→</button>
            </span>
          )}
        </div>
        {hasSearched && (
          <span className="text-[10px]">
            {(props.state.sortKeys ?? ['relevance']).map((k) => formatNumericIdLabel(k)).join(' → ')}
            {props.state.sortDescending ? ' ↓' : ' ↑'}
          </span>
        )}
      </div>
      <div
        ref={parentRef}
        className={cn(
          'wb-scrollbar overflow-auto rounded-md border border-[var(--wb-border-muted)] bg-[var(--wb-layer-1)]',
          props.embedded ? 'min-h-[140px] flex-1' : 'h-[calc(100vh-22rem)]',
        )}
      >
        {!hasSearched ? (
          <div className="flex min-h-[80px] items-center justify-center p-4 text-center text-[12px] text-[var(--wb-text-tertiary)]">
            Enter search text or apply filters to see items.
          </div>
        ) : pageRows.length === 0 ? (
          <div className="flex min-h-[80px] items-center justify-center p-4 text-center text-[12px] text-[var(--wb-text-tertiary)]">
            No items match.
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const baseIdx = virtualRow.index * itemsPerRow;
              const rowItems = pageRows.slice(baseIdx, baseIdx + itemsPerRow);
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    padding: isSidebar ? '1px 4px' : '4px 6px',
                  }}
                  className={isSidebar ? '' : 'grid grid-cols-2 gap-2 xl:grid-cols-3'}
                >
                  {rowItems.map((r) => (
                    <SearchResultItem
                      key={r.id}
                      catalog={props.catalog}
                      itemId={r.id}
                      selectedSlot={props.selectedSlot}
                      isSidebar={isSidebar}
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
        )}
      </div>

      {hoveredItem && hoveredForStats
        ? createPortal(
            <div
              className="fixed z-[100] w-64 max-h-[80vh] overflow-auto rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] p-2.5 shadow-lg"
              style={{
                left: Math.min(hoveredForStats.rect.right + 8, window.innerWidth - 270),
                top: Math.max(4, Math.min(hoveredForStats.rect.top, window.innerHeight - 400)),
              }}
              onMouseEnter={() => {
                if (hideTimerRef.current) { window.clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
              }}
              onMouseLeave={() => setHoveredForStats(null)}
            >
              <ItemDetailStats item={hoveredItem} />
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
  onSearch?: () => void;
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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Search header */}
      <div className="flex items-center gap-2 border-b border-[var(--wb-border-muted)] px-3 py-2">
        <Search size={13} className="shrink-0 text-[var(--wb-text-tertiary)]" />
        <span className="text-[13px] font-semibold">Item Search</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2 wb-scrollbar">
        {/* Search input + button */}
        <div className="flex gap-1.5">
          <input
            className="wb-input flex-1"
            placeholder="Name, lore, major ID..."
            value={props.state.text}
            onChange={(e) => updateState({ text: e.target.value })}
          />
          <Button
            variant="primary"
            className="shrink-0 px-2 py-1 text-[11px]"
            onClick={props.onSearch}
            disabled={props.loading}
          >
            {props.loading ? '...' : 'Search'}
          </Button>
        </div>

        {/* Results location toggle */}
        <div className="flex items-center gap-1.5">
          <FieldLabel className="mb-0 shrink-0">Show</FieldLabel>
          <ChipButton
            active={props.state.resultsBelowBuild}
            onClick={() => updateState({ resultsBelowBuild: !props.state.resultsBelowBuild })}
          >
            {props.state.resultsBelowBuild ? 'Below build' : 'In sidebar'}
          </ChipButton>
        </div>

        {/* Sort + View */}
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <FieldLabel>Sort</FieldLabel>
            <div className="flex flex-col gap-0.5">
              {(props.state.sortKeys ?? ['relevance']).map((key, idx) => (
                <div key={idx} className="flex items-center gap-0.5">
                  <select
                    className="wb-select flex-1 text-[11px]"
                    value={key}
                    onChange={(e) => {
                      const next = [...(props.state.sortKeys ?? ['relevance'])];
                      next[idx] = e.target.value;
                      updateState({ sortKeys: next });
                    }}
                  >
                    {sortIdOptions.map((k) => (
                      <option key={k} value={k}>{formatNumericIdLabel(k)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="wb-inline-button px-1 text-[11px]"
                    onClick={() => {
                      const next = (props.state.sortKeys ?? ['relevance']).filter((_, i) => i !== idx);
                      if (next.length === 0) next.push('relevance');
                      updateState({ sortKeys: next });
                    }}
                  >×</button>
                </div>
              ))}
              <button
                type="button"
                className="wb-inline-button self-start text-[10px]"
                onClick={() => {
                  const current = props.state.sortKeys ?? ['relevance'];
                  const next = sortIdOptions.find((k) => !current.includes(k)) ?? sortIdOptions[0];
                  updateState({ sortKeys: [...current, next] });
                }}
                disabled={(props.state.sortKeys ?? ['relevance']).length >= 8}
              >
                + Sort
              </button>
            </div>
          </div>
          <div>
            <FieldLabel>View</FieldLabel>
            <div className="flex flex-wrap gap-1">
              <ChipButton active={props.state.viewMode === 'list'} onClick={() => updateState({ viewMode: 'list' })}>List</ChipButton>
              <ChipButton active={props.state.viewMode === 'grid'} onClick={() => updateState({ viewMode: 'grid' })}>Grid</ChipButton>
              <ChipButton active={props.state.sortDescending} onClick={() => updateState({ sortDescending: !props.state.sortDescending })}>
                {props.state.sortDescending ? '↓' : '↑'}
              </ChipButton>
            </div>
          </div>
        </div>

        {/* Category chips */}
        <div>
          <FieldLabel className="flex items-center gap-1">
            <SlidersHorizontal size={10} /> Category
          </FieldLabel>
          <div className="flex flex-wrap gap-1">
            {ITEM_CATEGORY_KEYS.map((category) => (
              <ChipButton
                key={category}
                active={props.state.categories.includes(category)}
                onClick={() => updateState({ categories: toggleString(props.state.categories, category) as SearchFilterState['categories'] })}
              >
                {categoryLabel(category)}
                {facetCounts?.categories[category] ? ` ${facetCounts.categories[category]}` : ''}
              </ChipButton>
            ))}
          </div>
        </div>

        {/* Level + Class */}
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <FieldLabel>Wearable Lv</FieldLabel>
            <input
              className="wb-input"
              type="number"
              min={1}
              max={120}
              value={props.state.onlyWearableAtLevel ?? ''}
              onChange={(e) => {
                const v = e.target.value.trim();
                updateState({ onlyWearableAtLevel: v ? Number(v) : null });
              }}
            />
          </div>
          <div>
            <FieldLabel>Class</FieldLabel>
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
                <option key={cls} value={cls}>{cls}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          <ChipButton active={props.state.onlyClassCompatible} onClick={() => updateState({ onlyClassCompatible: !props.state.onlyClassCompatible })}>
            Class-compat
          </ChipButton>
          <ChipButton active={props.state.excludeRestricted} onClick={() => updateState({ excludeRestricted: !props.state.excludeRestricted })}>
            No restricted
          </ChipButton>
        </div>

        {/* Advanced ID Filters */}
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--wb-text-quaternary)]">
            <SlidersHorizontal size={10} /> ID Filters
          </summary>
          <div className="mt-1.5 grid gap-1.5">
            <div className="text-[10px] text-[var(--wb-text-quaternary)]">
              Set min/max for any stat. Items outside ranges are excluded.
            </div>
            {Object.entries(props.state.numericRanges).map(([rangeKey, current]) => {
              const metaKey = rangeKey === 'powderSlots' ? 'slots' : rangeKey === 'level' ? 'lvl' : rangeKey === 'baseDps' ? 'averageDps' : rangeKey;
              const metaRange = props.catalog.facetsMeta.numericRanges[metaKey];
              const cur = current ?? {};
              return (
                <div key={rangeKey} className="flex flex-wrap items-end gap-1 rounded border border-[var(--wb-border-muted)] p-1.5">
                  <div className="min-w-[90px] flex-1">
                    <FieldLabel>ID</FieldLabel>
                    <select className="wb-select text-[11px]" value={rangeKey} onChange={(e) => {
                      const next = { ...props.state.numericRanges };
                      delete next[rangeKey];
                      next[e.target.value] = cur;
                      updateState({ numericRanges: next });
                    }}>
                      {filterIdOptions.map((k) => (
                        <option key={k} value={k} disabled={k !== rangeKey && k in props.state.numericRanges}>{formatNumericIdLabel(k)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-16">
                    <FieldLabel>Min</FieldLabel>
                    <input className="wb-input text-[11px]" type="number" placeholder={metaRange ? String(Math.floor(metaRange.min)) : ''} value={cur.min ?? ''} onChange={(e) => {
                      const v = e.target.value.trim();
                      updateState({ numericRanges: { ...props.state.numericRanges, [rangeKey]: { ...cur, min: v === '' ? undefined : Number(v) } } });
                    }} />
                  </div>
                  <div className="w-16">
                    <FieldLabel>Max</FieldLabel>
                    <input className="wb-input text-[11px]" type="number" placeholder={metaRange ? String(Math.ceil(metaRange.max)) : ''} value={cur.max ?? ''} onChange={(e) => {
                      const v = e.target.value.trim();
                      updateState({ numericRanges: { ...props.state.numericRanges, [rangeKey]: { ...cur, max: v === '' ? undefined : Number(v) } } });
                    }} />
                  </div>
                  <button type="button" className="wb-inline-button text-[11px]" onClick={() => {
                    const next = { ...props.state.numericRanges };
                    delete next[rangeKey];
                    updateState({ numericRanges: next });
                  }}>×</button>
                </div>
              );
            })}
            <button type="button" className="wb-inline-button self-start text-[10px]" onClick={() => {
              const used = new Set(Object.keys(props.state.numericRanges));
              const first = filterIdOptions.find((k) => !used.has(k));
              if (first) updateState({ numericRanges: { ...props.state.numericRanges, [first]: {} } });
            }} disabled={filterIdOptions.every((k) => k in props.state.numericRanges)}>
              + Add filter
            </button>
          </div>
        </details>

        {/* Exclusion Filters */}
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--wb-text-quaternary)]">
            Exclusions
          </summary>
          <div className="mt-1.5 grid gap-1.5">
            {Object.entries(props.state.exclusionRanges ?? {}).map(([rangeKey, current]) => {
              const cur = current ?? {};
              return (
                <div key={rangeKey} className="flex flex-wrap items-end gap-1 rounded border border-[var(--wb-warn-border)] p-1.5">
                  <div className="min-w-[90px] flex-1">
                    <FieldLabel>Avoid</FieldLabel>
                    <select className="wb-select text-[11px]" value={rangeKey} onChange={(e) => {
                      const next = { ...(props.state.exclusionRanges ?? {}) };
                      delete next[rangeKey];
                      next[e.target.value] = cur;
                      updateState({ exclusionRanges: next });
                    }}>
                      {filterIdOptions.map((k) => (
                        <option key={k} value={k} disabled={k !== rangeKey && k in (props.state.exclusionRanges ?? {})}>{formatNumericIdLabel(k)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-16">
                    <FieldLabel>Max</FieldLabel>
                    <input className="wb-input text-[11px]" type="number" value={cur.max ?? ''} onChange={(e) => {
                      const v = e.target.value.trim();
                      updateState({ exclusionRanges: { ...(props.state.exclusionRanges ?? {}), [rangeKey]: { ...cur, max: v === '' ? undefined : Number(v) } } });
                    }} />
                  </div>
                  <div className="w-16">
                    <FieldLabel>Min</FieldLabel>
                    <input className="wb-input text-[11px]" type="number" value={cur.min ?? ''} onChange={(e) => {
                      const v = e.target.value.trim();
                      updateState({ exclusionRanges: { ...(props.state.exclusionRanges ?? {}), [rangeKey]: { ...cur, min: v === '' ? undefined : Number(v) } } });
                    }} />
                  </div>
                  <button type="button" className="wb-inline-button text-[11px]" onClick={() => {
                    const next = { ...(props.state.exclusionRanges ?? {}) };
                    delete next[rangeKey];
                    updateState({ exclusionRanges: next });
                  }}>×</button>
                </div>
              );
            })}
            <button type="button" className="wb-inline-button self-start text-[10px]" onClick={() => {
              const used = new Set(Object.keys(props.state.exclusionRanges ?? {}));
              const first = filterIdOptions.find((k) => !used.has(k));
              if (first) updateState({ exclusionRanges: { ...(props.state.exclusionRanges ?? {}), [first]: {} } });
            }}>
              + Add exclusion
            </button>
          </div>
        </details>

        {/* Major IDs */}
        <div>
          <FieldLabel>Major IDs</FieldLabel>
          <div className="flex flex-wrap gap-1">
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

        {/* Presets */}
        <div className="rounded border border-[var(--wb-border-muted)] p-1.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--wb-text-quaternary)]">Presets</span>
            <div className="flex gap-1">
              <button type="button" className="wb-inline-button text-[10px]" onClick={() => {
                const name = window.prompt('Preset name?')?.trim();
                if (!name) return;
                setPresets([{ name, state: props.state }, ...presets.filter((p) => p.name.toLowerCase() !== name.toLowerCase())].slice(0, 20));
              }}>Save</button>
              <button type="button" className="wb-inline-button text-[10px]" onClick={() => props.setState(DEFAULT_SEARCH_FILTER_STATE)}>Reset</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {presets.length === 0 ? (
              <span className="text-[10px] text-[var(--wb-text-quaternary)]">No saved presets.</span>
            ) : presets.map((preset) => (
              <div key={preset.name} className="flex items-center gap-0.5">
                <ChipButton onClick={() => props.setState(preset.state)}>{preset.name}</ChipButton>
                <button className="wb-inline-button px-1 text-[10px]" onClick={() => setPresets((p) => p.filter((x) => x.name !== preset.name))}>×</button>
              </div>
            ))}
          </div>
        </div>

        {/* Search results (in sidebar) */}
        {!props.state.resultsBelowBuild && (
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
        )}
      </div>
    </div>
  );
}
