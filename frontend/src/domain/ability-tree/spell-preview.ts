import type { AbilityTreeClassTree, AbilityTreeEvaluation, AbilityTreeNode } from '@/domain/ability-tree/types';
import { evaluateBuildSkillpointFeasibility } from '@/domain/build/build-metrics';
import type { WorkbenchSnapshot } from '@/domain/build/types';
import type { CatalogSnapshot, NormalizedItem } from '@/domain/items/types';
import { ITEM_SLOTS } from '@/domain/items/types';

type SkillVec = [number, number, number, number, number];

type LegacySpellPart =
  | {
      name: string;
      type?: 'damage';
      multipliers: number[];
      display?: boolean;
      use_str?: boolean;
      ignored_mults?: string[];
    }
  | {
      name: string;
      type?: 'heal';
      power: number;
      display?: boolean;
    }
  | {
      name: string;
      type?: 'total';
      hits: Record<string, number>;
      display?: boolean;
    };

interface LegacySpell {
  type?: string;
  name: string;
  cost?: number;
  base_spell: number;
  scaling?: 'spell' | 'melee' | string;
  use_atkspd?: boolean;
  display?: string;
  parts: LegacySpellPart[];
}

interface MergedAbilityLite {
  id: number;
  baseAbilityId: number | null;
  properties: Record<string, unknown>;
  effects: Array<Record<string, unknown>>;
}

class LegacyStatsLite {
  private numeric = new Map<string, number>();
  private maps = new Map<string, Map<string, number>>();

  get(name: string): number | Map<string, number> {
    if (this.maps.has(name)) return this.maps.get(name)!;
    return this.numeric.get(name) ?? 0;
  }

  getNum(name: string): number {
    const value = this.get(name);
    return typeof value === 'number' ? value : 0;
  }

  has(name: string): boolean {
    return this.maps.has(name) || this.numeric.has(name);
  }

  add(name: string, value: number): void {
    if (!Number.isFinite(value) || value === 0) return;
    this.numeric.set(name, (this.numeric.get(name) ?? 0) + value);
  }

  set(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    this.numeric.set(name, value);
  }

  getMap(name: string): Map<string, number> {
    let map = this.maps.get(name);
    if (!map) {
      map = new Map<string, number>();
      this.maps.set(name, map);
    }
    return map;
  }

  addMap(name: string, key: string, value: number): void {
    if (!Number.isFinite(value) || value === 0) return;
    const map = this.getMap(name);
    map.set(key, (map.get(key) ?? 0) + value);
  }
}

interface WeaponLegacyLite {
  atkSpd: string;
  type: string;
  tier: string;
  damages: Array<[number, number]>; // NETWFA
  damagePresent: boolean[];
}

type DamageElementId = (typeof DAMAGE_ELEMENTS)[number];

interface SpellDamagePartResult {
  type: 'damage' | 'heal';
  name: string;
  display: boolean;
  averageNonCrit?: number;
  averageCrit?: number;
  averageTotal?: number;
  normalTotal?: [number, number];
  critTotal?: [number, number];
  healAmount?: number;
  dominantElement?: DamageElementId;
}

export interface WorkbenchSpellSummary {
  baseSpell: number;
  name: string;
  displayPartName: string;
  averageDisplayValue: number;
  isHealing: boolean;
  manaCost: number | null;
   // dominant element for display (n/e/t/w/f/a), null for pure neutral or healing
  dominantElement: DamageElementId | null;
  parts: SpellDamagePartResult[];
}

export interface WorkbenchSpellPreviewResult {
  melee: {
    perAttackAverage: number;
    dps: number;
    attackSpeedTier: string;
  } | null;
  spells: WorkbenchSpellSummary[];
  notes: string[];
}

const SKP_ORDER = ['str', 'dex', 'int', 'def', 'agi'] as const;
const SKP_ELEMENTS = ['e', 't', 'w', 'f', 'a'] as const;
const DAMAGE_ELEMENTS = ['n', ...SKP_ELEMENTS] as const; // NETWFA
const ATTACK_SPEEDS = ['SUPER_SLOW', 'VERY_SLOW', 'SLOW', 'NORMAL', 'FAST', 'VERY_FAST', 'SUPER_FAST'] as const;
const BASE_DAMAGE_MULTIPLIER = [0.51, 0.83, 1.5, 2.05, 2.5, 3.1, 4.3] as const;
const SKILLPOINT_DAMAGE_MULT = [1, 1, 1, 0.867, 0.951] as const;
const SKILLPOINT_FINAL_MULT = [1, 1, 0.5 / skillPointsToPercentage(150), 0.867, 0.951] as const;
const DAMAGE_KEYS = ['nDam', 'eDam', 'tDam', 'wDam', 'fDam', 'aDam'] as const; // order matches NETWFA
const DISPLAY_ATTACK_SPEEDS = ['Super Slow', 'Very Slow', 'Slow', 'Normal', 'Fast', 'Very Fast', 'Super Fast'] as const;

