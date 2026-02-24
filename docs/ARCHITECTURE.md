# Workbench Architecture

This repo now has two app surfaces:

- Legacy static pages (`builder/`, `items/`, `items_adv/`)
- New Workbench app (`frontend/` -> built to `workbench/`)

## New Workbench layout (important parts)

- `frontend/src/app/`
  - app shell, URL sync, route-level orchestration
- `frontend/src/domain/items/`
  - item catalog loading + normalization (`compress.json`)
- `frontend/src/domain/search/`
  - search/filter model + search worker
- `frontend/src/domain/build/`
  - workbench state, build summary, legacy link/codec bridge
- `frontend/src/domain/autobuilder/`
  - auto-builder scoring/search engine + worker runtime
- `frontend/src/features/`
  - UI feature modules (`search`, `workbench`, `autobuilder`)

## Data flow (new app)

1. Load and normalize `compress.json`
2. Initialize search worker with normalized items
3. Search panel updates query/filter state
4. Workbench store manages slots/bins/locks/undo/redo
5. Build summary is recalculated from the same catalog + snapshot
6. Build Solver uses the same catalog/snapshot/summary logic and returns candidates

## Compatibility notes

- Legacy pages are still available and unchanged for core legacy behavior.
- Workbench can import legacy hashes and open the legacy builder.
- Ability tree remains legacy-only in Workbench v1.

## Why this split matters

It keeps search, build math, and auto-builder logic independent from React components, which makes the UI easier to iterate without breaking core behavior.
