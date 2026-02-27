import { useMemo, useState } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Copy, Link2, Lock, Trash2, Undo2, Upload } from 'lucide-react';
import type { CatalogSnapshot, ItemCategoryKey, ItemSlot } from '@/domain/items/types';
import { categoryLabel, slotLabel, slotToCategory } from '@/domain/items/types';
import type { CraftedSlotInfo } from '@/domain/build/types';
import type { WorkbenchStore } from '@/domain/build/workbench-state';
import { Button, Panel, ScrollArea, cn } from '@/components/ui';
import { ItemCard } from '@/features/workbench/ItemCard';

function CraftedSlotCard(props: { info: CraftedSlotInfo; onClear: () => void }) {
  const { info } = props;
  return (
    <div className="rounded-lg border border-violet-400/40 bg-violet-400/8 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-violet-100">
            Crafted {info.type.charAt(0).toUpperCase() + info.type.slice(1)}
          </div>
          <div className="mt-0.5 text-[10px] text-violet-200/60">
            Lv. {info.lvl} | {info.hash.slice(0, 20)}...
          </div>
        </div>
        <Button className="px-2 py-1 text-xs" variant="ghost" onClick={props.onClear} title="Remove crafted item">
          <Trash2 size={12} />
        </Button>
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
        'rounded-xl border p-2',
        isOver ? 'border-emerald-400/70 bg-emerald-400/8' : 'border-[var(--wb-border-muted)] bg-black/15',
      )}
      onMouseEnter={() => props.store.setSelectedSlot(props.slot)}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">{slotLabel(props.slot)}</div>
        <div className="flex items-center gap-1">
          <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => props.store.toggleLock(props.slot)} title="Lock slot">
            <Lock size={12} className={cn(props.store.locks[props.slot] && 'text-emerald-300')} />
          </Button>
          <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => props.store.moveSlotToBin(props.slot)} title="Move to bin">
            <Undo2 size={12} />
          </Button>
        </div>
      </div>
      {item ? (
        <div
          ref={draggable.setNodeRef}
          style={{
            transform: CSS.Translate.toString(draggable.transform),
            opacity: draggable.isDragging ? 0.45 : 1,
          }}
          {...draggable.listeners}
          {...draggable.attributes}
        >
          <ItemCard
            item={item}
            compact
            dense
            showDetails={props.showItemDetails}
            dragData={{ kind: 'slot', itemId: item.id, sourceSlot: props.slot }}
            locked={props.store.locks[props.slot]}
            onHover={(hovering) => props.onHoverItem?.(hovering ? item.id : null, hovering ? props.slot : null)}
          />
        </div>
      ) : craftedInfo ? (
        <CraftedSlotCard info={craftedInfo} onClear={() => props.store.clearCraftedSlot(props.slot)} />
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--wb-border)] px-3 py-3 text-center text-xs text-[var(--wb-muted)]">
          Drop a {slotToCategory(props.slot)} item here
        </div>
      )}
    </div>
  );
}

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

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold">{categoryLabel(props.category)} Bin</div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--wb-muted)]">{items.length}</span>
          <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => props.store.clearCategory(props.category)}>
            <Trash2 size={12} className="mr-1 inline" />
            Clear
          </Button>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'wb-grid-backdrop min-h-20 rounded-xl border p-1.5',
          isOver ? 'border-emerald-400/70 bg-emerald-400/8' : 'border-[var(--wb-border-muted)] bg-black/10',
        )}
      >
        {items.length === 0 ? (
          <div className="p-2 text-[11px] text-[var(--wb-muted)]">Drop items here for {props.category}.</div>
        ) : (
          <div className="grid max-h-40 gap-1.5 overflow-auto pr-0.5 wb-scrollbar">
            {items.map((item) => (
              <ItemCard
                key={`${props.category}-${item.id}`}
                item={item}
                compact
                dense
                showDetails={props.showItemDetails}
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
}) {
  const [showItemDetails, setShowItemDetails] = useState(false);
  const slotGroups = useMemo(
    () => [
      ['helmet', 'chestplate', 'leggings', 'boots'],
      ['ring1', 'ring2', 'bracelet', 'necklace'],
    ] as const satisfies ReadonlyArray<ReadonlyArray<ItemSlot>>,
    [],
  );
  const binSections = useMemo(
    () =>
      [
        {
          key: 'armor',
          title: 'Armor Shelf',
          categories: ['helmet', 'chestplate', 'leggings', 'boots'] as const satisfies ReadonlyArray<ItemCategoryKey>,
        },
        {
          key: 'accessories',
          title: 'Accessory Shelf',
          categories: ['ring', 'bracelet', 'necklace'] as const satisfies ReadonlyArray<ItemCategoryKey>,
        },
        {
          key: 'weapon',
          title: 'Weapon Shelf',
          categories: ['weapon'] as const satisfies ReadonlyArray<ItemCategoryKey>,
        },
      ].filter((section) => section.key !== 'weapon') as Array<{
        key: string;
        title: string;
        categories: ReadonlyArray<ItemCategoryKey>;
      }>,
    [],
  );

  return (
    <Panel
      className="flex min-h-0 flex-col"
      title="Build"
      headerRight={
        <>
          <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => props.store.undo()}>
            Undo
          </Button>
          <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => props.store.redo()}>
            Redo
          </Button>
          <Button className="px-2 py-1 text-xs" variant={showItemDetails ? 'primary' : 'ghost'} onClick={() => setShowItemDetails((prev) => !prev)}>
            {showItemDetails ? 'Hide Details' : 'Item Details'}
          </Button>
          <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => props.store.clearAll()}>
            Clear All
          </Button>
        </>
      }
    >
      <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr_auto] gap-2 p-2.5">
        <div className="grid gap-1.5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.05fr)]">
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
            <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">Weapon Shelf</div>
                <div className="text-[11px] text-[var(--wb-muted)]">Pinned weapon candidates</div>
              </div>
              <BinColumn
                category="weapon"
                catalog={props.catalog}
                store={props.store}
                showItemDetails={showItemDetails}
                onHoverItem={props.onHoverItem}
              />
            </div>
          </div>
        </div>

        <ScrollArea className="min-h-0 pr-1">
          <div className="grid gap-3">
            {binSections.map((section) => (
              <div key={section.key} className="grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">{section.title}</div>
                  <div className="text-xs text-[var(--wb-muted)]">
                    {section.categories.map(categoryLabel).join(' • ')}
                  </div>
                </div>
                <div
                  className={cn(
                    'grid gap-2',
                    section.categories.length === 1
                      ? 'grid-cols-1'
                      : section.categories.length === 3
                        ? 'lg:grid-cols-3'
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
        </ScrollArea>

        <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button variant="ghost" className="justify-start" onClick={props.onShareWorkbench}>
              <Link2 size={14} className="mr-2" />
              Share
            </Button>
            <Button variant="ghost" className="justify-start" onClick={props.onExportWorkbench}>
              <Copy size={14} className="mr-2" />
              Export
            </Button>
            <Button variant="ghost" className="justify-start" onClick={props.onImportWorkbench}>
              <Upload size={14} className="mr-2" />
              Import
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