const NUMERIC_STAT_KEYS = [
  'str',
  'dex',
  'int',
  'def',
  'agi',
  'sdPct',
  'sdRaw',
  'mdPct',
  'mdRaw',
  'atkTier',
  'damPct',
  'damRaw',
  'rSdPct',
  'rSdRaw',
  'rMdPct',
  'rMdRaw',
  'rDamPct',
  'rDamRaw',
  'critDamPct',
  'healPct',
  'spPct1',
  'spPct2',
  'spPct3',
  'spPct4',
  'spRaw1',
  'spRaw2',
  'spRaw3',
  'spRaw4',
  'spPct1Final',
  'spPct2Final',
  'spPct3Final',
  'spPct4Final',
  'nSdPct',
  'eSdPct',
  'tSdPct',
  'wSdPct',
  'fSdPct',
  'aSdPct',
  'nMdPct',
  'eMdPct',
  'tMdPct',
  'wMdPct',
  'fMdPct',
  'aMdPct',
  'nDamPct',
  'eDamPct',
  'tDamPct',
  'wDamPct',
  'fDamPct',
  'aDamPct',
  'nSdRaw',
  'eSdRaw',
  'tSdRaw',
  'wSdRaw',
  'fSdRaw',
  'aSdRaw',
  'nMdRaw',
  'eMdRaw',
  'tMdRaw',
  'wMdRaw',
  'fMdRaw',
  'aMdRaw',
  'nDamRaw',
  'eDamRaw',
  'tDamRaw',
  'wDamRaw',
  'fDamRaw',
  'aDamRaw',
  'nDamAddMin',
  'nDamAddMax',
  'eDamAddMin',
  'eDamAddMax',
  'tDamAddMin',
  'tDamAddMax',
  'wDamAddMin',
  'wDamAddMax',
  'fDamAddMin',
  'fDamAddMax',
  'aDamAddMin',
  'aDamAddMax',
  'rDamAddMin',
  'rDamAddMax',
  'damAddMin',
  'damAddMax',
  'hp',
  'hpBonus',
  'defMult',
] as const;

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function skillPointsToPercentage(skp: number): number {
  if (skp <= 0) return 0;
  let value = skp;
  if (value >= 150) value = 150;
  const r = 0.9908;
  return (r / (1 - r) * (1 - Math.pow(r, value))) / 100;
}

function levelToBaseHp(level: number): number {
  const clamped = Math.max(1, Math.min(106, Math.round(level || 1)));
  return clamped * 5 + 5;
}

function parseDamageRange(raw: unknown): [number, number] {
  if (Array.isArray(raw) && raw.length >= 2) {
    return [asNumber(raw[0]), asNumber(raw[1])];
  }
  if (typeof raw === 'string') {
    const match = raw.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
    if (match) return [Number(match[1]), Number(match[2])];
  }
  return [0, 0];
}

function parseWeaponFromItem(item: NormalizedItem): WeaponLegacyLite | null {
  if (item.category !== 'weapon') return null;
  const raw = item.legacyRaw ?? {};
  const damages = DAMAGE_KEYS.map((key) => parseDamageRange(raw[key]));
  const damagePresent = damages.map(([min, max]) => min !== 0 || max !== 0);
  return {
    atkSpd: typeof raw.atkSpd === 'string' && raw.atkSpd ? raw.atkSpd : item.atkSpd,
    type: item.type,
    tier: typeof raw.tier === 'string' ? raw.tier : item.tier,
    damages,
    damagePresent,
  };
}

function getDefaultMeleeSpellForWeaponType(weaponType: string): LegacySpell {
  switch (weaponType) {
    case 'bow':
      return {
        type: 'replace_spell',
        name: 'Bow Shot',
        base_spell: 0,
        scaling: 'melee',
        use_atkspd: false,
        display: 'Single Shot',
        parts: [{ name: 'Single Shot', multipliers: [100, 0, 0, 0, 0, 0] }],
      };
    case 'relik':
      return {
        type: 'replace_spell',
        name: 'Relik Melee',
        base_spell: 0,
        scaling: 'melee',
        use_atkspd: false,
        display: 'Total',
        parts: [
          { name: 'Single Beam', multipliers: [33, 0, 0, 0, 0, 0] },
          { name: 'Total', hits: { 'Single Beam': 3 } },
        ],
      };
    case 'wand':
      return {
        type: 'replace_spell',
        name: 'Wand Melee',
        base_spell: 0,
        scaling: 'melee',
        use_atkspd: false,
        display: 'Melee',
        parts: [{ name: 'Melee', multipliers: [100, 0, 0, 0, 0, 0] }],
      };
    case 'spear':
    case 'dagger':
    default:
      return {
        type: 'replace_spell',
        name: 'Melee',
        base_spell: 0,
        scaling: 'melee',
        use_atkspd: false,
        display: 'Melee',
        parts: [{ name: 'Melee', multipliers: [100, 0, 0, 0, 0, 0] }],
      };
  }
}

