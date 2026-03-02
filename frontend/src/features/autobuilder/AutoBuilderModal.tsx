import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogSnapshot } from '@/domain/items/types';
import { ITEM_SLOTS } from '@/domain/items/types';
import type { WorkbenchSnapshot } from '@/domain/build/types';
import type { AutoBuildCandidate, AutoBuildConstraints, AutoBuildProgressEvent } from '@/domain/autobuilder/types';
import { DEFAULT_AUTO_BUILD_CONSTRAINTS } from '@/domain/autobuilder/types';
import { thresholdBiasedWeights } from '@/domain/autobuilder/beam-search';
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

/** Parse reject stats from diagnostics detail (e.g. "Rejected SP-invalid=1, majorID=0, duplicates=2, hard=3 (speed=0, thresholds=3, item=0)"). */
function parseRejectStatsFromDetail(detail: string | undefined): { spInvalid: number; majorIds: number; duplicate: number; hard: number; speed: number; thresholds: number; item: number } | null {
  if (!detail) return null;
  const spMatch = /SP-invalid=(\d+)/i.exec(detail);
  const majorMatch = /majorID=(\d+)/i.exec(detail);
  const dupMatch = /duplicates?=(\d+)/i.exec(detail);
  const hardMatch = /hard=(\d+)/i.exec(detail);
  const speedMatch = /speed=(\d+)/i.exec(detail);
  const threshMatch = /thresholds=(\d+)/i.exec(detail);
  const itemMatch = /item=(\d+)/i.exec(detail);
  if (!hardMatch) return null;
  return {
    spInvalid: spMatch ? Number(spMatch[1]) : 0,
    majorIds: majorMatch ? Number(majorMatch[1]) : 0,
    duplicate: dupMatch ? Number(dupMatch[1]) : 0,
    hard: Number(hardMatch[1]),
    speed: speedMatch ? Number(speedMatch[1]) : 0,
    thresholds: threshMatch ? Number(threshMatch[1]) : 0,
    item: itemMatch ? Number(itemMatch[1]) : 0,
  };
}

const WEAPON_ATTACK_SPEED_OPTIONS = ['SUPER_SLOW', 'VERY_SLOW', 'SLOW', 'NORMAL', 'FAST', 'VERY_FAST', 'SUPER_FAST'] as const;
type OptimizationPreset = 'constraints' | 'spell' | 'melee' | 'mobility' | 'tank';
type SolverStrategy = 'auto' | 'fast' | 'constraint' | 'exhaustive';
type CustomIdThresholdRow = {
  id: number;
  key: string;
  min: number | null;
  max: number | null;
};

const OPTIMIZATION_PRESET_LABELS: Record<OptimizationPreset, string> = {
  constraints: 'Advanced IDs only',
  spell: 'Spell Damage',
  melee: 'Melee',
  mobility: 'Mobility',
  tank: 'Tank / EHP',
};

const PRIMARY_GOAL_ORDER: OptimizationPreset[] = ['constraints', 'spell', 'melee', 'mobility', 'tank'];

const SOLVER_STRATEGY_LABELS: Record<SolverStrategy, string> = {
  auto: 'All',
  fast: 'Fast',
  constraint: 'Constraint-first',
  exhaustive: 'Exhaustive-ish',
};

const SOLVER_STRATEGY_ORDER: SolverStrategy[] = ['auto', 'fast', 'constraint', 'exhaustive'];

/** Full display names for item IDs (from Legacy Builder display_constants idPrefixes). */
const NUMERIC_ID_FULL_NAMES: Record<string, string> = {
  hp: 'Health',
  hpBonus: 'Health Bonus',
  hprRaw: 'Raw Health Regen',
  hprPct: 'Health Regen %',
  mr: 'Mana Regen',
  ms: 'Mana Steal',
  ls: 'Life Steal',
  sdPct: 'Spell Damage %',
  sdRaw: 'Spell Damage Raw',
  mdPct: 'Melee Damage %',
  mdRaw: 'Melee Damage Raw',
  poison: 'Poison',
  spd: 'Walk Speed Bonus',
  atkTier: 'Attack Speed Bonus',
  averageDps: 'Average DPS',
  str: 'Strength',
  dex: 'Dexterity',
  int: 'Intelligence',
  def: 'Defense',
  agi: 'Agility',
  strReq: 'Strength Min',
  dexReq: 'Dexterity Min',
  intReq: 'Intelligence Min',
  defReq: 'Defense Min',
  agiReq: 'Agility Min',
  eDef: 'Earth Defense',
  tDef: 'Thunder Defense',
  wDef: 'Water Defense',
  fDef: 'Fire Defense',
  aDef: 'Air Defense',
  eDamPct: 'Earth Damage %',
  tDamPct: 'Thunder Damage %',
  wDamPct: 'Water Damage %',
  fDamPct: 'Fire Damage %',
  aDamPct: 'Air Damage %',
  damPct: 'Damage %',
  rDamPct: 'Elemental Damage %',
  nDamPct: 'Neutral Damage %',
  slots: 'Powder Slots',
  lvl: 'Combat Level',
  reqTotal: 'Req Total',
  skillPointTotal: 'Skill Point Total',
  offenseScore: 'Offense Score',
  ehpProxy: 'EHP Proxy',
  utilityScore: 'Utility Score',
  // Spell cost (negative = reduction)
  spPct1: '1st Spell Cost %',
  spRaw1: '1st Spell Cost Raw',
  spPct2: '2nd Spell Cost %',
  spRaw2: '2nd Spell Cost Raw',
  spPct3: '3rd Spell Cost %',
  spRaw3: '3rd Spell Cost Raw',
  spPct4: '4th Spell Cost %',
  spRaw4: '4th Spell Cost Raw',
  sumSpPct: 'Sum Spell Cost %',
  sumSpRaw: 'Sum Spell Cost Raw',
};

function formatNumericIdLabel(key: string): string {
  return NUMERIC_ID_FULL_NAMES[key] ?? key;
}

const ZERO_WEIGHTS: AutoBuildConstraints['weights'] = {
  legacyBaseDps: 0, legacyEhp: 0, dpsProxy: 0, spellProxy: 0, meleeProxy: 0,
  ehpProxy: 0, speed: 0, sustain: 0, skillPointTotal: 0, reqTotalPenalty: 0,
};

