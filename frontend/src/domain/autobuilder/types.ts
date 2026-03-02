import type { BuildSummary, WorkbenchSnapshot } from '@/domain/build/types';
import type { CharacterClass, ItemSlot } from '@/domain/items/types';

export interface AutoBuilderWeights {
  legacyBaseDps: number;
  legacyEhp: number;
  dpsProxy: number;
  spellProxy: number;  // spellPct*1.3 + spellRaw*0.12 (Legacy Builder spell damage)
  meleeProxy: number; // baseDps + meleePct*1.1 + meleeRaw*0.12 (Legacy Builder melee damage)
  ehpProxy: number;
  speed: number;
  sustain: number;
  skillPointTotal: number;
  reqTotalPenalty: number;
}

export interface AutoBuilderThresholds {
  minLegacyBaseDps?: number;
  minLegacyEhp?: number;
  minDpsProxy?: number;
  minEhpProxy?: number;
  minMr?: number;
  minMs?: number;
  minSpeed?: number;
  minSkillPointTotal?: number;
  maxReqTotal?: number;
  customNumericRanges?: Array<{
    key: string;
    min?: number;
    max?: number;
  }>;
}

export interface AutoBuildConstraints {
  characterClass: CharacterClass | null;
  level: number;
  mustIncludeIds: number[];
  excludedIds: number[];
  lockedSlots: Partial<Record<ItemSlot, boolean>>;
  target: AutoBuilderThresholds;
  allowedTiers: string[];
  requiredMajorIds: string[];
  excludedMajorIds: string[];
  weaponAttackSpeeds: string[];
  attackSpeedConstraintMode: 'or' | 'and';
  skillpointFeasibilityMode: 'no_tomes' | 'guild_rainbow' | 'flexible_2';
  minPowderSlots: number | null;
  onlyPinnedItems: boolean;
  weights: AutoBuilderWeights;
  topN: number;
  topKPerSlot: number;
  beamWidth: number;
  maxStates: number;
  useExhaustiveSmallPool: boolean;
  exhaustiveStateLimit: number;
  allowRestricted: boolean;
  /**
   * When true, scoring is purely constraint-satisfaction based: generic EHP/DPS
   * weights are zeroed and only customNumericRanges + feasibility matter.
   */
  constraintOnlyMode?: boolean;
}

export interface AutoBuildScoreBreakdown {
  legacyBaseDps: number;
  legacyEhp: number;
  dpsProxy: number;
  spellProxy: number;
  meleeProxy: number;
  ehpProxy: number;
  speed: number;
  sustain: number;
  skillPointTotal: number;
  reqPenalty: number;
  thresholdPenalty: number;
}

export interface AutoBuildCandidate {
  slots: WorkbenchSnapshot['slots'];
  score: number;
  scoreBreakdown: AutoBuildScoreBreakdown;
  summary: BuildSummary;
}

export interface AutoBuildProgressEvent {
  phase: string;
  processedStates: number;
  beamSize: number;
  totalSlots: number;
  expandedSlots: number;
  detail?: string;
  reasonCode?: string;
  /** Optional live preview of best candidates while search is running. */
  previewCandidates?: AutoBuildCandidate[];
}

export const DEFAULT_AUTO_BUILDER_WEIGHTS: AutoBuilderWeights = {
  legacyBaseDps: 1,
  legacyEhp: 0.7,
  dpsProxy: 1,
  spellProxy: 0,
  meleeProxy: 0,
  ehpProxy: 0.6,
  speed: 0.4,
  sustain: 0.35,
  skillPointTotal: 0.15,
  reqTotalPenalty: 0.2,
};

export const DEFAULT_AUTO_BUILD_CONSTRAINTS: AutoBuildConstraints = {
  characterClass: null,
  level: 106,
  mustIncludeIds: [],
  excludedIds: [],
  lockedSlots: {},
  target: {},
  allowedTiers: [],
  requiredMajorIds: [],
  excludedMajorIds: [],
  weaponAttackSpeeds: [],
  attackSpeedConstraintMode: 'or',
  skillpointFeasibilityMode: 'no_tomes',
  minPowderSlots: null,
  onlyPinnedItems: false,
  weights: DEFAULT_AUTO_BUILDER_WEIGHTS,
  topN: 50,
  topKPerSlot: 80,
  beamWidth: 400,
  maxStates: 150000,
  useExhaustiveSmallPool: true,
  exhaustiveStateLimit: 250000,
  // Allow restricted / untradeable items by default in Build Solver.
  allowRestricted: true,
};
