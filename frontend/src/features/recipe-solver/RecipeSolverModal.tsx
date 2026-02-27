import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  RecipeCatalogSnapshot,
  RecipeSolverCandidate,
  RecipeSolverConstraints,
  RecipeSolverProgressEvent,
  RecipeSolverWeights,
  CraftedAtkSpd,
} from '@/domain/recipe-solver/types';
import {
  RECIPE_TYPES,
  LEVEL_RANGES,
  CRAFTED_ATK_SPEEDS,
  DEFAULT_RECIPE_SOLVER_CONSTRAINTS,
  DEFAULT_RECIPE_SOLVER_WEIGHTS,
  getCraftedCategory,
} from '@/domain/recipe-solver/types';
import { RecipeSolverWorkerClient } from '@/domain/recipe-solver/worker';
import { recipeCatalogService } from '@/domain/recipe-solver/catalog-service';
import type { ItemSlot } from '@/domain/items/types';
import type { CraftedSlotInfo } from '@/domain/build/types';
import { Button, ChipButton, FieldLabel, Modal, NumberField } from '@/components/ui';

type OptimizationPreset = 'advancedIds' | 'balanced' | 'offense' | 'defense' | 'utility' | 'skillpoints';

const RECIPE_TYPE_TO_SLOT: Record<string, ItemSlot> = {
  helmet: 'helmet', chestplate: 'chestplate', leggings: 'leggings', boots: 'boots',
  ring: 'ring1', bracelet: 'bracelet', necklace: 'necklace',
  spear: 'weapon', bow: 'weapon', wand: 'weapon', dagger: 'weapon', relik: 'weapon',
};

const PRESET_LABELS: Record<OptimizationPreset, string> = {
  advancedIds: 'Advanced IDs only',
  balanced: 'Balanced',
  offense: 'Offense',
  defense: 'Defense',
  utility: 'Utility / Sustain',
  skillpoints: 'Skill Points',
};

const PRESET_ORDER: OptimizationPreset[] = ['advancedIds', 'balanced', 'offense', 'defense', 'utility', 'skillpoints'];

function presetWeights(preset: OptimizationPreset): RecipeSolverWeights {
  const base = { ...DEFAULT_RECIPE_SOLVER_WEIGHTS };
  switch (preset) {
    case 'advancedIds':
      return { offense: 0.25, defense: 0.25, utility: 0.25, skillPoints: 0.25, reqPenalty: 0.25 };
    case 'offense':
      return { offense: 2.0, defense: 0, utility: 0, skillPoints: 0, reqPenalty: 0 };
    case 'defense':
      return { offense: 0, defense: 2.0, utility: 0, skillPoints: 0, reqPenalty: 0 };
    case 'utility':
      return { offense: 0, defense: 0, utility: 2.0, skillPoints: 0, reqPenalty: 0 };
    case 'skillpoints':
      return { offense: 0, defense: 0, utility: 0, skillPoints: 2.0, reqPenalty: 0 };
    case 'balanced':
    default:
      return base;
  }
}