function cloneDeep<T>(value: T): T {
  return structuredClone(value);
}

function atreeTranslate(merged: Map<number, MergedAbilityLite>, value: unknown): number {
  if (typeof value === 'string') {
    const [idStr, propName] = value.split('.');
    const id = Number(idStr);
    if (!Number.isFinite(id) || !propName) return 0;
    const abil = merged.get(id);
    return asNumber(abil?.properties?.[propName]);
  }
  return asNumber(value);
}

function mergeActiveAbilities(tree: AbilityTreeClassTree, evaluation: AbilityTreeEvaluation): Map<number, MergedAbilityLite> {
  const activeSet = new Set(evaluation.activeIds);
  const merged = new Map<number, MergedAbilityLite>();

  const mergeOne = (node: AbilityTreeNode) => {
    const abil: MergedAbilityLite = {
      id: node.id,
      baseAbilityId: node.baseAbilityId ?? null,
      properties: cloneDeep(node.properties ?? {}),
      effects: cloneDeep(node.effects ?? []),
    };
    if (abil.baseAbilityId != null && merged.has(abil.baseAbilityId)) {
      const base = merged.get(abil.baseAbilityId)!;
      base.effects = base.effects.concat(abil.effects);
      for (const [key, value] of Object.entries(abil.properties)) {
        base.properties[key] = asNumber(base.properties[key]) + asNumber(value);
      }
      return;
    }
    merged.set(abil.id, abil);
  };

  for (const node of tree.nodes) {
    if (!activeSet.has(node.id)) continue;
    mergeOne(node);
  }

  return merged;
}

function collectSpellsFromMergedAbilities(merged: Map<number, MergedAbilityLite>, seedSpells: LegacySpell[] = []): Map<number, LegacySpell> {
  const spells = new Map<number, LegacySpell>();
  for (const seed of seedSpells) {
    spells.set(seed.base_spell, cloneDeep(seed));
  }

  for (const [, abil] of merged) {
    for (const effect of abil.effects) {
      if (effect.type !== 'replace_spell') continue;
      const baseSpell = asNumber(effect.base_spell, Number.NaN);
      if (!Number.isFinite(baseSpell)) continue;
      const incoming = cloneDeep(effect) as unknown as LegacySpell;
      let retSpell = spells.get(baseSpell);
      if (!retSpell) {
        retSpell = incoming;
        spells.set(baseSpell, retSpell);
      } else {
        for (const [key, value] of Object.entries(incoming)) {
          ((retSpell as unknown) as Record<string, unknown>)[key] = cloneDeep(value);
        }
      }
      for (const part of retSpell.parts ?? []) {
        const hits = (part as { hits?: Record<string, unknown> }).hits;
        if (!hits) continue;
        for (const [k, v] of Object.entries(hits)) {
          (hits as Record<string, number>)[k] = atreeTranslate(merged, v);
        }
      }
    }
  }

  for (const [, abil] of merged) {
    for (const effect of abil.effects) {
      const effectType = typeof effect.type === 'string' ? effect.type : '';
      if (effectType === 'replace_spell') continue;
      if (effectType === 'add_spell_prop') {
        const baseSpell = asNumber(effect.base_spell, Number.NaN);
        if (!Number.isFinite(baseSpell) || !spells.has(baseSpell)) continue;
        const retSpell = spells.get(baseSpell)!;
        const targetPart = typeof effect.target_part === 'string' ? effect.target_part : null;
        const behavior = typeof effect.behavior === 'string' ? effect.behavior : 'merge';
        const costDelta = asNumber(effect.cost);
        if (typeof retSpell.cost === 'number') retSpell.cost += costDelta;
        if (!targetPart) continue;

        let foundPart = false;
        for (const part of retSpell.parts) {
          if (part.name !== targetPart) continue;
          if ('multipliers' in effect && Array.isArray(effect.multipliers) && 'multipliers' in part) {
            for (let i = 0; i < effect.multipliers.length; i++) {
              const v = asNumber(effect.multipliers[i]);
              if (!Array.isArray(part.multipliers)) continue;
              if (behavior === 'overwrite') part.multipliers[i] = v;
              else part.multipliers[i] = (part.multipliers[i] ?? 0) + v;
            }
          } else if ('power' in effect && 'power' in part) {
            const v = asNumber(effect.power);
            part.power = behavior === 'overwrite' ? v : asNumber(part.power) + v;
          } else if ('hits' in effect && typeof effect.hits === 'object' && effect.hits && 'hits' in part) {
            for (const [subName, rawVal] of Object.entries(effect.hits as Record<string, unknown>)) {
              const v = atreeTranslate(merged, rawVal);
              if (behavior === 'overwrite') {
                part.hits[subName] = v;
              } else {
                part.hits[subName] = (part.hits[subName] ?? 0) + v;
              }
            }
          }
          if ('hide' in effect) part.display = false;
          if ('ignored_mults' in effect) {
            const list = Array.isArray(effect.ignored_mults) ? effect.ignored_mults.filter((v): v is string => typeof v === 'string') : [];
            if ('ignored_mults' in part && Array.isArray(part.ignored_mults)) part.ignored_mults.push(...list);
            else if ('multipliers' in part) part.ignored_mults = list;
          }
          foundPart = true;
          break;
        }
        if (!foundPart && behavior === 'merge') {
          const spellPart = cloneDeep(effect) as Record<string, unknown>;
          spellPart.name = targetPart;
          if (typeof spellPart.hits === 'object' && spellPart.hits) {
            for (const [k, v] of Object.entries(spellPart.hits as Record<string, unknown>)) {
              (spellPart.hits as Record<string, number>)[k] = atreeTranslate(merged, v);
            }
          }
          if ('hide' in effect) spellPart.display = false;
          retSpell.parts.push(spellPart as unknown as LegacySpellPart);
        }
        if (typeof effect.display === 'string') retSpell.display = effect.display;
      } else if (effectType === 'convert_spell_conv') {
        const baseSpell = asNumber(effect.base_spell, Number.NaN);
        if (!Number.isFinite(baseSpell) || !spells.has(baseSpell)) continue;
        const retSpell = spells.get(baseSpell)!;
        const targetPart = typeof effect.target_part === 'string' ? effect.target_part : 'all';
        const conversion = typeof effect.conversion === 'string' ? effect.conversion : '';
        const elemIdx = DAMAGE_ELEMENTS.indexOf(conversion as (typeof DAMAGE_ELEMENTS)[number]);
        if (elemIdx < 0) continue;
        const allParts = targetPart === 'all';
        for (const part of retSpell.parts) {
          if (!('multipliers' in part)) continue;
          if (!allParts && part.name !== targetPart) continue;
          const totalConv = part.multipliers.slice(1).reduce((sum, v) => sum + asNumber(v), 0);
          const next = [asNumber(part.multipliers[0]), 0, 0, 0, 0, 0];
          next[elemIdx] = totalConv;
          part.multipliers = next;
        }
      }
    }
  }

  return spells;
}

