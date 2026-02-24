# Build Solver Notes

This document is for tuning and debugging the Workbench Build Solver.

## Where the code lives

- Engine: `frontend/src/domain/autobuilder/beam-search.ts`
- Scoring: `frontend/src/domain/autobuilder/scoring.ts`
- Types/defaults: `frontend/src/domain/autobuilder/types.ts`
- Worker runtime/client:
  - `frontend/src/domain/autobuilder/worker-runtime.ts`
  - `frontend/src/domain/autobuilder/worker.ts`
- UI: `frontend/src/features/autobuilder/AutoBuilderModal.tsx`

## What it does (v1)

- Generates item combinations for the Workbench
- Respects class, level, must-includes, exclusions, and locked slots
- Filters out builds that fail skill-point / equip-order feasibility
- Runs in a worker and streams progress updates

## Search strategy (current)

1. Build candidate pools per slot
2. Use heuristic search (beam search) for fast passes
3. If needed, retry with deeper search budgets
4. If still failing, run a support-aware rescue pass for high-skill-requirement builds (ex: Warp)
5. Final scoring + dedupe + top N results

## Main tuning knobs

Defaults are in `DEFAULT_AUTO_BUILD_CONSTRAINTS`.

- `topKPerSlot` - breadth per slot
- `beamWidth` - number of partial states kept
- `maxStates` - hard safety cap
- `topN` - returned candidates
- `weights` - scoring weights (damage / ehp / speed / sustain / req penalty)

## Practical debugging tips

- If results are all SP-invalid, inspect must-include reqs first (especially >100 skill req weapons).
- Keep `Deep fallback` enabled for hard builds.
- Keep `Exact search for small pools` enabled when filters are narrow.
- Use diagnostics text in the modal to see whether the failure is pool-empty, state budget, or SP feasibility.

## v1 limits

- No ability-tree integration in scoring
- Heuristic scoring is still meta-dependent and may need tuning
- The engine prioritizes usable results over exhaustive optimality in large search spaces
