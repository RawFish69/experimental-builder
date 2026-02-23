import type { BuildSummary, WorkbenchSnapshot } from '@/domain/build/types';
import type { CharacterClass, ItemSlot } from '@/domain/items/types';

export interface AutoBuilderWeights {
  legacyBaseDps: number;
  legacyEhp: number;
  dpsProxy: number;
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
}

export interface AutoBuildScoreBreakdown {
  legacyBaseDps: number;
  legacyEhp: number;
  dpsProxy: number;
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
}

export const DEFAULT_AUTO_BUILDER_WEIGHTS: AutoBuilderWeights = {
  legacyBaseDps: 1,
  legacyEhp: 0.7,
  dpsProxy: 1,
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
  minPowderSlots: null,
  onlyPinnedItems: false,
  weights: DEFAULT_AUTO_BUILDER_WEIGHTS,
  topN: 20,
  topKPerSlot: 80,
  beamWidth: 350,
  maxStates: 120000,
  useExhaustiveSmallPool: true,
  exhaustiveStateLimit: 250000,
  allowRestricted: false,
};
