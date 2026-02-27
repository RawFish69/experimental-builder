# Build Solver
A web app for building and optimizing Wynncraft character loadouts using the Workbench + Build Solver application.

## Layout 

### Legacy app 
- `builder/` - legacy builder (ability tree, legacy workflows)
- `items/`, `items_adv/` - legacy item search pages
- `crafter/`, `custom/`, `map/`, `wynnfo/`, etc. - legacy static pages/tools
- `js/`, `css/`, `media/`, `thirdparty/` - shared legacy web assets and scripts

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

## Credit

This work builds on the original Wynnbuilder project and the people who made and maintained it.

- Original Wynnbuilder maintainers and contributors
- Additional contributor credits: `docs/CREDITS.txt`
- Wynncraft / game ecosystem credit belongs to the Wynncraft community and creators

If you are somehow using this repo, keep that credit intact.
