import type { CharacterClass } from '@/domain/items/types';
import type {
  AbilityTreeClassTree,
  AbilityTreeDataRaw,
  AbilityTreeDataset,
  AbilityTreeEvaluation,
  AbilityTreeNode,
  AbilityTreeNodeRaw,
  AbilityTreeNodeStatus,
} from '@/domain/ability-tree/types';

const KNOWN_CLASSES: CharacterClass[] = ['Warrior', 'Assassin', 'Mage', 'Archer', 'Shaman'];

// Ported from legacy js/builder/atree.js
const ATREE_LEVEL_TABLE: number[] = [
  0,
  1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 9, 10, 11, 11, 12, 12, 13, 14, 14, 15, 16, 16, 17, 17, 18, 18, 19,
  19, 20, 20, 20, 21, 21, 22, 22, 23, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 30, 30, 31, 31, 32,
  32, 33, 33, 34, 34, 34, 35, 35, 35, 36, 36, 36, 37, 37, 37, 38, 38, 38, 38, 39, 39, 39, 39, 40, 40, 40, 40, 41,
  41, 41, 41, 42, 42, 42, 42, 43, 43, 43, 43, 44, 44, 44, 44, 45, 45, 45,
];

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asNumber(entry, Number.NaN))
    .filter((entry): entry is number => Number.isFinite(entry))
    .map((entry) => Math.trunc(entry));
}

function normalizeNode(raw: AbilityTreeNodeRaw): AbilityTreeNode | null {
  const id = asNumber(raw.id, Number.NaN);
  if (!Number.isFinite(id)) return null;
  const displayRow = asNumber(raw.display?.row, 0);
  const displayCol = asNumber(raw.display?.col, 0);
  return {
    id: Math.trunc(id),
    displayName: asString(raw.display_name) || `Ability ${id}`,
    descriptionHtml: asString(raw.desc),
    parents: asNumArray(raw.parents),
    dependencies: asNumArray(raw.dependencies),
    blockers: asNumArray(raw.blockers),
    cost: Math.max(0, Math.trunc(asNumber(raw.cost, 1))),
    archetype: asString(raw.archetype).trim() || null,
    archetypeReq: Math.max(0, Math.trunc(asNumber(raw.archetype_req, 0))),
    reqArchetype: asString(raw.req_archetype).trim() || null,
    baseAbilityId: raw.base_abil == null ? null : Math.trunc(asNumber(raw.base_abil, Number.NaN)),
    display: {
      row: Math.max(0, Math.trunc(displayRow)),
      col: Math.max(0, Math.trunc(displayCol)),
      icon: asString(raw.display?.icon) || 'node_0',
    },
    properties: typeof raw.properties === 'object' && raw.properties ? raw.properties : {},
    effects: Array.isArray(raw.effects) ? raw.effects.filter((effect): effect is Record<string, unknown> => !!effect && typeof effect === 'object') : [],
  };
}

function buildClassTree(className: CharacterClass, rawNodes: AbilityTreeNodeRaw[]): AbilityTreeClassTree {
  const nodes = rawNodes
    .map(normalizeNode)
    .filter((node): node is AbilityTreeNode => node !== null)
    .sort((a, b) => {
      const rowDelta = a.display.row - b.display.row;
      if (rowDelta !== 0) return rowDelta;
      const colDelta = a.display.col - b.display.col;
      if (colDelta !== 0) return colDelta;
      return a.id - b.id;
    });

  const nodeById = new Map<number, AbilityTreeNode>();
  let maxRow = 0;
  let maxCol = 0;
  for (const node of nodes) {
    nodeById.set(node.id, node);
    maxRow = Math.max(maxRow, node.display.row);
    maxCol = Math.max(maxCol, node.display.col);
  }

  return {
    className,
    nodes,
    nodeById,
    maxRow,
    maxCol,
  };
}

export function normalizeAbilityTreeDataset(raw: AbilityTreeDataRaw, version: string): AbilityTreeDataset {
  const classes: AbilityTreeDataset['classes'] = {};
  for (const className of KNOWN_CLASSES) {
    const rawNodes = Array.isArray(raw[className]) ? raw[className] : [];
    classes[className] = buildClassTree(className, rawNodes);
  }
  return { version, classes };
}

