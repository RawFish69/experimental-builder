import { ExternalLink, Link2 } from 'lucide-react';
import type { CatalogSnapshot } from '@/domain/items/types';
import type { BuildSummary, ItemSlot, WorkbenchSnapshot } from '@/domain/build/types';
import { slotLabel } from '@/domain/items/types';
import { diffBuildSummary } from '@/domain/build/build-metrics';
import { Button, KpiTile, ScrollArea, Separator, StatRow } from '@/components/ui';
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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--wb-border-muted)] px-3 py-2">
        <span className="text-sm font-semibold">Stats</span>
        <div className="flex gap-1">
          <Button variant="ghost" className="px-1.5 py-0.5 text-[11px]" onClick={props.actions.onCopyLegacyLink} disabled={!props.snapshot.legacyHash}>
            <Link2 size={11} className="mr-0.5" /> Legacy
          </Button>
          <Button variant="ghost" className="px-1.5 py-0.5 text-[11px]" onClick={props.actions.onOpenLegacyBuilder}>
            <ExternalLink size={11} className="mr-0.5" /> Open
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2.5 p-3">
          {/* Primary KPIs */}
          <div className="grid grid-cols-2 gap-1.5">
            <KpiTile label="Melee DPS" value={fmt(meleePreview?.dps ?? props.summary.derived.legacyBaseDps)} delta={delta?.legacyBaseDps ?? null} valueClassName="wb-text-offense" />
            <KpiTile label="Effective HP" value={fmt(props.summary.derived.legacyEhp)} delta={delta?.legacyEhp ?? null} valueClassName="wb-text-defense" />
            <KpiTile label="Req Total" value={fmt(props.summary.derived.reqTotal)} />
            <KpiTile label="SP Total" value={fmt(props.summary.derived.skillPointTotal)} delta={delta?.skillPointTotal ?? null} />
          </div>

          {/* Melee detail line */}
          {meleePreview && (
            <div className="rounded-md bg-[var(--wb-layer-1)] px-2.5 py-2 text-xs text-[var(--wb-text-tertiary)]">
              <span className="wb-text-offense" style={{ fontFamily: 'var(--font-mono)' }}>{fmt(meleePreview.dps)}</span>
              {' '}DPS ({meleePreview.attackSpeedTier}) &middot; Per hit{' '}
              <span style={{ fontFamily: 'var(--font-mono)' }}>{fmt(meleePreview.perAttackAverage)}</span>
            </div>
          )}

          {/* SP Feasibility */}
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <div className="rounded-md bg-[var(--wb-layer-1)] px-2.5 py-2">
              <span className="text-[var(--wb-text-tertiary)]">SP: </span>
              <span className={props.summary.derived.skillpointFeasible ? 'wb-text-success' : 'wb-text-danger'}>
                {props.summary.derived.skillpointFeasible ? 'Wearable' : 'Invalid'}
              </span>
            </div>
            <div className="rounded-md bg-[var(--wb-layer-1)] px-2.5 py-2">
              <span className="text-[var(--wb-text-tertiary)]">Assigned: </span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{fmt(props.summary.derived.assignedSkillPointsRequired)}</span>
            </div>
          </div>

          {props.compareSummary && props.compareSlot && (
            <div className="wb-banner px-2.5 py-1.5 text-xs" data-tone="success">
              Comparing for <b>{slotLabel(props.compareSlot)}</b>
            </div>
          )}

          <Separator />

          {/* Mana Sustain */}
          <ManaSustainPanel spellPreview={props.spellPreview ?? null} summary={props.summary} />

          <Separator />

          {/* Spell preview */}
          {props.spellPreview && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--wb-text-quaternary)]">Spells (ATree)</span>
                <span className="text-[11px] text-[var(--wb-text-quaternary)]">{props.spellPreview.spells.length}</span>
              </div>
              {props.spellPreview.notes.length > 0 && (
                <div className="wb-banner mb-1.5 p-2 text-xs" data-tone="warning">
                  {props.spellPreview.notes.join(' ')}
                </div>
              )}
              {props.spellPreview.spells.length === 0 ? (
                <div className="rounded-md border border-dashed border-[var(--wb-border)] p-3 text-center text-xs text-[var(--wb-text-quaternary)]">
                  No spell entries. Select spell nodes in ability tree.
                </div>
              ) : (
                <ScrollArea className="max-h-[36vh]">
                  <div className="grid gap-1.5">
                    {props.spellPreview.spells.map((spell) => (
                      <div key={`${spell.baseSpell}-${spell.name}`} className="rounded-md bg-[var(--wb-layer-1)] p-2">
                        <div className="flex items-center justify-between gap-1.5 text-[13px]">
                          <div className="flex items-center gap-1 font-medium">
                            <span>{spell.name}</span>
                            <span className="text-[var(--wb-text-quaternary)]">({spell.displayPartName})</span>
                            {!spell.isHealing && spell.dominantElement && spell.dominantElement !== 'n' && (
                              <span className={`spell-elem-chip spell-elem-${spell.dominantElement}`}>
                                {spell.dominantElement === 'e' ? 'E' : spell.dominantElement === 't' ? 'T' : spell.dominantElement === 'w' ? 'W' : spell.dominantElement === 'f' ? 'F' : spell.dominantElement === 'a' ? 'A' : ''}
                              </span>
                            )}
                          </div>
                          <div className="text-right">
                            <span className={spell.isHealing ? 'wb-text-defense' : 'wb-text-offense'} style={{ fontFamily: 'var(--font-mono)' }}>
                              {Math.round(spell.averageDisplayValue).toLocaleString()}
                            </span>
                            <span className="ml-1 text-[11px] text-[var(--wb-text-quaternary)]">{spell.isHealing ? 'heal' : 'dmg'}</span>
                          </div>
                        </div>
                        {spell.manaCost != null && (
                          <div className="text-right text-[11px] text-[var(--wb-text-quaternary)]" style={{ fontFamily: 'var(--font-mono)' }}>
                            {spell.manaCost.toFixed(1)} mana
                          </div>
                        )}
                        <div className="mt-1 grid gap-0.5">
                          {spell.parts.filter((p) => p.display).map((part) => (
                            <div key={part.name} className="flex items-center justify-between gap-1 text-xs">
                              <span className="truncate text-[var(--wb-text-tertiary)]">{part.name}</span>
                              <span className={part.type === 'heal' ? 'wb-text-defense' : 'wb-text-offense'} style={{ fontFamily: 'var(--font-mono)' }}>
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
          )}

          <Separator />

          {/* Defense breakdown */}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--wb-text-quaternary)]">Defense & Utility</div>
            <div className="grid gap-1 rounded-md bg-[var(--wb-layer-1)] p-2">
              <StatRow label="EHP (AGI)" value={fmt(props.summary.derived.legacyEhp)} valueClassName="wb-text-defense" />
              <StatRow label="EHP (No AGI)" value={fmt(props.summary.derived.legacyEhpNoAgi)} valueClassName="wb-text-defense" />
              <StatRow label="EHP Proxy" value={fmt(props.summary.derived.ehpProxy)} valueClassName="wb-text-defense" />
              <StatRow label="HP Total" value={fmt(props.summary.aggregated.hpTotal)} valueClassName="wb-text-defense" />
              <StatRow label="HPR Total" value={fmt(props.summary.aggregated.hprTotal)} />
              <StatRow label="MR / MS / LS" value={`${fmt(props.summary.aggregated.mr)} / ${fmt(props.summary.aggregated.ms)} / ${fmt(props.summary.aggregated.ls)}`} />
              <StatRow label="Walk Speed" value={fmt(props.summary.aggregated.speed)} />
            </div>
          </div>

          <Separator />

          {/* Warnings */}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--wb-text-quaternary)]">Warnings</div>
            {props.summary.warnings.messages.length === 0 ? (
              <div className="rounded-md bg-[var(--wb-success-muted)] px-2.5 py-2 text-xs text-[var(--wb-success)]">
                No warnings.
              </div>
            ) : (
              <ScrollArea className="max-h-24">
                <div className="grid gap-1">
                  {props.summary.warnings.messages.map((warning, index) => (
                    <div key={`${warning}-${index}`} className="wb-banner px-2.5 py-1.5 text-xs" data-tone="warning">
                      {warning}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Info note */}
          <div className="rounded-md bg-[var(--wb-layer-1)] p-2 text-[11px] text-[var(--wb-text-quaternary)]">
            KPIs use legacy-compatible metrics. ATree spell effects are shown above but not included in base DPS/EHP.
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