/** All IDs that can appear on crafted items (from ingredients + recipe). Used for Stat Thresholds dropdown. */
const STAT_LABEL: Record<string, string> = {
  durability: 'Durability', duration: 'Duration',
  sdPct: 'Spell Dmg %', sdRaw: 'Spell Dmg Raw', mdPct: 'Melee Dmg %', mdRaw: 'Melee Dmg Raw',
  damPct: 'Damage %', poison: 'Poison', hpBonus: 'HP Bonus', hprRaw: 'HPR Raw', hprPct: 'HPR %',
  mr: 'Mana Regen', ms: 'Mana Steal', ls: 'Life Steal', spd: 'Walk Speed',
  xpb: 'XP Bonus', lb: 'Loot Bonus', ref: 'Reflection', thorns: 'Thorns', expd: 'Exploding',
  str: 'STR', dex: 'DEX', int: 'INT', def: 'DEF', agi: 'AGI',
  eDamPct: 'Earth Dmg %', tDamPct: 'Thunder Dmg %', wDamPct: 'Water Dmg %',
  fDamPct: 'Fire Dmg %', aDamPct: 'Air Dmg %', nDamPct: 'Neutral Dmg %', rDamPct: 'Elem Dmg %',
  eDefPct: 'Earth Def %', tDefPct: 'Thunder Def %', wDefPct: 'Water Def %',
  fDefPct: 'Fire Def %', aDefPct: 'Air Def %', rDefPct: 'Elem Def %',
  atkTier: 'Atk Speed Bonus', spRegen: 'Soul Point Regen', eSteal: 'Emerald Steal',
  rSdRaw: 'Rainbow Spell Raw', critDamPct: 'Crit Damage %',
  spPct1: '1st Spell Cost %', spRaw1: '1st Spell Cost Raw',
  spPct2: '2nd Spell Cost %', spRaw2: '2nd Spell Cost Raw',
  spPct3: '3rd Spell Cost %', spRaw3: '3rd Spell Cost Raw',
  spPct4: '4th Spell Cost %', spRaw4: '4th Spell Cost Raw',
  sprint: 'Sprint', sprintReg: 'Sprint Regen', jh: 'Jump Height',
  lq: 'Loot Quality', gXp: 'Gather XP', gSpd: 'Gather Speed',
  healPct: 'Healing %', kb: 'Knockback', weakenEnemy: 'Weaken Enemy', slowEnemy: 'Slow Enemy',
  maxMana: 'Max Mana', mainAttackRange: 'Main Attack Range',
  eDamRaw: 'Earth Dmg Raw', tDamRaw: 'Thunder Dmg Raw', wDamRaw: 'Water Dmg Raw',
  fDamRaw: 'Fire Dmg Raw', aDamRaw: 'Air Dmg Raw', nDamRaw: 'Neutral Dmg Raw', damRaw: 'Damage Raw', rDamRaw: 'Elem Dmg Raw',
};

/** Full list of craftable stat IDs (Legacy rolledIDs + skill points + durability/duration). */
const CRAFTABLE_STAT_KEYS = [
  'durability', 'duration',
  'hprPct', 'mr', 'sdPct', 'mdPct', 'ls', 'ms', 'xpb', 'lb', 'ref', 'thorns', 'expd', 'spd',
  'atkTier', 'poison', 'hpBonus', 'spRegen', 'eSteal', 'hprRaw', 'sdRaw', 'mdRaw',
  'fDamPct', 'wDamPct', 'aDamPct', 'tDamPct', 'eDamPct', 'nDamPct', 'rDamPct', 'damPct',
  'fDefPct', 'wDefPct', 'aDefPct', 'tDefPct', 'eDefPct', 'rDefPct',
  'spPct1', 'spRaw1', 'spPct2', 'spRaw2', 'spPct3', 'spRaw3', 'spPct4', 'spRaw4',
  'rSdRaw', 'sprint', 'sprintReg', 'jh', 'lq', 'gXp', 'gSpd',
  'eDamRaw', 'tDamRaw', 'wDamRaw', 'fDamRaw', 'aDamRaw', 'nDamRaw', 'damRaw', 'rDamRaw',
  'critDamPct', 'healPct', 'maxMana',
  'str', 'dex', 'int', 'def', 'agi',
];

function formatStatLabel(key: string): string {
  return STAT_LABEL[key] ?? key;
}

type ThresholdRow = { id: number; key: string; min: number | null; max: number | null };

const RECIPE_TYPE_TO_SKILL: Record<string, string> = {
  HELMET: 'ARMOURING', CHESTPLATE: 'TAILORING', LEGGINGS: 'TAILORING', BOOTS: 'TAILORING',
  SPEAR: 'WEAPONSMITHING', DAGGER: 'WEAPONSMITHING',
  WAND: 'WOODWORKING', BOW: 'WOODWORKING', RELIK: 'WOODWORKING',
  RING: 'JEWELING', NECKLACE: 'JEWELING', BRACELET: 'JEWELING',
  POTION: 'ALCHEMISM', SCROLL: 'SCRIBING', FOOD: 'COOKING',
};

