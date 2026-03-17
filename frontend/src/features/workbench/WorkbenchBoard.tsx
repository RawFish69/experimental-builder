import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Copy, ExternalLink, Link2, Lock, Trash2, Undo2, Upload } from 'lucide-react';
import type { CatalogSnapshot, ItemCategoryKey, ItemSlot } from '@/domain/items/types';
import { categoryLabel, slotLabel, slotToCategory } from '@/domain/items/types';
import type { CraftedSlotInfo } from '@/domain/build/types';
import type { WorkbenchStore } from '@/domain/build/workbench-state';
import { POWDERABLE_SLOTS } from '@/domain/build/powder-data';
import { Button, cn } from '@/components/ui';
import { ItemCard, ItemRow } from '@/components/ItemDisplay';
import { PowderSlots } from '@/components/PowderSlots';

function CraftedSlotCard(props: { info: CraftedSlotInfo; onClear: () => void }) {
  const { info } = props;
  return (
    <div className="wb-banner px-2 py-1.5" data-tone="accent">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold">
            Crafted {info.type.charAt(0).toUpperCase() + info.type.slice(1)}
          </div>
          <div className="text-[10px] text-[var(--wb-text-tertiary)]">
            Lv. {info.lvl} | {info.hash.slice(0, 16)}...
          </div>
        </div>
        <button type="button" className="wb-inline-button p-0.5" onClick={props.onClear} title="Remove crafted item">
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

function SlotCard(props: {
  slot: ItemSlot;
  catalog: CatalogSnapshot;
  store: WorkbenchStore;
  showItemDetails?: boolean;
  onHoverItem?: (itemId: number | null, slot: ItemSlot | null) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `slot:${props.slot}`, data: { droppableType: 'slot', slot: props.slot } });
  const itemId = props.store.slots[props.slot];
  const item = itemId != null ? props.catalog.itemsById.get(itemId) : undefined;
  const craftedInfo: CraftedSlotInfo | undefined = props.store.craftedSlots[props.slot];

  const draggable = useDraggable({
    id: item ? `slot-item:${props.slot}:${item.id}` : `slot-empty:${props.slot}`,
    data: item ? { dragItem: { kind: 'slot', itemId: item.id, sourceSlot: props.slot } } : undefined,
    disabled: !item,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-md border p-1.5',
        isOver ? 'border-[var(--wb-success)] bg-[var(--wb-success-muted)]' : 'border-[var(--wb-border-muted)] bg-[var(--wb-layer-1)]',
      )}
      onMouseEnter={() => props.store.setSelectedSlot(props.slot)}
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--wb-text-quaternary)]">
          {slotLabel(props.slot)}
        </span>
        <div className="flex items-center gap-0.5">
          <button type="button" className="wb-inline-button p-0.5" onClick={() => props.store.toggleLock(props.slot)} title="Lock">
            <Lock size={10} className={cn(props.store.locks[props.slot] && 'text-[var(--wb-success)]')} />
          </button>
          <button type="button" className="wb-inline-button p-0.5" onClick={() => props.store.moveSlotToBin(props.slot)} title="Unequip">
            <Undo2 size={10} />
          </button>
        </div>
      </div>
      {item ? (
        <>
          <div
            ref={draggable.setNodeRef}
            style={{ transform: CSS.Translate.toString(draggable.transform), opacity: draggable.isDragging ? 0.45 : 1 }}
            {...draggable.listeners}
            {...draggable.attributes}
          >
            <ItemCard
              item={item}
              compact
              showDetails={props.showItemDetails}
              dragData={{ kind: 'slot', itemId: item.id, sourceSlot: props.slot }}
              locked={props.store.locks[props.slot]}
              onHover={(hovering) => props.onHoverItem?.(hovering ? item.id : null, hovering ? props.slot : null)}
              powderIds={props.store.powdersBySlot?.[props.slot]}
            />
          </div>
          {POWDERABLE_SLOTS.has(props.slot) && item.powderSlots > 0 && (
            <PowderSlots slot={props.slot} maxSlots={item.powderSlots} store={props.store} />
          )}
        </>
      ) : craftedInfo ? (
        <CraftedSlotCard info={craftedInfo} onClear={() => props.store.clearCraftedSlot(props.slot)} />
      ) : (
        <div className="wb-placeholder rounded px-2 py-2 text-center text-[10px]">
          Drop {slotToCategory(props.slot)}
        </div>
      )}
    </div>
  );
}

