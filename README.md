# BookKeeper AI

**Open-source desktop accounting — a QuickBooks competitor with AI-powered error correction.**

BookKeeper AI is a cross-platform **desktop** application (Windows / macOS / Linux) for full
double-entry accounting. Your books live **locally** in an embedded Postgres database (PGlite) —
no cloud account, no subscription, no internet required. You own your data.

> Status: actively built. Core accounting engine, AR/AP cycles, banking, reports, and the AI review
> are functional and test-covered. See [`TODO.md`](./TODO.md) for the full roadmap and what's done.

## ✨ Features

### Accounting core (tested, reconciles)
- **Chart of Accounts** — hierarchical, 5 account types, opening balances, default templates.
- **Double-entry posting engine** — every document posts through one validated path that enforces
  *debits = credits* and keeps balances correct. Void/reverse with full audit trail.
- **Journal entries** + **General Ledger** register with running balances.
- **Trial Balance, Profit & Loss, Balance Sheet** — computed from the journal (the source of truth).
- Decimal-safe money throughout (no floating-point drift).

### Sales / A/R
Customers, Products & Services, **Invoices** (line items, tax, discounts), **Receive Payments**
(apply to invoices, undeposited funds), AR Aging.

### Purchases / A/P
Vendors (1099 tracking), **Bills**, **Pay Bills**, AP Aging.

### Banking
Bank/credit-card accounts, **OFX / QBO / CSV import** with duplicate detection,
**categorization rules**, **bank reconciliation**, transfers.

### AI differentiator
- **Error detection**: unbalanced entries, duplicates, miscategorization, outliers, missing fields.
- **LLM correction workflow**: Claude analyzes each issue with accounting context and proposes an
  applyable, human-approved fix (with prompt caching). Works offline with a deterministic fallback
  when no API key is set.

### Reports
P&L, Balance Sheet, Trial Balance, General Ledger, AR/AP Aging, Cash Flow — with CSV export.

## 🏗 Architecture

```
Electron shell  ──launches──►  Next.js server  ──►  lib/services/* (accounting engine)  ──►  PGlite (local DB)
(native menus,                 (React UI +              double-entry posting, reports,        embedded Postgres,
 file dialogs,                  API routes)             AR/AP, banking, AI                    one dir per company)
 per-company data dir)
```

- **UI**: Next.js 15 App Router + React 19 + Tailwind.
- **Engine**: pure TypeScript services (`lib/services/*`) — testable without a browser.
- **DB**: Drizzle ORM on **PGlite** (embedded Postgres). Migrations in `drizzle/`.
- **Desktop**: Electron (`electron/`). See [`DESKTOP.md`](./DESKTOP.md).

## 🚀 Getting started

```bash
npm install

# Web/dev mode (browser):
npm run dev            # http://localhost:3000

# Desktop dev (Electron pointed at the dev server):
npm run dev            # terminal 1
npm run electron:dev   # terminal 2

# Build desktop installers (Windows/mac/Linux):
npm run desktop:dist
```

## 🧪 Quality

```bash
npm test          # vitest — unit + integration (accounting golden cases, all modules)
npm run typecheck # tsc --noEmit
npm run build     # Next standalone production build
```

The test suite includes an end-to-end accounting integration test that posts a real scenario and
asserts the Trial Balance, P&L, and Balance Sheet all reconcile.

## 📁 Layout

```
electron/            Desktop shell (main process + preload bridge)
lib/db/              Drizzle schema + PGlite client
lib/services/        Accounting engine: posting, accounts, invoices, bills, payments,
                     banking import, reconcile, reports, AI error detection/correction, …
lib/money.ts         Decimal-safe money + allocation + formatting
app/                 React UI (pages) + API route handlers (app/api/*)
components/ui.tsx    Shared UI kit
drizzle/             Generated SQL migrations (bundled into the desktop build)
TODO.md              Master build plan (12 phases) + status
```

## ⚠️ Disclaimer

Accounting/tax features (incl. payroll tax tables) are provided as-is; verify against current
regulations before filing. This is open-source software, not professional accounting advice.
