import { useState } from 'react';
import { Copy, ExternalLink, Link2, Upload } from 'lucide-react';
import type { CatalogSnapshot, NormalizedItem } from '@/domain/items/types';
import type { BuildSummary, ItemSlot, WorkbenchSnapshot } from '@/domain/build/types';
import { ITEM_SLOTS, slotLabel } from '@/domain/items/types';
import { diffBuildSummary } from '@/domain/build/build-metrics';
import { Button, KpiTile, Panel, ScrollArea } from '@/components/ui';
import { ItemCard } from '@/features/workbench/ItemCard';

function fmt(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : '-';
}

function getWeaponItem(props: {
  catalog: CatalogSnapshot;
  snapshot: WorkbenchSnapshot;
}) {
  const weaponId = props.snapshot.slots.weapon;
  if (weaponId == null) return null;
  return props.catalog.itemsById.get(weaponId) ?? null;
}

function getFocusedItem(props: {
  catalog: CatalogSnapshot;
  snapshot: WorkbenchSnapshot;
}): { item: NormalizedItem; source: string } | null {
  const preview = props.snapshot.comparePreview;
  if (preview.itemId != null) {
    const item = props.catalog.itemsById.get(preview.itemId);
    if (item) {
      const source = preview.slot ? `Compare Preview • ${slotLabel(preview.slot)}` : 'Compare Preview';
      return { item, source };
    }
  }

  if (props.snapshot.selectedSlot) {
    const selectedId = props.snapshot.slots[props.snapshot.selectedSlot];
    if (selectedId != null) {
      const item = props.catalog.itemsById.get(selectedId);
      if (item) {
        return { item, source: `Selected Slot • ${slotLabel(props.snapshot.selectedSlot)}` };
      }
    }
  }

  const weapon = getWeaponItem(props);
  if (weapon) {
    return { item: weapon, source: 'Equipped Weapon' };
  }
  return null;
}

export interface SummaryActions {
  onOpenAutoBuilder(): void;
  onExportWorkbench(): void;
  onImportWorkbench(): void;
  onShareWorkbench(): void;
  onCopyLegacyLink(): void;
  onOpenLegacyBuilder(): void;
}