function applyAtreeRawStats(merged: Map<number, MergedAbilityLite>, stats: LegacyStatsLite, notes: string[]): void {
  let ignoredToggleEffects = false;
  let ignoredScalingEffects = false;
  for (const [, abil] of merged) {
    for (const effect of abil.effects) {
      const type = typeof effect.type === 'string' ? effect.type : '';
      if (type === 'raw_stat') {
        if (effect.toggle) {
          ignoredToggleEffects = true;
          continue;
        }
        const bonuses = Array.isArray(effect.bonuses) ? effect.bonuses : [];
        for (const bonus of bonuses) {
          if (!bonus || typeof bonus !== 'object') continue;
          const kind = typeof bonus.type === 'string' ? bonus.type : '';
          const name = typeof bonus.name === 'string' ? bonus.name : '';
          const value = asNumber((bonus as Record<string, unknown>).value);
          if (!name || value === 0) continue;
          if (kind === 'stat') {
            if (name.startsWith('damMult.')) {
              stats.addMap('damMult', name.slice('damMult.'.length), value);
            } else if (name.startsWith('healMult.')) {
              stats.addMap('healMult', name.slice('healMult.'.length), value);
            } else if (name.startsWith('defMult.')) {
              stats.add('defMult', value);
            } else {
              stats.add(name, value);
            }
          }
        }
        continue;
      }
      if (type === 'stat_scaling') {
        // Requires slider/toggle UI state parity; skipped for now.
        ignoredScalingEffects = true;
      }
    }
  }
  if (ignoredToggleEffects) notes.push('Some ability-tree toggle effects are not applied in Workbench spell damage yet.');
  if (ignoredScalingEffects) notes.push('Some ability-tree scaling/slider effects are not applied in Workbench spell damage yet.');
}