function presetWeightDelta(preset: OptimizationPreset): AutoBuildConstraints['weights'] {
  switch (preset) {
    case 'spell':
      return { ...ZERO_WEIGHTS, spellProxy: 2.0 };
    case 'melee':
      return { ...ZERO_WEIGHTS, meleeProxy: 2.0 };
    case 'mobility':
      return { ...ZERO_WEIGHTS, speed: 2.0 };
    case 'tank':
      return { ...ZERO_WEIGHTS, legacyEhp: 2.0 };
    case 'constraints':
      return {
        ...ZERO_WEIGHTS,
        legacyBaseDps: 0.25,
        legacyEhp: 0.25,
        dpsProxy: 0.25,
        spellProxy: 0.25,
        meleeProxy: 0.25,
        ehpProxy: 0.25,
        speed: 0.25,
        sustain: 0.25,
        skillPointTotal: 0.25,
        reqTotalPenalty: 0.25,
      };
    default:
      return { ...ZERO_WEIGHTS, spellProxy: 2.0 };
  }
}

function combinePresetWeights(primary: OptimizationPreset): AutoBuildConstraints['weights'] {
  return presetWeightDelta(primary);
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

  const [customIdThresholds, setCustomIdThresholds] = useState<CustomIdThresholdRow[]>([]);
  const [primaryPreset, setPrimaryPreset] = useState<OptimizationPreset>('constraints');
  const [builderCharacterClass, setBuilderCharacterClass] = useState<AutoBuildConstraints['characterClass']>(props.snapshot.characterClass);
  const [builderLevel, setBuilderLevel] = useState<number>(props.snapshot.level);

  const [allowedTiers, setAllowedTiers] = useState<string[]>([]);
  const [weaponAttackSpeeds, setWeaponAttackSpeeds] = useState<string[]>([]);
  const [attackSpeedConstraintMode, setAttackSpeedConstraintMode] =
    useState<AutoBuildConstraints['attackSpeedConstraintMode']>(DEFAULT_AUTO_BUILD_CONSTRAINTS.attackSpeedConstraintMode);
  const [skillpointFeasibilityMode, setSkillpointFeasibilityMode] =
    useState<AutoBuildConstraints['skillpointFeasibilityMode']>(DEFAULT_AUTO_BUILD_CONSTRAINTS.skillpointFeasibilityMode);
  const [minPowderSlots, setMinPowderSlots] = useState<number | null>(null);
  const [onlyPinnedItems, setOnlyPinnedItems] = useState(false);

  const [beamWidth, setBeamWidth] = useState<number>(DEFAULT_AUTO_BUILD_CONSTRAINTS.beamWidth);
  const [topKPerSlot, setTopKPerSlot] = useState<number>(DEFAULT_AUTO_BUILD_CONSTRAINTS.topKPerSlot);
  const [topN, setTopN] = useState<number>(DEFAULT_AUTO_BUILD_CONSTRAINTS.topN);
  const [solverStrategies, setSolverStrategies] = useState<SolverStrategy[]>(['auto']);

  const [results, setResults] = useState<AutoBuildCandidate[]>([]);
  const [progress, setProgress] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTips, setShowTips] = useState(false);
  const [deepFallbackEnabled, setDeepFallbackEnabled] = useState(false);
  const [useExhaustiveSmallPool, setUseExhaustiveSmallPool] = useState(true);
  const [exhaustiveStateLimit, setExhaustiveStateLimit] = useState<number>(DEFAULT_AUTO_BUILD_CONSTRAINTS.exhaustiveStateLimit);
  const [lastDiagnostics, setLastDiagnostics] = useState<string | null>(null);
  const [lastReasonCode, setLastReasonCode] = useState<string | null>(null);
  const [progressEvent, setProgressEvent] = useState<AutoBuildProgressEvent | null>(null);
  const [previewCandidates, setPreviewCandidates] = useState<AutoBuildCandidate[]>([]);
  const [lastRejectStats, setLastRejectStats] = useState<ReturnType<typeof parseRejectStatsFromDetail>>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const lastConstraintsRef = useRef<AutoBuildConstraints | null>(null);
  const lastWorkbenchRef = useRef<WorkbenchSnapshot | null>(null);
  const diagnosticsRef = useRef<string | null>(null);
  const reasonCodeRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hasAdvancedIdMinMax = customIdThresholds.some(
    (row) => row.key && row.min != null && row.max != null,
  );
  const customIdThresholdSeqRef = useRef(1);

  const lockedSlots = useMemo(() => {
    const locked: AutoBuildConstraints['lockedSlots'] = {};
    for (const slot of ITEM_SLOTS) {
      if (props.snapshot.locks[slot]) locked[slot] = true;
    }
    return locked;
  }, [props.snapshot.locks]);

  const tierOptions = props.catalog?.facetsMeta.tiers ?? [];
  const majorIdQuickPicks = (props.catalog?.facetsMeta.majorIds ?? []).slice(0, 24);
  const numericIdOptions = useMemo(() => {
    const keys = Object.keys(props.catalog?.facetsMeta.numericRanges ?? {});
    return keys.sort((a, b) => formatNumericIdLabel(a).localeCompare(formatNumericIdLabel(b)));
  }, [props.catalog]);

  useEffect(() => {
    if (!props.open) return;
    setBuilderCharacterClass(props.snapshot.characterClass);
    setBuilderLevel(props.snapshot.level);
  }, [props.open, props.snapshot.characterClass, props.snapshot.level]);

  const addCustomIdThresholdRow = () => {
    setCustomIdThresholds((prev) => [
      ...prev,
      {
        id: customIdThresholdSeqRef.current++,
        key: numericIdOptions[0] ?? '',
        min: null,
        max: null,
      },
    ]);
  };

  const updateCustomIdThresholdRow = (
    rowId: number,
    patch: Partial<Pick<CustomIdThresholdRow, 'key' | 'min' | 'max'>>,
  ) => {
    setCustomIdThresholds((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const removeCustomIdThresholdRow = (rowId: number) => {
    setCustomIdThresholds((prev) => prev.filter((row) => row.id !== rowId));
  };

  const runWithAttemptPlan = async (
    catalog: CatalogSnapshot,
    baseConstraints: AutoBuildConstraints,
    baseWorkbench: WorkbenchSnapshot,
    abortSignal: AbortSignal,
  ): Promise<AutoBuildCandidate[]> => {
    type Attempt = {
      label: string;
      topKPerSlot: number;
      beamWidth: number;
      maxStates: number;
      rescueWeights: boolean;
      useExhaustiveSmallPool?: boolean;
      exhaustiveStateLimit?: number;
    };
    const attempts: Attempt[] = (() => {
      const fast: Attempt = {
        label: 'Fast pass',
        topKPerSlot: baseConstraints.topKPerSlot,
        beamWidth: baseConstraints.beamWidth,
        maxStates: baseConstraints.maxStates,
        rescueWeights: false,
      };
      const deep: Attempt = {
        label: 'Deep pass',
        topKPerSlot: Math.max(baseConstraints.topKPerSlot, 140),
        beamWidth: Math.max(baseConstraints.beamWidth, 700),
        maxStates: Math.max(baseConstraints.maxStates, 900000),
        rescueWeights: false,
      };
      const bruteish: Attempt = {
        label: 'Bruteforce-ish pass',
        topKPerSlot: Math.max(baseConstraints.topKPerSlot, 220),
        beamWidth: Math.max(baseConstraints.beamWidth, 1200),
        maxStates: Math.max(baseConstraints.maxStates, 4000000),
        rescueWeights: false,
      };
      const feasibilityRescue: Attempt = {
        label: 'Feasibility rescue',
        topKPerSlot: Math.max(baseConstraints.topKPerSlot, 260),
        beamWidth: Math.max(baseConstraints.beamWidth, 1400),
        maxStates: Math.max(baseConstraints.maxStates, 4500000),
        rescueWeights: true,
      };
      const constraintPass: Attempt = {
        label: 'Constraint-first pass',
        topKPerSlot: Math.max(baseConstraints.topKPerSlot, 180),
        beamWidth: Math.max(baseConstraints.beamWidth, 1200),
        maxStates: Math.max(baseConstraints.maxStates, 2200000),
        rescueWeights: true,
      };
      const constraintDeep: Attempt = {
        label: 'Constraint rescue deep',
        topKPerSlot: Math.max(baseConstraints.topKPerSlot, 280),
        beamWidth: Math.max(baseConstraints.beamWidth, 2200),
        maxStates: Math.max(baseConstraints.maxStates, 9000000),
        rescueWeights: true,
        useExhaustiveSmallPool: true,
        exhaustiveStateLimit: Math.max(baseConstraints.exhaustiveStateLimit, 1200000),
      };
      const exhaustive: Attempt = {
        label: 'Exhaustive-ish pass',
        topKPerSlot: Math.max(baseConstraints.topKPerSlot, 300),
        beamWidth: Math.max(baseConstraints.beamWidth, 2600),
        maxStates: Math.max(baseConstraints.maxStates, 12000000),
        rescueWeights: true,
        useExhaustiveSmallPool: true,
        exhaustiveStateLimit: Math.max(baseConstraints.exhaustiveStateLimit, 2000000),
      };

      const forStrategy = (strategy: SolverStrategy): Attempt[] => {
        switch (strategy) {
          case 'fast':
            return [fast];
          case 'constraint':
            return deepFallbackEnabled ? [constraintPass, constraintDeep, exhaustive] : [constraintPass];
          case 'exhaustive':
            return deepFallbackEnabled ? [constraintPass, exhaustive] : [exhaustive];
          case 'auto':
          default:
            return [fast, ...(deepFallbackEnabled ? [deep, bruteish, feasibilityRescue] : [])];
        }
      };
      const strategies: SolverStrategy[] = solverStrategies.length > 0 ? solverStrategies : ['auto'];
      if (strategies.length === 1 && strategies[0] === 'auto') {
        return forStrategy('auto');
      }
      return strategies.flatMap((s) => forStrategy(s));
    })();

    let lastCandidates: AutoBuildCandidate[] = [];
    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
      if (abortSignal.aborted) throw new DOMException('Auto build cancelled', 'AbortError');
      const attempt = attempts[attemptIndex];
      const constraints: AutoBuildConstraints = {
        ...baseConstraints,
        topKPerSlot: attempt.topKPerSlot,
        beamWidth: attempt.beamWidth,
        maxStates: attempt.maxStates,
        useExhaustiveSmallPool: attempt.useExhaustiveSmallPool ?? baseConstraints.useExhaustiveSmallPool,
        exhaustiveStateLimit: attempt.exhaustiveStateLimit ?? baseConstraints.exhaustiveStateLimit,
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
          setProgressEvent(event);
          if (event.previewCandidates) {
            setPreviewCandidates(event.previewCandidates);
          }
          if (event.phase === 'diagnostics' && event.reasonCode) {
            reasonCodeRef.current = event.reasonCode;
            setLastReasonCode(event.reasonCode);
          }
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

    if (lastCandidates.length === 0) {
      const target = baseConstraints.target;
      const hasTargetThresholds =
        typeof target.minDpsProxy === 'number' ||
        typeof target.minEhpProxy === 'number' ||
        typeof target.minSkillPointTotal === 'number' ||
        (target.customNumericRanges?.length ?? 0) > 0;
      if (hasTargetThresholds) {
        setProgress('Threshold rescue pass • topK 180, beam 3600, maxStates 2200000');
        const rescueConstraints: AutoBuildConstraints = {
          ...baseConstraints,
          weights: thresholdBiasedWeights(baseConstraints.target, baseConstraints.weights),
          topKPerSlot: Math.max(baseConstraints.topKPerSlot, 180),
          beamWidth: Math.max(baseConstraints.beamWidth, 3600),
          maxStates: Math.max(baseConstraints.maxStates, 2_200_000),
        };
        const rescueCandidates = await workerRef.current!.run(catalog, baseWorkbench, rescueConstraints, {
          signal: abortSignal,
          onProgress: (event) => {
            setProgressEvent(event);
            if (event.previewCandidates) {
              setPreviewCandidates(event.previewCandidates);
            }
            if (event.phase === 'diagnostics' && event.reasonCode) {
              reasonCodeRef.current = event.reasonCode;
              setLastReasonCode(event.reasonCode);
            }
            if (event.phase === 'diagnostics' && event.detail) {
              diagnosticsRef.current = event.detail;
              setLastDiagnostics(event.detail);
            }
            setProgress(
              `Threshold rescue pass • ${event.phase}: ${event.expandedSlots}/${event.totalSlots} slots, beam ${event.beamSize}, states ${event.processedStates}${event.detail ? ` • ${event.detail}` : ''}`,
            );
          },
        });
        if (rescueCandidates.length > 0) {
          return rescueCandidates;
        }
      }
    }

    return lastCandidates;
  };

  const run = async () => {
    if (!props.catalog) return;
    setError(null);
    setResults([]);
    setLastDiagnostics(null);
    setLastReasonCode(null);
    setProgressEvent(null);
    diagnosticsRef.current = null;
    reasonCodeRef.current = null;

    const must = parseNameList(mustIncludeText, props.catalog);
    const excluded = parseNameList(excludeText, props.catalog);
    const requiredMajorIds = parseCsvList(requiredMajorIdsText, (value) => value.toUpperCase());
    const excludedMajorIds = parseCsvList(excludedMajorIdsText, (value) => value.toUpperCase());
    const knownMajorIds = new Set(props.catalog.facetsMeta.majorIds.map((value) => value.toUpperCase()));
    const unknownRequiredMajors = requiredMajorIds.filter((value) => !knownMajorIds.has(value));
    const unknownExcludedMajors = excludedMajorIds.filter((value) => !knownMajorIds.has(value));
    const customNumericRanges = customIdThresholds
      .map((row) => ({
        key: row.key.trim(),
        min: row.min ?? undefined,
        max: row.max ?? undefined,
      }))
      .filter((row) => row.key && (typeof row.min === 'number' || typeof row.max === 'number'));
    const knownNumericKeys = new Set(Object.keys(props.catalog.facetsMeta.numericRanges));
    const unknownCustomNumericKeys = customNumericRanges
      .map((row) => row.key)
      .filter((key) => !knownNumericKeys.has(key));
    const invalidCustomNumericRanges = customNumericRanges.filter(
      (row) => typeof row.min === 'number' && typeof row.max === 'number' && row.min > row.max,
    );

    if (
      must.unknown.length > 0 ||
      excluded.unknown.length > 0 ||
      unknownRequiredMajors.length > 0 ||
      unknownExcludedMajors.length > 0 ||
      unknownCustomNumericKeys.length > 0 ||
      invalidCustomNumericRanges.length > 0
    ) {
      setError(
        [
          must.unknown.length ? `Unknown must-include items: ${must.unknown.join(', ')}` : '',
          excluded.unknown.length ? `Unknown excluded items: ${excluded.unknown.join(', ')}` : '',
          unknownRequiredMajors.length ? `Unknown required major IDs: ${unknownRequiredMajors.join(', ')}` : '',
          unknownExcludedMajors.length ? `Unknown excluded major IDs: ${unknownExcludedMajors.join(', ')}` : '',
          unknownCustomNumericKeys.length ? `Unknown advanced ID keys: ${unknownCustomNumericKeys.join(', ')}` : '',
          invalidCustomNumericRanges.length
            ? `Invalid advanced ID ranges (min > max): ${invalidCustomNumericRanges.map((row) => row.key).join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join(' | '),
      );
      return;
    }

    const hasCustomRanges = customNumericRanges.length > 0;
    const isConstraintOnlyMode =
      hasCustomRanges &&
      primaryPreset === 'constraints';

    const constraints: AutoBuildConstraints = {
      ...DEFAULT_AUTO_BUILD_CONSTRAINTS,
      characterClass: builderCharacterClass,
      level: Math.max(1, Math.min(106, Math.round(builderLevel || props.snapshot.level || 106))),
      mustIncludeIds: must.ids,
      excludedIds: excluded.ids,
      lockedSlots,
      target: {
        customNumericRanges,
      },
      allowedTiers: [...allowedTiers],
      requiredMajorIds,
      excludedMajorIds,
      weaponAttackSpeeds: [...weaponAttackSpeeds],
      attackSpeedConstraintMode,
      skillpointFeasibilityMode,
      minPowderSlots,
      onlyPinnedItems,
      useExhaustiveSmallPool,
      exhaustiveStateLimit: Math.max(1000, Math.min(5000000, exhaustiveStateLimit)),
      weights: combinePresetWeights(primaryPreset),
      topN: Math.max(1, Math.min(150, topN)),
      topKPerSlot: Math.max(10, Math.min(300, topKPerSlot)),
      beamWidth: Math.max(20, Math.min(5000, beamWidth)),
      constraintOnlyMode: isConstraintOnlyMode,
    };

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setRunning(true);
    setPreviewCandidates([]);
    setRetryAvailable(false);
    setLastRejectStats(null);
    lastConstraintsRef.current = constraints;
    lastWorkbenchRef.current = props.snapshot;
    setProgress('Starting...');
    try {
      const candidates = await runWithAttemptPlan(props.catalog, constraints, props.snapshot, abort.signal);
      setResults(candidates);
      if (candidates.length === 0) {
        const finalRejectStats = parseRejectStatsFromDetail(diagnosticsRef.current ?? undefined);
        setLastRejectStats(finalRejectStats);
        if (!deepFallbackEnabled) {
          setRetryAvailable(true);
        }
        setProgress('');
        setProgressEvent(null);
        const diag = diagnosticsRef.current ?? '';
        const reasonCode = reasonCodeRef.current ?? lastReasonCode ?? '';
        const spInvalidMatch = /SP-invalid=(\d+)/i.exec(diag);
        const spInvalidCount = spInvalidMatch ? Number(spInvalidMatch[1]) : 0;
        const hardSpeedMatch = /hard=.*?\(speed=(\d+)/i.exec(diag);
        const hardSpeedCount = hardSpeedMatch ? Number(hardSpeedMatch[1]) : 0;
        const hardThresholdMatch = /hard=.*?\(speed=\d+,\s*thresholds=(\d+)/i.exec(diag);
        const hardThresholdCount = hardThresholdMatch ? Number(hardThresholdMatch[1]) : 0;
        const reasonMessage =
          reasonCode === 'must_include_conflict'
            ? 'At least one must-include item cannot be placed under current locks/filters.'
            : reasonCode === 'unsat_attack_target'
            ? 'The configured attack target cannot be satisfied from the current candidate pool.'
            : reasonCode === 'unsat_threshold'
            ? 'One or more hard thresholds are mathematically unsatisfiable with the current pool.'
            : reasonCode === 'sp_infeasible'
            ? 'The explored builds failed skill-point/equip-order feasibility in the selected SP mode.'
            : reasonCode === 'fallback_timeout'
            ? 'Deterministic fallback timed out before finding a valid candidate.'
            : reasonCode === 'empty_pool'
            ? 'At least one slot has no eligible candidate items after filters.'
            : reasonCode === 'search_pruned'
            ? 'Search pruning/state limits exhausted viable branches before a valid candidate was found.'
            : null;
        const tipMessage =
          reasonCode === 'must_include_conflict'
            ? 'Tip: unlock conflicting slots, remove exclusions on required items, or relax class/level/tier filters.'
            : reasonCode === 'unsat_attack_target'
            ? 'Tip: switch attack logic to Either, lower atkTier minimum, or broaden candidate pools.'
            : reasonCode === 'unsat_threshold'
            ? 'Tip: lower strict min/max thresholds or reduce simultaneous hard constraints.'
            : reasonCode === 'sp_infeasible'
            ? skillpointFeasibilityMode === 'no_tomes'
              ? 'Tip: try SP Feasibility Mode = Guild rainbow (+1 each), or add more low-requirement/support items.'
              : 'Tip: relax hard constraints or lower requirement-heavy must-includes.'
            : reasonCode === 'fallback_timeout'
            ? 'Tip: increase Top K / Beam Width, disable pinned-only, or reduce hard filters.'
            : reasonCode === 'empty_pool'
            ? 'Tip: disable pinned-only first, then relax tier/powder/class filters.'
            : reasonCode === 'search_pruned'
            ? 'Tip: use Constraint-first/Exhaustive-ish strategy and increase search budgets.'
            : null;
        setError(
          [
            'No valid candidates found.',
            diagnosticsRef.current ? `Diagnostics: ${diagnosticsRef.current}` : '',
            reasonMessage
              ? reasonMessage
              : spInvalidCount > 0
              ? 'The engine found many full builds, but they failed skill-point/equip-order feasibility. This is not just a UI filter issue.'
              : hardSpeedCount > 0
                ? 'The engine found many full builds, but they failed the final attack-speed target. This usually means the search is missing enough +atkTier support for the selected weapon/target combination.'
              : hardThresholdCount > 0 && customNumericRanges.length > 0
                ? 'The engine found many full builds, but they failed advanced ID min/max thresholds. This usually means the search is not preserving enough support items for those IDs.'
              : 'This usually means your hard constraints are too strict (pinned-only, major IDs, must-includes, attack-speed, or thresholds), or the selected objective conflicts with them.',
            tipMessage
              ? tipMessage
              : spInvalidCount > 0
              ? 'Try switching Primary Goal to Balanced or Tank and keeping Exact Search + Deep Fallback enabled.'
              : hardSpeedCount > 0
                ? 'Tip: keep Exact Search + Deep Fallback enabled, lower thresholds, and try adding/pinning known +Attack Speed Bonus support items for the target speed.'
              : hardThresholdCount > 0 && customNumericRanges.length > 0
                ? 'Tip: switch Solver Strategy to Constraint-first or Exhaustive-ish and keep Deep Fallback enabled. For strict advanced IDs, add only the most important thresholds first.'
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
      setProgressEvent(null);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    workerRef.current?.cancelCurrent();
    setRunning(false);
    setProgress('Cancelled');
    setProgressEvent(null);
  };

  const retryDeeper = async (tier: 'deep' | 'exhaustive') => {
    const catalog = props.catalog;
    const baseConstraints = lastConstraintsRef.current;
    const baseWorkbench = lastWorkbenchRef.current;
    if (!catalog || !baseConstraints || !baseWorkbench) return;

    setError(null);
    setRetryAvailable(false);
    setLastRejectStats(null);
    setLastDiagnostics(null);
    setLastReasonCode(null);
    diagnosticsRef.current = null;
    reasonCodeRef.current = null;

    const deeperConstraints: AutoBuildConstraints = {
      ...baseConstraints,
      topKPerSlot: tier === 'exhaustive'
        ? Math.max(baseConstraints.topKPerSlot, 300)
        : Math.max(baseConstraints.topKPerSlot, 180),
      beamWidth: tier === 'exhaustive'
        ? Math.max(baseConstraints.beamWidth, 2600)
        : Math.max(baseConstraints.beamWidth, 1200),
      maxStates: tier === 'exhaustive'
        ? Math.max(baseConstraints.maxStates, 12_000_000)
        : Math.max(baseConstraints.maxStates, 4_000_000),
      useExhaustiveSmallPool: true,
      exhaustiveStateLimit: tier === 'exhaustive'
        ? Math.max(baseConstraints.exhaustiveStateLimit, 2_000_000)
        : Math.max(baseConstraints.exhaustiveStateLimit, 1_200_000),
      weights: {
        ...baseConstraints.weights,
        ...(baseConstraints.constraintOnlyMode ? {} : {
          legacyBaseDps: baseConstraints.weights.legacyBaseDps * 0.6,
          dpsProxy: baseConstraints.weights.dpsProxy * 0.55,
          legacyEhp: Math.max(baseConstraints.weights.legacyEhp, 1.0),
          ehpProxy: Math.max(baseConstraints.weights.ehpProxy, 1.0),
          sustain: Math.max(baseConstraints.weights.sustain, 0.8),
          skillPointTotal: Math.max(baseConstraints.weights.skillPointTotal, 0.8),
          reqTotalPenalty: Math.max(baseConstraints.weights.reqTotalPenalty, 1.8),
        }),
      },
    };

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setRunning(true);
    setPreviewCandidates([]);
    const label = tier === 'exhaustive' ? 'Exhaustive retry' : 'Deep retry';
    setProgress(`${label} • topK ${deeperConstraints.topKPerSlot}, beam ${deeperConstraints.beamWidth}`);

    try {
      const candidates = await workerRef.current!.run(catalog, baseWorkbench, deeperConstraints, {
        signal: abort.signal,
        onProgress: (event) => {
          setProgressEvent(event);
          if (event.previewCandidates) setPreviewCandidates(event.previewCandidates);
          if (event.phase === 'diagnostics' && event.reasonCode) {
            reasonCodeRef.current = event.reasonCode;
            setLastReasonCode(event.reasonCode);
          }
          if (event.phase === 'diagnostics' && event.detail) {
            diagnosticsRef.current = event.detail;
            setLastDiagnostics(event.detail);
          }
          setProgress(
            `${label} • ${event.phase}: ${event.expandedSlots}/${event.totalSlots} slots, beam ${event.beamSize}, states ${event.processedStates}${event.detail ? ` • ${event.detail}` : ''}`,
          );
        },
      });
      setResults(candidates);
      if (candidates.length === 0) {
        const finalRejectStats = parseRejectStatsFromDetail(diagnosticsRef.current ?? undefined);
        setLastRejectStats(finalRejectStats);
        setProgress('');
        setProgressEvent(null);
        setError(`No valid candidates found after ${label.toLowerCase()}. Try relaxing constraints or increasing search budgets further.`);
      } else {
        setProgress(`Completed. ${candidates.length} valid candidates.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auto builder failed');
      setProgress('');
    } finally {
      setRunning(false);
      setProgressEvent(null);
    }
  };

  const statusMessage = error ?? lastDiagnostics;
  const statusIsError = Boolean(error);
  const liveRejectStats = parseRejectStatsFromDetail(progressEvent?.detail);
  const rejectStats = (running ? liveRejectStats : lastRejectStats) ?? null;
  const totalRejected = rejectStats
    ? rejectStats.spInvalid + rejectStats.majorIds + rejectStats.duplicate + rejectStats.hard
    : 0;

  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Build Solver"
      description="Beam search over item combinations. Uses Workbench summary metrics (legacy-style Base DPS / EHP, ability tree excluded)."
      className="!w-[min(95vw,1360px)]"
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
      {running && progressEvent ? (
        <div className="wb-beam-progress mb-4 rounded-xl p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-[var(--wb-info-border)] bg-[var(--wb-info-soft)] px-2 py-0.5 text-xs font-medium text-[var(--wb-info)]">
              {progressEvent.phase === 'exact-search'
                ? 'Exact search'
                : progressEvent.phase === 'beam-search'
                  ? 'Beam search'
                  : progressEvent.phase === 'diagnostics'
                    ? 'Finalize / diagnostics'
                    : progressEvent.phase}
            </span>
            {progressEvent.totalSlots > 0 ? (
              <span className="text-xs text-[var(--wb-muted)]">
                Slots {progressEvent.expandedSlots}/{progressEvent.totalSlots}
              </span>
            ) : null}
          </div>
          <div className="wb-beam-progress-track h-2.5 w-full overflow-hidden rounded-full">
            <div
              className="wb-beam-progress-fill h-full rounded-full transition-[width] duration-300 ease-out"
              style={{
                width: progressEvent.totalSlots > 0 ? `${(100 * progressEvent.expandedSlots) / progressEvent.totalSlots}%` : '0%',
              }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--wb-muted)]">
            <span>States: {progressEvent.processedStates.toLocaleString()}</span>
            <span>Beam: {progressEvent.beamSize.toLocaleString()}</span>
          </div>
          {rejectStats && totalRejected > 0 ? (
            <div className="mt-3 border-t border-[var(--wb-info-border)] pt-2">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--wb-muted)]">
                Rejected builds (this pass)
              </div>
              <div className="flex flex-wrap gap-2">
                {rejectStats.spInvalid > 0 ? (
                  <span className="rounded bg-rose-400/20 px-1.5 py-0.5 text-[11px] text-rose-200" title="Skill point / equip feasibility">
                    SP: {rejectStats.spInvalid}
                  </span>
                ) : null}
                {rejectStats.majorIds > 0 ? (
                  <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[11px] text-amber-200" title="Major ID requirement">
                    Major ID: {rejectStats.majorIds}
                  </span>
                ) : null}
                {rejectStats.duplicate > 0 ? (
                  <span className="rounded bg-slate-400/20 px-1.5 py-0.5 text-[11px] text-slate-200" title="Duplicate build">
                    Dup: {rejectStats.duplicate}
                  </span>
                ) : null}
                {rejectStats.speed > 0 ? (
                  <span className="rounded bg-orange-400/20 px-1.5 py-0.5 text-[11px] text-orange-200" title="Attack speed">
                    Speed: {rejectStats.speed}
                  </span>
                ) : null}
                {rejectStats.thresholds > 0 ? (
                  <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[11px] text-amber-200" title="Min/max thresholds">
                    Thresholds: {rejectStats.thresholds}
                  </span>
                ) : null}
                {rejectStats.item > 0 ? (
                  <span className="rounded bg-slate-400/20 px-1.5 py-0.5 text-[11px] text-slate-200" title="Item constraint">
                    Item: {rejectStats.item}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {!running && (retryAvailable || (lastRejectStats && totalRejected > 0)) ? (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/8 p-3">
          {lastRejectStats && totalRejected > 0 ? (
            <div className="mb-3">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-amber-200/80">
                Last pass reject breakdown
              </div>
              <div className="flex flex-wrap gap-2">
                {lastRejectStats.spInvalid > 0 ? (
                  <span className="rounded bg-rose-400/20 px-1.5 py-0.5 text-[11px] text-rose-200">
                    SP: {lastRejectStats.spInvalid}
                  </span>
                ) : null}
                {lastRejectStats.majorIds > 0 ? (
                  <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[11px] text-amber-200">
                    Major ID: {lastRejectStats.majorIds}
                  </span>
                ) : null}
                {lastRejectStats.duplicate > 0 ? (
                  <span className="rounded bg-slate-400/20 px-1.5 py-0.5 text-[11px] text-slate-200">
                    Dup: {lastRejectStats.duplicate}
                  </span>
                ) : null}
                {lastRejectStats.speed > 0 ? (
                  <span className="rounded bg-orange-400/20 px-1.5 py-0.5 text-[11px] text-orange-200">
                    Speed: {lastRejectStats.speed}
                  </span>
                ) : null}
                {lastRejectStats.thresholds > 0 ? (
                  <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[11px] text-amber-200">
                    Thresholds: {lastRejectStats.thresholds}
                  </span>
                ) : null}
                {lastRejectStats.item > 0 ? (
                  <span className="rounded bg-slate-400/20 px-1.5 py-0.5 text-[11px] text-slate-200">
                    Item: {lastRejectStats.item}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
          {retryAvailable ? (
            <div>
              <div className="mb-2 text-xs text-amber-100">
                Fast pass found 0 results. Retry with a higher search budget?
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" className="text-xs" onClick={() => retryDeeper('deep')}>
                  Deeper search (2x budget)
                </Button>
                <Button variant="ghost" className="text-xs" onClick={() => retryDeeper('exhaustive')}>
                  Exhaustive search (max budget)
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="grid h-[52vh] min-h-0 gap-4 overflow-hidden lg:h-[56vh] lg:grid-cols-[1fr_1fr] lg:items-stretch">
        <div className="grid h-full min-h-0 min-w-0 gap-3 overflow-auto pr-1 wb-scrollbar">
          {showTips ? (
            <div className="wb-card p-3">
              <div className="mb-2 text-sm font-semibold">Tips (New Players)</div>
              <div className="grid gap-2 text-xs text-[var(--wb-muted)]">
                <div>1. Start with a Primary Goal like <b>Damage</b> or <b>Tank / EHP</b>. Leave most constraints empty.</div>
                <div>2. Add only a few hard constraints first: class/level, maybe one must-include item.</div>
                <div>3. If you get 0 candidates, turn off <b>Only use pinned items in bins</b> and clear major-ID constraints.</div>
                <div>4. Build Solver filters out builds that fail skill requirements / equip order feasibility.</div>
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
                  {PRIMARY_GOAL_ORDER.map((preset) => (
                    <ChipButton
                      key={preset}
                      active={primaryPreset === preset}
                      onClick={() => setPrimaryPreset(preset)}
                    >
                      {OPTIMIZATION_PRESET_LABELS[preset]}
                    </ChipButton>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-2 text-xs text-[var(--wb-muted)]">
                Build Solver always filters out builds that fail skill point/equip-order feasibility. You do not need to set a minimum SP total.
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

              <details className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-2">
                <summary className="cursor-pointer text-sm font-medium">Advanced: Specific ID Min / Max</summary>
                <div className="mt-3 grid gap-3">
                  <div className="text-xs text-[var(--wb-muted)]">
                    Set build-wide min/max totals for any numeric ID (e.g. `mr`, `ms`, `spd`, `reqTotal`, `sdPct`, `poison`, `atkTier`). These are hard constraints.
                  </div>
                  {customIdThresholds.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[var(--wb-border-muted)] px-3 py-2 text-xs text-[var(--wb-muted)]">
                      No advanced ID thresholds yet.
                    </div>
                  ) : null}
                  {customIdThresholds.map((row) => {
                    const range = props.catalog?.facetsMeta.numericRanges[row.key];
                    return (
                      <div key={row.id} className="rounded-lg border border-[var(--wb-border-muted)] p-2">
                        <div className="flex flex-col gap-2">
                          <div>
                            <FieldLabel>ID</FieldLabel>
                            <select
                              className="wb-select w-full"
                              value={row.key}
                              onChange={(e) => updateCustomIdThresholdRow(row.id, { key: e.target.value })}
                            >
                              {numericIdOptions.map((key) => (
                                <option key={key} value={key}>
                                  {formatNumericIdLabel(key)} ({key})
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="min-w-[80px] flex-1">
                              <FieldLabel>Min</FieldLabel>
                              <input
                                className="wb-input w-full"
                                type="number"
                                value={row.min ?? ''}
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  updateCustomIdThresholdRow(row.id, { min: raw === '' ? null : Number(raw) });
                                }}
                              />
                            </div>
                            <div className="min-w-[80px] flex-1">
                              <FieldLabel>Max</FieldLabel>
                              <input
                                className="wb-input w-full"
                                type="number"
                                value={row.max ?? ''}
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  updateCustomIdThresholdRow(row.id, { max: raw === '' ? null : Number(raw) });
                                }}
                              />
                            </div>
                            <Button variant="ghost" className="shrink-0" onClick={() => removeCustomIdThresholdRow(row.id)}>
                              Remove
                            </Button>
                          </div>
                        </div>
                        {range ? (
                          <div className="mt-1 text-[11px] text-[var(--wb-muted)]">
                            Catalog item range: {range.min} to {range.max} (per item)
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  <div>
                    <Button
                      variant="ghost"
                      onClick={addCustomIdThresholdRow}
                      disabled={numericIdOptions.length === 0}
                    >
                      Add ID Threshold
                    </Button>
                  </div>
                  {primaryPreset === 'constraints' && !hasAdvancedIdMinMax ? (
                    <div className="mt-1 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-[11px] text-amber-50">
                      Advanced IDs preset is selected as Primary Goal, but no ID has both Min and Max set.
                      Add at least one ID with a Min and Max, or switch primary goal. You can still run the solver without this.
                    </div>
                  ) : null}
                </div>
              </details>
            </div>
          </div>

          <div className="wb-card p-3">
            <div className="mb-3 text-sm font-semibold">Solver Strategy</div>
            <div className="grid gap-3">
              <div>
                <FieldLabel>Strategies (select one or more; All is exclusive)</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {SOLVER_STRATEGY_ORDER.map((strategy) => {
                    const isAll = strategy === 'auto';
                    const isAllSelected = solverStrategies.length === 1 && solverStrategies[0] === 'auto';
                    const active = isAll ? isAllSelected : solverStrategies.includes(strategy);
                    const disabled = isAll && !isAllSelected;
                    return (
                      <ChipButton
                        key={strategy}
                        active={active}
                        disabled={disabled}
                        onClick={() => {
                          if (disabled) return;
                          if (isAll) {
                            setSolverStrategies(['auto']);
                            return;
                          }
                          if (isAllSelected) {
                            setSolverStrategies([strategy]);
                            return;
                          }
                          const has = solverStrategies.includes(strategy);
                          const next = has
                            ? solverStrategies.filter((s) => s !== strategy)
                            : [...solverStrategies, strategy];
                          const allThree =
                            next.length === 3 &&
                            next.includes('fast') &&
                            next.includes('constraint') &&
                            next.includes('exhaustive');
                          setSolverStrategies(next.length > 0 ? (allThree ? ['auto'] : next) : ['auto']);
                        }}
                      >
                        {SOLVER_STRATEGY_LABELS[strategy]}
                      </ChipButton>
                    );
                  })}
                </div>
                <div className="mt-1 text-xs text-[var(--wb-muted)]">
                  {solverStrategies.length === 1 && solverStrategies[0] === 'auto'
                    ? (deepFallbackEnabled ? 'Starts fast, then auto-retries deeper if needed.' : 'Starts fast. Prompts to retry deeper if 0 results.')
                    : solverStrategies.includes('fast') && !solverStrategies.includes('constraint') && !solverStrategies.includes('exhaustive')
                      ? 'Single fast pass. Lowest wait time, weakest fallback.'
                      : solverStrategies.includes('constraint')
                        ? 'Constraint-first helps strict attack-speed or advanced ID min/max.'
                        : solverStrategies.includes('exhaustive')
                          ? 'Exhaustive-ish: highest search budget, strongest fallback.'
                          : 'Selected strategies run in order (fast → constraint → exhaustive).'}
                </div>
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

              <div>
                <FieldLabel>Attack Target Logic</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <ChipButton
                    active={attackSpeedConstraintMode === 'or'}
                    onClick={() => setAttackSpeedConstraintMode('or')}
                  >
                    Either
                  </ChipButton>
                  <ChipButton
                    active={attackSpeedConstraintMode === 'and'}
                    onClick={() => setAttackSpeedConstraintMode('and')}
                  >
                    Both
                  </ChipButton>
                </div>
                <div className="mt-1 text-xs text-[var(--wb-muted)]">
                  Applies when both final attack speed and advanced `atkTier` thresholds are set.
                </div>
              </div>

              <div>
                <FieldLabel>SP Feasibility Mode</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <ChipButton
                    active={skillpointFeasibilityMode === 'no_tomes'}
                    onClick={() => setSkillpointFeasibilityMode('no_tomes')}
                  >
                    No tomes
                  </ChipButton>
                  <ChipButton
                    active={skillpointFeasibilityMode === 'guild_rainbow'}
                    onClick={() => setSkillpointFeasibilityMode('guild_rainbow')}
                  >
                    Guild rainbow (+1 each)
                  </ChipButton>
                  <ChipButton
                    active={skillpointFeasibilityMode === 'flexible_2'}
                    onClick={() => setSkillpointFeasibilityMode('flexible_2')}
                  >
                    +2 flexible
                  </ChipButton>
                </div>
                <div className="mt-1 text-xs text-[var(--wb-muted)]">
                  Guild rainbow: +1 each (total +5). +2 flexible: +2 in two skills (total +4).
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
                max={150}
              />
              <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-2 text-xs text-[var(--wb-muted)]">
                Locked slots from the Workbench will be preserved. Current locks: {Object.values(lockedSlots).filter(Boolean).length}
                {onlyPinnedItems ? ' | Candidate pools restricted to pinned bins.' : ''}
                {solverStrategies.length > 0 && !(solverStrategies.length === 1 && solverStrategies[0] === 'auto')
                  ? ` | Strategy: ${solverStrategies.map((s) => SOLVER_STRATEGY_LABELS[s]).join(' → ')}.`
                  : ''}
                {` | Attack logic: ${attackSpeedConstraintMode === 'or' ? 'Either' : 'Both'}.`}
                {` | SP mode: ${skillpointFeasibilityMode === 'guild_rainbow' ? 'Guild rainbow (+1 each)' : skillpointFeasibilityMode === 'flexible_2' ? '+2 flexible' : 'No tomes'}.`}
                {deepFallbackEnabled ? ' | Auto retries with deeper search if fast pass finds 0 candidates.' : ' | Prompts to retry manually if fast pass finds 0.'}
                {useExhaustiveSmallPool ? ` | Exact enumeration is used automatically when pool combinations are <= ${Math.round(exhaustiveStateLimit).toLocaleString()}.` : ''}
              </div>
            </div>
          </div>
        </div>

        <div className="h-full min-h-0 min-w-0">
          <div className="wb-card flex h-full min-h-0 flex-col overflow-hidden p-3">
            {(() => {
              const isPreview = running && previewCandidates.length > 0;
              const shownCandidates = (isPreview ? previewCandidates.slice(0, 2) : results);
              return (
                <>
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold">
                      Candidates{' '}
                      {isPreview ? (
                        <span className="text-[11px] text-[var(--wb-muted)]">(live preview; may be partial)</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-[var(--wb-muted)]">
                      {shownCandidates.length} shown
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1 wb-scrollbar">
                    {shownCandidates.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[var(--wb-border)] p-4 text-sm text-[var(--wb-muted)]">
                        Run Build Solver to generate candidate builds.
                      </div>
                    ) : (
                      shownCandidates.map((candidate, index) => (
                        <div
                          key={`${candidate.score}-${index}`}
                          className={
                            isPreview
                              ? 'rounded-xl border border-[var(--wb-info-border)] bg-[var(--wb-info-soft)] p-3'
                              : 'rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-3'
                          }
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold">
                                #{index + 1} | Score {Math.round(candidate.score).toLocaleString()}
                              </div>
                              <div className="mt-1 text-xs text-[var(--wb-muted)]">
                                HP {Math.round(candidate.summary.aggregated.hpTotal)} | Req {candidate.summary.derived.reqTotal}
                              </div>
                              <div className="mt-1 text-xs text-[var(--wb-muted)]">
                                SP Needed {Math.round(candidate.summary.derived.assignedSkillPointsRequired)} | MR {candidate.summary.aggregated.mr} | MS {candidate.summary.aggregated.ms}
                              </div>
                              {isPreview ? (
                                <div className="mt-1 text-[11px] text-[var(--wb-muted)]">
                                  Live preview only – may not be a complete or fully feasible build.
                                </div>
                              ) : null}
                            </div>
                            {!isPreview ? (
                              <Button className="px-2 py-1 text-xs" onClick={() => props.onLoadCandidate(candidate)}>
                                Load into Workbench
                              </Button>
                            ) : null}
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
                </>
              );
            })()}
            {statusMessage ? (
              <details
                className={`mt-2 rounded-xl border p-2 ${
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
          </div>
        </div>
      </div>
    </Modal>
  );
}