export function getAbilityPointCap(level: number): number {
  if (!Number.isFinite(level)) return 45;
  const rounded = Math.trunc(level);
  if (rounded >= ATREE_LEVEL_TABLE.length) return 45;
  if (rounded < 1) return ATREE_LEVEL_TABLE[1] ?? 1;
  return ATREE_LEVEL_TABLE[rounded] ?? 45;
}

type CanActivateResult = {
  ok: boolean;
  hardBlocked: boolean;
  reason: string;
};

function canActivateNode(
  node: AbilityTreeNode,
  tree: AbilityTreeClassTree,
  reachable: Set<number>,
  archetypeCounts: Map<string, number>,
  pointsRemaining: number,
): CanActivateResult {
  if (node.parents.length === 0) {
    if (node.cost > pointsRemaining) {
      return { ok: false, hardBlocked: false, reason: 'not enough ability points left' };
    }
    return { ok: true, hardBlocked: false, reason: '' };
  }

  const missingDeps = node.dependencies.filter((depId) => !reachable.has(depId));
  if (missingDeps.length > 0) {
    const names = missingDeps.map((id) => `"${tree.nodeById.get(id)?.displayName ?? id}"`);
    return { ok: false, hardBlocked: true, reason: `missing dep: ${names.join(', ')}` };
  }

  const blockingIds = node.blockers.filter((id) => reachable.has(id));
  if (blockingIds.length > 0) {
    const names = blockingIds.map((id) => `"${tree.nodeById.get(id)?.displayName ?? id}"`);
    return { ok: false, hardBlocked: true, reason: `blocked by: ${names.join(', ')}` };
  }

  const reachableFromParent = node.parents.some((parentId) => reachable.has(parentId));
  if (!reachableFromParent) {
    return { ok: false, hardBlocked: false, reason: 'not reachable' };
  }

  if (node.archetypeReq > 0) {
    const reqArchetype = node.reqArchetype || node.archetype;
    const count = reqArchetype ? archetypeCounts.get(reqArchetype) ?? 0 : 0;
    if (!reqArchetype || count < node.archetypeReq) {
      return { ok: false, hardBlocked: false, reason: `${reqArchetype ?? 'Archetype'}: ${count} < ${node.archetypeReq}` };
    }
  }

  if (node.cost > pointsRemaining) {
    return { ok: false, hardBlocked: false, reason: 'not enough ability points left' };
  }

  return { ok: true, hardBlocked: false, reason: '' };
}

function evaluateSelectionCore(tree: AbilityTreeClassTree, selectedIds: number[], level: number) {
  const selectedSet = new Set<number>(selectedIds.filter((id) => tree.nodeById.has(id)));
  let remainingSelected = new Set(selectedSet);
  let pending = tree.nodes.filter((node) => remainingSelected.has(node.id));
  const reachable = new Set<number>();
  const archetypeCounts = new Map<string, number>();
  let apUsed = 0;
  const unresolved = new Map<number, { reason: string; hardBlocked: boolean }>();

  // Legacy-style validation repeatedly scans selected nodes until no more can be activated.
  while (true) {
    let progressed = false;
    const nextPending: AbilityTreeNode[] = [];
    for (const node of pending) {
      const check = canActivateNode(node, tree, reachable, archetypeCounts, 9999);
      if (!check.ok) {
        nextPending.push(node);
        unresolved.set(node.id, { reason: check.reason, hardBlocked: check.hardBlocked });
        continue;
      }
      unresolved.delete(node.id);
      reachable.add(node.id);
      remainingSelected.delete(node.id);
      apUsed += node.cost;
      if (node.archetype) {
        archetypeCounts.set(node.archetype, (archetypeCounts.get(node.archetype) ?? 0) + 1);
      }
      progressed = true;
    }
    pending = nextPending;
    if (!progressed) break;
  }

  const apCap = getAbilityPointCap(level);
  const apRemaining = apCap - apUsed;

  const availableIds: number[] = [];
  for (const node of tree.nodes) {
    if (reachable.has(node.id)) continue;
    const check = canActivateNode(node, tree, reachable, archetypeCounts, apRemaining);
    if (check.ok) availableIds.push(node.id);
  }

  const nodeStatusById: Record<number, AbilityTreeNodeStatus> = {};
  for (const node of tree.nodes) {
    if (reachable.has(node.id)) {
      nodeStatusById[node.id] = { active: true, selectable: true, hardBlocked: false, reason: null };
      continue;
    }
    const unresolvedFailure = unresolved.get(node.id);
    if (unresolvedFailure) {
      nodeStatusById[node.id] = {
        active: false,
        selectable: false,
        hardBlocked: unresolvedFailure.hardBlocked,
        reason: unresolvedFailure.reason,
      };
      continue;
    }
    const check = canActivateNode(node, tree, reachable, archetypeCounts, apRemaining);
    nodeStatusById[node.id] = {
      active: false,
      selectable: check.ok,
      hardBlocked: check.hardBlocked,
      reason: check.ok ? null : check.reason,
    };
  }

  const errors: string[] = [];
  let hardErrors = false;
  if (apUsed > apCap) {
    errors.push(`too many ability points assigned! (${apUsed} > ${apCap})`);
  }
  for (const node of pending) {
    const failure = unresolved.get(node.id);
    if (!failure) continue;
    if (failure.hardBlocked) hardErrors = true;
    errors.push(`${node.displayName}: ${failure.reason}`);
  }

  return {
    apCap,
    apUsed,
    apRemaining,
    reachable,
    pending,
    unresolved,
    availableIds,
    errors,
    hardErrors,
    archetypeCounts,
    nodeStatusById,
  };
}

