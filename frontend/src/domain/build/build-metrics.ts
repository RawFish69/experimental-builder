import type { CatalogSnapshot, NormalizedItem } from '@/domain/items/types';
import { getClassFromWeaponType } from '@/domain/items/types';
import type { BuildSummary, WorkbenchSnapshot } from '@/domain/build/types';
import { ITEM_SLOTS, slotToCategory } from '@/domain/items/types';

const EMPTY_SUMMARY: BuildSummary = {
  slotStatus: {},
  warnings: { messages: [] },
  aggregated: {
    hpTotal: 0,
    hprTotal: 0,
    mr: 0,
    ms: 0,
    ls: 0,
    speed: 0,
    skillPoints: { str: 0, dex: 0, int: 0, def: 0, agi: 0 },
    skillReqs: { str: 0, dex: 0, int: 0, def: 0, agi: 0 },
    defenses: { e: 0, t: 0, w: 0, f: 0, a: 0 },
    offense: {
      baseDps: 0,
      spellPct: 0,
      spellRaw: 0,
      meleePct: 0,
      meleeRaw: 0,
      elemDamPct: 0,
      genericDamPct: 0,
      offenseScore: 0,
    },
  },
  derived: {
    dpsProxy: 0,
    spellProxy: 0,
    meleeProxy: 0,
    ehpProxy: 0,
    reqTotal: 0,
    skillPointTotal: 0,
    legacyBaseDps: 0,
    legacyEhp: 0,
    legacyEhpNoAgi: 0,
    skillpointFeasible: true,
    assignedSkillPointsRequired: 0,
  },
};

export interface BuildEvaluationInput {
  slots: Record<(typeof ITEM_SLOTS)[number], number | null>;
  level: number;
  characterClass: WorkbenchSnapshot['characterClass'];
}

type SkillVec = [number, number, number, number, number];

interface EquipFeasibilityResult {
  feasible: boolean;
  assignedTotal: number;
  assignedByStat: SkillVec | null;
}

interface SkillpointFeasibilityOptions {
  extraBaseSkillPoints?: SkillVec;
}

// Ported from legacy builder build_utils.js / builder_graph.js to keep Workbench EHP
// aligned with Wynnbuilder's displayed defense metric semantics (ability tree excluded).
function skillPointsToPercentage(skillPoints: number): number {
  let skp = Number.isFinite(skillPoints) ? skillPoints : 0;
  if (skp <= 0) return 0;
  if (skp >= 150) skp = 150;
  const r = 0.9908;
  return (r / (1 - r) * (1 - Math.pow(r, skp))) / 100;
}

const DEFENSE_MULT_SCALE = 0.867;
const AGILITY_MULT_SCALE = 0.951;
const DEFAULT_AGI_DEF_CAP = 90;

function levelToBaseHp(level: number): number {
  const clamped = Math.max(1, Math.min(106, Math.round(level || 1)));
  return clamped * 5 + 5;
}

function levelToAvailableSkillPoints(level: number): number {
  const clamped = Math.max(1, Math.min(106, Math.round(level || 1)));
  if (clamped >= 101) return 200;
  return (clamped - 1) * 2;
}

function classDefenseMultiplierFromWeaponType(weaponType: string | null): number {
  switch (weaponType) {
    case 'relik':
      return 0.6;
    case 'bow':
      return 0.7;
    case 'wand':
      return 0.8;
    case 'dagger':
    case 'spear':
      return 1.0;
    default:
      return 1.0;
  }
}

function computeLegacyEhp(params: {
  totalHp: number;
  defSkillPoints: number;
  agiSkillPoints: number;
  weaponType: string | null;
}): { withAgi: number; noAgi: number } {
  const totalHp = Math.max(5, params.totalHp);
  const defPct = skillPointsToPercentage(params.defSkillPoints) * DEFENSE_MULT_SCALE;
  const agiPct = skillPointsToPercentage(params.agiSkillPoints) * AGILITY_MULT_SCALE;
  const classDef = classDefenseMultiplierFromWeaponType(params.weaponType);
  const defMult = 2 - classDef; // legacy builder starts from class multiplier then applies external defMults
  const agiReduction = (100 - DEFAULT_AGI_DEF_CAP) / 100;
  const denominatorWithAgi = agiReduction * agiPct + (1 - agiPct) * (1 - defPct);
  const denominatorNoAgi = 1 - defPct;

  // Guard against invalid/zero denominators if weird data slips through.
  const withAgi = totalHp / Math.max(1e-9, denominatorWithAgi) / Math.max(1e-9, defMult);
  const noAgi = totalHp / Math.max(1e-9, denominatorNoAgi) / Math.max(1e-9, defMult);
  return { withAgi, noAgi };
}

