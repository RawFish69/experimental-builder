import { useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useShallow } from 'zustand/react/shallow';
import { Hammer, Link2, TreePine } from 'lucide-react';
import { itemCatalogService } from '@/domain/items/catalog-service';
import type { CatalogSnapshot, ItemCategoryKey, ItemSlot } from '@/domain/items/types';
import { getClassFromWeaponType, ITEM_SLOTS, slotToCategory } from '@/domain/items/types';
import type { SearchFilterState, SearchResultPage } from '@/domain/search/filter-schema';
import { DEFAULT_SEARCH_FILTER_STATE } from '@/domain/search/filter-schema';
import { SearchWorkerClient } from '@/domain/search/search-worker-client';
import { SearchPanel } from '@/features/search/SearchPanel';
import { BuildSummaryPanel } from '@/features/workbench/BuildSummaryPanel';
import { WorkbenchBoard } from '@/features/workbench/WorkbenchBoard';
import { evaluateBuild } from '@/domain/build/build-metrics';
import { legacyCodecAdapter } from '@/domain/build/legacy-codec-adapter';
import { getLegacyBuilderUrl } from '@/domain/build/legacy-open-link';
import { useWorkbenchStore } from '@/domain/build/workbench-state';
import type { WorkbenchStore } from '@/domain/build/workbench-state';
import type { WorkbenchSnapshot } from '@/domain/build/types';
import { encodeWorkbenchSnapshot, parseAbilityTreeStateFromUrl, parseSearchStateFromUrl, parseWorkbenchPatchFromUrl, parseUrlState, writeUrlState } from '@/app/url-state';
import { AutoBuilderModal } from '@/features/autobuilder/AutoBuilderModal';
import { AbilityTreeModal } from '@/features/abilitytree/AbilityTreeModal';
import { abilityTreeCatalogService } from '@/domain/ability-tree/catalog-service';
import { evaluateAbilityTree, getClassTree } from '@/domain/ability-tree/logic';
import type { AbilityTreeDataset, AbilityTreeSelectionsByClass } from '@/domain/ability-tree/types';
import { Button } from '@/components/ui';

function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value);
  }
  window.prompt('Copy text:', value);
  return Promise.resolve();
}

function parseDropTarget(overId: string | number | null | undefined): { kind: 'slot'; slot: ItemSlot } | { kind: 'bin'; category: ReturnType<typeof slotToCategory> } | null {
  if (typeof overId !== 'string') return null;
  if (overId.startsWith('slot:')) {
    return { kind: 'slot', slot: overId.slice(5) as ItemSlot };
  }
  if (overId.startsWith('bin:')) {
    return { kind: 'bin', category: overId.slice(4) as ReturnType<typeof slotToCategory> };
  }
  return null;
}

function chooseEquipSlotForItem(
  itemId: number,
  catalog: CatalogSnapshot,
  snapshot: WorkbenchSnapshot,
): ItemSlot | null {
  const item = catalog.itemsById.get(itemId);
  if (!item) return null;
  const category = item.category;
  if (snapshot.selectedSlot && slotToCategory(snapshot.selectedSlot) === category) {
    return snapshot.selectedSlot;
  }
  const candidates = ITEM_SLOTS.filter((slot) => slotToCategory(slot) === category);
  const empty = candidates.find((slot) => snapshot.slots[slot] == null);
  return empty ?? candidates[0] ?? null;
}

function snapshotFromStore(store: Pick<WorkbenchStore, 'slots' | 'binsByCategory' | 'locks' | 'level' | 'characterClass' | 'selectedSlot' | 'comparePreview' | 'legacyHash'>): WorkbenchSnapshot {
  return {
    slots: { ...store.slots },
    binsByCategory: {
      helmet: [...store.binsByCategory.helmet],
      chestplate: [...store.binsByCategory.chestplate],
      leggings: [...store.binsByCategory.leggings],
      boots: [...store.binsByCategory.boots],
      ring: [...store.binsByCategory.ring],
      bracelet: [...store.binsByCategory.bracelet],
      necklace: [...store.binsByCategory.necklace],
      weapon: [...store.binsByCategory.weapon],
    },
    locks: { ...store.locks },
    level: store.level,
    characterClass: store.characterClass,
    selectedSlot: store.selectedSlot,
    comparePreview: { ...store.comparePreview },
    legacyHash: store.legacyHash,
  };
}

