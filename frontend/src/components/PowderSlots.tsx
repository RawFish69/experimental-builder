import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ItemSlot } from '@/domain/items/types';
import {
  POWDERS,
  POWDER_BY_ID,
  ELEMENT_CSS_VARS,
  type PowderElement,
  type PowderSpec,
} from '@/domain/build/powder-data';
import type { WorkbenchStore } from '@/domain/build/workbench-state';
import { cn } from '@/components/ui';

const ELEMENTS: PowderElement[] = ['earth', 'thunder', 'water', 'fire', 'air'];
const ELEMENT_LABELS: Record<PowderElement, string> = {
  earth: 'Earth', thunder: 'Thunder', water: 'Water', fire: 'Fire', air: 'Air',
};
const TIERS = [1, 2, 3, 4, 5, 6, 7] as const;

function PowderPicker(props: {
  onSelect: (powder: PowderSpec) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        props.onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [props.onClose]);

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-50 mt-1 rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] p-2 shadow-lg"
      style={{ minWidth: 220 }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-[var(--wb-text-secondary)]">Select Powder</span>
        <button type="button" className="wb-inline-button p-0.5" onClick={props.onClose}><X size={12} /></button>
      </div>
      <div className="grid gap-1">
        {ELEMENTS.map((elem) => (
          <div key={elem} className="flex items-center gap-1">
            <span
              className="w-[52px] shrink-0 text-[11px] font-medium"
              style={{ color: ELEMENT_CSS_VARS[elem] }}
            >
              {ELEMENT_LABELS[elem]}
            </span>
            <div className="flex gap-0.5">
              {TIERS.map((tier) => {
                const powder = POWDERS.find((p) => p.element === elem && p.tier === tier)!;
                return (
                  <button
                    key={tier}
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold transition-colors hover:brightness-125"
                    style={{
                      background: `color-mix(in srgb, ${ELEMENT_CSS_VARS[elem]} 25%, transparent)`,
                      color: ELEMENT_CSS_VARS[elem],
                      border: `1px solid color-mix(in srgb, ${ELEMENT_CSS_VARS[elem]} 40%, transparent)`,
                    }}
                    onClick={() => props.onSelect(powder)}
                    title={`${powder.label}: +${powder.min}-${powder.max} dmg, ${powder.convert}% convert, +${powder.defPlus}/-${powder.defMinus} def`}
                  >
                    {tier}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PowderSlots(props: {
  slot: ItemSlot;
  maxSlots: number;
  store: WorkbenchStore;
}) {
  const { slot, maxSlots, store } = props;
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const assigned = store.powdersBySlot?.[slot] ?? [];

  if (maxSlots === 0) return null;

  function handleSelect(powder: PowderSpec) {
    if (pickerIndex == null) return;
    store.setPowder(slot, pickerIndex, powder.id);
    setPickerIndex(null);
  }

  return (
    <div className="relative mt-1">
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-medium text-[var(--wb-text-quaternary)]">Powders</span>
        <div className="flex gap-0.5">
          {Array.from({ length: maxSlots }).map((_, i) => {
            const powderId = assigned[i];
            const powder = powderId != null && powderId >= 0 ? POWDER_BY_ID.get(powderId) : null;
            const isFilled = powder != null;

            return (
              <button
                key={i}
                type="button"
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-sm text-[9px] font-bold transition-all',
                  isFilled
                    ? 'hover:brightness-125'
                    : 'border border-dashed border-[var(--wb-border)] bg-[var(--wb-layer-2)] text-[var(--wb-text-quaternary)] hover:border-[var(--wb-border-strong)] hover:bg-[var(--wb-layer-1)]',
                  pickerIndex === i && 'ring-1 ring-[var(--wb-accent)]',
                )}
                style={isFilled ? {
                  background: `color-mix(in srgb, ${ELEMENT_CSS_VARS[powder.element]} 30%, transparent)`,
                  color: ELEMENT_CSS_VARS[powder.element],
                  border: `1px solid color-mix(in srgb, ${ELEMENT_CSS_VARS[powder.element]} 50%, transparent)`,
                } : undefined}
                title={isFilled ? `${powder.label} — right-click to remove` : `Powder slot ${i + 1} (empty)`}
                onClick={() => setPickerIndex(pickerIndex === i ? null : i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (isFilled) store.removePowder(slot, i);
                }}
              >
                {isFilled ? powder.short : '+'}
              </button>
            );
          })}
        </div>
        {assigned.length > 0 && (
          <button
            type="button"
            className="wb-inline-button p-0.5 text-[9px] text-[var(--wb-text-quaternary)] hover:text-[var(--wb-danger)]"
            onClick={() => store.clearPowders(slot)}
            title="Clear all powders"
          >
            <X size={10} />
          </button>
        )}
      </div>
      {pickerIndex != null && (
        <PowderPicker
          onSelect={handleSelect}
          onClose={() => setPickerIndex(null)}
        />
      )}
    </div>
  );
}