export function evaluateAbilityTree(tree: AbilityTreeClassTree, selectedIds: number[], level: number): AbilityTreeEvaluation {
  const core = evaluateSelectionCore(tree, selectedIds, level);
  const activeIds = tree.nodes.filter((node) => core.reachable.has(node.id)).map((node) => node.id);
  const unresolvedIds = core.pending.map((node) => node.id);
  const archetypeCounts = Object.fromEntries([...core.archetypeCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])));

  return {
    className: tree.className,
    level,
    apCap: core.apCap,
    apUsed: core.apUsed,
    apRemaining: core.apRemaining,
    selectedIdsInput: [...selectedIds],
    activeIds,
    unresolvedIds,
    availableIds: core.availableIds,
    hardErrors: core.hardErrors,
    errors: core.errors,
    archetypeCounts,
    nodeStatusById: core.nodeStatusById,
  };
}

function pruneSelectionToValid(tree: AbilityTreeClassTree, selectedIds: number[], level: number): number[] {
  let next = [...new Set(selectedIds)].filter((id) => tree.nodeById.has(id));
  while (true) {
    const evalResult = evaluateAbilityTree(tree, next, level);
    if (evalResult.unresolvedIds.length === 0 && evalResult.apUsed <= evalResult.apCap) {
      return evalResult.activeIds;
    }
    const validSet = new Set(evalResult.activeIds);
    const pruned = next.filter((id) => validSet.has(id));
    if (pruned.length === next.length) {
      return pruned;
    }
    next = pruned;
  }
}

export function toggleAbilitySelection(tree: AbilityTreeClassTree, selectedIds: number[], nodeId: number, level: number): number[] {
  if (!tree.nodeById.has(nodeId)) return [...selectedIds];
  const selectedSet = new Set(selectedIds);
  if (selectedSet.has(nodeId)) {
    selectedSet.delete(nodeId);
    // Deselecting a node may invalidate downstream picks; prune them.
    return pruneSelectionToValid(tree, [...selectedSet], level);
  }

  const currentEval = evaluateAbilityTree(tree, selectedIds, level);
  const nodeStatus = currentEval.nodeStatusById[nodeId];
  if (!nodeStatus?.selectable) {
    return [...selectedIds];
  }
  selectedSet.add(nodeId);
  // Preserve UI order using tree row/col sort.
  return tree.nodes.filter((node) => selectedSet.has(node.id)).map((node) => node.id);
}

export function getClassTree(dataset: AbilityTreeDataset | null | undefined, className: CharacterClass | null): AbilityTreeClassTree | null {
  if (!dataset || !className) return null;
  return dataset.classes[className] ?? null;
}