export function BuildSummaryPanel(props: {
  catalog: CatalogSnapshot;
  snapshot: WorkbenchSnapshot;
  summary: BuildSummary;
  compareSummary?: BuildSummary | null;
  compareSlot?: ItemSlot | null;
  actions: SummaryActions;
}) {
  const [showFocusedItemDetails, setShowFocusedItemDetails] = useState(false);
  const delta = props.compareSummary ? diffBuildSummary(props.summary, props.compareSummary) : null;
  const equippedItems = ITEM_SLOTS.map((slot) => {
    const id = props.snapshot.slots[slot];
    return { slot, item: id == null ? null : props.catalog.itemsById.get(id) ?? null };
  });
  const focusedItem = getFocusedItem(props);

  return (
    <Panel
      className="flex min-h-0 flex-col"
      title="Live Build Summary"
      headerRight={
        <div className="flex gap-1">
          <Button className="px-2 py-1 text-xs" onClick={props.actions.onOpenAutoBuilder}>
            Auto Build
          </Button>
          <Button className="px-2 py-1 text-xs" variant="ghost" onClick={props.actions.onShareWorkbench} title="Share Workbench Link">
            <Link2 size={12} className="mr-1 inline" />
            Share
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-3">
        {focusedItem ? (
          <div className="wb-card p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--wb-muted)]">Focused Item</div>
                <div className="text-xs text-[var(--wb-muted)]">{focusedItem.source}</div>
              </div>
              <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => setShowFocusedItemDetails((prev) => !prev)}>
                {showFocusedItemDetails ? 'Hide Stats' : 'Show Stats'}
              </Button>
            </div>
            <ItemCard item={focusedItem.item} compact dense showDetails={showFocusedItemDetails} />
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-3 text-xs text-[var(--wb-muted)]">
            Select or hover an item to inspect it here.
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <KpiTile label="Base DPS" value={fmt(props.summary.derived.legacyBaseDps)} delta={delta?.legacyBaseDps ?? null} />
          <KpiTile label="Effective HP" value={fmt(props.summary.derived.legacyEhp)} delta={delta?.legacyEhp ?? null} />
          <KpiTile label="Req Total" value={fmt(props.summary.derived.reqTotal)} />
          <KpiTile label="SP Total" value={fmt(props.summary.derived.skillPointTotal)} delta={delta?.skillPointTotal ?? null} />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 px-3 py-2">
            <span className="text-[var(--wb-muted)]">SP Feasibility:</span>{' '}
            <span className={props.summary.derived.skillpointFeasible ? 'text-emerald-200' : 'text-rose-200'}>
              {props.summary.derived.skillpointFeasible ? 'Wearable' : 'Invalid / Not Wearable'}
            </span>
          </div>
          <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 px-3 py-2">
            <span className="text-[var(--wb-muted)]">Assigned SP Needed:</span>{' '}
            <span>{fmt(props.summary.derived.assignedSkillPointsRequired)}</span>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-3 text-xs text-[var(--wb-muted)]">
          Workbench primary KPIs use legacy-compatible metrics (Base DPS + Effective HP, ability tree excluded). Proxy values are still used internally for search/autobuilder heuristics.
        </div>

        {props.compareSummary && props.compareSlot ? (
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/8 p-3 text-xs text-emerald-100">
            Compare preview for <b>{slotLabel(props.compareSlot)}</b>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="wb-card p-3">
            <div className="text-xs uppercase tracking-wide text-[var(--wb-muted)]">Offense</div>
            <div className="mt-2 grid gap-1 text-xs">
              <div>Legacy Base DPS: {fmt(props.summary.derived.legacyBaseDps)}</div>
              <div>Heuristic DPS Proxy: {fmt(props.summary.derived.dpsProxy)}</div>
              <div>Spell % / Raw: {fmt(props.summary.aggregated.offense.spellPct)} / {fmt(props.summary.aggregated.offense.spellRaw)}</div>
              <div>Melee % / Raw: {fmt(props.summary.aggregated.offense.meleePct)} / {fmt(props.summary.aggregated.offense.meleeRaw)}</div>
            </div>
          </div>
          <div className="wb-card p-3">
            <div className="text-xs uppercase tracking-wide text-[var(--wb-muted)]">Defense & Utility</div>
            <div className="mt-2 grid gap-1 text-xs">
              <div>Legacy EHP (AGI): {fmt(props.summary.derived.legacyEhp)}</div>
              <div>Legacy EHP (No AGI): {fmt(props.summary.derived.legacyEhpNoAgi)}</div>
              <div>Heuristic EHP Proxy: {fmt(props.summary.derived.ehpProxy)}</div>
              <div>HP Total: {fmt(props.summary.aggregated.hpTotal)}</div>
              <div>HPR Total: {fmt(props.summary.aggregated.hprTotal)}</div>
              <div>MR / MS / LS: {fmt(props.summary.aggregated.mr)} / {fmt(props.summary.aggregated.ms)} / {fmt(props.summary.aggregated.ls)}</div>
              <div>Walk Speed: {fmt(props.summary.aggregated.speed)}</div>
            </div>
          </div>
        </div>
        <div className="grid gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">Warnings</div>
          {props.summary.warnings.messages.length === 0 ? (
            <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-3 text-xs text-emerald-200">
              No active warnings.
            </div>
          ) : (
            <ScrollArea className="max-h-32">
              <div className="grid gap-2">
                {props.summary.warnings.messages.map((warning, index) => (
                  <div key={`${warning}-${index}`} className="rounded-xl border border-amber-400/30 bg-amber-400/8 p-2 text-xs text-amber-100">
                    {warning}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="grid gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">Equipped</div>
          <div className="grid gap-1 text-xs">
            {equippedItems.map(({ slot, item }) => (
              <div key={slot} className="flex items-center justify-between rounded-lg border border-[var(--wb-border-muted)] bg-black/10 px-2 py-1.5">
                <span className="text-[var(--wb-muted)]">{slotLabel(slot)}</span>
                <span className={item ? '' : 'text-[var(--wb-muted)]'}>{item?.displayName ?? 'Empty'}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" className="justify-start" onClick={props.actions.onExportWorkbench}>
            <Copy size={14} className="mr-2" />
            Export
          </Button>
          <Button variant="ghost" className="justify-start" onClick={props.actions.onImportWorkbench}>
            <Upload size={14} className="mr-2" />
            Import
          </Button>
          <Button variant="ghost" className="justify-start" onClick={props.actions.onCopyLegacyLink} disabled={!props.snapshot.legacyHash}>
            <Link2 size={14} className="mr-2" />
            Legacy Link
          </Button>
          <Button variant="ghost" className="justify-start" onClick={props.actions.onOpenLegacyBuilder}>
            <ExternalLink size={14} className="mr-2" />
            Open Legacy
          </Button>
        </div>
      </div>
    </Panel>
  );
}