function itemReqVector(item: NormalizedItem): SkillVec {
  return [item.numeric.reqStr, item.numeric.reqDex, item.numeric.reqInt, item.numeric.reqDef, item.numeric.reqAgi];
}

function itemBonusVector(item: NormalizedItem): SkillVec {
  return [item.numeric.spStr, item.numeric.spDex, item.numeric.spInt, item.numeric.spDef, item.numeric.spAgi];
}

function vecAdd(a: SkillVec, b: SkillVec): SkillVec {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3], a[4] + b[4]];
}

function vecTotal(a: SkillVec): number {
  return a[0] + a[1] + a[2] + a[3] + a[4];
}

function dominatesAssignedVec(a: SkillVec, b: SkillVec): boolean {
  for (let i = 0; i < 5; i++) {
    if (a[i] > b[i]) return false;
  }
  return true;
}

interface ExactFeasibilityState {
  assigned: SkillVec;
  assignedTotal: number;
}

function pushParetoState(frontier: ExactFeasibilityState[], candidate: ExactFeasibilityState): void {
  for (const existing of frontier) {
    if (dominatesAssignedVec(existing.assigned, candidate.assigned)) {
      return;
    }
  }
  for (let i = frontier.length - 1; i >= 0; i--) {
    if (dominatesAssignedVec(candidate.assigned, frontier[i].assigned)) {
      frontier.splice(i, 1);
    }
  }
  frontier.push(candidate);
}

function estimateEquipFeasibility(items: NormalizedItem[], level: number, options: SkillpointFeasibilityOptions = {}): EquipFeasibilityResult {
  if (items.length === 0) return { feasible: true, assignedTotal: 0, assignedByStat: [0, 0, 0, 0, 0] };

  const available = levelToAvailableSkillPoints(level);
  const extraBase = options.extraBaseSkillPoints ?? [0, 0, 0, 0, 0];
  const n = items.length;
  const reqs = items.map(itemReqVector);
  const bonuses = items.map(itemBonusVector);
  const stateCount = 1 << n;
  const bonusSumByMask: SkillVec[] = Array.from({ length: stateCount }, () => [0, 0, 0, 0, 0] as SkillVec);
  for (let mask = 1; mask < stateCount; mask++) {
    const lsb = mask & -mask;
    const bitIndex = Math.log2(lsb) | 0;
    bonusSumByMask[mask] = vecAdd(bonusSumByMask[mask ^ lsb], bonuses[bitIndex]);
  }

  const frontiers: Array<ExactFeasibilityState[] | undefined> = new Array(stateCount);
  frontiers[0] = [{ assigned: [0, 0, 0, 0, 0], assignedTotal: 0 }];

  for (let mask = 0; mask < stateCount; mask++) {
    const frontier = frontiers[mask];
    if (!frontier || frontier.length === 0) continue;
    const bonusSum = bonusSumByMask[mask];

    for (const state of frontier) {
      for (let i = 0; i < n; i++) {
        if ((mask & (1 << i)) !== 0) continue;

        const nextAssigned: SkillVec = [...state.assigned] as SkillVec;
        let valid = true;
        for (let j = 0; j < 5; j++) {
          const currentTotal = state.assigned[j] + bonusSum[j] + (extraBase[j] ?? 0);
          const required = reqs[i][j];
          if (required > currentTotal) {
            nextAssigned[j] += required - currentTotal;
          }
          if (nextAssigned[j] > 100) {
            valid = false;
            break;
          }
        }
        if (!valid) continue;

        const nextAssignedTotal = vecTotal(nextAssigned);
        if (nextAssignedTotal > available) continue;

        const nextMask = mask | (1 << i);
        const nextFrontier = (frontiers[nextMask] ??= []);
        pushParetoState(nextFrontier, {
          assigned: nextAssigned,
          assignedTotal: nextAssignedTotal,
        });
      }
    }
  }

  const finals = frontiers[stateCount - 1];
  if (!finals || finals.length === 0) return { feasible: false, assignedTotal: Infinity, assignedByStat: null };
  let bestAssignedTotal = Infinity;
  let bestAssigned: SkillVec | null = null;
  for (const state of finals) {
    if (state.assignedTotal < bestAssignedTotal) {
      bestAssignedTotal = state.assignedTotal;
      bestAssigned = [...state.assigned] as SkillVec;
    }
  }
  return {
    feasible: Number.isFinite(bestAssignedTotal),
    assignedTotal: bestAssignedTotal,
    assignedByStat: Number.isFinite(bestAssignedTotal) ? bestAssigned : null,
  };
}

