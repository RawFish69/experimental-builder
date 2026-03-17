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
import { CirclePlay, Hammer, Link2, TreePine } from 'lucide-react';
import { applyThemeMode, persistThemeMode, readStoredThemeMode, type ThemeMode } from '@/app/theme-mode';
import { itemCatalogService } from '@/domain/items/catalog-service';
import type { CatalogSnapshot, ItemCategoryKey, ItemSlot } from '@/domain/items/types';
import { getClassFromWeaponType, ITEM_SLOTS, slotToCategory } from '@/domain/items/types';
import type { SearchFilterState, SearchResultPage } from '@/domain/search/filter-schema';
import { DEFAULT_SEARCH_FILTER_STATE, hasActiveSearchFilters } from '@/domain/search/filter-schema';
import { SearchWorkerClient } from '@/domain/search/search-worker-client';
import { SearchPanel, SearchResultList } from '@/features/search/SearchPanel';
import { BuildSummaryPanel } from '@/features/workbench/BuildSummaryPanel';
import { WorkbenchBoard } from '@/features/workbench/WorkbenchBoard';
import { evaluateBuild } from '@/domain/build/build-metrics';
import { legacyCodecAdapter } from '@/domain/build/legacy-codec-adapter';
import { getLegacyBuilderUrl } from '@/domain/build/legacy-open-link';
import { encodeBuildHash, getWynnBuilderBuildUrl } from '@/domain/build/build-encoder';
import { useWorkbenchStore } from '@/domain/build/workbench-state';
import type { WorkbenchStore } from '@/domain/build/workbench-state';
import type { WorkbenchSnapshot } from '@/domain/build/types';
import { encodeWorkbenchSnapshot, parseAbilityTreeStateFromUrl, parseSearchStateFromUrl, parseWorkbenchPatchFromUrl, parseUrlState, writeUrlState } from '@/app/url-state';
import { AutoBuilderModal } from '@/features/autobuilder/AutoBuilderModal';
import { AbilityTreeModal } from '@/features/abilitytree/AbilityTreeModal';
import { RecipeSolverModal } from '@/features/recipe-solver/RecipeSolverModal';
import { abilityTreeCatalogService } from '@/domain/ability-tree/catalog-service';
import { evaluateAbilityTree, getClassTree } from '@/domain/ability-tree/logic';
import type { AbilityTreeDataset, AbilityTreeSelectionsByClass } from '@/domain/ability-tree/types';
import { buildWorkbenchSpellPreview } from '@/domain/ability-tree/spell-preview';
import { Button, SidebarToggle } from '@/components/ui';
import { CommandPalette } from '@/components/CommandPalette';

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

function snapshotFromStore(store: Pick<WorkbenchStore, 'slots' | 'craftedSlots' | 'binsByCategory' | 'locks' | 'powdersBySlot' | 'level' | 'characterClass' | 'selectedSlot' | 'comparePreview' | 'legacyHash' | 'skillpointTomeMode'>): WorkbenchSnapshot {
  return {
    slots: { ...store.slots },
    craftedSlots: { ...store.craftedSlots },
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
    powdersBySlot: store.powdersBySlot ?? {},
    level: store.level,
    characterClass: store.characterClass,
    selectedSlot: store.selectedSlot,
    comparePreview: { ...store.comparePreview },
    legacyHash: store.legacyHash,
    skillpointTomeMode: store.skillpointTomeMode ?? 'no_tomes',
  };
}

