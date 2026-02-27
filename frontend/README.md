# Workbench Frontend

React + TypeScript + Vite app for the site root `/`.

The Workbench includes the build generation feature now named `Build Solver`.

## Quick start

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:5173/`.

## Commands

- `npm.cmd run dev` - local dev server
- `npm.cmd run build` - typecheck + build to `../dist`
- `npm.cmd test` - run tests
- `npm.cmd run preview` - preview production build

## Notes

- The app reads item data from the repo root `compress.json`.
- If PowerShell blocks `npm`, use `npm.cmd` (as shown above).
