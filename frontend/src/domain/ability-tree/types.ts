import type { CharacterClass } from '@/domain/items/types';

export interface AbilityTreeDisplayRef {
  row: number;
  col: number;
  icon: string;
}

export interface AbilityTreeNodeRaw {
  id: number;
  display_name: string;
  desc?: string;
  parents?: number[];
  dependencies?: number[];
  blockers?: number[];
  cost?: number;
  archetype?: string;
  archetype_req?: number;
  req_archetype?: string;
  base_abil?: number;
  display?: Partial<AbilityTreeDisplayRef>;
  properties?: Record<string, unknown>;
  effects?: Array<Record<string, unknown>>;
}

export type AbilityTreeDataRaw = Record<string, AbilityTreeNodeRaw[]>;

export interface AbilityTreeNode {
  id: number;
  displayName: string;
  descriptionHtml: string;
  parents: number[];
  dependencies: number[];
  blockers: number[];
  cost: number;
  archetype: string | null;
  archetypeReq: number;
  reqArchetype: string | null;
  baseAbilityId: number | null;
  display: AbilityTreeDisplayRef;
  properties: Record<string, unknown>;
  effects: Array<Record<string, unknown>>;
}

export interface AbilityTreeClassTree {
  className: CharacterClass;
  nodes: AbilityTreeNode[];
  nodeById: Map<number, AbilityTreeNode>;
  maxRow: number;
  maxCol: number;
}

export interface AbilityTreeDataset {
  version: string;
  classes: Partial<Record<CharacterClass, AbilityTreeClassTree>>;
}

export interface AbilityTreeNodeStatus {
  active: boolean;
  selectable: boolean;
  hardBlocked: boolean;
  reason: string | null;
}

export interface AbilityTreeEvaluation {
  className: CharacterClass;
  level: number;
  apCap: number;
  apUsed: number;
  apRemaining: number;
  selectedIdsInput: number[];
  activeIds: number[];
  unresolvedIds: number[];
  availableIds: number[];
  hardErrors: boolean;
  errors: string[];
  archetypeCounts: Record<string, number>;
  nodeStatusById: Record<number, AbilityTreeNodeStatus>;
}

export type AbilityTreeSelectionsByClass = Partial<Record<CharacterClass, number[]>>;

export interface AbilityTreeUrlState {
  version?: string | null;
  selectedByClass: AbilityTreeSelectionsByClass;
}

