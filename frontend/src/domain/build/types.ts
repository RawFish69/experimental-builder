import type { CharacterClass, ItemCategoryKey, ItemSlot } from '@/domain/items/types';

export type { CharacterClass, ItemCategoryKey, ItemSlot };
export { ITEM_SLOTS, slotLabel, slotToCategory, categoryLabel } from '@/domain/items/types';

export interface SlotRequirementsStatus {
  levelOk: boolean;
  classOk: boolean;
  skillReqsMet: boolean;
}

export interface BuildWarnings {
  messages: string[];
}

export interface AggregatedBuildStats {
  hpTotal: number;
  hprTotal: number;
  mr: number;
  ms: number;
  ls: number;
  speed: number;
  skillPoints: { str: number; dex: number; int: number; def: number; agi: number };
  skillReqs: { str: number; dex: number; int: number; def: number; agi: number };
  defenses: { e: number; t: number; w: number; f: number; a: number };
  offense: {
    baseDps: number;
    spellPct: number;
    spellRaw: number;
    meleePct: number;
    meleeRaw: number;
    elemDamPct: number;   // eDamPct+tDamPct+wDamPct+fDamPct+aDamPct (elemental damage %)
    genericDamPct: number; // damPct+rDamPct+nDamPct (generic damage %)
    offenseScore: number;
  };
}

export interface BuildSummary {
  slotStatus: Partial<Record<ItemSlot, SlotRequirementsStatus>>;
  warnings: BuildWarnings;
  aggregated: AggregatedBuildStats;
  derived: {
    dpsProxy: number;
    spellProxy: number; // spellPct*1.3 + spellRaw*0.12 (Legacy Builder spell damage inputs)
    meleeProxy: number; // baseDps + meleePct*1.1 + meleeRaw*0.12 (Legacy Builder melee damage inputs)
    ehpProxy: number;
    reqTotal: number;
    skillPointTotal: number;
    legacyBaseDps: number;
    legacyEhp: number;
    legacyEhpNoAgi: number;
    skillpointFeasible: boolean;
    assignedSkillPointsRequired: number;
  };
}

export interface ComparePreview {
  itemId: number | null;
  slot: ItemSlot | null;
}

export interface CraftedSlotInfo {
  hash: string;
  type: string;
  category: string;
  lvl: number;
}

export interface WorkbenchSnapshot {
  slots: Record<ItemSlot, number | null>;
  craftedSlots: Partial<Record<ItemSlot, CraftedSlotInfo>>;
  binsByCategory: Record<ItemCategoryKey, number[]>;
  locks: Record<ItemSlot, boolean>;
  level: number;
  characterClass: CharacterClass | null;
  selectedSlot: ItemSlot | null;
  comparePreview: ComparePreview;
  legacyHash: string | null;
}

export interface WorkbenchBuildState extends WorkbenchSnapshot {
  undoStack: WorkbenchSnapshot[];
  redoStack: WorkbenchSnapshot[];
}

export interface DecodedLegacyBuild {
  legacyHash: string;
  level: number | null;
  slots: Partial<Record<ItemSlot, string>>;
  sourceUrl?: string;
}
