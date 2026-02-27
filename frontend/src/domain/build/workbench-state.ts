import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { CharacterClass, ItemCategoryKey, ItemSlot } from '@/domain/items/types';
import { ITEM_CATEGORY_KEYS, ITEM_SLOTS, slotToCategory } from '@/domain/items/types';
import type { ComparePreview, CraftedSlotInfo, WorkbenchBuildState, WorkbenchSnapshot } from '@/domain/build/types';

const EMPTY_COMPARE: ComparePreview = { itemId: null, slot: null };

function createEmptySlots(): Record<ItemSlot, number | null> {
  return Object.fromEntries(ITEM_SLOTS.map((slot) => [slot, null])) as Record<ItemSlot, number | null>;
}

function createEmptyBins(): Record<ItemCategoryKey, number[]> {
  return Object.fromEntries(ITEM_CATEGORY_KEYS.map((category) => [category, [] as number[]])) as unknown as Record<
    ItemCategoryKey,
    number[]
  >;
}

function createEmptyLocks(): Record<ItemSlot, boolean> {
  return Object.fromEntries(ITEM_SLOTS.map((slot) => [slot, false])) as Record<ItemSlot, boolean>;
}

export function createInitialWorkbenchSnapshot(): WorkbenchSnapshot {
  return {
    slots: createEmptySlots(),
    craftedSlots: {},
    binsByCategory: createEmptyBins(),
    locks: createEmptyLocks(),
    level: 106,
    characterClass: null,
    selectedSlot: 'weapon',
    comparePreview: { ...EMPTY_COMPARE },
    legacyHash: null,
  };
}

function snapshotOf(state: WorkbenchBuildState): WorkbenchSnapshot {
  return {
    slots: { ...state.slots },
    craftedSlots: { ...state.craftedSlots },
    binsByCategory: Object.fromEntries(
      ITEM_CATEGORY_KEYS.map((category) => [category, [...state.binsByCategory[category]]]),
    ) as WorkbenchSnapshot['binsByCategory'],
    locks: { ...state.locks },
    level: state.level,
    characterClass: state.characterClass,
    selectedSlot: state.selectedSlot,
    comparePreview: { ...state.comparePreview },
    legacyHash: state.legacyHash,
  };
}

function pushHistory(state: WorkbenchBuildState): void {
  state.undoStack.push(snapshotOf(state));
  if (state.undoStack.length > 100) {
    state.undoStack.shift();
  }
  state.redoStack = [];
}

function applySnapshot(state: WorkbenchBuildState, snap: WorkbenchSnapshot): void {
  state.slots = { ...snap.slots };
  state.craftedSlots = { ...snap.craftedSlots };
  state.binsByCategory = Object.fromEntries(
    ITEM_CATEGORY_KEYS.map((category) => [category, [...snap.binsByCategory[category]]]),
  ) as WorkbenchSnapshot['binsByCategory'];
  state.locks = { ...snap.locks };
  state.level = snap.level;
  state.characterClass = snap.characterClass;
  state.selectedSlot = snap.selectedSlot;
  state.comparePreview = { ...snap.comparePreview };
  state.legacyHash = snap.legacyHash;
}

function dedupePush(list: number[], itemId: number): void {
  if (!list.includes(itemId)) list.unshift(itemId);
}

export interface WorkbenchStore extends WorkbenchBuildState {
  setLevel(level: number): void;
  setCharacterClass(characterClass: CharacterClass | null): void;
  setSelectedSlot(slot: ItemSlot | null): void;
  setComparePreview(preview: Partial<ComparePreview> | null): void;
  pinItem(category: ItemCategoryKey, itemId: number): void;
  removePinnedItem(category: ItemCategoryKey, itemId: number): void;
  clearCategory(category: ItemCategoryKey): void;
  clearAll(): void;
  equipItem(slot: ItemSlot, itemId: number | null): void;
  moveSlotToBin(slot: ItemSlot): void;
  swapSlots(a: ItemSlot, b: ItemSlot): void;
  assignDraggedItemToSlot(params: {
    targetSlot: ItemSlot;
    source: 'search' | 'bin' | 'slot';
    itemId: number;
    sourceCategory?: ItemCategoryKey;
    sourceSlot?: ItemSlot;
  }): void;
  assignDraggedItemToBin(params: {
    targetCategory: ItemCategoryKey;
    source: 'search' | 'bin' | 'slot';
    itemId: number;
    sourceCategory?: ItemCategoryKey;
    sourceSlot?: ItemSlot;
  }): void;
  toggleLock(slot: ItemSlot): void;
  equipCraftedItem(slot: ItemSlot, info: CraftedSlotInfo): void;
  clearCraftedSlot(slot: ItemSlot): void;
  undo(): void;
  redo(): void;
  hydrateSnapshot(snapshot: Partial<WorkbenchSnapshot>): void;
  loadCandidate(slots: Record<ItemSlot, number | null>): void;
  setLegacyHash(hash: string | null): void;
}