export function App() {
  const tutorialUrl = 'https://www.youtube.com/watch?v=BGEwpXTIjQo';
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
  const [recipeSolverOpen, setRecipeSolverOpen] = useState(false);
  const [abilityTreeDataset, setAbilityTreeDataset] = useState<AbilityTreeDataset | null>(null);
  const [abilityTreeLoading, setAbilityTreeLoading] = useState(false);
  const [abilityTreeError, setAbilityTreeError] = useState<string | null>(null);
  const [abilityTreeSelectionsByClass, setAbilityTreeSelectionsByClass] = useState<AbilityTreeSelectionsByClass>(
    initialParsed?.abilityTree?.selectedByClass ?? {},
  );
  const [abilityTreeVersionHint, setAbilityTreeVersionHint] = useState<string | null>(initialParsed?.abilityTree?.version ?? null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [searchTrigger, setSearchTrigger] = useState(0);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredThemeMode());

  // Layout state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [statsPanelCollapsed, setStatsPanelCollapsed] = useState(false);

  const searchClientRef = useRef<SearchWorkerClient | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const writeUrlTimerRef = useRef<number | null>(null);

  const hydrateSnapshot = useWorkbenchStore((s) => s.hydrateSnapshot);
  const setLegacyHash = useWorkbenchStore((s) => s.setLegacyHash);
  const store = useWorkbenchStore(
    useShallow((state) => ({
      slots: state.slots,
      craftedSlots: state.craftedSlots,
      binsByCategory: state.binsByCategory,
      locks: state.locks,
      powdersBySlot: state.powdersBySlot,
      level: state.level,
      characterClass: state.characterClass,
      selectedSlot: state.selectedSlot,
      comparePreview: state.comparePreview,
      legacyHash: state.legacyHash,
      skillpointTomeMode: state.skillpointTomeMode,
      undoStack: state.undoStack,
      redoStack: state.redoStack,
      setLevel: state.setLevel,
      setCharacterClass: state.setCharacterClass,
      setSkillpointTomeMode: state.setSkillpointTomeMode,
      setSelectedSlot: state.setSelectedSlot,
      setComparePreview: state.setComparePreview,
      pinItem: state.pinItem,
      removePinnedItem: state.removePinnedItem,
      clearCategory: state.clearCategory,
      clearAll: state.clearAll,
      equipItem: state.equipItem,
      equipCraftedItem: state.equipCraftedItem,
      clearCraftedSlot: state.clearCraftedSlot,
      moveSlotToBin: state.moveSlotToBin,
      swapSlots: state.swapSlots,
      assignDraggedItemToSlot: state.assignDraggedItemToSlot,
      assignDraggedItemToBin: state.assignDraggedItemToBin,
      toggleLock: state.toggleLock,
      setPowder: state.setPowder,
      removePowder: state.removePowder,
      clearPowders: state.clearPowders,
      undo: state.undo,
      redo: state.redo,
      hydrateSnapshot: state.hydrateSnapshot,
      loadCandidate: state.loadCandidate,
      setLegacyHash: state.setLegacyHash,
    })),
  );

  const snapshot = useMemo(() => snapshotFromStore(store), [store]);

  useEffect(() => {
    applyThemeMode(themeMode);
    persistThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (initialParsed?.workbenchPatch) {
      hydrateSnapshot(initialParsed.workbenchPatch);
    }
  }, [initialParsed?.workbenchPatch, hydrateSnapshot]);

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
            const currentLevel = useWorkbenchStore.getState().level;
            hydrateSnapshot({
              ...initialParsed.workbenchPatch,
              slots: { ...(initialParsed.workbenchPatch?.slots ?? {}), ...slotPatch } as WorkbenchSnapshot['slots'],
              level: decoded.level ?? initialParsed.workbenchPatch?.level ?? currentLevel,
              legacyHash: decoded.legacyHash,
            });
            setLegacyHash(decoded.legacyHash);
            setStatusMessage('Imported legacy builder hash.');
          } catch (error) {
            console.error(error);
            setStatusMessage('Failed to import legacy hash.');
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
  }, [initialParsed, hydrateSnapshot, setLegacyHash]);

  useEffect(() => {
    if (!catalog || !searchClientReady || !searchClientRef.current) return;
    if (!hasActiveSearchFilters(searchState) && searchTrigger === 0) {
      setSearchResult(null);
      setSearchLoading(false);
      return;
    }
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
  }, [catalog, searchClientReady, searchState, searchTrigger]);

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
      { slots: snapshot.slots, level: snapshot.level, characterClass: snapshot.characterClass },
      catalog,
      { skillpointTomeMode: snapshot.skillpointTomeMode ?? 'no_tomes' },
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
      { slots, level: snapshot.level, characterClass: snapshot.characterClass },
      catalog,
      { skillpointTomeMode: snapshot.skillpointTomeMode ?? 'no_tomes' },
    );
  }, [catalog, summary, snapshot]);

  const spellPreview = useMemo(() => {
    if (!catalog) return null;
    return buildWorkbenchSpellPreview({ catalog, snapshot, abilityTreeTree, abilityTreeEvaluation });
  }, [catalog, snapshot, abilityTreeTree, abilityTreeEvaluation]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
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
    window.prompt('Copy Workbench export (JSON).', json);
    setStatusMessage(`Export ready. Code: ${code.length} chars`);
  };

  const openInWynnBuilder = () => {
    if (!catalog) { setStatusMessage('Catalog not loaded.'); return; }
    const hash = encodeBuildHash(snapshot, catalog);
    if (!hash) { setStatusMessage('No items equipped.'); return; }
    window.open(getWynnBuilderBuildUrl(hash), '_blank', 'noopener,noreferrer');
    setStatusMessage('Opened in WynnBuilder.');
  };

  const importWorkbench = async () => {
    const raw = window.prompt('Paste Workbench JSON, URL, or legacy hash.');
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
        setStatusMessage('Imported legacy hash.');
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
        setStatusMessage('Imported URL state.');
        return;
      }

      const parsed = JSON.parse(trimmed) as Partial<WorkbenchSnapshot>;
      store.hydrateSnapshot(parsed);
      setStatusMessage('Imported JSON.');
    } catch (error) {
      console.error(error);
      setStatusMessage('Import failed.');
    }
  };

  const shareWorkbench = async () => {
    writeUrlState({
      search: searchState,
      workbenchSnapshot: snapshot,
      mode: autoBuilderOpen ? 'autobuilder' : abilityTreeOpen ? 'abilitytree' : null,
      abilityTreeState: { version: abilityTreeVersionHint, selectedByClass: abilityTreeSelectionsByClass },
      replace: true,
    });
    await copyText(window.location.href);
    setStatusMessage('Link copied.');
  };

  const copyLegacyLink = async () => {
    if (!snapshot.legacyHash) { setStatusMessage('No legacy hash available.'); return; }
    const url = new URL(getLegacyBuilderUrl(snapshot.legacyHash), window.location.href).href;
    await copyText(url);
    setStatusMessage('Legacy link copied.');
  };

  const openLegacyBuilder = () => {
    window.open(getLegacyBuilderUrl(snapshot.legacyHash), '_blank', 'noopener,noreferrer');
  };

  const openAbilityTree = () => {
    setAbilityTreeError(null);
    setAutoBuilderOpen(false);
    setAbilityTreeOpen(true);
  };

  const openAutoBuilder = () => {
    setAbilityTreeOpen(false);
    setRecipeSolverOpen(false);
    setAutoBuilderOpen(true);
  };

  const openRecipeSolver = () => {
    setAutoBuilderOpen(false);
    setAbilityTreeOpen(false);
    setRecipeSolverOpen(true);
  };

  /* ─── Loading / Error states ─── */

  if (catalogError) {
    return (
      <div className="wb-app-shell flex min-h-screen items-center justify-center p-6">
        <div className="wb-panel max-w-md rounded-lg p-5">
          <div className="text-base font-semibold">Failed to load</div>
          <div className="mt-1 text-[13px] text-[var(--wb-text-secondary)]">{catalogError}</div>
        </div>
      </div>
    );
  }

  if (!catalog || !summary) {
    return (
      <div className="wb-app-shell flex min-h-screen items-center justify-center p-6">
        <div className="wb-panel max-w-md rounded-lg p-5">
          <div className="text-base font-semibold">Loading...</div>
          <div className="mt-1 text-[13px] text-[var(--wb-text-secondary)]">
            Preparing item catalog, search index, and build state.
          </div>
        </div>
      </div>
    );
  }

  /* ─── Main layout ─── */

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="wb-app-shell flex h-screen flex-col overflow-hidden">
        {/* ─── TopBar (48px) ─── */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--wb-surface-border)] bg-[var(--wb-surface)] px-3">
          {/* Left section */}
          <SidebarToggle collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((v) => !v)} side="left" />

          <div className="wb-theme-toggle">
            <span className="wb-theme-toggle-label">Theme</span>
            {(['dark', 'light'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className="wb-theme-toggle-button"
                data-active={themeMode === mode ? 'true' : 'false'}
                onClick={() => setThemeMode(mode)}
              >
                {mode === 'dark' ? 'Dark' : 'Light'}
              </button>
            ))}
          </div>

          {abilityTreeEvaluation && (
            <span className="wb-chip" data-tone="success">
              ATree {abilityTreeEvaluation.apUsed}/{abilityTreeEvaluation.apCap} AP
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Center: How to use + Build Solver */}
          <div className="flex items-center gap-2">
            <a
              className="wb-button px-2 py-1 text-[11px]"
              data-variant="ghost"
              href={tutorialUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <CirclePlay size={12} className="mr-1" />
              How to use
            </a>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg border-2 border-[var(--wb-accent)] bg-[var(--wb-accent)] px-4 py-2 text-sm font-bold text-[var(--wb-button-primary-text)] shadow-sm transition-all hover:bg-[var(--wb-accent-hover)] hover:border-[var(--wb-accent-hover)] hover:shadow-md active:scale-95"
              onClick={openAutoBuilder}
              title="Open Build Solver"
            >
              <Hammer size={17} />
              <span className="hidden sm:inline">Build Solver</span>
            </button>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right controls */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1">
              <label className="text-[11px] text-[var(--wb-text-quaternary)]">Class</label>
              <select
                className="wb-select w-28"
                value={snapshot.characterClass ?? ''}
                onChange={(e) => store.setCharacterClass((e.target.value || null) as WorkbenchSnapshot['characterClass'])}
              >
                <option value="">Auto</option>
                <option value="Warrior">Warrior</option>
                <option value="Assassin">Assassin</option>
                <option value="Mage">Mage</option>
                <option value="Archer">Archer</option>
                <option value="Shaman">Shaman</option>
              </select>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-[11px] text-[var(--wb-text-quaternary)]">Lv.</label>
              <input
                className="wb-input w-16"
                type="number"
                min={1}
                max={120}
                value={snapshot.level}
                onChange={(e) => store.setLevel(Number(e.target.value))}
              />
            </div>
            <div className="hidden items-center gap-1 lg:flex">
              <label className="text-[11px] text-[var(--wb-text-quaternary)]">Tomes</label>
              <select
                className="wb-select w-32"
                value={snapshot.skillpointTomeMode ?? 'no_tomes'}
                onChange={(e) => store.setSkillpointTomeMode((e.target.value || 'no_tomes') as WorkbenchSnapshot['skillpointTomeMode'])}
              >
                <option value="no_tomes">None (200)</option>
                <option value="guild_rainbow">Guild +1</option>
                <option value="flexible_2">+2 Flex</option>
              </select>
            </div>

            <div className="mx-1 h-5 w-px bg-[var(--wb-border-muted)]" />

            <Button variant="ghost" className="px-2 py-1 text-[11px]" onClick={() => void shareWorkbench()}>
              <Link2 size={12} className="mr-1" />
              Share
            </Button>
            <Button variant="ghost" className="px-2 py-1 text-[11px]" onClick={openAbilityTree}>
              <TreePine size={12} className="mr-1" />
              ATree
            </Button>
            <Button variant="primary" className="px-3 py-1.5 text-xs font-bold shadow-sm hover:shadow-md" onClick={openRecipeSolver}>
              Recipe Solver
            </Button>
            <SidebarToggle collapsed={statsPanelCollapsed} onToggle={() => setStatsPanelCollapsed((v) => !v)} side="right" />
          </div>
        </header>

        {/* Status bar */}
        {statusMessage && (
          <div className="flex h-6 items-center border-b border-[var(--wb-border-muted)] bg-[var(--wb-success-muted)] px-3 text-[11px] text-[var(--wb-success)]">
            {statusMessage}
            <button
              type="button"
              className="ml-auto text-[10px] text-[var(--wb-text-tertiary)] hover:text-[var(--wb-text)]"
              onClick={() => setStatusMessage('')}
            >
              dismiss
            </button>
          </div>
        )}

        {/* ─── Content area (3-column) ─── */}
        <div className="flex min-h-0 flex-1">
          {/* Left Sidebar */}
          {!sidebarCollapsed && (
            <aside className="flex w-[280px] shrink-0 flex-col border-r border-[var(--wb-surface-border)] bg-[var(--wb-surface)] xl:w-[320px]">
              <SearchPanel
                catalog={catalog}
                state={searchState}
                setState={setSearchState}
                result={searchResult}
                loading={searchLoading}
                selectedSlot={snapshot.selectedSlot}
                onPin={handlePinFromSearch}
                onEquip={handleEquipFromSearch}
                onHover={() => {}}
                onSearch={() => setSearchTrigger((t) => t + 1)}
              />
            </aside>
          )}

          {/* Main panel */}
          <main className="min-w-0 flex-1 overflow-auto bg-[var(--wb-canvas)] wb-scrollbar">
            <WorkbenchBoard
              catalog={catalog}
              store={store}
              onHoverItem={(itemId, slot) => store.setComparePreview(itemId && slot ? { itemId, slot } : null)}
              onShareWorkbench={() => void shareWorkbench()}
              onExportWorkbench={exportWorkbench}
              onImportWorkbench={() => void importWorkbench()}
              onOpenInWynnBuilder={openInWynnBuilder}
              searchResults={
                searchState.resultsBelowBuild ? (
                  <SearchResultList
                    catalog={catalog}
                    result={searchResult}
                    selectedSlot={snapshot.selectedSlot}
                    state={searchState}
                    loading={searchLoading}
                    onPin={handlePinFromSearch}
                    onEquip={handleEquipFromSearch}
                    onHover={() => {}}
                    embedded
                  />
                ) : undefined
              }
            />
          </main>

          {/* Right Stats Panel */}
          {!statsPanelCollapsed && (
            <aside className="flex w-[400px] shrink-0 flex-col overflow-hidden border-l border-[var(--wb-surface-border)] bg-[var(--wb-surface)] xl:w-[440px]">
              <BuildSummaryPanel
                catalog={catalog}
                snapshot={snapshot}
                summary={summary}
                compareSummary={compareSummary}
                compareSlot={snapshot.comparePreview.slot}
                spellPreview={spellPreview}
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
                  onOpenAbilityTree: openAbilityTree,
                  onCopyLegacyLink: () => void copyLegacyLink(),
                  onOpenLegacyBuilder: openLegacyBuilder,
                }}
              />
            </aside>
          )}
        </div>
      </div>

      {/* ─── Command Palette ─── */}
      <CommandPalette
        onSearch={() => setSidebarCollapsed(false)}
        onOpenAutoBuilder={openAutoBuilder}
        onOpenAbilityTree={openAbilityTree}
        onOpenRecipeSolver={openRecipeSolver}
        onShare={() => void shareWorkbench()}
      />

      {/* ─── Modals ─── */}
      <AutoBuilderModal
        open={autoBuilderOpen}
        onOpenChange={setAutoBuilderOpen}
        catalog={catalog}
        snapshot={snapshot}
        onLoadCandidate={(candidate) => {
          store.loadCandidate(candidate.slots);
          setAutoBuilderOpen(false);
          setStatusMessage('Loaded Build Solver candidate.');
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
      <RecipeSolverModal
        open={recipeSolverOpen}
        onOpenChange={setRecipeSolverOpen}
        onEquipCraft={(slot, info) => {
          store.equipCraftedItem(slot, info);
          setRecipeSolverOpen(false);
          setStatusMessage(`Crafted ${info.type} equipped to ${slot}.`);
        }}
      />
    </DndContext>
  );
}