function aggregateItemStatsForSpellPreview(
  snapshot: WorkbenchSnapshot,
  catalog: CatalogSnapshot,
  assignedByStat: SkillVec | null,
): LegacyStatsLite {
  const stats = new LegacyStatsLite();
  for (const key of NUMERIC_STAT_KEYS) stats.set(key, 0);
  stats.getMap('damMult');
  stats.getMap('healMult');

  let totalHpFlat = 0;
  let totalHpBonus = 0;
  let itemSp: SkillVec = [0, 0, 0, 0, 0];
  for (const slot of ITEM_SLOTS) {
    const itemId = snapshot.slots[slot];
    if (itemId == null) continue;
    const item = catalog.itemsById.get(itemId);
    if (!item) continue;
    const raw = item.legacyRaw ?? {};
    for (const key of NUMERIC_STAT_KEYS) {
      stats.add(key, asNumber(raw[key]));
    }
    totalHpFlat += asNumber(raw.hp);
    totalHpBonus += asNumber(raw.hpBonus);
    itemSp = [
      itemSp[0] + asNumber(raw.str),
      itemSp[1] + asNumber(raw.dex),
      itemSp[2] + asNumber(raw.int),
      itemSp[3] + asNumber(raw.def),
      itemSp[4] + asNumber(raw.agi),
    ];
  }

  const assigned = assignedByStat ?? [0, 0, 0, 0, 0];
  stats.set('str', itemSp[0] + assigned[0]);
  stats.set('dex', itemSp[1] + assigned[1]);
  stats.set('int', itemSp[2] + assigned[2]);
  stats.set('def', itemSp[3] + assigned[3]);
  stats.set('agi', itemSp[4] + assigned[4]);
  stats.set('hp', totalHpFlat + totalHpBonus + levelToBaseHp(snapshot.level));

  return stats;
}

