import { useState } from 'react';
import { ExternalLink, Link2, TreePine } from 'lucide-react';
import type { CatalogSnapshot, NormalizedItem } from '@/domain/items/types';
import type { BuildSummary, ItemSlot, WorkbenchSnapshot } from '@/domain/build/types';
import { slotLabel } from '@/domain/items/types';
import { diffBuildSummary } from '@/domain/build/build-metrics';
import { Button, KpiTile, Panel, ScrollArea } from '@/components/ui';
import { ItemCard } from '@/features/workbench/ItemCard';
import type { WorkbenchSpellPreviewResult } from '@/domain/ability-tree/spell-preview';

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
  onOpenAbilityTree(): void;
  onCopyLegacyLink(): void;
  onOpenLegacyBuilder(): void;
}

export interface AbilityTreeSummaryInfo {
  className: string;
  apUsed: number;
  apCap: number;
  selectedCount: number;
  hasErrors: boolean;
}

export function BuildSummaryPanel(props: {
  catalog: CatalogSnapshot;
  snapshot: WorkbenchSnapshot;
  summary: BuildSummary;
  compareSummary?: BuildSummary | null;
  compareSlot?: ItemSlot | null;
  abilityTreeSummary?: AbilityTreeSummaryInfo | null;
  spellPreview?: WorkbenchSpellPreviewResult | null;
  actions: SummaryActions;
}) {
  const [showFocusedItemDetails, setShowFocusedItemDetails] = useState(false);
  const delta = props.compareSummary ? diffBuildSummary(props.summary, props.compareSummary) : null;
  const meleePreview = props.spellPreview?.melee ?? null;
  const focusedItem = getFocusedItem(props);

  return (
    <Panel
      className="flex min-h-0 flex-col"
      title="Live Build Summary"
      headerRight={
        <div className="flex gap-1">
          <Button className="px-2 py-1 text-xs" variant="ghost" onClick={props.actions.onOpenAbilityTree}>
            <TreePine size={12} className="mr-1" />
            Ability Tree
          </Button>
          <Button className="px-2 py-1 text-xs" onClick={props.actions.onOpenAutoBuilder}>
            Build Solver
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-3">
        {focusedItem ? (
          <div className="wb-card p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--wb-muted)]">Focused Item</div>
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

        {props.abilityTreeSummary ? (
          <div
            className={[
              'rounded-xl border p-3 text-xs',
              props.abilityTreeSummary.hasErrors
                ? 'border-amber-400/30 bg-amber-400/8 text-amber-100'
                : 'border-emerald-400/20 bg-emerald-400/8 text-emerald-100',
            ].join(' ')}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="font-semibold">Ability Tree ({props.abilityTreeSummary.className})</div>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={props.actions.onOpenAbilityTree}>
                Edit
              </Button>
            </div>
            <div>
              AP {props.abilityTreeSummary.apUsed}/{props.abilityTreeSummary.apCap} • {props.abilityTreeSummary.selectedCount} abilities selected
            </div>
            {props.abilityTreeSummary.hasErrors ? <div className="mt-1">Tree has validation issues (dependencies/blockers/AP).</div> : null}
          </div>
        ) : null}

        <div className="wb-card p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">Melee DPS</div>
          <div className="mt-1 flex items-end justify-between gap-2">
            <div className="text-xl font-semibold text-cyan-100">{fmt(meleePreview?.dps ?? props.summary.derived.legacyBaseDps)}</div>
            {delta?.legacyBaseDps != null ? (
              <div className={['text-xs', delta.legacyBaseDps > 0 ? 'text-emerald-300' : delta.legacyBaseDps < 0 ? 'text-rose-300' : 'text-[var(--wb-muted)]'].join(' ')}>
                {delta.legacyBaseDps > 0 ? '+' : ''}
                {Math.round(delta.legacyBaseDps).toLocaleString()}
              </div>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-[var(--wb-muted)]">
            {meleePreview
              ? `Legacy melee DPS (${meleePreview.attackSpeedTier}) • Per Attack ${fmt(meleePreview.perAttackAverage)}`
              : 'Legacy melee DPS preview unavailable (equip a weapon and valid ability tree selection).'}{' '}
            • Melee % / Raw {fmt(props.summary.aggregated.offense.meleePct)} / {fmt(props.summary.aggregated.offense.meleeRaw)}
          </div>
        </div>

        {props.spellPreview ? (
          <div className="wb-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">Spells (ATree)</div>
              <div className="text-xs text-[var(--wb-muted)]">{props.spellPreview.spells.length} entries</div>
            </div>
            {props.spellPreview.notes.length > 0 ? (
              <div className="mb-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-2 text-xs text-amber-100">
                {props.spellPreview.notes.join(' ')}
              </div>
            ) : null}
            {props.spellPreview.spells.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--wb-border-muted)] p-2 text-xs text-[var(--wb-muted)]">
                No spell damage entries yet. Select active ability-tree spell nodes (roots / spell upgrades).
              </div>
            ) : (
              <ScrollArea className="max-h-[36vh] lg:max-h-[44vh]">
                <div className="grid gap-2 pr-1">
                  {props.spellPreview.spells.map((spell) => (
                    <div key={`${spell.baseSpell}-${spell.name}`} className="rounded-lg border border-[var(--wb-border-muted)] bg-black/10 p-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="font-semibold">
                          {spell.name}
                          <span className="ml-1 text-[var(--wb-muted)]">({spell.displayPartName})</span>
                        </div>
                        <div className="text-right">
                          <div className={spell.isHealing ? 'text-emerald-200' : 'text-cyan-100'}>
                            {Math.round(spell.averageDisplayValue).toLocaleString()} {spell.isHealing ? 'heal' : 'avg dmg'}
                          </div>
                          {spell.manaCost != null ? (
                            <div className="text-xs text-[var(--wb-muted)]">{spell.manaCost.toFixed(2)} mana</div>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-1 grid gap-1 text-xs text-[var(--wb-muted)]">
                        {spell.parts
                          .filter((part) => part.display)
                          .map((part) => (
                            <div key={part.name} className="flex items-center justify-between gap-2">
                              <span className="truncate">{part.name}</span>
                              <span className={part.type === 'heal' ? 'text-emerald-200' : 'text-cyan-100'}>
                                {Math.round(part.averageTotal ?? 0).toLocaleString()}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        ) : null}

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
        <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-3 text-xs text-[var(--wb-muted)]">
          Workbench primary KPIs use legacy-compatible metrics (Base DPS + Effective HP). Ability tree editing is now in Workbench, but these summary metrics still exclude ability-tree effects for now. Proxy values are still used internally for search/Build Solver heuristics.
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

        <div className="grid grid-cols-2 gap-2">
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