export function App() {
  const initialParsedRef = useRef<ReturnType<typeof parseUrlState> | null>(null);
  if (!initialParsedRef.current && typeof window !== 'undefined') {
    initialParsedRef.current = parseUrlState(window.location);
  }

  const initialParsed = initialParsedRef.current;
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<SearchFilterState>(initialParsed?.search ?? DEFAULT_SEARCH_FILTER_STATE);
  const [searchResult, setSearchResult] = useState<SearchResultPage | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchClientReady, setSearchClientReady] = useState(false);
  const [autoBuilderOpen, setAutoBuilderOpen] = useState(initialParsed?.mode === 'autobuilder');
  const [abilityTreeOpen, setAbilityTreeOpen] = useState(initialParsed?.mode === 'abilitytree');
  const [abilityTreeDataset, setAbilityTreeDataset] = useState<AbilityTreeDataset | null>(null);
  const [abilityTreeLoading, setAbilityTreeLoading] = useState(false);
  const [abilityTreeError, setAbilityTreeError] = useState<string | null>(null);
  const [abilityTreeSelectionsByClass, setAbilityTreeSelectionsByClass] = useState<AbilityTreeSelectionsByClass>(
    initialParsed?.abilityTree?.selectedByClass ?? {},
  );
  const [abilityTreeVersionHint, setAbilityTreeVersionHint] = useState<string | null>(initialParsed?.abilityTree?.version ?? null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const searchClientRef = useRef<SearchWorkerClient | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const writeUrlTimerRef = useRef<number | null>(null);

  const store = useWorkbenchStore(
    useShallow((state) => ({
      slots: state.slots,
      binsByCategory: state.binsByCategory,
      locks: state.locks,
      level: state.level,
      characterClass: state.characterClass,
      selectedSlot: state.selectedSlot,
      comparePreview: state.comparePreview,
      legacyHash: state.legacyHash,
      undoStack: state.undoStack,
      redoStack: state.redoStack,
      setLevel: state.setLevel,
      setCharacterClass: state.setCharacterClass,
      setSelectedSlot: state.setSelectedSlot,
      setComparePreview: state.setComparePreview,
      pinItem: state.pinItem,
      removePinnedItem: state.removePinnedItem,
      clearCategory: state.clearCategory,
      clearAll: state.clearAll,
      equipItem: state.equipItem,
      moveSlotToBin: state.moveSlotToBin,
      swapSlots: state.swapSlots,
      assignDraggedItemToSlot: state.assignDraggedItemToSlot,
      assignDraggedItemToBin: state.assignDraggedItemToBin,
      toggleLock: state.toggleLock,
      undo: state.undo,
      redo: state.redo,
      hydrateSnapshot: state.hydrateSnapshot,
      loadCandidate: state.loadCandidate,
      setLegacyHash: state.setLegacyHash,
    })),
  );

  const snapshot = useMemo(() => snapshotFromStore(store), [store]);

  useEffect(() => {
    if (initialParsed?.workbenchPatch) {
      store.hydrateSnapshot(initialParsed.workbenchPatch);
    }
  }, [initialParsed, store]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await itemCatalogService.getCatalog();
        if (cancelled) return;
        setSearchClientReady(false);

        const searchClient = new SearchWorkerClient();
        await searchClient.init(loaded.items);
        if (cancelled) {
          searchClient.dispose();
          return;
        }
        searchClientRef.current = searchClient;
        setCatalog(loaded);
        setSearchClientReady(true);

        // Import legacy hash into Workbench when present.
        if (initialParsed?.legacyHash) {
          setStatusMessage('Importing legacy builder hash...');
          try {
            const decoded = await legacyCodecAdapter.decodeLegacyHash(initialParsed.legacyHash);
            const slotPatch: Partial<WorkbenchSnapshot['slots']> = {};
            for (const [slot, name] of Object.entries(decoded.slots)) {
              if (!name) continue;
              const found = loaded.itemIdByName.get(name.toLowerCase());
              if (typeof found === 'number') {
                slotPatch[slot as ItemSlot] = found;
              }
            }
            store.hydrateSnapshot({
              ...initialParsed.workbenchPatch,
              slots: { ...(initialParsed.workbenchPatch?.slots ?? {}), ...slotPatch } as WorkbenchSnapshot['slots'],
              level: decoded.level ?? initialParsed.workbenchPatch?.level ?? store.level,
              legacyHash: decoded.legacyHash,
            });
            store.setLegacyHash(decoded.legacyHash);
            setStatusMessage('Imported legacy builder hash into Workbench.');
          } catch (error) {
            console.error(error);
            setStatusMessage('Failed to import legacy hash automatically. You can still open it in legacy builder.');
          }
        }
      } catch (error) {
        console.error(error);
        setCatalogError(error instanceof Error ? error.message : 'Failed to load item catalog');
      }
    })();

    return () => {
      cancelled = true;
      searchClientRef.current?.dispose();
      if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
      if (writeUrlTimerRef.current) window.clearTimeout(writeUrlTimerRef.current);
    };
  }, [initialParsed, store]);

  useEffect(() => {
    if (!catalog || !searchClientReady || !searchClientRef.current) return;
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    setSearchLoading(true);
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const result = await searchClientRef.current!.search(searchState);
        setSearchResult(result);
      } catch (error) {
        console.error(error);
        setCatalogError(error instanceof Error ? error.message : 'Search failed');
      } finally {
        setSearchLoading(false);
      }
    }, 180);
    return () => {
      if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    };
  }, [catalog, searchClientReady, searchState]);

  useEffect(() => {
    if (!abilityTreeOpen || !catalog) return;
    if (abilityTreeLoading || abilityTreeDataset || abilityTreeError) return;
    let cancelled = false;
    setAbilityTreeLoading(true);
    setAbilityTreeError(null);
    (async () => {
      try {
        const dataset = await abilityTreeCatalogService.getDataset(abilityTreeVersionHint || catalog.version);
        if (cancelled) return;
        setAbilityTreeDataset(dataset);
        setAbilityTreeVersionHint(dataset.version);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setAbilityTreeError(error instanceof Error ? error.message : 'Failed to load ability tree data');
      } finally {
        if (!cancelled) setAbilityTreeLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [abilityTreeOpen, abilityTreeDataset, catalog, abilityTreeVersionHint, abilityTreeError]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (writeUrlTimerRef.current) window.clearTimeout(writeUrlTimerRef.current);
    writeUrlTimerRef.current = window.setTimeout(() => {
      try {
        const mode = autoBuilderOpen ? 'autobuilder' : abilityTreeOpen ? 'abilitytree' : null;
        writeUrlState({
          search: searchState,
          workbenchSnapshot: snapshot,
          mode,
          abilityTreeState: {
            version: abilityTreeVersionHint,
            selectedByClass: abilityTreeSelectionsByClass,
          },
          replace: true,
        });
      } catch (error) {
        console.error(error);
      }
    }, 250);
    return () => {
      if (writeUrlTimerRef.current) window.clearTimeout(writeUrlTimerRef.current);
    };
  }, [searchState, snapshot, autoBuilderOpen, abilityTreeOpen, abilityTreeSelectionsByClass, abilityTreeVersionHint]);

  const summary = useMemo(() => {
    if (!catalog) return null;
    return evaluateBuild(
      {
        slots: snapshot.slots,
        level: snapshot.level,
        characterClass: snapshot.characterClass,
      },
      catalog,
    );
  }, [catalog, snapshot]);

  const inferredWeaponClass = useMemo(() => {
    if (!catalog) return null;
    const weaponId = snapshot.slots.weapon;
    if (weaponId == null) return null;
    const weapon = catalog.itemsById.get(weaponId);
    if (!weapon) return null;
    return weapon.classReq ?? getClassFromWeaponType(weapon.type);
  }, [catalog, snapshot.slots.weapon]);

  const abilityTreeClass = snapshot.characterClass ?? inferredWeaponClass;
  const abilityTreeTree = useMemo(() => getClassTree(abilityTreeDataset, abilityTreeClass), [abilityTreeDataset, abilityTreeClass]);
  const abilityTreeEvaluation = useMemo(() => {
    if (!abilityTreeTree || !abilityTreeClass) return null;
    const selected = abilityTreeSelectionsByClass[abilityTreeClass] ?? [];
    return evaluateAbilityTree(abilityTreeTree, selected, snapshot.level);
  }, [abilityTreeSelectionsByClass, abilityTreeTree, abilityTreeClass, snapshot.level]);

  const compareSummary = useMemo(() => {
    if (!catalog || !summary) return null;
    const preview = snapshot.comparePreview;
    if (!preview.itemId || !preview.slot) return null;
    const slots = { ...snapshot.slots, [preview.slot]: preview.itemId };
    return evaluateBuild(
      {
        slots,
        level: snapshot.level,
        characterClass: snapshot.characterClass,
      },
      catalog,
    );
  }, [catalog, summary, snapshot]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const dragItem = event.active.data.current?.dragItem as
      | { kind: 'search' | 'bin' | 'slot'; itemId: number; sourceSlot?: ItemSlot; sourceCategory?: string }
      | undefined;
    if (!dragItem) return;
    const slot = dragItem.kind === 'slot' ? (dragItem.sourceSlot ?? null) : (snapshot.selectedSlot ?? null);
    store.setComparePreview({ itemId: dragItem.itemId, slot });
  };

  const handleDragOver = (event: DragOverEvent) => {
    const dragItem = event.active.data.current?.dragItem as
      | { kind: 'search' | 'bin' | 'slot'; itemId: number }
      | undefined;
    const target = parseDropTarget(event.over?.id);
    if (!dragItem || !target) return;
    if (target.kind === 'slot') {
      store.setComparePreview({ itemId: dragItem.itemId, slot: target.slot });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const dragItem = event.active.data.current?.dragItem as
      | { kind: 'search' | 'bin' | 'slot'; itemId: number; sourceSlot?: ItemSlot; sourceCategory?: string }
      | undefined;
    const target = parseDropTarget(event.over?.id);
    store.setComparePreview(null);
    if (!catalog || !dragItem || !target) return;
    const item = catalog.itemsById.get(dragItem.itemId);
    if (!item) return;

    if (target.kind === 'slot') {
      if (slotToCategory(target.slot) !== item.category) return;
      store.assignDraggedItemToSlot({
        targetSlot: target.slot,
        source: dragItem.kind,
        itemId: dragItem.itemId,
        sourceCategory: dragItem.sourceCategory as ItemCategoryKey | undefined,
        sourceSlot: dragItem.sourceSlot,
      });
      return;
    }

    if (target.kind === 'bin') {
      if (target.category !== item.category) return;
      store.assignDraggedItemToBin({
        targetCategory: target.category,
        source: dragItem.kind,
        itemId: dragItem.itemId,
        sourceCategory: dragItem.sourceCategory as ItemCategoryKey | undefined,
        sourceSlot: dragItem.sourceSlot,
      });
    }
  };

  const handleEquipFromSearch = (itemId: number) => {
    if (!catalog) return;
    const slot = chooseEquipSlotForItem(itemId, catalog, snapshot);
    if (!slot) return;
    store.equipItem(slot, itemId);
    store.setSelectedSlot(slot);
    setStatusMessage(`Equipped item into ${slot}.`);
  };

  const handlePinFromSearch = (itemId: number) => {
    if (!catalog) return;
    const item = catalog.itemsById.get(itemId);
    if (!item) return;
    store.pinItem(item.category, item.id);
  };

  const exportWorkbench = () => {
    const code = encodeWorkbenchSnapshot(snapshot);
    const json = JSON.stringify(snapshot, null, 2);
    window.prompt('Copy Workbench export (JSON). URL-safe code is also in the current ?wb= param.', json);
    setStatusMessage(`Workbench export ready. Code length: ${code.length}`);
  };

  const importWorkbench = async () => {
    const raw = window.prompt('Paste a Workbench JSON export, Workbench URL, or legacy builder URL/hash.');
    if (!raw) return;
    const trimmed = raw.trim();
    try {
      if (legacyCodecAdapter.isSupported(trimmed) && catalog) {
        const decoded = await legacyCodecAdapter.decodeLegacyHash(trimmed);
        const slots: Partial<Record<ItemSlot, number | null>> = {};
        for (const [slot, name] of Object.entries(decoded.slots)) {
          const itemId = catalog.itemIdByName.get((name ?? '').toLowerCase());
          if (itemId != null) slots[slot as ItemSlot] = itemId;
        }
        store.hydrateSnapshot({
          slots: { ...snapshot.slots, ...slots } as WorkbenchSnapshot['slots'],
          level: decoded.level ?? snapshot.level,
          legacyHash: decoded.legacyHash,
        });
        store.setLegacyHash(decoded.legacyHash);
        setStatusMessage('Imported legacy build hash.');
        return;
      }

      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const url = new URL(trimmed);
        const search = parseSearchStateFromUrl(url);
        const wbPatch = parseWorkbenchPatchFromUrl(url);
        const atreeState = parseAbilityTreeStateFromUrl(url);
        setSearchState(search);
        if (wbPatch) store.hydrateSnapshot(wbPatch);
        if (atreeState) {
          setAbilityTreeSelectionsByClass(atreeState.selectedByClass ?? {});
          setAbilityTreeVersionHint(atreeState.version ?? null);
        }
        setStatusMessage('Imported Workbench URL state.');
        return;
      }

      const parsed = JSON.parse(trimmed) as Partial<WorkbenchSnapshot>;
      store.hydrateSnapshot(parsed);
      setStatusMessage('Imported Workbench JSON.');
    } catch (error) {
      console.error(error);
      setStatusMessage('Import failed. Check the pasted JSON/URL/hash.');
    }
  };

  const shareWorkbench = async () => {
    writeUrlState({
      search: searchState,
      workbenchSnapshot: snapshot,
      mode: autoBuilderOpen ? 'autobuilder' : abilityTreeOpen ? 'abilitytree' : null,
      abilityTreeState: {
        version: abilityTreeVersionHint,
        selectedByClass: abilityTreeSelectionsByClass,
      },
      replace: true,
    });
    await copyText(window.location.href);
    setStatusMessage('Workbench link copied.');
  };

  const copyLegacyLink = async () => {
    if (!snapshot.legacyHash) {
      setStatusMessage('No imported legacy hash is currently available.');
      return;
    }
    const url = new URL(getLegacyBuilderUrl(snapshot.legacyHash), window.location.href).href;
    await copyText(url);
    setStatusMessage('Legacy builder link copied.');
  };

  const openLegacyBuilder = () => {
    window.open(getLegacyBuilderUrl(snapshot.legacyHash), '_blank', 'noopener,noreferrer');
  };

  const openAbilityTree = () => {
    setAbilityTreeError(null);
    setAutoBuilderOpen(false);
    setAbilityTreeOpen(true);
  };

  if (catalogError) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="wb-panel max-w-xl rounded-2xl p-6">
          <div className="text-xl font-semibold">Workbench failed to load</div>
          <div className="mt-2 text-sm text-[var(--wb-muted)]">{catalogError}</div>
        </div>
      </div>
    );
  }

  if (!catalog || !summary) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="wb-panel max-w-xl rounded-2xl p-6">
          <div className="text-xl font-semibold">Loading Workbench...</div>
          <div className="mt-2 text-sm text-[var(--wb-muted)]">Preparing item catalog, search index, and workbench state.</div>
        </div>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="flex min-h-full flex-col gap-3 p-3 lg:p-4">
        <header className="wb-panel wb-hero rounded-2xl px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="wb-chip border-cyan-300/30 bg-cyan-300/8 text-cyan-100">Standalone Alpha</span>
                <span className="wb-chip">Legacy-compatible imports</span>
                {abilityTreeEvaluation ? (
                  <span className="wb-chip border-emerald-300/30 bg-emerald-300/8 text-emerald-100">
                    Ability Tree {abilityTreeEvaluation.apUsed}/{abilityTreeEvaluation.apCap} AP
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-lg font-semibold">
                <Hammer size={18} className="text-cyan-200" />
                Workbench
              </div>
              <div className="mt-1 text-xs text-[var(--wb-muted)]">
                Modular loadout planning studio with a compatibility bridge for legacy builder links and hashes.
              </div>
              <div className="mt-1 text-[11px] tracking-wide text-[var(--wb-muted-2)]">
                Ability tree editing now works in Workbench using legacy data/rules. Workbench summary metrics still exclude ability-tree effects for now.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--wb-muted)]">Class</label>
                <select
                  className="wb-select w-36"
                  value={snapshot.characterClass ?? ''}
                  onChange={(e) => store.setCharacterClass((e.target.value || null) as WorkbenchSnapshot['characterClass'])}
                >
                  <option value="">Auto / Any</option>
                  <option value="Warrior">Warrior</option>
                  <option value="Assassin">Assassin</option>
                  <option value="Mage">Mage</option>
                  <option value="Archer">Archer</option>
                  <option value="Shaman">Shaman</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--wb-muted)]">Level</label>
                <input
                  className="wb-input w-22"
                  type="number"
                  min={1}
                  max={106}
                  value={snapshot.level}
                  onChange={(e) => store.setLevel(Number(e.target.value))}
                />
              </div>
              <Button variant="ghost" onClick={shareWorkbench}>
                <Link2 size={13} className="mr-1 inline" />
                Share Session
              </Button>
              <Button
                variant="ghost"
                onClick={openAbilityTree}
              >
                <TreePine size={13} className="mr-1 inline" />
                Ability Tree
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setAbilityTreeOpen(false);
                  setAutoBuilderOpen(true);
                }}
              >
                Optimizer
              </Button>
            </div>
          </div>
          {statusMessage ? <div className="mt-2 text-xs text-emerald-200">{statusMessage}</div> : null}
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(360px,28vw)_minmax(0,1fr)_360px]">
          <SearchPanel
            catalog={catalog}
            state={searchState}
            setState={setSearchState}
            result={searchResult}
            loading={searchLoading}
            selectedSlot={snapshot.selectedSlot}
            onPin={handlePinFromSearch}
            onEquip={handleEquipFromSearch}
            onHover={(itemId, slot) => store.setComparePreview(itemId && slot ? { itemId, slot } : null)}
            onOpenAutoBuilder={() => setAutoBuilderOpen(true)}
          />

          <WorkbenchBoard
            catalog={catalog}
            store={store}
            onHoverItem={(itemId, slot) => store.setComparePreview(itemId && slot ? { itemId, slot } : null)}
          />

          <BuildSummaryPanel
            catalog={catalog}
            snapshot={snapshot}
            summary={summary}
            compareSummary={compareSummary}
            compareSlot={snapshot.comparePreview.slot}
            abilityTreeSummary={
              abilityTreeEvaluation && abilityTreeClass
                ? {
                    className: abilityTreeClass,
                    apUsed: abilityTreeEvaluation.apUsed,
                    apCap: abilityTreeEvaluation.apCap,
                    selectedCount: abilityTreeEvaluation.activeIds.length,
                    hasErrors: abilityTreeEvaluation.errors.length > 0 || abilityTreeEvaluation.apUsed > abilityTreeEvaluation.apCap,
                  }
                : null
            }
            actions={{
              onOpenAutoBuilder: () => {
                setAbilityTreeOpen(false);
                setAutoBuilderOpen(true);
              },
              onOpenAbilityTree: () => {
                openAbilityTree();
              },
              onExportWorkbench: exportWorkbench,
              onImportWorkbench: () => void importWorkbench(),
              onShareWorkbench: () => void shareWorkbench(),
              onCopyLegacyLink: () => void copyLegacyLink(),
              onOpenLegacyBuilder: openLegacyBuilder,
            }}
          />
        </main>
      </div>

      <AutoBuilderModal
        open={autoBuilderOpen}
        onOpenChange={setAutoBuilderOpen}
        catalog={catalog}
        snapshot={snapshot}
        onLoadCandidate={(candidate) => {
          store.loadCandidate(candidate.slots);
          setAutoBuilderOpen(false);
          setStatusMessage('Loaded autobuilder candidate into Workbench.');
        }}
      />
      <AbilityTreeModal
        open={abilityTreeOpen}
        onOpenChange={(open) => {
          if (open) setAbilityTreeError(null);
          setAbilityTreeOpen(open);
        }}
        dataset={abilityTreeDataset}
        loading={abilityTreeLoading}
        error={abilityTreeError}
        level={snapshot.level}
        selectedClass={snapshot.characterClass}
        inferredClass={inferredWeaponClass}
        selectionsByClass={abilityTreeSelectionsByClass}
        onSelectionsChange={setAbilityTreeSelectionsByClass}
      />
    </DndContext>
  );
}