function calculateSpellDamageLite(
  stats: LegacyStatsLite,
  weapon: WeaponLegacyLite,
  conversionsInput: number[],
  useSpellDamage: boolean,
  ignoreSpeed = false,
  partFilter?: string,
  ignoreStr = false,
  ignoredMults: string[] = [],
): [[number, number], [number, number], number[][], number[]] {
  const weaponDamages = weapon.damages.map((d) => [...d] as [number, number]);
  const present = [...weapon.damagePresent];
  const conversions = conversionsInput.map((v) => asNumber(v));

  if (!ignoreSpeed) {
    // applied later, same as legacy
  }

  // Legacy supports extra conversion stats; we partially support them if present in stats.
  for (let i = 0; i < DAMAGE_ELEMENTS.length; i++) {
    const suffix = partFilter ? `:${partFilter}` : '';
    const partKey = `${DAMAGE_ELEMENTS[i]}ConvBase${suffix}`;
    if (partFilter && stats.has(partKey)) conversions[i] += stats.getNum(partKey);
    const genericKey = `${DAMAGE_ELEMENTS[i]}ConvBase`;
    if (stats.has(genericKey)) conversions[i] += stats.getNum(genericKey);
  }

  const damages: Array<[number, number]> = [];
  const neutralConvert = (conversions[0] ?? 0) / 100;
  if (neutralConvert === 0) {
    for (let i = 0; i < present.length; i++) present[i] = false;
  }
  let weaponMin = 0;
  let weaponMax = 0;
  for (const damage of weaponDamages) {
    damages.push([damage[0] * neutralConvert, damage[1] * neutralConvert]);
    weaponMin += damage[0];
    weaponMax += damage[1];
  }

  let totalConvert = 0;
  for (let i = 1; i <= 5; i++) {
    const conv = conversions[i] ?? 0;
    if (conv > 0) {
      const frac = conv / 100;
      damages[i][0] += frac * weaponMin;
      damages[i][1] += frac * weaponMax;
      present[i] = true;
      totalConvert += frac;
    }
  }
  totalConvert += neutralConvert;

  if (!ignoreSpeed) {
    const atkIdx = ATTACK_SPEEDS.indexOf((weapon.atkSpd || 'NORMAL') as (typeof ATTACK_SPEEDS)[number]);
    const atkMult = BASE_DAMAGE_MULTIPLIER[atkIdx >= 0 ? atkIdx : 3] ?? BASE_DAMAGE_MULTIPLIER[3];
    for (let i = 0; i < damages.length; i++) {
      damages[i][0] *= atkMult;
      damages[i][1] *= atkMult;
    }
  }

  for (let i = 0; i < DAMAGE_ELEMENTS.length; i++) {
    if (!present[i]) continue;
    const el = DAMAGE_ELEMENTS[i];
    damages[i][0] += stats.getNum(`${el}DamAddMin`);
    damages[i][1] += stats.getNum(`${el}DamAddMax`);
  }

  const specific = useSpellDamage ? 'Sd' : 'Md';
  const skillBoost = [0];
  for (let i = 0; i < SKP_ORDER.length; i++) {
    skillBoost.push(skillPointsToPercentage(stats.getNum(SKP_ORDER[i])) * SKILLPOINT_DAMAGE_MULT[i]);
  }
  const staticBoost = (stats.getNum(`${specific.toLowerCase()}Pct`) + stats.getNum('damPct')) / 100;

  let totalMin = 0;
  let totalMax = 0;
  const saveProp: Array<[number, number]> = [];
  for (let i = 0; i < DAMAGE_ELEMENTS.length; i++) {
    saveProp.push([...damages[i]] as [number, number]);
    totalMin += damages[i][0];
    totalMax += damages[i][1];
    const el = DAMAGE_ELEMENTS[i];
    const damageSpecific = `${el}${specific}Pct`;
    let damageBoost = 1 + (skillBoost[i] ?? 0) + staticBoost + (stats.getNum(damageSpecific) + stats.getNum(`${el}DamPct`)) / 100;
    if (i > 0) {
      damageBoost += (stats.getNum(`r${specific}Pct`) + stats.getNum('rDamPct')) / 100;
    }
    damages[i][0] *= damageBoost;
    damages[i][1] *= damageBoost;
  }

  const totalElemMin = totalMin - saveProp[0][0];
  const totalElemMax = totalMax - saveProp[0][1];
  const propRaw = stats.getNum(`${specific.toLowerCase()}Raw`) + stats.getNum('damRaw');
  const rainbowRaw = stats.getNum(`r${specific}Raw`) + stats.getNum('rDamRaw');
  for (let i = 0; i < damages.length; i++) {
    const save = saveProp[i];
    const el = DAMAGE_ELEMENTS[i];
    let rawBoost = 0;
    if (present[i]) rawBoost += stats.getNum(`${el}${specific}Raw`) + stats.getNum(`${el}DamRaw`);
    let minBoost = rawBoost;
    let maxBoost = rawBoost;
    if (totalMax > 0) {
      minBoost += (totalMin === 0 ? save[1] / totalMax : save[0] / totalMin) * propRaw;
      maxBoost += (save[1] / totalMax) * propRaw;
    }
    if (i !== 0 && totalElemMax > 0) {
      minBoost += (totalElemMin === 0 ? save[1] / totalElemMax : save[0] / totalElemMin) * rainbowRaw;
      maxBoost += (save[1] / totalElemMax) * rainbowRaw;
    }
    damages[i][0] += minBoost * totalConvert;
    damages[i][1] += maxBoost * totalConvert;
  }

  const strBoost = ignoreStr ? 1 : 1 + (skillBoost[1] ?? 0); // earth/str at index 1 in legacy array
  const damMult = stats.getMap('damMult');
  let damageMult = 1;
  const eleDamageMult = [1, 1, 1, 1, 1, 1];
  const multipliedConversions = [...conversions];

  for (const [k, v] of damMult.entries()) {
    if (k.includes(':')) {
      const spellMatch = k.split(':')[1];
      if (spellMatch !== partFilter) continue;
    }
    if (ignoredMults.includes(k)) continue;
    if (k.includes(';')) {
      const elMatch = DAMAGE_ELEMENTS.indexOf(k.split(';')[1] as (typeof DAMAGE_ELEMENTS)[number]);
      if (elMatch !== -1) eleDamageMult[elMatch] *= 1 + v / 100;
    } else {
      damageMult *= 1 + v / 100;
    }
  }

  const critMult = ignoreStr ? 0 : 1 + stats.getNum('critDamPct') / 100;
  const totalDamNorm: [number, number] = [0, 0];
  const totalDamCrit: [number, number] = [0, 0];
  const damageResults: number[][] = [];

  for (let i = 0; i < DAMAGE_ELEMENTS.length; i++) {
    damages[i][0] *= eleDamageMult[i] * damageMult;
    damages[i][1] *= eleDamageMult[i] * damageMult;
    multipliedConversions[i] *= eleDamageMult[i] * damageMult;
    if (damages[i][0] < 0) damages[i][0] = 0;
    if (damages[i][1] < 0) damages[i][1] = 0;
    const res = [
      damages[i][0] * strBoost,
      damages[i][1] * strBoost,
      damages[i][0] * (strBoost + critMult),
      damages[i][1] * (strBoost + critMult),
    ];
    damageResults.push(res);
    totalDamNorm[0] += res[0];
    totalDamNorm[1] += res[1];
    totalDamCrit[0] += res[2];
    totalDamCrit[1] += res[3];
  }

  return [totalDamNorm, totalDamCrit, damageResults, multipliedConversions];
}

type EvalResult =
  | ({
      type: 'damage';
      name: string;
      display: boolean;
      normal_total: [number, number];
      crit_total: [number, number];
    } & Record<string, unknown>)
  | ({
      type: 'heal';
      name: string;
      display: boolean;
      heal_amount: number;
    } & Record<string, unknown>);

