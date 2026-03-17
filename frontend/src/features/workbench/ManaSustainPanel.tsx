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
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--wb-text-quaternary)]">Mana Sustain</div>
        <div className="mt-0.5 text-xs text-[var(--wb-text-tertiary)]">
          Equip a weapon and select spells in the Ability Tree.
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 py-1 text-left"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-1.5">
          {collapsed ? <ChevronRight size={12} className="text-[var(--wb-text-quaternary)]" /> : <ChevronDown size={12} className="text-[var(--wb-text-quaternary)]" />}
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--wb-text-quaternary)]">Mana Sustain</span>
          {result != null && (
            <span className={`text-xs font-medium ${result.sustainable ? 'wb-text-success' : 'wb-text-danger'}`}>
              {result.sustainable ? 'Sustainable' : 'Draining'}
            </span>
          )}
        </div>
      </button>
      {!collapsed && (
        <div className="mt-1 grid gap-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="mb-0.5 block text-[11px] uppercase tracking-wider text-[var(--wb-text-quaternary)]">CPS</label>
              <input
                className="wb-input w-full text-xs"
                type="number"
                min={0.5}
                max={30}
                step={0.5}
                value={cps}
                onChange={(e) => setCps(Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[11px] uppercase tracking-wider text-[var(--wb-text-quaternary)]">Sequence</label>
              <input
                className="wb-input w-full text-xs"
                type="text"
                inputMode="numeric"
                pattern="[1-4]*"
                placeholder="1234"
                value={spellSequenceStr}
                onChange={(e) => setSpellSequenceStr(e.target.value.replace(/[^1-4]/g, '').slice(0, 20))}
              />
            </div>
          </div>

          {result == null ? (
            <div className="text-xs text-[var(--wb-text-tertiary)]">Enter digits 1-4.</div>
          ) : (
            <>
              <div
                className="rounded-md border px-2.5 py-2 text-xs"
                style={{
                  borderColor: result.sustainable ? 'var(--wb-success-border)' : 'var(--wb-danger-border)',
                  background: result.sustainable ? 'var(--wb-success-muted)' : 'var(--wb-danger-muted)',
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[var(--wb-text-tertiary)]">Net mana/s</span>
                  <span
                    className={`font-semibold ${result.sustainable ? 'wb-text-success' : 'wb-text-danger'}`}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {result.netManaPerSecond >= 0 ? '+' : ''}{fmt(result.netManaPerSecond)}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <div className="rounded-md bg-[var(--wb-layer-1)] px-2.5 py-1.5">
                  <div className="text-[11px] text-[var(--wb-text-quaternary)]">Gain/s</div>
                  <div className="wb-text-success font-medium" style={{ fontFamily: 'var(--font-mono)' }}>{fmt(result.manaGainPerSecond)}</div>
                </div>
                <div className="rounded-md bg-[var(--wb-layer-1)] px-2.5 py-1.5">
                  <div className="text-[11px] text-[var(--wb-text-quaternary)]">Usage/s</div>
                  <div className="wb-text-offense font-medium" style={{ fontFamily: 'var(--font-mono)' }}>{fmt(result.manaUsagePerSecond)}</div>
                </div>
              </div>
              <div className="rounded-md bg-[var(--wb-layer-1)] px-2.5 py-1.5 text-xs">
                <div className="text-[11px] text-[var(--wb-text-quaternary)]">Sustained Spell DPS</div>
                <div className="wb-text-offense font-semibold" style={{ fontFamily: 'var(--font-mono)' }}>{fmtInt(result.sustainedSpellDps)}</div>
              </div>
              <div className="text-[11px] text-[var(--wb-text-quaternary)]">
                Spells/s: {fmt(result.spellsPerSecond)} &middot; Costs: {result.cycleCosts.map((c) => Math.round(c)).join(', ')}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
