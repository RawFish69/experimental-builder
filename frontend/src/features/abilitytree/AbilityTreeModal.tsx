import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, GitBranch, Sparkles, TreePine } from 'lucide-react';
import { Button, ChipButton, Modal, Panel, ScrollArea } from '@/components/ui';
import { evaluateAbilityTree, getClassTree, toggleAbilitySelection } from '@/domain/ability-tree/logic';
import type { AbilityTreeDataset, AbilityTreeSelectionsByClass } from '@/domain/ability-tree/types';
import type { CharacterClass } from '@/domain/items/types';

function formatNodeLabel(displayName: string): string {
  return displayName.length > 20 ? `${displayName.slice(0, 19)}…` : displayName;
}

function classKey(className: CharacterClass | null, inferredClass: CharacterClass | null): CharacterClass | null {
  return className ?? inferredClass ?? null;
}

export function AbilityTreeModal(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  dataset: AbilityTreeDataset | null;
  loading: boolean;
  error: string | null;
  level: number;
  selectedClass: CharacterClass | null;
  inferredClass: CharacterClass | null;
  selectionsByClass: AbilityTreeSelectionsByClass;
  onSelectionsChange(next: AbilityTreeSelectionsByClass): void;
}) {
  const effectiveClass = classKey(props.selectedClass, props.inferredClass);
  const tree = useMemo(() => getClassTree(props.dataset, effectiveClass), [props.dataset, effectiveClass]);
  const selectedIds = useMemo(() => (effectiveClass ? props.selectionsByClass[effectiveClass] ?? [] : []), [props.selectionsByClass, effectiveClass]);
  const evaluation = useMemo(() => (tree ? evaluateAbilityTree(tree, selectedIds, props.level) : null), [tree, selectedIds, props.level]);
  const [focusedNodeId, setFocusedNodeId] = useState<number | null>(null);

  useEffect(() => {
    if (!tree) {
      setFocusedNodeId(null);
      return;
    }
    if (focusedNodeId != null && tree.nodeById.has(focusedNodeId)) return;
    setFocusedNodeId(evaluation?.activeIds[0] ?? tree.nodes[0]?.id ?? null);
  }, [tree, focusedNodeId, evaluation]);

  const focusedNode = useMemo(() => {
    if (!tree || focusedNodeId == null) return null;
    return tree.nodeById.get(focusedNodeId) ?? null;
  }, [tree, focusedNodeId]);

  const updateSelection = (nextIds: number[]) => {
    if (!effectiveClass) return;
    props.onSelectionsChange({
      ...props.selectionsByClass,
      [effectiveClass]: nextIds,
    });
  };

  const toggleNode = (nodeId: number) => {
    if (!tree || !effectiveClass) return;
    const next = toggleAbilitySelection(tree, selectedIds, nodeId, props.level);
    updateSelection(next);
    setFocusedNodeId(nodeId);
  };

  const resetCurrentTree = () => {
    if (!effectiveClass) return;
    props.onSelectionsChange({
      ...props.selectionsByClass,
      [effectiveClass]: [],
    });
  };

  const selectedCount = evaluation?.activeIds.length ?? 0;
  const gridStyles = tree
    ? ({
        gridTemplateColumns: `repeat(${Math.max(1, tree.maxCol + 1)}, minmax(56px, 1fr))`,
        gridTemplateRows: `repeat(${Math.max(1, tree.maxRow + 1)}, minmax(56px, auto))`,
      } as const)
    : undefined;

  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Ability Tree"
      description="Legacy ability tree data and activation rules integrated into Workbench. Effects are tracked here, but Workbench DPS/EHP still excludes ability-tree math for now."
      className="w-[min(97vw,1320px)]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[var(--wb-muted)]">
            {effectiveClass
              ? `Editing ${effectiveClass} tree at level ${props.level}.`
              : 'Select a class (or equip a class weapon) to start editing an ability tree.'}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={resetCurrentTree} disabled={!effectiveClass || selectedCount === 0}>
              Reset Tree
            </Button>
            <Button onClick={() => props.onOpenChange(false)}>Done</Button>
          </div>
        </div>
      }
    >
      {props.loading ? (
        <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-4 text-sm text-[var(--wb-muted)]">
          Loading ability tree data...
        </div>
      ) : props.error ? (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/8 p-4 text-sm text-rose-100">{props.error}</div>
      ) : !effectiveClass ? (
        <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-4 text-sm text-[var(--wb-muted)]">
          Pick a class in the Workbench header, or equip a weapon so Workbench can infer the class and load the correct ability tree.
        </div>
      ) : !tree || !evaluation ? (
        <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-4 text-sm text-[var(--wb-muted)]">
          No ability tree data available for {effectiveClass}.
        </div>
      ) : (
        <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-h-0 space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <div className="wb-card p-3">
                <div className="text-[11px] uppercase tracking-wide text-[var(--wb-muted)]">AP</div>
                <div className="mt-1 text-lg font-semibold">
                  {evaluation.apUsed} / {evaluation.apCap}
                </div>
                <div className="text-xs text-[var(--wb-muted)]">{evaluation.apRemaining} left</div>
              </div>
              <div className="wb-card p-3">
                <div className="text-[11px] uppercase tracking-wide text-[var(--wb-muted)]">Selected</div>
                <div className="mt-1 text-lg font-semibold">{evaluation.activeIds.length}</div>
                <div className="text-xs text-[var(--wb-muted)]">{evaluation.availableIds.length} available next</div>
              </div>
              <div className="wb-card p-3 sm:col-span-2">
                <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-[var(--wb-muted)]">
                  <Sparkles size={12} />
                  Archetypes
                </div>
                <div className="flex flex-wrap gap-1">
                  {Object.keys(evaluation.archetypeCounts).length === 0 ? (
                    <span className="text-xs text-[var(--wb-muted)]">No archetype points yet.</span>
                  ) : (
                    Object.entries(evaluation.archetypeCounts).map(([name, count]) => (
                      <span key={name} className="wb-chip">
                        {name}: {count}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>

            {evaluation.errors.length > 0 ? (
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/8 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-100">
                  <AlertTriangle size={14} />
                  Tree Validation ({evaluation.hardErrors ? 'hard' : 'soft'} issues)
                </div>
                <ScrollArea className="max-h-28">
                  <div className="grid gap-1">
                    {evaluation.errors.map((error, index) => (
                      <div key={`${error}-${index}`} className="text-xs text-amber-100/95">
                        {error}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ) : null}

            <Panel
              title={
                <div className="flex items-center gap-2">
                  <TreePine size={14} />
                  {effectiveClass} Tree
                </div>
              }
              headerRight={
                <div className="text-xs text-[var(--wb-muted)]">
                  {props.selectedClass ? 'Using selected class' : props.inferredClass ? 'Using weapon-inferred class' : ''}
                </div>
              }
              className="min-h-0"
            >
              <ScrollArea className="max-h-[52vh] p-3">
                <div className="atree-grid-container rounded-xl border border-[var(--wb-border-muted)] p-2">
                  <div className="grid gap-2" style={gridStyles}>
                    {tree.nodes.map((node) => {
                      const status = evaluation.nodeStatusById[node.id];
                      const active = Boolean(status?.active);
                      const selectable = Boolean(status?.selectable);
                      const hardBlocked = Boolean(status?.hardBlocked);
                      const stateClass =
                        active
                          ? 'atree-node--active'
                          : selectable
                            ? 'atree-node--selectable'
                            : hardBlocked
                              ? 'atree-node--blocked'
                              : 'atree-node--default';
                      return (
                        <button
                          key={node.id}
                          type="button"
                          className={`atree-node ${stateClass}`}
                          style={{
                            gridColumnStart: node.display.col + 1,
                            gridRowStart: node.display.row + 1,
                          }}
                          title={status?.reason ?? ''}
                          onClick={() => toggleNode(node.id)}
                          onMouseEnter={() => setFocusedNodeId(node.id)}
                          onFocus={() => setFocusedNodeId(node.id)}
                        >
                          <div className="text-[10px] uppercase tracking-wide text-[var(--wb-muted)]">#{node.id}</div>
                          <div className="mt-1 text-xs font-semibold leading-tight">{formatNodeLabel(node.displayName)}</div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                            <span className="text-[var(--wb-muted)]">AP {node.cost}</span>
                            {node.archetype ? <span className="wb-chip px-1.5 py-0.5">{node.archetype}</span> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </ScrollArea>
            </Panel>
          </div>

          <div className="min-h-0 space-y-3">
            <Panel
              title={
                <div className="flex items-center gap-2">
                  <GitBranch size={14} />
                  Node Details
                </div>
              }
              className="min-h-0"
            >
              <div className="space-y-3 p-3">
                {focusedNode ? (
                  <>
                    <div>
                      <div className="text-base font-semibold">{focusedNode.displayName}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="wb-chip">AP {focusedNode.cost}</span>
                        {focusedNode.archetype ? <span className="wb-chip">{focusedNode.archetype}</span> : null}
                        {focusedNode.archetypeReq > 0 ? (
                          <span className="wb-chip">
                            Req {(focusedNode.reqArchetype || focusedNode.archetype || 'Archetype')}: {focusedNode.archetypeReq}
                          </span>
                        ) : null}
                        {evaluation.nodeStatusById[focusedNode.id]?.reason ? (
                          <span className="wb-chip text-amber-100">{evaluation.nodeStatusById[focusedNode.id]?.reason}</span>
                        ) : null}
                      </div>
                    </div>
                    <div
                      className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-3 text-xs leading-relaxed text-[var(--wb-text)] [&_br]:block [&_br]:content-[''] [&_span]:text-inherit"
                      dangerouslySetInnerHTML={{ __html: focusedNode.descriptionHtml || '<span class="text-slate-400">No description.</span>' }}
                    />
                    <div className="grid gap-2 text-xs">
                      <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-2">
                        <div className="text-[11px] uppercase tracking-wide text-[var(--wb-muted)]">Parents</div>
                        <div className="mt-1">
                          {focusedNode.parents.length === 0
                            ? 'Root node'
                            : focusedNode.parents.map((id) => tree.nodeById.get(id)?.displayName ?? `#${id}`).join(' • ')}
                        </div>
                      </div>
                      {focusedNode.dependencies.length > 0 ? (
                        <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-2">
                          <div className="text-[11px] uppercase tracking-wide text-[var(--wb-muted)]">Dependencies</div>
                          <div className="mt-1">
                            {focusedNode.dependencies.map((id) => tree.nodeById.get(id)?.displayName ?? `#${id}`).join(' • ')}
                          </div>
                        </div>
                      ) : null}
                      {focusedNode.blockers.length > 0 ? (
                        <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-2">
                          <div className="text-[11px] uppercase tracking-wide text-[var(--wb-muted)]">Blockers</div>
                          <div className="mt-1">
                            {focusedNode.blockers.map((id) => tree.nodeById.get(id)?.displayName ?? `#${id}`).join(' • ')}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-3 text-xs text-[var(--wb-muted)]">
                    Hover or focus an ability node to inspect it here.
                  </div>
                )}
              </div>
            </Panel>

            <Panel title="Selected Abilities" className="min-h-0">
              <ScrollArea className="max-h-[28vh] p-3">
                {evaluation.activeIds.length === 0 ? (
                  <div className="rounded-xl border border-[var(--wb-border-muted)] bg-black/10 p-3 text-xs text-[var(--wb-muted)]">
                    No abilities selected yet.
                  </div>
                ) : (
                  <div className="grid gap-1">
                    {evaluation.activeIds.map((id) => {
                      const node = tree.nodeById.get(id);
                      if (!node) return null;
                      return (
                        <ChipButton
                          key={id}
                          className="justify-start text-left"
                          active={focusedNodeId === id}
                          onClick={() => setFocusedNodeId(id)}
                          title={`AP ${node.cost}`}
                        >
                          {node.displayName}
                        </ChipButton>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </Panel>
          </div>
        </div>
      )}
    </Modal>
  );
}