export const useWorkbenchStore = create<WorkbenchStore>()(
  immer((set, get) => ({
    ...createInitialWorkbenchSnapshot(),
    undoStack: [],
    redoStack: [],

    setLevel(level) {
      set((state) => {
        pushHistory(state);
        state.level = Math.min(106, Math.max(1, Math.round(level)));
      });
    },

    setCharacterClass(characterClass) {
      set((state) => {
        pushHistory(state);
        state.characterClass = characterClass;
      });
    },

    setSelectedSlot(slot) {
      set((state) => {
        state.selectedSlot = slot;
      });
    },

    setComparePreview(preview) {
      set((state) => {
        if (!preview) {
          state.comparePreview = { ...EMPTY_COMPARE };
          return;
        }
        state.comparePreview = {
          itemId: preview.itemId ?? state.comparePreview.itemId,
          slot: preview.slot ?? state.comparePreview.slot,
        };
      });
    },

    pinItem(category, itemId) {
      set((state) => {
        pushHistory(state);
        dedupePush(state.binsByCategory[category], itemId);
      });
    },

    removePinnedItem(category, itemId) {
      set((state) => {
        pushHistory(state);
        state.binsByCategory[category] = state.binsByCategory[category].filter((id) => id !== itemId);
      });
    },

    clearCategory(category) {
      set((state) => {
        pushHistory(state);
        state.binsByCategory[category] = [];
      });
    },

    clearAll() {
      set((state) => {
        pushHistory(state);
        state.slots = createEmptySlots();
        state.craftedSlots = {};
        state.binsByCategory = createEmptyBins();
        state.comparePreview = { ...EMPTY_COMPARE };
        state.legacyHash = null;
      });
    },

    equipItem(slot, itemId) {
      set((state) => {
        pushHistory(state);
        state.slots[slot] = itemId;
        delete state.craftedSlots[slot];
        state.selectedSlot = slot;
      });
    },

    moveSlotToBin(slot) {
      set((state) => {
        const itemId = state.slots[slot];
        if (itemId == null) return;
        pushHistory(state);
        const category = slotToCategory(slot);
        dedupePush(state.binsByCategory[category], itemId);
        state.slots[slot] = null;
      });
    },

    swapSlots(a, b) {
      set((state) => {
        pushHistory(state);
        const tmp = state.slots[a];
        state.slots[a] = state.slots[b];
        state.slots[b] = tmp;
      });
    },

    assignDraggedItemToSlot({ targetSlot, source, itemId, sourceCategory, sourceSlot }) {
      set((state) => {
        pushHistory(state);
        const previousTarget = state.slots[targetSlot];
        state.slots[targetSlot] = itemId;
        delete state.craftedSlots[targetSlot];
        state.selectedSlot = targetSlot;
        if (source === 'bin' && sourceCategory) {
          state.binsByCategory[sourceCategory] = state.binsByCategory[sourceCategory].filter((id) => id !== itemId);
        }
        if (source === 'slot' && sourceSlot) {
          if (sourceSlot !== targetSlot) {
            state.slots[sourceSlot] = previousTarget ?? null;
          }
        }
      });
    },

    assignDraggedItemToBin({ targetCategory, source, itemId, sourceCategory, sourceSlot }) {
      set((state) => {
        pushHistory(state);
        if (source === 'bin' && sourceCategory) {
          state.binsByCategory[sourceCategory] = state.binsByCategory[sourceCategory].filter((id) => id !== itemId);
        }
        if (source === 'slot' && sourceSlot) {
          state.slots[sourceSlot] = null;
        }
        dedupePush(state.binsByCategory[targetCategory], itemId);
      });
    },

    toggleLock(slot) {
      set((state) => {
        pushHistory(state);
        state.locks[slot] = !state.locks[slot];
      });
    },

    equipCraftedItem(slot, info) {
      set((state) => {
        pushHistory(state);
        state.slots[slot] = null;
        state.craftedSlots[slot] = info;
        state.selectedSlot = slot;
      });
    },

    clearCraftedSlot(slot) {
      set((state) => {
        pushHistory(state);
        delete state.craftedSlots[slot];
      });
    },

    undo() {
      const current = get();
      const prev = current.undoStack[current.undoStack.length - 1];
      if (!prev) return;
      set((state) => {
        const currentSnap = snapshotOf(state);
        state.undoStack.pop();
        state.redoStack.push(currentSnap);
        applySnapshot(state, prev);
      });
    },

    redo() {
      const current = get();
      const next = current.redoStack[current.redoStack.length - 1];
      if (!next) return;
      set((state) => {
        const currentSnap = snapshotOf(state);
        state.redoStack.pop();
        state.undoStack.push(currentSnap);
        applySnapshot(state, next);
      });
    },

    hydrateSnapshot(snapshot) {
      set((state) => {
        const next = createInitialWorkbenchSnapshot();
        const merged: WorkbenchSnapshot = {
          ...next,
          ...snapshot,
          slots: { ...next.slots, ...(snapshot.slots ?? {}) },
          craftedSlots: { ...next.craftedSlots, ...(snapshot.craftedSlots ?? {}) },
          locks: { ...next.locks, ...(snapshot.locks ?? {}) },
          binsByCategory: {
            ...next.binsByCategory,
            ...(snapshot.binsByCategory ?? {}),
          },
          comparePreview: { ...next.comparePreview, ...(snapshot.comparePreview ?? {}) },
        };
        applySnapshot(state, merged);
        state.undoStack = [];
        state.redoStack = [];
      });
    },

    loadCandidate(slots) {
      set((state) => {
        pushHistory(state);
        state.slots = { ...slots };
        state.comparePreview = { ...EMPTY_COMPARE };
      });
    },

    setLegacyHash(hash) {
      set((state) => {
        state.legacyHash = hash;
      });
    },
  })),
);

export function getCurrentWorkbenchSnapshot(): WorkbenchSnapshot {
  return snapshotOf(useWorkbenchStore.getState());
}
