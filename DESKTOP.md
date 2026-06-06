# BookKeeper AI — Desktop App

BookKeeper AI runs as a native desktop application (Windows/macOS/Linux) via Electron. All data
lives **locally** in an embedded Postgres (PGlite) — fully offline, you own your data.

## Architecture

```
┌─────────────────────────────────────────────┐
│ Electron main (electron/main.js)             │
│  • single-instance, app menu, native dialogs │
│  • launches the Next.js server on a free port │
│  • sets BKA_DATA_DIR = userData/companies/... │
└───────────────┬─────────────────────────────┘
                │ loads http://127.0.0.1:<port>
┌───────────────▼─────────────────────────────┐
│ Next.js standalone server (.next/standalone) │
│  • React UI (renderer)                        │
│  • API routes -> lib/services/* (engine)      │
│  • lib/db -> PGlite (local file DB)           │
└───────────────────────────────────────────────┘
```

The renderer talks to Electron only through the audited `window.bookkeeper` bridge
(`electron/preload.js`): native file open/save, the active data dir, and menu/navigation events.

## Develop

One command — starts the Next dev server, waits for it, then opens the desktop window.
Closing the window (or Ctrl+C) stops both:

```bash
npm run desktop
```

(If you prefer two terminals: `npm run dev` in one, `npm run electron:dev` in the other.)

## Build a distributable

```bash
npm run desktop:pack   # unpacked app in dist/ (fast, for smoke testing)
npm run desktop:dist   # installers: Windows nsis+portable / mac dmg / linux AppImage+deb
```

`output: 'standalone'` in `next.config.js` produces `.next/standalone/server.js`; electron-builder
bundles it (plus `.next/static`, `public`, and `drizzle/` migrations) under the app resources.
On boot the DB migrator runs `drizzle/` against the local company file.

## Data & backups

- Company files: `app.getPath('userData')/companies/<name>/` (one PGlite directory per company).
- `BKA_DATA_DIR` overrides the active company dir (used by the main process + tests).
- Backup/restore packages a company directory into a single `.bka` archive (see Phase 10).