function evaluateSpellParts(spell: LegacySpell, stats: LegacyStatsLite, weapon: WeaponLegacyLite): SpellDamagePartResult[] {
  const partMap = new Map<string, { type: 'need_eval'; store: LegacySpellPart } | EvalResult>();
  for (const part of spell.parts) {
    partMap.set(part.name, { type: 'need_eval', store: part });
  }

  const useSpeed = 'use_atkspd' in spell ? Boolean(spell.use_atkspd) : true;
  const useSpell = 'scaling' in spell ? spell.scaling === 'spell' : true;

  const evalPart = (partName: string): EvalResult | null => {
    const dat = partMap.get(partName);
    if (!dat) return null;
    if (dat.type !== 'need_eval') return dat;
    const part = dat.store;
    const partId = `${spell.base_spell}.${part.name}`;
    let result: EvalResult;
    if ('multipliers' in part) {
      const ignored = Array.isArray(part.ignored_mults) ? part.ignored_mults : [];
      const calc = calculateSpellDamageLite(
        stats,
        weapon,
        part.multipliers.map((v) => asNumber(v)),
        useSpell,
        !useSpeed,
        partId,
        part.use_str === false,
        ignored,
      );
      result = {
        type: 'damage',
        name: part.name,
        display: part.display !== false,
        normal_total: calc[0],
        crit_total: calc[1],
        damage_results: calc[2],
      };
    } else if ('power' in part) {
      const healBase = stats.getNum('hp');
      const healMult = 1 + stats.getNum('healPct') / 100;
      result = {
        type: 'heal',
        name: part.name,
        display: part.display !== false,
        heal_amount: asNumber(part.power) * healBase * healMult,
      };
    } else {
      let mode: 'damage' | 'heal' | null = null;
      let normal: [number, number] = [0, 0];
      let crit: [number, number] = [0, 0];
      let heal = 0;
      for (const [subName, hits] of Object.entries(part.hits)) {
        const sub = evalPart(subName);
        if (!sub) continue;
        if (mode && mode !== sub.type) continue;
        mode = sub.type;
        if (sub.type === 'damage') {
          normal = [normal[0] + sub.normal_total[0] * hits, normal[1] + sub.normal_total[1] * hits];
          crit = [crit[0] + sub.crit_total[0] * hits, crit[1] + sub.crit_total[1] * hits];
        } else {
          heal += sub.heal_amount * hits;
        }
      }
      if (mode === 'heal') {
        result = { type: 'heal', name: part.name, display: part.display !== false, heal_amount: heal };
      } else {
        result = { type: 'damage', name: part.name, display: part.display !== false, normal_total: normal, crit_total: crit };
      }
    }
    partMap.set(part.name, result);
    return result;
  };

  const outputs: SpellDamagePartResult[] = [];
  const critChance = skillPointsToPercentage(stats.getNum('dex'));
  for (const part of spell.parts) {
    const res = evalPart(part.name);
    if (!res) continue;
    if (res.type === 'damage') {
      const avgNonCrit = (res.normal_total[0] + res.normal_total[1]) / 2;
      const avgCrit = (res.crit_total[0] + res.crit_total[1]) / 2;
      let dominantElement: DamageElementId | undefined;
      if (Array.isArray((res as unknown as { damage_results?: number[][] }).damage_results)) {
        const damageResults = (res as unknown as { damage_results: number[][] }).damage_results;
        let best = 0;
        for (let i = 1; i < DAMAGE_ELEMENTS.length; i++) {
          const elem = damageResults[i];
          if (!elem) continue;
          const avgElem = (elem[0] + elem[1]) / 2;
          if (avgElem > best) {
            best = avgElem;
            dominantElement = DAMAGE_ELEMENTS[i];
          }
        }
      }
      outputs.push({
        type: 'damage',
        name: res.name,
        display: res.display,
        normalTotal: res.normal_total,
        critTotal: res.crit_total,
        averageNonCrit: avgNonCrit,
        averageCrit: avgCrit,
        averageTotal: (1 - critChance) * avgNonCrit + critChance * avgCrit,
        dominantElement,
      });
    } else {
      outputs.push({
        type: 'heal',
        name: res.name,
        display: res.display,
        healAmount: res.heal_amount,
        averageTotal: res.heal_amount,
      });
    }
  }
  return outputs;
}