export function RecipeSolverModal(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onEquipCraft?(slot: ItemSlot, info: CraftedSlotInfo): void;
}) {
  const workerRef = useRef<RecipeSolverWorkerClient | null>(null);
  if (!workerRef.current) workerRef.current = new RecipeSolverWorkerClient();

  const [catalog, setCatalog] = useState<RecipeCatalogSnapshot | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [recipeType, setRecipeType] = useState<string>('HELMET');
  const [levelRange, setLevelRange] = useState<string>('103-105');
  const [matTierMode, setMatTierMode] = useState<'auto' | 'manual'>('auto');
  const [matTier1, setMatTier1] = useState<number>(3);
  const [matTier2, setMatTier2] = useState<number>(3);
  const [atkSpdMode, setAtkSpdMode] = useState<'auto' | 'manual'>('auto');
  const [atkSpd, setAtkSpd] = useState<CraftedAtkSpd>('FAST');
  const [preset, setPreset] = useState<OptimizationPreset>('advancedIds');
  const [mustIncludeText, setMustIncludeText] = useState('');
  const [excludeText, setExcludeText] = useState('');
  const [thresholds, setThresholds] = useState<ThresholdRow[]>([]);
  const thresholdSeqRef = useRef(1);
  const [beamWidth, setBeamWidth] = useState(DEFAULT_RECIPE_SOLVER_CONSTRAINTS.beamWidth);
  const [topKPerSlot, setTopKPerSlot] = useState(DEFAULT_RECIPE_SOLVER_CONSTRAINTS.topKPerSlot);
  const [topN, setTopN] = useState(DEFAULT_RECIPE_SOLVER_CONSTRAINTS.topN);

  const [results, setResults] = useState<RecipeSolverCandidate[]>([]);
  const [progress, setProgress] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressEvent, setProgressEvent] = useState<RecipeSolverProgressEvent | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isWeapon = getCraftedCategory(recipeType.toLowerCase()) === 'weapon';

  // Load catalog when modal opens
  useEffect(() => {
    if (!props.open) return;
    if (catalog) return;
    recipeCatalogService.getCatalog().then(setCatalog).catch((e) => {
      setCatalogError(e instanceof Error ? e.message : 'Failed to load crafting data');
    });
  }, [props.open, catalog]);

  const ingredientCount = useMemo(() => {
    if (!catalog) return 0;
    const skill = RECIPE_TYPE_TO_SKILL[recipeType] ?? '';
    return catalog.ingredientsBySkill.get(skill)?.length ?? 0;
  }, [catalog, recipeType]);

  function parseIngredientNames(text: string): { ids: number[]; unknown: string[] } {
    if (!catalog) return { ids: [], unknown: [] };
    const parts = text.split(',').map(s => s.trim()).filter(Boolean);
    const ids: number[] = [];
    const unknown: string[] = [];
    for (const part of parts) {
      const id = catalog.ingredientIdByName.get(part.toLowerCase());
      if (id == null) unknown.push(part);
      else ids.push(id);
    }
    return { ids, unknown };
  }

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash).then(() => {
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash(null), 2000);
    });
  };

  const run = async () => {
    if (!catalog) return;
    setError(null);
    setResults([]);
    setProgressEvent(null);

    const must = parseIngredientNames(mustIncludeText);
    const excluded = parseIngredientNames(excludeText);
    if (must.unknown.length > 0 || excluded.unknown.length > 0) {
      setError(
        [
          must.unknown.length ? `Unknown must-include: ${must.unknown.join(', ')}` : '',
          excluded.unknown.length ? `Unknown excluded: ${excluded.unknown.join(', ')}` : '',
        ].filter(Boolean).join(' | '),
      );
      return;
    }

    const target: Record<string, { min?: number; max?: number }> = {};
    for (const row of thresholds) {
      if (!row.key) continue;
      if (row.min == null && row.max == null) continue;
      target[row.key] = {
        min: row.min ?? undefined,
        max: row.max ?? undefined,
      };
    }

    const constraints: RecipeSolverConstraints = {
      ...DEFAULT_RECIPE_SOLVER_CONSTRAINTS,
      recipeType,
      levelRange,
      matTiers: matTierMode === 'manual' ? [matTier1, matTier2] : null,
      atkSpd: isWeapon && atkSpdMode === 'manual' ? atkSpd : null,
      weights: presetWeights(preset),
      mustIncludeIngredients: must.ids,
      excludedIngredients: excluded.ids,
      topN: Math.max(1, Math.min(100, topN)),
      topKPerSlot: Math.max(10, Math.min(300, topKPerSlot)),
      beamWidth: Math.max(20, Math.min(3000, beamWidth)),
      target,
    };

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setRunning(true);
    setProgress('Starting...');

    try {
      const candidates = await workerRef.current!.run(catalog, constraints, {
        signal: abort.signal,
        onProgress: (event) => {
          setProgressEvent(event);
          setProgress(
            `${event.phase}: ${event.expandedSlots}/${event.totalSlots} slots, beam ${event.beamSize}, states ${event.processedStates}${event.detail ? ` | ${event.detail}` : ''}`,
          );
        },
      });
      setResults(candidates);
      if (candidates.length === 0) {
        setError('No valid candidates found. Try relaxing constraints, increasing beam width/top K, or choosing a different recipe.');
      } else {
        setProgress(`Done. ${candidates.length} candidates found.`);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setProgress('Cancelled');
      } else {
        setError(e instanceof Error ? e.message : 'Recipe solver failed');
        setProgress('');
      }
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

  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Recipe Solver"
      description="Find optimal ingredient combinations for crafted items. Uses beam search over the ingredient pool."
      className="!w-[min(95vw,1360px)]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-[var(--wb-muted)]">{progress}</div>
          <div className="flex gap-2">
            {running ? (
              <Button variant="ghost" onClick={cancel}>Cancel</Button>
            ) : null}
            <Button variant="primary" onClick={run} disabled={!catalog || running}>
              Solve Recipe
            </Button>
          </div>
        </div>
      }
    >
      {catalogError ? (
        <div className="mb-4 rounded-xl border border-rose-400/30 bg-rose-400/5 p-3 text-sm text-rose-200">
          {catalogError}
        </div>
      ) : null}

      {running && progressEvent ? (
        <div className="mb-4 rounded-xl border border-sky-400/30 bg-sky-400/5 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-sky-400/20 px-2 py-0.5 text-xs font-medium text-sky-100">
              {progressEvent.phase}
            </span>
            {progressEvent.totalSlots > 0 ? (
              <span className="text-xs text-[var(--wb-muted)]">
                Slots {progressEvent.expandedSlots}/{progressEvent.totalSlots}
              </span>
            ) : null}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-black/20">
            <div
              className="h-full rounded-full bg-sky-400/70 transition-all duration-300"
              style={{
                width: progressEvent.totalSlots > 0
                  ? `${(100 * progressEvent.expandedSlots) / progressEvent.totalSlots}%`
                  : '0%',
              }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--wb-muted)]">
            <span>States: {progressEvent.processedStates.toLocaleString()}</span>
            <span>Beam: {progressEvent.beamSize.toLocaleString()}</span>
          </div>
        </div>
      ) : null}

      <div className="grid h-[52vh] min-h-0 gap-4 overflow-hidden lg:h-[56vh] lg:grid-cols-[1fr_1fr] lg:items-stretch">
        {/* Left: Inputs */}
        <div className="grid h-full min-h-0 min-w-0 gap-3 overflow-auto pr-1 wb-scrollbar">
          <div className="wb-card p-3">
            <div className="mb-3 text-sm font-semibold">Recipe</div>
            <div className="grid gap-3">
              <div>
                <FieldLabel>Item Type</FieldLabel>
                <select className="wb-select" value={recipeType} onChange={(e) => setRecipeType(e.target.value)}>
                  {RECIPE_TYPES.map(t => (
                    <option key={t} value={t}>{t} ({RECIPE_TYPE_TO_SKILL[t]})</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Level Range</FieldLabel>
                <select className="wb-select" value={levelRange} onChange={(e) => setLevelRange(e.target.value)}>
                  {LEVEL_RANGES.map(lr => (
                    <option key={lr} value={lr}>{lr}</option>
                  ))}
                </select>
              </div>
              {catalog ? (
                <div className="text-xs text-[var(--wb-muted)]">
                  {ingredientCount} compatible ingredients in pool for {RECIPE_TYPE_TO_SKILL[recipeType]}
                </div>
              ) : null}
            </div>
          </div>

          <div className="wb-card p-3">
            <div className="mb-3 text-sm font-semibold">Material Tiers</div>
            <div className="grid gap-3">
              <div className="flex gap-2">
                <ChipButton active={matTierMode === 'auto'} onClick={() => setMatTierMode('auto')}>Auto-optimize</ChipButton>
                <ChipButton active={matTierMode === 'manual'} onClick={() => setMatTierMode('manual')}>Manual</ChipButton>
              </div>
              {matTierMode === 'manual' ? (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <FieldLabel>Material 1 Tier</FieldLabel>
                    <div className="flex gap-2">
                      {[1, 2, 3].map(t => (
                        <ChipButton key={t} active={matTier1 === t} onClick={() => setMatTier1(t)}>{t}</ChipButton>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1">
                    <FieldLabel>Material 2 Tier</FieldLabel>
                    <div className="flex gap-2">
                      {[1, 2, 3].map(t => (
                        <ChipButton key={t} active={matTier2 === t} onClick={() => setMatTier2(t)}>{t}</ChipButton>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {isWeapon ? (
            <div className="wb-card p-3">
              <div className="mb-3 text-sm font-semibold">Attack Speed</div>
              <div className="grid gap-3">
                <div className="flex gap-2">
                  <ChipButton active={atkSpdMode === 'auto'} onClick={() => setAtkSpdMode('auto')}>Auto-optimize</ChipButton>
                  <ChipButton active={atkSpdMode === 'manual'} onClick={() => setAtkSpdMode('manual')}>Manual</ChipButton>
                </div>
                {atkSpdMode === 'manual' ? (
                  <div className="flex gap-2">
                    {CRAFTED_ATK_SPEEDS.map(s => (
                      <ChipButton key={s} active={atkSpd === s} onClick={() => setAtkSpd(s)}>{s}</ChipButton>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="wb-card p-3">
            <div className="mb-3 text-sm font-semibold">Optimization Goal</div>
            <div className="flex flex-wrap gap-2">
              {PRESET_ORDER.map(p => (
                <ChipButton key={p} active={preset === p} onClick={() => setPreset(p)}>
                  {PRESET_LABELS[p]}
                </ChipButton>
              ))}
            </div>
          </div>

          <div className="wb-card p-3">
            <div className="mb-3 text-sm font-semibold">Ingredient Constraints</div>
            <div className="grid gap-3">
              <div>
                <FieldLabel>Must-Include Ingredients (comma-separated)</FieldLabel>
                <textarea
                  className="wb-textarea min-h-16"
                  value={mustIncludeText}
                  onChange={(e) => setMustIncludeText(e.target.value)}
                  placeholder="e.g. Blueshift Beacon, Depurinated Genome"
                />
              </div>
              <div>
                <FieldLabel>Excluded Ingredients (comma-separated)</FieldLabel>
                <textarea
                  className="wb-textarea min-h-16"
                  value={excludeText}
                  onChange={(e) => setExcludeText(e.target.value)}
                  placeholder="Blacklist ingredient names"
                />
              </div>
            </div>
          </div>

          <div className="wb-card p-3">
            <details className="group">
              <summary className="cursor-pointer text-sm font-semibold">Advanced: Stat Thresholds</summary>
              <div className="mt-3 grid gap-3">
                <div className="text-xs text-[var(--wb-muted)]">
                  Set minimum / maximum targets for specific stats on the crafted item.
                </div>
                {thresholds.map(row => (
                  <div key={row.id} className="rounded-lg border border-[var(--wb-border-muted)] p-2">
                    <div className="flex flex-col gap-2">
                      <div>
                        <FieldLabel>Stat</FieldLabel>
                        <select
                          className="wb-select w-full"
                          value={row.key}
                          onChange={(e) => setThresholds(prev => prev.map(r => r.id === row.id ? { ...r, key: e.target.value } : r))}
                        >
                          {CRAFTABLE_STAT_KEYS.map(key => (
                            <option key={key} value={key}>{formatStatLabel(key)} ({key})</option>
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
                              setThresholds(prev => prev.map(r => r.id === row.id ? { ...r, min: raw === '' ? null : Number(raw) } : r));
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
                              setThresholds(prev => prev.map(r => r.id === row.id ? { ...r, max: raw === '' ? null : Number(raw) } : r));
                            }}
                          />
                        </div>
                        <Button variant="ghost" className="shrink-0" onClick={() => setThresholds(prev => prev.filter(r => r.id !== row.id))}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                <div>
                  <Button
                    variant="ghost"
                    onClick={() => setThresholds(prev => [...prev, { id: thresholdSeqRef.current++, key: CRAFTABLE_STAT_KEYS[0], min: null, max: null }])}
                  >
                    Add Threshold
                  </Button>
                </div>
              </div>
            </details>
          </div>

          <div className="wb-card p-3">
            <details className="group">
              <summary className="cursor-pointer text-sm font-semibold">Search Heuristics</summary>
              <div className="mt-3 grid gap-3">
                <NumberField label="Beam Width" value={beamWidth} onChange={(v) => setBeamWidth(v ?? DEFAULT_RECIPE_SOLVER_CONSTRAINTS.beamWidth)} min={20} max={3000} />
                <NumberField label="Top K per Slot" value={topKPerSlot} onChange={(v) => setTopKPerSlot(v ?? DEFAULT_RECIPE_SOLVER_CONSTRAINTS.topKPerSlot)} min={10} max={300} />
                <NumberField label="Top N Results" value={topN} onChange={(v) => setTopN(v ?? DEFAULT_RECIPE_SOLVER_CONSTRAINTS.topN)} min={1} max={100} />
              </div>
            </details>
          </div>
        </div>

        {/* Right: Results */}
        <div className="h-full min-h-0 min-w-0">
          <div className="wb-card flex h-full min-h-0 flex-col overflow-hidden p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Candidates</div>
              <div className="text-xs text-[var(--wb-muted)]">{results.length} shown</div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1 wb-scrollbar">
              {results.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--wb-border)] p-4 text-sm text-[var(--wb-muted)]">
                  Run Recipe Solver to find optimal ingredient combinations.
                </div>
              ) : (
                results.map((candidate, index) => (
                  <CandidateCard
                    key={`${candidate.hash}-${index}`}
                    candidate={candidate}
                    index={index}
                    catalog={catalog}
                    copiedHash={copiedHash}
                    onCopyHash={copyHash}
                    onEquipCraft={props.onEquipCraft}
                  />
                ))
              )}
            </div>

            {error ? (
              <div className="mt-2 rounded-xl border border-rose-400/30 bg-rose-400/8 p-2 text-xs text-rose-100">
                {error}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function getCrafterUrl(hash: string): string {
  const raw = hash.startsWith('CR-') ? hash.slice(3) : hash;
  return `../crafter/#${raw}`;
}


function CandidateCard(props: {
  candidate: RecipeSolverCandidate;
  index: number;
  catalog: RecipeCatalogSnapshot | null;
  copiedHash: string | null;
  onCopyHash: (hash: string) => void;
  onEquipCraft?: (slot: ItemSlot, info: CraftedSlotInfo) => void;
}) {
  const { candidate, index, catalog } = props;
  const { stats, scoreBreakdown } = candidate;

  const ingredientNames = candidate.ingredientIds.map(id => {
    const ing = catalog?.ingredientsById.get(id);
    return ing?.displayName ?? ing?.name ?? `#${id}`;
  });

  const keyStats: Array<{ label: string; value: string | number }> = [];
  for (const [key, val] of Object.entries(stats.maxRolls)) {
    if (val !== 0) {
      keyStats.push({ label: formatStatLabel(key), value: val > 0 ? `+${val}` : `${val}` });
    }
  }
  keyStats.sort((a, b) => {
    const av = typeof a.value === 'string' ? parseInt(a.value) : a.value;
    const bv = typeof b.value === 'string' ? parseInt(b.value) : b.value;
    return Math.abs(bv) - Math.abs(av);
  });

  const openInCrafter = () => {
    window.open(getCrafterUrl(candidate.hash), '_blank', 'noopener,noreferrer');
  };

  const targetSlot = RECIPE_TYPE_TO_SLOT[stats.type.toLowerCase()] ?? null;

  const handleUseInBuild = () => {
    if (targetSlot && props.onEquipCraft) {
      props.onEquipCraft(targetSlot, {
        hash: candidate.hash,
        type: stats.type,
        category: stats.category,
        lvl: stats.lvl,
      });
    }
  };

  return (
    <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">
            #{index + 1} | Score {Math.round(candidate.score)}
          </div>
          <div className="mt-1 text-xs text-[var(--wb-muted)]">
            Off {Math.round(scoreBreakdown.offense)} | Def {Math.round(scoreBreakdown.defense)}
            {' | '}Util {Math.round(scoreBreakdown.utility)} | SP {Math.round(scoreBreakdown.skillPoints)}
            {scoreBreakdown.reqPenalty > 0 ? ` | Req -${Math.round(scoreBreakdown.reqPenalty)}` : ''}
          </div>
          <div className="mt-1 text-xs text-[var(--wb-muted)]">
            Mat Tiers: {candidate.matTiers[0]}/{candidate.matTiers[1]}
            {stats.category === 'weapon' ? ` | Atk Spd: ${candidate.atkSpd}` : ''}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <Button
            className="px-2 py-1 text-xs"
            onClick={() => props.onCopyHash(candidate.hash)}
          >
            {props.copiedHash === candidate.hash ? 'Copied!' : 'Copy Hash'}
          </Button>
          <Button
            variant="ghost"
            className="px-2 py-1 text-xs"
            onClick={openInCrafter}
          >
            Open in Crafter
          </Button>
          {targetSlot ? (
            <Button
              className="border border-emerald-400/40 bg-emerald-400/15 px-2 py-1 text-xs text-emerald-100 hover:bg-emerald-400/25"
              onClick={handleUseInBuild}
            >
              Use in Build
            </Button>
          ) : null}
        </div>
      </div>

      {/* Ingredient Grid: 3x2 */}
      <div className="mt-2">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--wb-muted)]">Ingredients (3x2 grid)</div>
        <div className="grid grid-cols-2 gap-1">
          {ingredientNames.map((name, i) => (
            <div
              key={i}
              className="rounded-md border border-[var(--wb-border-muted)] bg-black/10 px-2 py-1 text-xs"
            >
              <div className="truncate">{name}</div>
              <div className="text-[10px] text-[var(--wb-muted)]">
                Eff: {candidate.effectiveness[i]}%
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Key Stats */}
      {keyStats.length > 0 ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--wb-muted)]">Stats (max rolls)</div>
          <div className="flex flex-wrap gap-1">
            {keyStats.slice(0, 12).map(({ label, value }) => {
              const isPositive = typeof value === 'string' ? value.startsWith('+') : value > 0;
              return (
                <span
                  key={label}
                  className={`rounded px-1.5 py-0.5 text-[11px] ${isPositive ? 'bg-emerald-400/15 text-emerald-200' : 'bg-rose-400/15 text-rose-200'}`}
                >
                  {label}: {value}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Extra info for armor/consumable */}
      {stats.category === 'armor' ? (
        <div className="mt-1 text-xs text-[var(--wb-muted)]">
          HP: {stats.hpLow}-{stats.hp} | Dur: {stats.durability[0]}-{stats.durability[1]}
          | Reqs: [{stats.reqs.join(', ')}]
        </div>
      ) : null}
      {stats.category === 'consumable' ? (
        <div className="mt-1 text-xs text-[var(--wb-muted)]">
          Duration: {stats.duration[0]}-{stats.duration[1]}s | Charges: {stats.charges}
        </div>
      ) : null}
      {stats.category === 'weapon' ? (
        <div className="mt-1 text-xs text-[var(--wb-muted)]">
          nDam: {stats.nDam} | Dur: {stats.durability[0]}-{stats.durability[1]}
          | Reqs: [{stats.reqs.join(', ')}]
        </div>
      ) : null}
    </div>
  );
}