const BIN_CAPACITY = 69;

function BinColumn(props: {
  category: ItemCategoryKey;
  catalog: CatalogSnapshot;
  store: WorkbenchStore;
  showItemDetails?: boolean;
  onHoverItem?: (itemId: number | null, slot: ItemSlot | null) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `bin:${props.category}`,
    data: { droppableType: 'bin', category: props.category },
  });
  const items = props.store.binsByCategory[props.category]
    .map((id) => props.catalog.itemsById.get(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const isFull = items.length >= BIN_CAPACITY;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--wb-text-quaternary)]">
          {categoryLabel(props.category)}{' '}
          <span className={isFull ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--wb-text-quaternary)]'}>
            ({items.length}/{BIN_CAPACITY})
          </span>
        </span>
        <button type="button" className="wb-inline-button p-0.5 text-[10px]" onClick={() => props.store.clearCategory(props.category)}>
          <Trash2 size={10} />
        </button>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'min-h-10 rounded-md border p-1',
          isOver ? 'border-[var(--wb-success)] bg-[var(--wb-success-muted)]' : 'border-[var(--wb-border-muted)] bg-[var(--wb-layer-1)]',
        )}
      >
        {items.length === 0 ? (
          <div className="p-1.5 text-center text-[10px] text-[var(--wb-text-quaternary)]">
            Drop {props.category} here
          </div>
        ) : (
          <div className="grid max-h-64 gap-0.5 overflow-auto wb-scrollbar">
            {items.map((item) => (
              <ItemRow
                key={`${props.category}-${item.id}`}
                item={item}
                dragData={{ kind: 'bin', itemId: item.id, sourceCategory: props.category }}
                onRemove={() => props.store.removePinnedItem(props.category, item.id)}
                onHover={(hovering) => {
                  const selectedSlot =
                    props.store.selectedSlot && slotToCategory(props.store.selectedSlot) === props.category
                      ? props.store.selectedSlot
                      : null;
                  props.onHoverItem?.(hovering ? item.id : null, hovering ? selectedSlot : null);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkbenchBoard(props: {
  catalog: CatalogSnapshot;
  store: WorkbenchStore;
  onHoverItem?: (itemId: number | null, slot: ItemSlot | null) => void;
  onShareWorkbench?: () => void;
  onExportWorkbench?: () => void;
  onImportWorkbench?: () => void;
  onOpenInWynnBuilder?: () => void;
  searchResults?: ReactNode;
}) {
  const [showItemDetails, setShowItemDetails] = useState(true);
  const slotGroups = useMemo(
    () => [
      ['helmet', 'chestplate', 'leggings', 'boots'],
      ['ring1', 'ring2', 'bracelet', 'necklace'],
    ] as const satisfies ReadonlyArray<ReadonlyArray<ItemSlot>>,
    [],
  );
  const binSections = useMemo(
    () => [
      { key: 'armor', title: 'Armor', categories: ['helmet', 'chestplate', 'leggings', 'boots'] as const satisfies ReadonlyArray<ItemCategoryKey> },
      { key: 'accessories', title: 'Accessories', categories: ['ring', 'bracelet', 'necklace'] as const satisfies ReadonlyArray<ItemCategoryKey> },
    ] as Array<{ key: string; title: string; categories: ReadonlyArray<ItemCategoryKey> }>,
    [],
  );

  const comparePreview = props.store.comparePreview;
  let focusedItemForBoard: { itemId: number; source: string } | null = null;
  if (comparePreview?.itemId != null && comparePreview.slot) {
    focusedItemForBoard = { itemId: comparePreview.itemId, source: `Compare • ${slotLabel(comparePreview.slot)}` };
  } else if (props.store.selectedSlot) {
    const selectedId = props.store.slots[props.store.selectedSlot];
    if (selectedId != null) {
      focusedItemForBoard = { itemId: selectedId, source: `Selected • ${slotLabel(props.store.selectedSlot)}` };
    }
  } else if (props.store.slots.weapon != null) {
    focusedItemForBoard = { itemId: props.store.slots.weapon, source: 'Weapon' };
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[13px] font-semibold">Build</span>
          <Button className="px-1.5 py-0.5 text-[10px]" variant="ghost" onClick={() => props.store.undo()}>Undo</Button>
          <Button className="px-1.5 py-0.5 text-[10px]" variant="ghost" onClick={() => props.store.redo()}>Redo</Button>
          <Button
            className="px-1.5 py-0.5 text-[10px]"
            variant={showItemDetails ? 'primary' : 'ghost'}
            onClick={() => setShowItemDetails((v) => !v)}
          >
            {showItemDetails ? 'Hide Detail' : 'Detail'}
          </Button>
          <Button className="px-1.5 py-0.5 text-[10px]" variant="ghost" onClick={() => props.store.clearAll()}>Clear</Button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" className="px-1.5 py-0.5 text-[10px]" onClick={props.onShareWorkbench}>
            <Link2 size={10} className="mr-0.5" /> Share
          </Button>
          <Button variant="ghost" className="px-1.5 py-0.5 text-[10px]" onClick={props.onExportWorkbench}>
            <Copy size={10} className="mr-0.5" /> Export
          </Button>
          <Button variant="ghost" className="px-1.5 py-0.5 text-[10px]" onClick={props.onImportWorkbench}>
            <Upload size={10} className="mr-0.5" /> Import
          </Button>
          <Button variant="ghost" className="px-1.5 py-0.5 text-[10px]" onClick={props.onOpenInWynnBuilder}>
            <ExternalLink size={10} className="mr-0.5" /> WynnBuilder
          </Button>
        </div>
      </div>

      {/* Equipment grid: 1 col on mobile, 2 on md, 3 on xl */}
      <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        {slotGroups.map((group, idx) => (
          <div key={idx} className="grid gap-1.5">
            {group.map((slot) => (
              <SlotCard
                key={slot}
                slot={slot}
                catalog={props.catalog}
                store={props.store}
                showItemDetails={showItemDetails}
                onHoverItem={props.onHoverItem}
              />
            ))}
          </div>
        ))}
        <div className="grid content-start gap-1.5">
          <SlotCard
            slot="weapon"
            catalog={props.catalog}
            store={props.store}
            showItemDetails={showItemDetails}
            onHoverItem={props.onHoverItem}
          />
          <BinColumn
            category="weapon"
            catalog={props.catalog}
            store={props.store}
            showItemDetails={showItemDetails}
            onHoverItem={props.onHoverItem}
          />
          {focusedItemForBoard && (() => {
            const item = props.catalog.itemsById.get(focusedItemForBoard!.itemId);
            if (!item) return null;
            return (
              <div className="rounded-md border border-[var(--wb-accent-border)] bg-[var(--wb-accent-muted)] p-1.5">
                <div className="mb-1 text-[10px] text-[var(--wb-accent-text)]">{focusedItemForBoard!.source}</div>
                <ItemCard item={item} compact showDetails={showItemDetails} />
              </div>
            );
          })()}
        </div>
      </div>

      {/* Item bins/shelves */}
      <div className="grid gap-2">
        {binSections.map((section) => (
          <div key={section.key}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--wb-text-quaternary)]">
              {section.title}
            </div>
            <div
              className={cn(
                'grid gap-1.5',
                section.categories.length === 1 ? 'grid-cols-1'
                  : section.categories.length === 3 ? 'lg:grid-cols-3'
                  : 'md:grid-cols-2 xl:grid-cols-4',
              )}
            >
              {section.categories.map((category) => (
                <BinColumn
                  key={category}
                  category={category}
                  catalog={props.catalog}
                  store={props.store}
                  showItemDetails={showItemDetails}
                  onHoverItem={props.onHoverItem}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Embedded search results */}
      {props.searchResults && (
        <div className="flex min-h-[180px] max-h-[35vh] min-w-0 flex-col overflow-hidden rounded-md border border-[var(--wb-border-muted)] bg-[var(--wb-layer-1)]">
          {props.searchResults}
        </div>
      )}
    </div>
  );
}