function computeLegacyMeleeDps(params: {
  spells: Map<number, LegacySpell>;
  stats: LegacyStatsLite;
  weapon: WeaponLegacyLite;
}): WorkbenchSpellPreviewResult['melee'] {
  const { spells, stats, weapon } = params;
  const meleeSpell = spells.get(0);
  if (!meleeSpell || !Array.isArray(meleeSpell.parts) || meleeSpell.parts.length === 0) return null;
  const parts = evaluateSpellParts(meleeSpell, stats, weapon);
  if (parts.length === 0) return null;
  const displayTarget = (meleeSpell.display || '').trim();
  const displayPart =
    (displayTarget && parts.find((part) => part.name === displayTarget)) ||
    parts.find((part) => part.display) ||
    parts[0];
  if (!displayPart || displayPart.type !== 'damage') return null;

  const perAttackAverage = displayPart.averageTotal ?? 0;
  const baseIndex = ATTACK_SPEEDS.indexOf((weapon.atkSpd || 'NORMAL') as (typeof ATTACK_SPEEDS)[number]);
  const adjustedIndex = Math.max(0, Math.min(ATTACK_SPEEDS.length - 1, (baseIndex >= 0 ? baseIndex : 3) + Math.round(stats.getNum('atkTier'))));
  const dps = perAttackAverage * BASE_DAMAGE_MULTIPLIER[adjustedIndex];
  return {
    perAttackAverage,
    dps,
    attackSpeedTier: DISPLAY_ATTACK_SPEEDS[adjustedIndex],
  };
}

function getSpellCostLite(stats: LegacyStatsLite, spell: LegacySpell): number | null {
  if (typeof spell.cost !== 'number') return null;
  if (spell.base_spell < 1 || spell.base_spell > 4) return null;
  const idx = spell.base_spell;
  let cost = spell.cost * (1 - skillPointsToPercentage(stats.getNum('int')) * SKILLPOINT_FINAL_MULT[2]);
  cost += stats.getNum(`spRaw${idx}`);
  cost = cost * (1 + stats.getNum(`spPct${idx}`) / 100);
  cost = Math.max(1, cost * (1 + stats.getNum(`spPct${idx}Final`) / 100));
  return cost;
}

export function buildWorkbenchSpellPreview(params: {
  catalog: CatalogSnapshot;
  snapshot: WorkbenchSnapshot;
  abilityTreeTree: AbilityTreeClassTree | null;
  abilityTreeEvaluation: AbilityTreeEvaluation | null;
}): WorkbenchSpellPreviewResult | null {
  const { catalog, snapshot, abilityTreeTree, abilityTreeEvaluation } = params;
  if (!abilityTreeTree || !abilityTreeEvaluation) return null;
  const weaponId = snapshot.slots.weapon;
  if (weaponId == null) return null;
  const weaponItem = catalog.itemsById.get(weaponId);
  if (!weaponItem) return null;
  const weapon = parseWeaponFromItem(weaponItem);
  if (!weapon) return null;

  const equippedSlots: Record<(typeof ITEM_SLOTS)[number], number | null> = { ...snapshot.slots };
  const feasibility = evaluateBuildSkillpointFeasibility(equippedSlots, catalog, snapshot.level);
  const stats = aggregateItemStatsForSpellPreview(snapshot, catalog, feasibility.assignedByStat);
  const notes: string[] = [];
  if (!feasibility.feasible) notes.push('Spell preview uses current build state, but skill-point feasibility is invalid.');

  const mergedAbilities = mergeActiveAbilities(abilityTreeTree, abilityTreeEvaluation);
  applyAtreeRawStats(mergedAbilities, stats, notes);
  const spells = collectSpellsFromMergedAbilities(mergedAbilities, [getDefaultMeleeSpellForWeaponType(weapon.type)]);
  const melee = computeLegacyMeleeDps({ spells, stats, weapon });
  if (spells.size === 0) return { melee, spells: [], notes };

  const summaries: WorkbenchSpellSummary[] = [];
  for (const spell of [...spells.values()].sort((a, b) => a.base_spell - b.base_spell)) {
    if (!Array.isArray(spell.parts) || spell.parts.length === 0) continue;
    const parts = evaluateSpellParts(spell, stats, weapon);
    if (parts.length === 0) continue;
    const displayTarget = (spell.display || '').trim();
    const displayPart =
      (displayTarget && parts.find((part) => part.name === displayTarget)) ||
      parts.find((part) => part.display) ||
      parts[0];
    if (!displayPart) continue;
    const isHealing = displayPart.type === 'heal';
    const dominantElement = !isHealing ? displayPart.dominantElement ?? null : null;
    summaries.push({
      baseSpell: spell.base_spell,
      name: spell.name,
      displayPartName: displayPart.name,
      averageDisplayValue: displayPart.averageTotal ?? 0,
      isHealing,
      manaCost: getSpellCostLite(stats, spell),
      dominantElement,
      parts,
    });
  }

  if (abilityTreeEvaluation.activeIds.length > 0 && summaries.length === 0) {
    notes.push('No spell damage entries found in the selected ability tree nodes.');
  }

  return { melee, spells: summaries, notes };
}
