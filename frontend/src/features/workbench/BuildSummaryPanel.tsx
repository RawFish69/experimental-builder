import { ExternalLink, Link2 } from 'lucide-react';
import type { CatalogSnapshot } from '@/domain/items/types';
import type { BuildSummary, ItemSlot, WorkbenchSnapshot } from '@/domain/build/types';
import { slotLabel } from '@/domain/items/types';
import { diffBuildSummary } from '@/domain/build/build-metrics';
import { Button, KpiTile, Panel, ScrollArea } from '@/components/ui';
import { ManaSustainPanel } from '@/features/workbench/ManaSustainPanel';
import type { WorkbenchSpellPreviewResult } from '@/domain/ability-tree/spell-preview';

function fmt(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : '-';
}

export interface SummaryActions {
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
  const delta = props.compareSummary ? diffBuildSummary(props.summary, props.compareSummary) : null;
  const meleePreview = props.spellPreview?.melee ?? null;

  return (
    <Panel
      className="flex min-h-0 flex-col"
      title="Live Build Summary"
      headerRight={null}
    >
      <div className="flex flex-col gap-3 p-3">
        <div className="wb-card p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">Melee DPS</div>
          <div className="mt-1 flex items-end justify-between gap-2">
            <div className="wb-text-offense text-xl font-semibold">{fmt(meleePreview?.dps ?? props.summary.derived.legacyBaseDps)}</div>
            {delta?.legacyBaseDps != null ? (
              <div className={['text-xs', delta.legacyBaseDps > 0 ? 'wb-text-success' : delta.legacyBaseDps < 0 ? 'wb-text-danger' : 'text-[var(--wb-muted)]'].join(' ')}>
                {delta.legacyBaseDps > 0 ? '+' : ''}
                {Math.round(delta.legacyBaseDps).toLocaleString()}
              </div>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-[var(--wb-muted)]">
            {meleePreview
              ? `Legacy melee DPS (${meleePreview.attackSpeedTier}) • Per Attack ${fmt(meleePreview.perAttackAverage)}`
              : 'Legacy melee DPS preview unavailable (equip a weapon and valid ability tree selection).'}{' '}
            • Melee % / Raw <span className="wb-text-offense">{fmt(props.summary.aggregated.offense.meleePct)}</span> / <span className="wb-text-offense">{fmt(props.summary.aggregated.offense.meleeRaw)}</span>
          </div>
        </div>

        <ManaSustainPanel spellPreview={props.spellPreview ?? null} summary={props.summary} />

        {props.spellPreview ? (
          <div className="wb-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">Spells (ATree)</div>
              <div className="text-xs text-[var(--wb-muted)]">{props.spellPreview.spells.length} entries</div>
            </div>
            {props.spellPreview.notes.length > 0 ? (
              <div className="wb-banner mb-2 p-2 text-xs" data-tone="warning">
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
                    <div key={`${spell.baseSpell}-${spell.name}`} className="wb-surface rounded-lg p-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 font-semibold">
                          <span>
                            {spell.name}
                            <span className="ml-1 text-[var(--wb-muted)]">({spell.displayPartName})</span>
                          </span>
                          {!spell.isHealing && spell.dominantElement && spell.dominantElement !== 'n' ? (
                            <span className={`spell-elem-chip spell-elem-${spell.dominantElement}`}>
                              {spell.dominantElement === 'e'
                                ? 'Earth'
                                : spell.dominantElement === 't'
                                  ? 'Thunder'
                                  : spell.dominantElement === 'w'
                                    ? 'Water'
                                    : spell.dominantElement === 'f'
                                      ? 'Fire'
                                      : spell.dominantElement === 'a'
                                        ? 'Air'
                                        : ''}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <div className={spell.isHealing ? 'wb-text-defense' : 'wb-text-offense'}>
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
                              <span className={part.type === 'heal' ? 'wb-text-defense' : 'wb-text-offense'}>
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
          <KpiTile label="Base DPS" value={fmt(props.summary.derived.legacyBaseDps)} delta={delta?.legacyBaseDps ?? null} valueClassName="wb-text-offense" />
          <KpiTile label="Effective HP" value={fmt(props.summary.derived.legacyEhp)} delta={delta?.legacyEhp ?? null} valueClassName="wb-text-defense" />
          <KpiTile label="Req Total" value={fmt(props.summary.derived.reqTotal)} />
          <KpiTile label="SP Total" value={fmt(props.summary.derived.skillPointTotal)} delta={delta?.skillPointTotal ?? null} />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="wb-surface rounded-xl px-3 py-2">
            <span className="text-[var(--wb-muted)]">SP Feasibility:</span>{' '}
            <span className={props.summary.derived.skillpointFeasible ? 'wb-text-success' : 'wb-text-danger'}>
              {props.summary.derived.skillpointFeasible ? 'Wearable' : 'Invalid / Not Wearable'}
            </span>
          </div>
          <div className="wb-surface rounded-xl px-3 py-2">
            <span className="text-[var(--wb-muted)]">Assigned SP Needed:</span>{' '}
            <span>{fmt(props.summary.derived.assignedSkillPointsRequired)}</span>
          </div>
        </div>

        {props.compareSummary && props.compareSlot ? (
          <div className="wb-banner p-3 text-xs" data-tone="success">
            Compare preview for <b>{slotLabel(props.compareSlot)}</b>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="wb-card p-3">
            <div className="text-xs uppercase tracking-wide text-[var(--wb-muted)]">Offense</div>
            <div className="mt-2 grid gap-1 text-xs">
              <div><span className="text-[var(--wb-muted)]">Legacy Base DPS:</span> <span className="wb-text-offense font-medium">{fmt(props.summary.derived.legacyBaseDps)}</span></div>
              <div><span className="text-[var(--wb-muted)]">Heuristic DPS Proxy:</span> <span className="wb-text-offense">{fmt(props.summary.derived.dpsProxy)}</span></div>
              <div><span className="text-[var(--wb-muted)]">Spell % / Raw:</span> <span className="wb-text-offense">{fmt(props.summary.aggregated.offense.spellPct)}</span> / <span className="wb-text-offense">{fmt(props.summary.aggregated.offense.spellRaw)}</span></div>
              <div><span className="text-[var(--wb-muted)]">Melee % / Raw:</span> <span className="wb-text-offense">{fmt(props.summary.aggregated.offense.meleePct)}</span> / <span className="wb-text-offense">{fmt(props.summary.aggregated.offense.meleeRaw)}</span></div>
            </div>
          </div>
          <div className="wb-card p-3">
            <div className="text-xs uppercase tracking-wide text-[var(--wb-muted)]">Defense & Utility</div>
            <div className="mt-2 grid gap-1 text-xs">
              <div><span className="text-[var(--wb-muted)]">Legacy EHP (AGI):</span> <span className="wb-text-defense font-medium">{fmt(props.summary.derived.legacyEhp)}</span></div>
              <div><span className="text-[var(--wb-muted)]">Legacy EHP (No AGI):</span> <span className="wb-text-defense">{fmt(props.summary.derived.legacyEhpNoAgi)}</span></div>
              <div><span className="text-[var(--wb-muted)]">Heuristic EHP Proxy:</span> <span className="wb-text-defense">{fmt(props.summary.derived.ehpProxy)}</span></div>
              <div><span className="text-[var(--wb-muted)]">HP Total:</span> <span className="wb-text-defense">{fmt(props.summary.aggregated.hpTotal)}</span></div>
              <div><span className="text-[var(--wb-muted)]">HPR Total:</span> {fmt(props.summary.aggregated.hprTotal)}</div>
              <div><span className="text-[var(--wb-muted)]">MR / MS / LS:</span> {fmt(props.summary.aggregated.mr)} / {fmt(props.summary.aggregated.ms)} / {fmt(props.summary.aggregated.ls)}</div>
              <div><span className="text-[var(--wb-muted)]">Walk Speed:</span> {fmt(props.summary.aggregated.speed)}</div>
            </div>
          </div>
        </div>
        <div className="wb-surface rounded-xl p-3 text-xs text-[var(--wb-muted)]">
          Workbench primary KPIs use legacy-compatible metrics (Base DPS + Effective HP). Ability tree editing is now in Workbench, but these summary metrics still exclude ability-tree effects for now. Proxy values are still used internally for search/Build Solver heuristics.
        </div>
        <div className="grid gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">Warnings</div>
          {props.summary.warnings.messages.length === 0 ? (
            <div className="wb-surface rounded-xl p-3 text-xs wb-text-success">
              No active warnings.
            </div>
          ) : (
            <ScrollArea className="max-h-32">
              <div className="grid gap-2">
                {props.summary.warnings.messages.map((warning, index) => (
                  <div key={`${warning}-${index}`} className="wb-banner p-2 text-xs" data-tone="warning">
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
