import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { BuildSummary } from '@/domain/build/types';
import type { WorkbenchSpellPreviewResult } from '@/domain/ability-tree/spell-preview';
import { computeManaSustain } from '@/domain/mana-sustain';

const DEFAULT_CPS = 8;
const DEFAULT_SEQUENCE = '1234';

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '-';
}

function fmtInt(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : '-';
}

export function ManaSustainPanel(props: {
  spellPreview: WorkbenchSpellPreviewResult | null;
  summary: BuildSummary;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [cps, setCps] = useState(DEFAULT_CPS);
  const [spellSequenceStr, setSpellSequenceStr] = useState(DEFAULT_SEQUENCE);

  const result = useMemo(() => {
    const preview = props.spellPreview;
    const summary = props.summary;
    if (!preview?.spells.length) return null;

    const spellCosts: Record<number, number> = {};
    const spellDamages: Record<number, number> = {};
    for (const spell of preview.spells) {
      if (spell.baseSpell >= 1 && spell.baseSpell <= 4) {
        if (spell.manaCost != null) spellCosts[spell.baseSpell] = spell.manaCost;
        if (!spell.isHealing) spellDamages[spell.baseSpell] = spell.averageDisplayValue;
      }
    }

    const sequence = spellSequenceStr
      .replace(/\D/g, '')
      .split('')
      .map((d) => parseInt(d, 10))
      .filter((n) => n >= 1 && n <= 4);
    if (sequence.length === 0) return null;

    return computeManaSustain({
      spellCosts,
      spellDamages,
      mr: summary.aggregated.mr,
      ms: summary.aggregated.ms,
      cps,
      spellSequence: sequence,
    });
  }, [props.spellPreview, props.summary, cps, spellSequenceStr]);

  const hasSpells = props.spellPreview?.spells.some((s) => s.baseSpell >= 1 && s.baseSpell <= 4 && s.manaCost != null) ?? false;

  if (!hasSpells) {
    return (
      <div className="wb-card p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">Mana Sustain</div>
        <div className="mt-1 text-xs text-[var(--wb-muted)]">
          Equip a weapon and select spells with mana costs in the Ability Tree to see sustained mana and spell DPS.
        </div>
      </div>
    );
  }

  return (
    <div className="wb-card overflow-hidden p-0">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-[var(--wb-surface-hover)]"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight size={14} className="text-[var(--wb-muted)]" /> : <ChevronDown size={14} className="text-[var(--wb-muted)]" />}
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--wb-muted)]">Mana Sustain</span>
          {result != null && (
            <span className={result.sustainable ? 'wb-text-success' : 'wb-text-danger'}>
              {result.sustainable ? 'Sustainable' : 'Draining'}
            </span>
          )}
        </div>
      </button>
      {!collapsed && (
        <div className="border-t border-[var(--wb-border-muted)] px-3 py-3">
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--wb-muted)]">Clicks / s</label>
                <input
                  className="wb-input w-full"
                  type="number"
                  min={0.5}
                  max={30}
                  step={0.5}
                  value={cps}
                  onChange={(e) => setCps(Number(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--wb-muted)]">Spell sequence</label>
                <input
                  className="wb-input w-full"
                  type="text"
                  inputMode="numeric"
                  pattern="[1-4]*"
                  placeholder="e.g. 1234"
                  value={spellSequenceStr}
                  onChange={(e) => setSpellSequenceStr(e.target.value.replace(/[^1-4]/g, '').slice(0, 20))}
                />
              </div>
            </div>
            <p className="text-[11px] text-[var(--wb-muted)]">
              Each spell = 3 clicks. Sequence uses digits 1–4 for spell slots.
            </p>

            {result == null ? (
              <div className="text-xs text-[var(--wb-muted)]">Enter a valid sequence (digits 1–4).</div>
            ) : (
              <>
                <div
                  className="rounded-lg border p-2 text-xs"
                  style={{
                    borderColor: result.sustainable ? 'var(--wb-success-muted, #166534)' : 'var(--wb-danger-muted, #991b1b)',
                    background: result.sustainable ? 'var(--wb-success-bg, rgba(22,101,52,0.08))' : 'var(--wb-danger-bg, rgba(153,27,27,0.08))',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--wb-muted)]">Net mana/s</span>
                    <span className={result.sustainable ? 'wb-text-success font-semibold' : 'wb-text-danger font-semibold'}>
                      {result.netManaPerSecond >= 0 ? '+' : ''}{fmt(result.netManaPerSecond)}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="wb-surface rounded-lg px-2 py-1.5">
                    <span className="text-[var(--wb-muted)]">Mana gain/s</span>
                    <div className="wb-text-success font-medium">{fmt(result.manaGainPerSecond)}</div>
                  </div>
                  <div className="wb-surface rounded-lg px-2 py-1.5">
                    <span className="text-[var(--wb-muted)]">Mana usage/s</span>
                    <div className="wb-text-offense font-medium">{fmt(result.manaUsagePerSecond)}</div>
                  </div>
                  <div className="wb-surface rounded-lg px-2 py-1.5 col-span-2">
                    <span className="text-[var(--wb-muted)]">Sustained spell DPS</span>
                    <div className="wb-text-offense font-semibold">{fmtInt(result.sustainedSpellDps)}</div>
                  </div>
                </div>
                <div className="text-[11px] text-[var(--wb-muted)]">
                  Spells/s: {fmt(result.spellsPerSecond)} • Cycle costs: {result.cycleCosts.map((c) => Math.round(c)).join(', ')}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
