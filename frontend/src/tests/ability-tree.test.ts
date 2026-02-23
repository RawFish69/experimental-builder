import { describe, expect, it } from 'vitest';
import { evaluateAbilityTree, getAbilityPointCap, toggleAbilitySelection } from '@/domain/ability-tree/logic';
import type { AbilityTreeClassTree, AbilityTreeNode } from '@/domain/ability-tree/types';

function makeNode(partial: Partial<AbilityTreeNode> & Pick<AbilityTreeNode, 'id' | 'displayName'>): AbilityTreeNode {
  return {
    id: partial.id,
    displayName: partial.displayName,
    descriptionHtml: partial.descriptionHtml ?? '',
    parents: partial.parents ?? [],
    dependencies: partial.dependencies ?? [],
    blockers: partial.blockers ?? [],
    cost: partial.cost ?? 1,
    archetype: partial.archetype ?? null,
    archetypeReq: partial.archetypeReq ?? 0,
    reqArchetype: partial.reqArchetype ?? null,
    baseAbilityId: partial.baseAbilityId ?? null,
    display: partial.display ?? { row: 0, col: 0, icon: 'node_0' },
    properties: partial.properties ?? {},
    effects: partial.effects ?? [],
  };
}

function makeTree(nodes: AbilityTreeNode[]): AbilityTreeClassTree {
  return {
    className: 'Mage',
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    maxRow: Math.max(...nodes.map((node) => node.display.row), 0),
    maxCol: Math.max(...nodes.map((node) => node.display.col), 0),
  };
}

describe('ability-tree logic', () => {
  it('uses legacy ability point cap table', () => {
    expect(getAbilityPointCap(1)).toBe(1);
    expect(getAbilityPointCap(50)).toBe(27);
    expect(getAbilityPointCap(106)).toBe(45);
  });

  it('enforces legacy-style parents/dependencies/blockers when toggling', () => {
    const tree = makeTree([
      makeNode({ id: 1, displayName: 'Root', parents: [], cost: 1, display: { row: 0, col: 0, icon: 'node_0' } }),
      makeNode({ id: 2, displayName: 'Branch', parents: [1], dependencies: [1], cost: 1, display: { row: 1, col: 0, icon: 'node_0' } }),
      makeNode({ id: 3, displayName: 'Blocked Branch', parents: [1], blockers: [2], cost: 1, display: { row: 1, col: 1, icon: 'node_0' } }),
    ]);

    let selected: number[] = [];
    selected = toggleAbilitySelection(tree, selected, 2, 106);
    expect(selected).toEqual([]); // cannot select before root is reachable

    selected = toggleAbilitySelection(tree, selected, 1, 106);
    expect(selected).toEqual([1]);

    selected = toggleAbilitySelection(tree, selected, 2, 106);
    expect(selected).toEqual([1, 2]);

    const evalAfterBranch = evaluateAbilityTree(tree, selected, 106);
    expect(evalAfterBranch.nodeStatusById[3]?.selectable).toBe(false);
    expect(evalAfterBranch.nodeStatusById[3]?.reason).toContain('blocked by');

    selected = toggleAbilitySelection(tree, selected, 1, 106);
    expect(selected).toEqual([]); // pruning removes downstream invalid nodes when root is removed
  });
});