export function evaluateBuildSkillpointFeasibility(
  slots: BuildEvaluationInput['slots'],
  catalog: CatalogSnapshot,
  level: number,
  options: SkillpointFeasibilityOptions = {},
): EquipFeasibilityResult {
  const items: NormalizedItem[] = [];
  for (const slot of ITEM_SLOTS) {
    const itemId = slots[slot];
    if (itemId == null) continue;
    const item = catalog.itemsById.get(itemId);
    if (item) items.push(item);
  }
  return estimateEquipFeasibility(items, level, options);
}

export interface BuildEvaluationOptions {
  skillpointFeasibility?: SkillpointFeasibilityOptions;
}

export function getEquippedItems(input: BuildEvaluationInput, catalog: CatalogSnapshot): Partial<Record<(typeof ITEM_SLOTS)[number], NormalizedItem>> {
  const equipped: Partial<Record<(typeof ITEM_SLOTS)[number], NormalizedItem>> = {};
  for (const slot of ITEM_SLOTS) {
    const id = input.slots[slot];
    if (id == null) continue;
    const item = catalog.itemsById.get(id);
    if (item) equipped[slot] = item;
  }
  return equipped;
}

export function evaluateBuild(input: BuildEvaluationInput, catalog: CatalogSnapshot, options: BuildEvaluationOptions = {}): BuildSummary {
  const equipped = getEquippedItems(input, catalog);
  const summary: BuildSummary = structuredClone(EMPTY_SUMMARY);
  const warnings = summary.warnings.messages;
  let weaponType: string | null = null;

  for (const slot of ITEM_SLOTS) {
    const item = equipped[slot];
    if (!item) continue;

    if (slot === 'weapon') {
      weaponType = item.type;
    }

    summary.aggregated.hpTotal += item.numeric.hp + item.numeric.hpBonus;
    summary.aggregated.hprTotal += item.numeric.hprRaw + item.numeric.hprPct;
    summary.aggregated.mr += item.numeric.mr;
    summary.aggregated.ms += item.numeric.ms;
    summary.aggregated.ls += item.numeric.ls;
    summary.aggregated.speed += item.numeric.spd;

    summary.aggregated.skillPoints.str += item.numeric.spStr;
    summary.aggregated.skillPoints.dex += item.numeric.spDex;
    summary.aggregated.skillPoints.int += item.numeric.spInt;
    summary.aggregated.skillPoints.def += item.numeric.spDef;
    summary.aggregated.skillPoints.agi += item.numeric.spAgi;

    summary.aggregated.skillReqs.str = Math.max(summary.aggregated.skillReqs.str, item.numeric.reqStr);
    summary.aggregated.skillReqs.dex = Math.max(summary.aggregated.skillReqs.dex, item.numeric.reqDex);
    summary.aggregated.skillReqs.int = Math.max(summary.aggregated.skillReqs.int, item.numeric.reqInt);
    summary.aggregated.skillReqs.def = Math.max(summary.aggregated.skillReqs.def, item.numeric.reqDef);
    summary.aggregated.skillReqs.agi = Math.max(summary.aggregated.skillReqs.agi, item.numeric.reqAgi);

    summary.aggregated.defenses.e += item.numeric.eDef;
    summary.aggregated.defenses.t += item.numeric.tDef;
    summary.aggregated.defenses.w += item.numeric.wDef;
    summary.aggregated.defenses.f += item.numeric.fDef;
    summary.aggregated.defenses.a += item.numeric.aDef;

    summary.aggregated.offense.baseDps += item.numeric.baseDps;
    summary.aggregated.offense.spellPct += item.numeric.sdPct;
    summary.aggregated.offense.spellRaw += item.numeric.sdRaw;
    summary.aggregated.offense.meleePct += item.numeric.mdPct;
    summary.aggregated.offense.meleeRaw += item.numeric.mdRaw;
    summary.aggregated.offense.elemDamPct +=
      item.numeric.eDamPct + item.numeric.tDamPct + item.numeric.wDamPct +
      item.numeric.fDamPct + item.numeric.aDamPct;
    summary.aggregated.offense.genericDamPct +=
      item.numeric.damPct + item.numeric.rDamPct + item.numeric.nDamPct;
    summary.aggregated.offense.offenseScore += item.roughScoreFields.offense;

    const classReq = item.classReq;
    const classOk = !classReq || !input.characterClass || classReq === input.characterClass;
    const levelOk = item.level <= input.level;
    const skillReqsMet =
      item.numeric.reqStr <= 100 &&
      item.numeric.reqDex <= 100 &&
      item.numeric.reqInt <= 100 &&
      item.numeric.reqDef <= 100 &&
      item.numeric.reqAgi <= 100;
    summary.slotStatus[slot] = { classOk, levelOk, skillReqsMet };
  }

  if (!input.characterClass && weaponType) {
    input.characterClass = getClassFromWeaponType(weaponType);
  }

  for (const slot of ITEM_SLOTS) {
    const item = equipped[slot];
    if (!item) continue;
    if (slotToCategory(slot) !== item.category) {
      warnings.push(`${slot} contains incompatible item type (${item.type}).`);
    }
    if (item.level > input.level) {
      warnings.push(`${item.displayName} requires level ${item.level}.`);
    }
    if (input.characterClass && item.classReq && item.classReq !== input.characterClass) {
      warnings.push(`${item.displayName} requires ${item.classReq}.`);
    }
    if (item.restricted || item.deprecated) {
      warnings.push(`${item.displayName} is restricted/deprecated.`);
    }
  }

  const reqTotal =
    summary.aggregated.skillReqs.str +
    summary.aggregated.skillReqs.dex +
    summary.aggregated.skillReqs.int +
    summary.aggregated.skillReqs.def +
    summary.aggregated.skillReqs.agi;
  const skillPointTotal =
    summary.aggregated.skillPoints.str +
    summary.aggregated.skillPoints.dex +
    summary.aggregated.skillPoints.int +
    summary.aggregated.skillPoints.def +
    summary.aggregated.skillPoints.agi;

  const equipFeasibility = evaluateBuildSkillpointFeasibility(
    input.slots,
    catalog,
    input.level,
    options.skillpointFeasibility,
  );

  const { spellPct, spellRaw, meleePct, meleeRaw, baseDps, elemDamPct, genericDamPct } = summary.aggregated.offense;
  const sp = summary.aggregated.skillPoints;
  const strPct = skillPointsToPercentage(sp.str);

  // STR multiplies all damage globally (Legacy strBoost = 1 + skill_boost[str]). Other stats (dex/int/def/agi)
  // scale element-specific damage; STR is the main universal damage multiplier.
  const skillMult = 1 + strPct;

  // Spell: (base_dps + spell_raw + base_dps*spell_dmg% + elem_dps*elem_dmg%) * skill mult
  const spellProxy =
    (baseDps * (1 + (spellPct + elemDamPct + genericDamPct) / 100) + spellRaw) * skillMult;

  // Melee: same structure
  const meleeProxy =
    (baseDps * (1 + (meleePct + elemDamPct + genericDamPct) / 100) + meleeRaw) * skillMult;
  const dpsProxy =
    meleeProxy +
    spellProxy +
    summary.aggregated.speed * 0.8;

  const defWeighted =
    summary.aggregated.defenses.e +
    summary.aggregated.defenses.t +
    summary.aggregated.defenses.w +
    summary.aggregated.defenses.f +
    summary.aggregated.defenses.a;
  const ehpProxy =
    summary.aggregated.hpTotal +
    defWeighted * 0.45 +
    summary.aggregated.hprTotal * 2 +
    Math.max(0, summary.aggregated.skillPoints.def) * 12 +
    Math.max(0, summary.aggregated.skillPoints.agi) * 10;

  const legacyBaseDps = summary.aggregated.offense.baseDps;
  const totalHpForLegacy = levelToBaseHp(input.level) + summary.aggregated.hpTotal;
  const legacyEhp = computeLegacyEhp({
    totalHp: totalHpForLegacy,
    defSkillPoints: summary.aggregated.skillPoints.def,
    agiSkillPoints: summary.aggregated.skillPoints.agi,
    weaponType,
  });

  summary.derived = {
    dpsProxy,
    spellProxy,
    meleeProxy,
    ehpProxy,
    reqTotal,
    skillPointTotal,
    legacyBaseDps,
    legacyEhp: legacyEhp.withAgi,
    legacyEhpNoAgi: legacyEhp.noAgi,
    skillpointFeasible: equipFeasibility.feasible,
    assignedSkillPointsRequired: Number.isFinite(equipFeasibility.assignedTotal) ? equipFeasibility.assignedTotal : 0,
  };
  if (!equipFeasibility.feasible) {
    warnings.push(`Skill requirements are not satisfiable at level ${input.level} (estimated assigned SP exceeds available or equip order is invalid).`);
  }
  return summary;
}

export function diffBuildSummary(base: BuildSummary, next: BuildSummary): Record<string, number> {
  return {
    dpsProxy: next.derived.dpsProxy - base.derived.dpsProxy,
    ehpProxy: next.derived.ehpProxy - base.derived.ehpProxy,
    legacyBaseDps: next.derived.legacyBaseDps - base.derived.legacyBaseDps,
    legacyEhp: next.derived.legacyEhp - base.derived.legacyEhp,
    hpTotal: next.aggregated.hpTotal - base.aggregated.hpTotal,
    speed: next.aggregated.speed - base.aggregated.speed,
    skillPointTotal: next.derived.skillPointTotal - base.derived.skillPointTotal,
  };
}
