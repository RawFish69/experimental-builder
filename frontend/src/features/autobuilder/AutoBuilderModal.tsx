import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogSnapshot } from '@/domain/items/types';
import { ITEM_SLOTS } from '@/domain/items/types';
import type { WorkbenchSnapshot } from '@/domain/build/types';
import type { AutoBuildCandidate, AutoBuildConstraints } from '@/domain/autobuilder/types';
import { DEFAULT_AUTO_BUILD_CONSTRAINTS } from '@/domain/autobuilder/types';
import { AutoBuilderWorkerClient } from '@/domain/autobuilder/worker';
import { Button, ChipButton, FieldLabel, Modal, NumberField } from '@/components/ui';

function parseNameList(text: string, catalog: CatalogSnapshot): { ids: number[]; unknown: string[] } {
  const parts = text
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const ids: number[] = [];
  const unknown: string[] = [];
  for (const part of parts) {
    const id = catalog.itemIdByName.get(part.toLowerCase());
    if (id == null) unknown.push(part);
    else ids.push(id);
  }
  return { ids, unknown };
}

function parseCsvList(text: string, transform?: (value: string) => string): string[] {
  return text
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (transform ? transform(value) : value));
}

function toggleString(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

const WEAPON_ATTACK_SPEED_OPTIONS = ['SUPER_SLOW', 'VERY_SLOW', 'SLOW', 'NORMAL', 'FAST', 'VERY_FAST', 'SUPER_FAST'] as const;
type OptimizationPreset = 'balanced' | 'damage' | 'tank' | 'spell' | 'melee' | 'speed' | 'sustain';

const OPTIMIZATION_PRESET_LABELS: Record<OptimizationPreset, string> = {
  balanced: 'Balanced',
  damage: 'Damage',
  tank: 'Tank / EHP',
  spell: 'Spell Caster',
  melee: 'Melee',
  speed: 'Mobility',
  sustain: 'Sustain',
};

function presetWeightDelta(preset: OptimizationPreset): AutoBuildConstraints['weights'] {
  const base = { ...DEFAULT_AUTO_BUILD_CONSTRAINTS.weights };
  switch (preset) {
    case 'damage':
      return { ...base, legacyBaseDps: 2.4, legacyEhp: 0.25, dpsProxy: 2.2, ehpProxy: 0.2, speed: 0.5, sustain: 0.3 };
    case 'tank':
      return { ...base, legacyBaseDps: 0.45, legacyEhp: 2.2, dpsProxy: 0.4, ehpProxy: 1.8, speed: 0.2, sustain: 0.75 };
    case 'spell':
      return { ...base, legacyBaseDps: 1.4, legacyEhp: 0.45, dpsProxy: 2.0, ehpProxy: 0.35, speed: 0.4, sustain: 1.0 };
    case 'melee':
      return { ...base, legacyBaseDps: 1.8, legacyEhp: 0.55, dpsProxy: 1.7, ehpProxy: 0.45, speed: 0.8, sustain: 0.4 };
    case 'speed':
      return { ...base, legacyBaseDps: 0.8, legacyEhp: 0.5, dpsProxy: 0.9, ehpProxy: 0.45, speed: 2.0, sustain: 0.5 };
    case 'sustain':
      return { ...base, legacyBaseDps: 0.7, legacyEhp: 1.0, dpsProxy: 0.7, ehpProxy: 1.0, speed: 0.3, sustain: 2.0 };
    case 'balanced':
    default:
      return base;
  }
}

function combinePresetWeights(primary: OptimizationPreset, secondary: OptimizationPreset | null): AutoBuildConstraints['weights'] {
  const p = presetWeightDelta(primary);
  if (!secondary || secondary === primary) return p;
  const s = presetWeightDelta(secondary);
  return {
    legacyBaseDps: p.legacyBaseDps * 0.7 + s.legacyBaseDps * 0.3,
    legacyEhp: p.legacyEhp * 0.7 + s.legacyEhp * 0.3,
    dpsProxy: p.dpsProxy * 0.7 + s.dpsProxy * 0.3,
    ehpProxy: p.ehpProxy * 0.7 + s.ehpProxy * 0.3,
    speed: p.speed * 0.7 + s.speed * 0.3,
    sustain: p.sustain * 0.7 + s.sustain * 0.3,
    skillPointTotal: p.skillPointTotal * 0.7 + s.skillPointTotal * 0.3,
    reqTotalPenalty: p.reqTotalPenalty * 0.7 + s.reqTotalPenalty * 0.3,
  };
}

export function AutoBuilderModal(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  catalog: CatalogSnapshot | null;
  snapshot: WorkbenchSnapshot;
  onLoadCandidate(candidate: AutoBuildCandidate): void;
}) {
  const workerRef = useRef<AutoBuilderWorkerClient | null>(null);
  if (!workerRef.current) workerRef.current = new AutoBuilderWorkerClient();

  const [mustIncludeText, setMustIncludeText] = useState('');
  const [excludeText, setExcludeText] = useState('');
  const [requiredMajorIdsText, setRequiredMajorIdsText] = useState('');
  const [excludedMajorIdsText, setExcludedMajorIdsText] = useState('');

  const [minLegacyBaseDps, setMinLegacyBaseDps] = useState<number | null>(null);
  const [minLegacyEhp, setMinLegacyEhp] = useState<number | null>(null);
  const [minMr, setMinMr] = useState<number | null>(null);
  const [minMs, setMinMs] = useState<number | null>(null);
  const [minSpeed, setMinSpeed] = useState<number | null>(null);
  const [maxReqTotal, setMaxReqTotal] = useState<number | null>(null);
  const [primaryPreset, setPrimaryPreset] = useState<OptimizationPreset>('balanced');
  const [secondaryPreset, setSecondaryPreset] = useState<OptimizationPreset | null>(null);
  const [builderCharacterClass, setBuilderCharacterClass] = useState<AutoBuildConstraints['characterClass']>(props.snapshot.characterClass);
  const [builderLevel, setBuilderLevel] = useState<number>(props.snapshot.level);

  const [allowedTiers, setAllowedTiers] = useState<string[]>([]);
  const [weaponAttackSpeeds, setWeaponAttackSpeeds] = useState<string[]>([]);
  const [minPowderSlots, setMinPowderSlots] = useState<number | null>(null);
  const [onlyPinnedItems, setOnlyPinnedItems] = useState(false);

  const [beamWidth, setBeamWidth] = useState<number>(DEFAULT_AUTO_BUILD_CONSTRAINTS.beamWidth);
  const [topKPerSlot, setTopKPerSlot] = useState<number>(DEFAULT_AUTO_BUILD_CONSTRAINTS.topKPerSlot);
  const [topN, setTopN] = useState<number>(DEFAULT_AUTO_BUILD_CONSTRAINTS.topN);

  const [results, setResults] = useState<AutoBuildCandidate[]>([]);
  const [progress, setProgress] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTips, setShowTips] = useState(false);
  const [deepFallbackEnabled, setDeepFallbackEnabled] = useState(true);
  const [useExhaustiveSmallPool, setUseExhaustiveSmallPool] = useState(true);
  const [exhaustiveStateLimit, setExhaustiveStateLimit] = useState<number>(DEFAULT_AUTO_BUILD_CONSTRAINTS.exhaustiveStateLimit);
  const [lastDiagnostics, setLastDiagnostics] = useState<string | null>(null);
  const diagnosticsRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const lockedSlots = useMemo(() => {
    const locked: AutoBuildConstraints['lockedSlots'] = {};
    for (const slot of ITEM_SLOTS) {
      if (props.snapshot.locks[slot]) locked[slot] = true;
    }
    return locked;
  }, [props.snapshot.locks]);

  const tierOptions = props.catalog?.facetsMeta.tiers ?? [];
  const majorIdQuickPicks = (props.catalog?.facetsMeta.majorIds ?? []).slice(0, 24);

  useEffect(() => {
    if (!props.open) return;
    setBuilderCharacterClass(props.snapshot.characterClass);
    setBuilderLevel(props.snapshot.level);
  }, [props.open, props.snapshot.characterClass, props.snapshot.level]);

  const runWithAttemptPlan = async (
    catalog: CatalogSnapshot,
    baseConstraints: AutoBuildConstraints,
    baseWorkbench: WorkbenchSnapshot,
    abortSignal: AbortSignal,
  ): Promise<AutoBuildCandidate[]> => {
    const attempts = [
      {
        label: 'Fast pass',
        topKPerSlot: baseConstraints.topKPerSlot,
        beamWidth: baseConstraints.beamWidth,
        maxStates: baseConstraints.maxStates,
        rescueWeights: false,
      },
      ...(deepFallbackEnabled
        ? [
            {
              label: 'Deep pass',
              topKPerSlot: Math.max(baseConstraints.topKPerSlot, 140),
              beamWidth: Math.max(baseConstraints.beamWidth, 700),
              maxStates: Math.max(baseConstraints.maxStates, 900000),
              rescueWeights: false,
            },
            {
              label: 'Bruteforce-ish pass',
              topKPerSlot: Math.max(baseConstraints.topKPerSlot, 220),
              beamWidth: Math.max(baseConstraints.beamWidth, 1200),
              maxStates: Math.max(baseConstraints.maxStates, 4000000),
              rescueWeights: false,
            },
            {
              label: 'Feasibility rescue',
              topKPerSlot: Math.max(baseConstraints.topKPerSlot, 260),
              beamWidth: Math.max(baseConstraints.beamWidth, 1400),
              maxStates: Math.max(baseConstraints.maxStates, 4500000),
              rescueWeights: true,
            },
          ]
        : []),
    ];

    let lastCandidates: AutoBuildCandidate[] = [];
    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
      if (abortSignal.aborted) throw new DOMException('Auto build cancelled', 'AbortError');
      const attempt = attempts[attemptIndex];
      const constraints: AutoBuildConstraints = {
        ...baseConstraints,
        topKPerSlot: attempt.topKPerSlot,
        beamWidth: attempt.beamWidth,
        maxStates: attempt.maxStates,
        weights: attempt.rescueWeights
          ? {
              ...baseConstraints.weights,
              legacyBaseDps: baseConstraints.weights.legacyBaseDps * 0.6,
              dpsProxy: baseConstraints.weights.dpsProxy * 0.55,
              legacyEhp: Math.max(baseConstraints.weights.legacyEhp, 1.0),
              ehpProxy: Math.max(baseConstraints.weights.ehpProxy, 1.0),
              sustain: Math.max(baseConstraints.weights.sustain, 0.8),
              skillPointTotal: Math.max(baseConstraints.weights.skillPointTotal, 0.8),
              reqTotalPenalty: Math.max(baseConstraints.weights.reqTotalPenalty, 1.8),
            }
          : baseConstraints.weights,
      };

      setProgress(
        `${attempt.label} (${attemptIndex + 1}/${attempts.length}) • topK ${constraints.topKPerSlot}, beam ${constraints.beamWidth}, maxStates ${constraints.maxStates}`,
      );
      const candidates = await workerRef.current!.run(catalog, baseWorkbench, constraints, {
        signal: abortSignal,
        onProgress: (event) => {
          if (event.phase === 'diagnostics' && event.detail) {
            diagnosticsRef.current = event.detail;
            setLastDiagnostics(event.detail);
          }
          setProgress(
            `${attempt.label} (${attemptIndex + 1}/${attempts.length}) • ${event.phase}: ${event.expandedSlots}/${event.totalSlots} slots, beam ${event.beamSize}, states ${event.processedStates}${event.detail ? ` • ${event.detail}` : ''}`,
          );
        },
      });

      if (candidates.length > 0) {
        return candidates;
      }
      lastCandidates = candidates;
    }

    return lastCandidates;
  };

  const run = async () => {
    if (!props.catalog) return;
    setError(null);
    setResults([]);
    setLastDiagnostics(null);
    diagnosticsRef.current = null;

    const must = parseNameList(mustIncludeText, props.catalog);
    const excluded = parseNameList(excludeText, props.catalog);
    const requiredMajorIds = parseCsvList(requiredMajorIdsText, (value) => value.toUpperCase());
    const excludedMajorIds = parseCsvList(excludedMajorIdsText, (value) => value.toUpperCase());
    const knownMajorIds = new Set(props.catalog.facetsMeta.majorIds.map((value) => value.toUpperCase()));
    const unknownRequiredMajors = requiredMajorIds.filter((value) => !knownMajorIds.has(value));
    const unknownExcludedMajors = excludedMajorIds.filter((value) => !knownMajorIds.has(value));

    if (must.unknown.length > 0 || excluded.unknown.length > 0 || unknownRequiredMajors.length > 0 || unknownExcludedMajors.length > 0) {
      setError(
        [
          must.unknown.length ? `Unknown must-include items: ${must.unknown.join(', ')}` : '',
          excluded.unknown.length ? `Unknown excluded items: ${excluded.unknown.join(', ')}` : '',
          unknownRequiredMajors.length ? `Unknown required major IDs: ${unknownRequiredMajors.join(', ')}` : '',
          unknownExcludedMajors.length ? `Unknown excluded major IDs: ${unknownExcludedMajors.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join(' | '),
      );
      return;
    }

    const constraints: AutoBuildConstraints = {
      ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
      characterClass: builderCharacterClass,
      level: Math.max(1, Math.min(106, Math.round(builderLevel || props.snapshot.level || 106))),
      mustIncludeIds: must.ids,
      excludedIds: excluded.ids,
      lockedSlots,
      target: {
        minLegacyBaseDps: minLegacyBaseDps ?? undefined,
        minLegacyEhp: minLegacyEhp ?? undefined,
        minMr: minMr ?? undefined,
        minMs: minMs ?? undefined,
        minSpeed: minSpeed ?? undefined,
        maxReqTotal: maxReqTotal ?? undefined,
      },
      allowedTiers: [...allowedTiers],
      requiredMajorIds,
      excludedMajorIds,
      weaponAttackSpeeds: [...weaponAttackSpeeds],
      minPowderSlots,
      onlyPinnedItems,
      useExhaustiveSmallPool,
      exhaustiveStateLimit: Math.max(1000, Math.min(5000000, exhaustiveStateLimit)),
      weights: combinePresetWeights(primaryPreset, secondaryPreset),
      topN: Math.max(1, Math.min(50, topN)),
      topKPerSlot: Math.max(10, Math.min(300, topKPerSlot)),
      beamWidth: Math.max(20, Math.min(5000, beamWidth)),
    };

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setRunning(true);
    setProgress('Starting...');
    try {
      const candidates = await runWithAttemptPlan(props.catalog, constraints, props.snapshot, abort.signal);
      setResults(candidates);
      if (candidates.length === 0) {
        setProgress('');
        const diag = diagnosticsRef.current ?? '';
        const spInvalidMatch = /SP-invalid=(\d+)/i.exec(diag);
        const spInvalidCount = spInvalidMatch ? Number(spInvalidMatch[1]) : 0;
        setError(
          [
            'No valid candidates found.',
            diagnosticsRef.current ? `Diagnostics: ${diagnosticsRef.current}` : '',
            spInvalidCount > 0
              ? 'The engine found many full builds, but they failed skill-point/equip-order feasibility. This is not just a UI filter issue.'
              : 'This usually means your hard constraints are too strict (pinned-only, major IDs, must-includes, attack-speed, or thresholds), or the selected objective conflicts with them.',
            spInvalidCount > 0
              ? 'Try switching Primary Goal to Balanced or Tank, lowering Min Base DPS/EHP thresholds, and keeping Exact Search + Deep Fallback enabled.'
              : 'Tip: disable pinned-only first, remove major-ID constraints, then try again.',
          ].join(' '),
        );
      } else {
        setProgress(`Completed. ${candidates.length} valid candidates.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auto builder failed');
      setProgress('');
    } finally {
      setRunning(false);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    workerRef.current?.cancelCurrent();
    setRunning(false);
    setProgress('Cancelled');
  };

  const statusMessage = error ?? lastDiagnostics;
  const statusIsError = Boolean(error);

  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Auto Build Maker"
      description="Beam search over item combinations. Uses Workbench summary metrics (legacy-style Base DPS / EHP, ability tree excluded)."
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-[var(--wb-muted)]">{progress}</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowTips((prev) => !prev)}>
              {showTips ? 'Hide Tips' : 'Tips'}
            </Button>
            {running ? (
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            ) : null}
            <Button variant="primary" onClick={run} disabled={!props.catalog || running}>
              Generate Candidates
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)] lg:items-start">
        <div className="grid gap-3">
          {showTips ? (
            <div className="wb-card p-3">
              <div className="mb-2 text-sm font-semibold">Tips (New Players)</div>
              <div className="grid gap-2 text-xs text-[var(--wb-muted)]">
                <div>1. Start with a Primary Goal like <b>Damage</b> or <b>Tank / EHP</b>. Leave most constraints empty.</div>
                <div>2. Add only a few hard constraints first: class/level, maybe one must-include item.</div>
                <div>3. If you get 0 candidates, turn off <b>Only use pinned items in bins</b> and clear major-ID constraints.</div>
                <div>4. The Auto Builder now filters out builds that fail skill requirements / equip order feasibility.</div>
                <div>5. Use Workbench bins to guide it: pin good options, then rerun with pinned-only once you have enough items in each slot category.</div>
              </div>
            </div>
          ) : null}

          <div className="wb-card p-3">
            <div className="mb-3 text-sm font-semibold">Optimization</div>
            <div className="grid gap-3">
              <div>
                <FieldLabel>Primary Goal</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(OPTIMIZATION_PRESET_LABELS) as OptimizationPreset[]).map((preset) => (
                    <ChipButton key={preset} active={primaryPreset === preset} onClick={() => setPrimaryPreset(preset)}>
                      {OPTIMIZATION_PRESET_LABELS[preset]}
                    </ChipButton>
                  ))}
                </div>
              </div>
              <div>
                <FieldLabel>Secondary Goal (optional)</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <ChipButton active={secondaryPreset === null} onClick={() => setSecondaryPreset(null)}>
                    None
                  </ChipButton>
                  {(Object.keys(OPTIMIZATION_PRESET_LABELS) as OptimizationPreset[]).map((preset) => (
                    <ChipButton key={preset} active={secondaryPreset === preset} onClick={() => setSecondaryPreset(preset)}>
                      {OPTIMIZATION_PRESET_LABELS[preset]}
                    </ChipButton>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-2 text-xs text-[var(--wb-muted)]">
                Auto Builder always filters out builds that fail skill point/equip-order feasibility. You do not need to set a minimum SP total.
              </div>
            </div>
          </div>

          <div className="wb-card p-3">
            <div className="mb-3 text-sm font-semibold">Hard Constraints (Optional)</div>
            <div className="grid gap-3">
              <div>
                <FieldLabel>Character Class</FieldLabel>
                <select
                  className="wb-select"
                  value={builderCharacterClass ?? ''}
                  onChange={(e) => setBuilderCharacterClass((e.target.value || null) as AutoBuildConstraints['characterClass'])}
                >
                  <option value="">Auto / Any</option>
                  <option value="Warrior">Warrior</option>
                  <option value="Assassin">Assassin</option>
                  <option value="Mage">Mage</option>
                  <option value="Archer">Archer</option>
                  <option value="Shaman">Shaman</option>
                </select>
              </div>

              <NumberField label="Level" value={builderLevel} onChange={(value) => setBuilderLevel(value ?? props.snapshot.level)} min={1} max={106} />
              <NumberField label="Min Base DPS" value={minLegacyBaseDps} onChange={setMinLegacyBaseDps} min={0} />
              <NumberField label="Min Effective HP" value={minLegacyEhp} onChange={setMinLegacyEhp} min={0} />

              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Min MR" value={minMr} onChange={setMinMr} min={0} />
                <NumberField label="Min MS" value={minMs} onChange={setMinMs} min={0} />
                <NumberField label="Min Walk Speed" value={minSpeed} onChange={setMinSpeed} />
                <NumberField label="Max Req Total" value={maxReqTotal} onChange={setMaxReqTotal} min={0} />
              </div>

              <div>
                <FieldLabel>Must-Include Items (comma-separated names)</FieldLabel>
                <textarea
                  className="wb-textarea min-h-20"
                  value={mustIncludeText}
                  onChange={(e) => setMustIncludeText(e.target.value)}
                  placeholder="Example: Cancer, Stardew"
                />
              </div>
              <div>
                <FieldLabel>Excluded Items (comma-separated names)</FieldLabel>
                <textarea
                  className="wb-textarea min-h-20"
                  value={excludeText}
                  onChange={(e) => setExcludeText(e.target.value)}
                  placeholder="Blacklist item names"
                />
              </div>
            </div>
          </div>

          <div className="wb-card p-3">
            <div className="mb-3 text-sm font-semibold">Pool Filters</div>
            <div className="grid gap-3">
              <NumberField label="Min Powder Slots" value={minPowderSlots} onChange={setMinPowderSlots} min={0} max={6} />

              <div>
                <FieldLabel>Allowed Tiers (optional)</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {tierOptions.map((tier) => (
                    <ChipButton
                      key={tier}
                      active={allowedTiers.includes(tier)}
                      onClick={() => setAllowedTiers((prev) => toggleString(prev, tier))}
                    >
                      {tier}
                    </ChipButton>
                  ))}
                  {tierOptions.length === 0 ? <span className="text-xs text-[var(--wb-muted)]">Catalog not loaded.</span> : null}
                </div>
              </div>

              <div>
                <FieldLabel>Final Weapon Attack Speed (optional hard constraint)</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {WEAPON_ATTACK_SPEED_OPTIONS.map((value) => (
                    <ChipButton
                      key={value}
                      active={weaponAttackSpeeds.includes(value)}
                      onClick={() => setWeaponAttackSpeeds((prev) => toggleString(prev, value))}
                    >
                      {value}
                    </ChipButton>
                  ))}
                </div>
                <div className="mt-1 text-xs text-[var(--wb-muted)]">
                  Matches the completed build attack speed (weapon base speed plus total Attack Speed Bonus / `atkTier`).
                </div>
              </div>

              <ChipButton active={onlyPinnedItems} onClick={() => setOnlyPinnedItems((prev) => !prev)}>
                Only use pinned items in bins
              </ChipButton>

              <div>
                <FieldLabel>Required Major IDs (build must include all)</FieldLabel>
                <textarea
                  className="wb-textarea min-h-16"
                  value={requiredMajorIdsText}
                  onChange={(e) => setRequiredMajorIdsText(e.target.value)}
                  placeholder="Example: HAWKEYE, GREED"
                />
              </div>

              <div>
                <FieldLabel>Excluded Major IDs (avoid any item with these)</FieldLabel>
                <textarea
                  className="wb-textarea min-h-16"
                  value={excludedMajorIdsText}
                  onChange={(e) => setExcludedMajorIdsText(e.target.value)}
                  placeholder="Example: NAPALM"
                />
              </div>

              {majorIdQuickPicks.length > 0 ? (
                <div>
                  <FieldLabel>Major ID Quick Picks</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {majorIdQuickPicks.map((majorId) => {
                      const requiredList = parseCsvList(requiredMajorIdsText, (value) => value.toUpperCase());
                      const excludedList = parseCsvList(excludedMajorIdsText, (value) => value.toUpperCase());
                      return (
                        <div key={majorId} className="flex items-center gap-1">
                          <ChipButton
                            active={requiredList.includes(majorId.toUpperCase())}
                            onClick={() => {
                              setRequiredMajorIdsText((prev) => toggleString(parseCsvList(prev, (v) => v.toUpperCase()), majorId.toUpperCase()).join(', '));
                            }}
                            title={`Require ${majorId}`}
                          >
                            +{majorId}
                          </ChipButton>
                          <ChipButton
                            active={excludedList.includes(majorId.toUpperCase())}
                            onClick={() => {
                              setExcludedMajorIdsText((prev) => toggleString(parseCsvList(prev, (v) => v.toUpperCase()), majorId.toUpperCase()).join(', '));
                            }}
                            title={`Exclude ${majorId}`}
                          >
                            -{majorId}
                          </ChipButton>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="wb-card p-3">
            <div className="mb-3 text-sm font-semibold">Search Heuristics</div>
            <div className="grid gap-3">
              <ChipButton active={deepFallbackEnabled} onClick={() => setDeepFallbackEnabled((prev) => !prev)}>
                Deep fallback if 0 results
              </ChipButton>
              <ChipButton active={useExhaustiveSmallPool} onClick={() => setUseExhaustiveSmallPool((prev) => !prev)}>
                Exact search for small pools
              </ChipButton>
              <NumberField
                label="Exact Search Combination Limit"
                value={exhaustiveStateLimit}
                onChange={(v) => setExhaustiveStateLimit(v ?? DEFAULT_AUTO_BUILD_CONSTRAINTS.exhaustiveStateLimit)}
                min={1000}
                max={5000000}
              />
              <NumberField
                label="Beam Width"
                value={beamWidth}
                onChange={(v) => setBeamWidth(v ?? DEFAULT_AUTO_BUILD_CONSTRAINTS.beamWidth)}
                min={20}
                max={5000}
              />
              <NumberField
                label="Top K per Slot"
                value={topKPerSlot}
                onChange={(v) => setTopKPerSlot(v ?? DEFAULT_AUTO_BUILD_CONSTRAINTS.topKPerSlot)}
                min={10}
                max={300}
              />
              <NumberField
                label="Top N Results"
                value={topN}
                onChange={(v) => setTopN(v ?? DEFAULT_AUTO_BUILD_CONSTRAINTS.topN)}
                min={1}
                max={50}
              />
              <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-2 text-xs text-[var(--wb-muted)]">
                Locked slots from the Workbench will be preserved. Current locks: {Object.values(lockedSlots).filter(Boolean).length}
                {onlyPinnedItems ? ' | Candidate pools restricted to pinned bins.' : ''}
                {deepFallbackEnabled ? ' | Auto retries with deeper search if fast pass finds 0 candidates.' : ''}
                {useExhaustiveSmallPool ? ` | Exact enumeration is used automatically when pool combinations are <= ${Math.round(exhaustiveStateLimit).toLocaleString()}.` : ''}
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 auto-rows-min gap-3 self-start lg:sticky lg:top-0">
          <div className="wb-card flex min-h-0 flex-col p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Candidates</div>
              <div className="text-xs text-[var(--wb-muted)]">{results.length} shown</div>
            </div>
            {statusMessage ? (
              <details
                className={`mb-2 rounded-xl border p-2 ${
                  statusIsError
                    ? 'border-rose-400/30 bg-rose-400/8 text-rose-100'
                    : 'border-sky-400/20 bg-sky-400/5 text-sky-100'
                }`}
              >
                <summary className="cursor-pointer list-none text-xs font-medium">
                  {statusIsError ? 'Run issue (click to expand)' : 'Diagnostics (click to expand)'}
                </summary>
                <div className="mt-2 text-xs leading-relaxed">{statusMessage}</div>
              </details>
            ) : null}

            <div className="min-h-0 space-y-2 overflow-auto pr-1 wb-scrollbar max-h-[52vh] lg:max-h-[56vh]">
              {results.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--wb-border)] p-4 text-sm text-[var(--wb-muted)]">
                  Run the Auto Build Maker to generate candidate builds.
                </div>
              ) : (
                results.map((candidate, index) => (
                  <div key={`${candidate.score}-${index}`} className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">
                          #{index + 1} | Score {Math.round(candidate.score).toLocaleString()}
                        </div>
                        <div className="mt-1 text-xs text-[var(--wb-muted)]">
                          Base DPS {Math.round(candidate.summary.derived.legacyBaseDps)} | EHP {Math.round(candidate.summary.derived.legacyEhp)} | Req {candidate.summary.derived.reqTotal} | MR {candidate.summary.aggregated.mr}
                        </div>
                        <div className="mt-1 text-xs text-emerald-200">
                          SP Valid | Assigned SP {Math.round(candidate.summary.derived.assignedSkillPointsRequired)}
                        </div>
                      </div>
                      <Button className="px-2 py-1 text-xs" onClick={() => props.onLoadCandidate(candidate)}>
                        Load into Workbench
                      </Button>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2 xl:grid-cols-3">
                      {ITEM_SLOTS.map((slot) => (
                        <div key={slot} className="min-w-0 rounded-md border border-[var(--wb-border-muted)] bg-black/10 px-2 py-1">
                          <div className="text-[10px] uppercase tracking-wide text-[var(--wb-muted)]">{slot}</div>
                          <div className="truncate">
                            {candidate.slots[slot] != null
                              ? props.catalog?.itemsById.get(candidate.slots[slot]!)?.displayName ?? candidate.slots[slot]
                              : 'Empty'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
