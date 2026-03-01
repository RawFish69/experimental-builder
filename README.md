# Build Solver
A web app for building and optimizing Wynncraft character loadouts using the Workbench + Build Solver application.

## Layout 

### New Workbench + Build Solver app
- `frontend/` - source code (React + TypeScript + Vite)
- `dist/` - built static output for the site root `/`

### Data (legacy + workbench)
- `compress.json` - main item database
- other root JSON files are mostly legacy runtime/build data and are intentionally still in root for compatibility

### Docs
- `docs/ARCHITECTURE.md`
- `docs/AUTO_BUILDER.md`
- `docs/legacy/ENCODING.md`
- `docs/legacy/expr_parser.md`
- `docs/CREDITS.txt`

## Workbench quick start

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open:
- `http://localhost:5173/`

In the Workbench UI, the old "Auto Builder / Optimizer" flow is now called `Build Solver`.

Build:

```powershell
cd frontend
npm.cmd run build
```

## Legacy

The original Wynnbuilder static site and tools (builder, items, crafter, custom, map, wynnfo, etc.) are preserved under the `legacy/` folder for archival and backwards-compatibility purposes.

## Credit

This work builds on prior community projects and the broader Wynncraft ecosystem:

- **Wynnbuilder team**: Original Wynnbuilder maintainers and contributors (see additional contributor credits in `docs/CREDITS.txt`).
- **Wynnmana**: Mana sustain and spell–mana reference from [`wynnmana/wynnmana.github.io`](https://github.com/wynnmana/wynnmana.github.io).
- **Wynncraft**: Game, content, and universe credit belongs to the Wynncraft creators and community.

If you are somehow using this repo, keep that credit intact.
