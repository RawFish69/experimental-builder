# build-solver — Claude context

## What this project is
A build-optimization tool for the MMORPG Wynncraft. Frontend is React/TypeScript (Vite). Game data (items, ingredients, ability trees, etc.) is synced from the upstream [wynnbuilder-beta](https://github.com/wynnbuilder-beta/wynnbuilder-beta.github.io) repository.

## Data updates

When game data needs updating, use the sync script — do NOT copy files manually:

```bash
# Standard update (fetches from GitHub directly)
python sync-from-wynnbuilder.py

# When a new version folder appears upstream (e.g. 2.2.0.25)
python sync-from-wynnbuilder.py --bump-version 2.2.0.25

# Dry run to preview what would change
python sync-from-wynnbuilder.py --dry-run
```

Full details in `docs/DATA_UPDATE.md`.

### What the script updates
- `data/<version>/` — versioned snapshots (items, atree, aspects, majid, tomes, recipes, …)
- Root-level JSON files: `compress.json`, `clean.json`, `ingreds_*.json`, `recipes_*.json`, `tomes.json`, `tome_map.json`, etc.
- With `--bump-version`: updates `LATEST_ATREE_VERSION` in `catalog-service.ts` and `vite.config.ts`, and `WYNN_VERSION_LATEST` index in `build-encoder.ts`

### Data version constants (3 places to keep in sync)
| File | Constant |
|------|----------|
| `frontend/src/domain/ability-tree/catalog-service.ts` | `LATEST_ATREE_VERSION` |
| `frontend/vite.config.ts` | `latestAtreeVersion` |
| `frontend/src/domain/build/build-encoder.ts` | `WYNN_VERSION_LATEST` (numeric index into `wynn_version_names`) |

## Dev commands
```bash
npm run dev      # start dev server
npm run build    # production build → dist/
npm run test     # run tests
```

## Key frontend source paths
- `frontend/src/domain/` — all business logic (items, ability tree, autobuilder, recipe solver)
- `frontend/src/domain/items/catalog-service.ts` — item data loading
- `frontend/src/domain/ability-tree/catalog-service.ts` — atree data loading
- `frontend/src/domain/build/build-encoder.ts` — WynnBuilder URL hash encoding
