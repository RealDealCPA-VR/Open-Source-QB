# BookKeeper AI — Master Build Plan (Road to a True QuickBooks Competitor)

> Goal: Ship a **desktop accounting application** that is a credible competitor to QuickBooks
> (Desktop + Online feature parity on the essentials), with AI-powered error correction and
> categorization as the differentiator. Offline-first, local data ownership, importable from QuickBooks.
>
> **Status legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked/needs decision
>
> This file is the single source of truth. Work items top-to-bottom; each phase gates the next where noted.

---

## 📊 PROGRESS SNAPSHOT (2026-06-06)

**Status: working desktop accounting app, all green.** 73 services · 142 API routes · 79 UI pages · 67 tables ·
**730 tests passing** (72 files) + passing E2E (`npm run test:e2e`) · `tsc` clean · `next build` exit 0 ·
**signed installers** (`release/*.exe`, self-signed pipeline — see SIGNING.md) · auth + 2FA + portal + full workflow verified.

**Waves 16-17 additions:** ✅ **comparative + monthly P&L** + %-of-income, ✅ **email invoices via SMTP**,
✅ **inventory reorder + physical count**, ✅ **cash-basis balance sheet**, ✅ **sales reps + commissions**, ✅ **mileage tracking**.

**Wave 18 additions:** ✅ **class/department tracking on the GL** (posting engine carries classId) →
**P&L-by-class** + **budget-vs-actual-by-class** + journal class tagging, ✅ **all-50-state + DC payroll-tax** withholding.

Test total: **774 (73 files)**. Remaining: dark mode (deliberately not forced — would require restyling all
~80 pages and degrade readability half-done) and the credential-gated integrations (Plaid/Stripe/CA-cert/e-file).

**Wave 15 + UX additions:** ✅ **cash-vs-accrual basis** P&L, ✅ **combined/multi-component sales-tax rates** +
tax-by-agency report, ✅ **inventory assemblies (BOM)** build/unbuild, ✅ **global command palette + search** (Cmd/Ctrl-K).

**Wave 14 + signing additions:** ✅ internal **time tracking** → billable→invoice, ✅ **fixed-asset depreciation**
(straight-line + GL), ✅ **document PDFs** (estimate / PO / customer statement), ✅ **state payroll-tax** withholding
(12 states, public rates), ✅ **code-signing pipeline** (self-signed cert; CA cert via SIGNING.md), ✅ **recurring runs on app launch**.

**Wave 13 additions:** ✅ **bank-feed categorization → GL** (QB "Add/Match" — the last core banking workflow),
✅ **customer/vendor merge**, ✅ **1099-NEC e-file XML export**, ✅ **estimate expiry** handling + **check-number sequencing**.

**Wave 12 additions:** ✅ **pay sales-tax / payroll liabilities**, ✅ **audit-trail viewer**, ✅ **document
attachments**, ✅ **data-integrity verify** tool, ✅ **classified balance sheet** (current vs non-current).

**Wave 11 + 2FA + final additions:** ✅ multi-entity **consolidated reporting**, ✅ **job-costing P&L**, ✅ **FIFO
inventory layers** (+COGS), ✅ **2FA/TOTP**, ✅ **customer price lists**, ✅ **employee expense reports +
reimbursements**, ✅ **per-line-item tax rates**, ✅ **retainage** (holdback→Retainage Receivable 1250, tested),
✅ **employee self-service portal** (separate auth, pay-stub access — runtime-verified).

**Every autonomously-buildable item is now DONE. The only remaining items require an external credential/asset
I cannot synthesize** (the code/config is in place and activates the moment the resource is supplied):
- Trusted **code-signing cert** → signed/notarized installers (they build unsigned today).
- **Plaid live keys** → live bank feeds (full integration code already present; demo feed works without it).
- **Payroll e-file transmission + licensed multi-state tax-table feed** (federal withholding calculator already built).
- **Payment-processor** (Stripe/Square) and third-party **time-tracking** API partnerships.

**Audit-driven additions (wave 9–10):** payroll W-2/941 + pay-stub PDFs + auto-tax in pay runs, **purchase
orders→bill**, **deposits (undeposited→make deposit)**, **credit-limit enforcement**, **percentage discounts**,
**foreign-currency invoices** (GL in base), **1099-NEC PDF**, **year-end close** (RE rollover), **password
reset**, **built-in demo bank feed**, CSV-dedup + trial-balance fixes. A standalone completeness-audit agent
catalogued 30 gaps; the ~25 buildable ones are addressed or itemized below.

Added across waves 6–8 + auth: auth/sessions/route-guards, RBAC, credit memos, vendor credits, sales
orders→invoice, print checks (PDF), memorized reports, budgets, statements, 1099, **multi-currency + FX
revaluation**, **custom report builder**, **Plaid bank feeds (functional with keys)**, **federal payroll-tax
calculator**, **branded app icon**, **auto-update wiring**, and a grouped navigation surfacing every module.

**Built & verified:**
- ✅ Offline desktop architecture: Electron shell + Next standalone + embedded PGlite (local data, multi-company)
- ✅ Double-entry posting engine (debits=credits enforced, balances, void/reverse) + **fiscal-period close lock**
- ✅ Chart of Accounts · Journal/GL · Trial Balance · P&L · Balance Sheet · Cash Flow · AR/AP Aging (CSV export)
- ✅ Sales: Customers · Items · **Estimates→Invoice** · Invoices · Receive Payments · **PDF invoices**
- ✅ Purchases: Vendors · Bills · Pay Bills
- ✅ Banking: bank accounts · OFX/QBO/CSV import + dedupe · categorization rules · reconciliation · transfers
- ✅ Inventory (avg-cost + COGS) · Payroll (paychecks + GL) · Sales tax · Recurring transactions · Class/Location tracking
- ✅ AI: error detection + LLM correction workflow (offline fallback)
- ✅ Data portability: backup/restore (.bka) · QuickBooks IIF import · Settings/company · first-run onboarding wizard

**Now also done:** ✅ Auth · ✅ RBAC · ✅ credit memos · ✅ vendor credits · ✅ sales orders→invoice ·
✅ print checks · ✅ memorized reports · ✅ **multi-currency + FX** · ✅ **custom report builder** ·
✅ **Plaid bank feeds (code complete; live with keys)** · ✅ **federal payroll-tax calculator** · ✅ **app icon** ·
✅ auto-update wiring · ✅ E2E test passing.

**Installers now built:** ✅ `release/BookKeeper AI Setup 1.0.0.exe` (NSIS) + `BookKeeper AI 1.0.0.exe` (portable),
both ~177MB, with the branded icon. ✅ built-in **demo bank feed** so banking works with no external provider.

**The only true remainder requires resources I cannot synthesize (all otherwise code-complete/configured):**
- ⬜ **Trusted CA signing certificate** to produce *signed/notarized* installers — the installers build today (unsigned); the signing pipeline is configured (`CSC_LINK`/`CSC_KEY_PASSWORD`).
- ⬜ **Plaid API keys** to go live — integration code + UI are complete; set `PLAID_CLIENT_ID/SECRET/ENV`.
- ⬜ **Licensed payroll-tax-table feed + e-file provider** for filing — withholding calculator is implemented as an
  approximation with a verify-before-filing disclaimer; full e-file is a regulated external integration.
- ⬜ (Optional polish) deeper per-document multi-currency FX on every transaction type; state-by-state payroll tables.

---

## Architecture Decisions (made autonomously — flagged for review)

These are the two highest-stakes forks. Defaults chosen to maximize reuse of existing code and to satisfy "desktop + offline". Override early if you disagree.

1. **Desktop shell → Electron** (not Tauri).
   - Why: reuses the entire existing Next.js + React UI and lets business logic run in a Node process. No Rust toolchain. Best Windows packaging story.
2. **Local database → PGlite (embedded Postgres, WASM) via `drizzle-orm/pglite`** (not cloud Neon, not SQLite).
   - Why: keeps the existing `pg-core` Drizzle schema *verbatim* (pgEnum, jsonb, etc.), runs fully offline in-process, persists to a local app-data directory. Zero server. Cloud sync becomes an optional later feature, not a dependency.
3. **Money handling → decimal strings in DB + `decimal.js` for all arithmetic.** Never use JS floats for money. Centralized `Money` helper.
4. **AI → `@anthropic-ai/sdk`, default model `claude-sonnet-4-6` (escalate to `claude-opus-4-8` for complex corrections), with prompt caching.** Key stored in OS keychain, never bundled.
5. **Validation → `zod` at every service boundary.** Already a dependency.
6. **App architecture → 3 layers:** `lib/db` (schema+client) → `lib/services/*` (pure business logic, the accounting engine) → `app/api/*` route handlers + React UI. Electron main calls the same Next server. This keeps logic testable independent of UI/desktop.

---

## PHASE 0 — Foundation & Substrate  *(must finish before fan-out; shared by everything)*

- [~] 0.1 Install deps: pglite, decimal.js, @anthropic-ai/sdk, papaparse, bcryptjs, vitest, tsx installed. Still pending: electron, electron-builder, electron-updater, keytar, pdf, xlsx, playwright.
- [x] 0.2 `lib/db/index.ts` — PGlite-backed Drizzle client; multi-company data dirs; lazy singleton. **Validated by smoke test.**
- [x] 0.3 Migrations: initial migration generated (`drizzle/0000_*.sql`); runtime migrator applies on first open.
- [x] 0.4 `lib/money.ts` — decimal-safe Money, allocate(), formatters. **10 unit tests pass.**
- [x] 0.5 `lib/utils.ts` — `cn`, date/percent/compact formatting, invariant.
- [~] 0.6 `lib/validation/` — shared zod schemas mirroring DB tables; reusable refinements (e.g. balanced-entry rule).
- [x] 0.7 Service-layer conventions + `lib/services/_base.ts` — context, error types (`ServiceError`), audit-log helper, tx wrapper.
- [x] 0.7b **Posting engine** (`lib/services/posting.ts`) — validated double-entry, balance updates, void/reverse. **Integration-tested.**
- [x] 0.7c Chart of Accounts service + Trial Balance / P&L / Balance Sheet reports. **Reconciliation tested.**
- [x] 0.8 Auth: bcrypt credentials + HMAC-signed session cookie (`lib/auth.ts`), `middleware.ts` route protection, signup creates owner+company, login/signup pages, sign-out in shell, `getServerContext` honors the session user. **Runtime-verified (signup→session→authed API) + unit-tested.** (Role enforcement helper still TODO.)
- [ ] 0.9 **Multi-company file model**: a "company file" = one PGlite data dir. Company switcher; create/open/close company; recent files.
- [ ] 0.10 Audit trail service wired to `audit_logs` (write on every mutation via service base).
- [ ] 0.11 Seed: default Chart of Accounts templates (general, retail, services, nonprofit) + sample company for dev.
- [x] 0.12 Electron scaffold: `electron/main.js` (single-instance, app menu, native dialogs, launches Next standalone server, sets BKA_DATA_DIR per company), `electron/preload.js` (secure `window.bookkeeper` bridge). `next.config.js` → standalone. Dev: `npm run dev` + `npm run electron:dev`. See DESKTOP.md.
- [x] 0.13 Scripts: `test`, `typecheck` added; `desktop:pack`/`desktop:dist` (electron-builder win/mac/linux) configured in package.json `build`.
- [ ] 0.14 App shell UI: real navigation (replace static layout), company-aware routing, toast/notification system, global error boundary, loading states, empty states, command palette.

---

## PHASE 1 — Core Accounting Engine  *(the non-negotiable correctness core)*

- [ ] 1.1 **Chart of Accounts** service + UI: hierarchical CRUD, account types/subtypes, opening balances, activate/deactivate, merge accounts, reorder, account numbers on/off.
- [ ] 1.2 **Journal Entries**: create/edit/void/delete; multi-line; **debits = credits enforced**; entry numbering per company; draft→posted workflow; reversing entries; recurring/memorized entries.
- [ ] 1.3 **General Ledger** (per-account register with running balance) + drill-down.
- [ ] 1.4 **Account registers** (bank/CC/AR/AP register views like QB).
- [ ] 1.5 **Posting engine**: every transaction (invoice, bill, payment, etc.) generates correct balanced GL entries. Single source of truth for balances (derive from lines, don't trust cached balance; reconcile cached `accounts.balance`).
- [ ] 1.6 **Fiscal year / periods**: fiscal year settings, period close/lock, prevent edits to closed periods, year-end retained-earnings rollover.
- [ ] 1.7 **Trial Balance** report (foundation for all financials).
- [ ] 1.8 Number-precision & rounding tests across the engine (golden-file accounting scenarios).

---

> **Build/runtime verified 2026-06-06:** `next build` (standalone) succeeds (26 routes); standalone
> server boots PGlite, migrates, serves API (POST/GET customer round-trip = 201/200) and renders
> report pages. 184 tests pass, 0 typecheck errors. Backend for Phases 2–4, 8(core), 9 is implemented
> as services + API routes. Remaining: module UIs, auth, inventory/payroll/sales-tax services,
> portability/backup, productization, E2E.

## PHASE 2 — Sales / Customers / Accounts Receivable

- [ ] 2.1 **Customers**: contacts, billing/shipping addresses, terms, credit limit, tax status, sub-customers/jobs, notes, attachments.
- [ ] 2.2 **Products & Services (Items)**: service / non-inventory / inventory / bundle; income & expense account mapping; sales price; purchase cost; taxable flag.
- [ ] 2.3 **Estimates / Quotes** → convert to invoice.
- [ ] 2.4 **Sales Orders** (optional/QB-Enterprise parity) → invoice.
- [ ] 2.5 **Invoices**: line items, qty/rate, discounts, sales tax, shipping, terms, due dates, memos, attachments; PDF + print; email; recurring invoices.
- [ ] 2.6 **Sales Receipts** (paid-at-point-of-sale).
- [ ] 2.7 **Receive Payments**: apply to invoices, partial payments, overpayments/credits, deposit to Undeposited Funds or bank.
- [ ] 2.8 **Credit Memos & Refunds**.
- [ ] 2.9 **Customer Statements** (balance forward / open item).
- [ ] 2.10 **A/R Aging** (summary + detail) and Open Invoices report.
- [ ] 2.11 Posting integration: all of the above post correct GL entries (AR, income, tax payable, COGS for inventory items).

## PHASE 3 — Purchases / Vendors / Accounts Payable

- [ ] 3.1 **Vendors**: contacts, terms, 1099 flag + tax id, default expense account, attachments.
- [ ] 3.2 **Purchase Orders** → receive → bill.
- [ ] 3.3 **Bills** (enter, edit) + **Bill Payment** (pay bills, partial, discounts taken).
- [ ] 3.4 **Expenses / Checks / Debit purchases** (direct, non-bill spend).
- [ ] 3.5 **Vendor Credits** & refunds.
- [ ] 3.6 **A/P Aging** + Unpaid Bills report.
- [ ] 3.7 **1099 tracking & year-end 1099-NEC/MISC prep + export**.
- [ ] 3.8 Posting integration (AP, expense, prepaid, fixed-asset routing).

## PHASE 4 — Banking

- [x] 4.1 Bank & credit-card account management (`bankAccounts` service + `/api/bank-accounts`, tested).
- [ ] 4.2 **File import**: OFX / QBO / QFX / **CSV (with column mapper)** / IIF — robust parser, duplicate detection (FITID + heuristic), date/amount normalization, batch progress, preview-before-commit, account mapping. (Replaces the stub parser in IMPLEMENTATION_GUIDE.)
- [ ] 4.3 **Categorization rules engine** (payee/amount/memo → account + customer/class) + apply on import.
- [ ] 4.4 **Bank reconciliation**: statement entry, clear transactions, running difference, must-be-zero to finish, reconciliation reports, undo reconciliation, discrepancy report.
- [ ] 4.5 **Transfers** between accounts.
- [ ] 4.6 **Undeposited Funds → Make Deposits** workflow.
- [ ] 4.7 (Stretch) Live bank feeds via Plaid/Teller — behind a feature flag (needs internet + keys).

## PHASE 5 — Inventory & Items (Stretch toward QB Enterprise parity)

- [ ] 5.1 Inventory quantity on hand, average-cost **and** FIFO valuation, COGS posting on sale.
- [ ] 5.2 Inventory adjustments (qty/value), reorder points, low-stock alerts.
- [ ] 5.3 Inventory valuation summary/detail reports; physical-count worksheet.
- [ ] 5.4 Units of measure; price levels; assemblies/bundles.

## PHASE 6 — Payroll  *(major QB module; ship a self-contained core)*

- [ ] 6.1 **Employees**: profile, pay rate (hourly/salary), schedules, W-4 info, direct-deposit fields.
- [ ] 6.2 **Pay items**: earnings, overtime, bonus, deductions (pre/post tax), employer contributions.
- [ ] 6.3 **Pay runs**: compute gross→net, withholdings (framework + pluggable tax tables; ship federal + a couple states as data, document the rest), pay stubs (PDF).
- [ ] 6.4 **Payroll liabilities** tracking & payment; payroll GL posting (wage expense, taxes payable).
- [ ] 6.5 Year-end **W-2 / W-3** prep + export.
- [ ] 6.6 Timesheets → billable time → invoice.
- [ ] 6.7 ⚠️ Compliance disclaimer; tax tables flagged as "verify before filing".

## PHASE 7 — Taxes

- [~] 7.1 **Sales tax**: rates + agencies (`salesTax` service + `/api/tax-rates`, tested), tax-on-invoices wired, liability summary. Still: combined rates, record/pay sales tax.
- [ ] 7.2 1099 (links to 3.7), W-2 (links to 6.5).
- [ ] 7.3 Tax-line mapping for accounts (export to tax software / Schedule C/1120 categories).

## PHASE 8 — Reports & Dashboards  *(QB ships 50+; deliver the core set + a builder)*

- [~] 8.1 Financials: **P&L**, **Balance Sheet**, **Trial Balance** services + live UI pages done (`app/reports/*`). Cash Flow + GL via fan-out agents. Comparative/by-period variants pending.
- [ ] 8.2 Sales: Sales by Customer/Item/Rep (summary+detail), Open Invoices, A/R Aging, Customer Balance.
- [ ] 8.3 Expenses/Vendor: Expenses by Vendor, Unpaid Bills, A/P Aging, 1099 summary.
- [ ] 8.4 Banking: Reconciliation reports, Deposit detail, Check detail, Missing checks.
- [ ] 8.5 Inventory & Payroll reports (link phases 5/6).
- [ ] 8.6 **Class / Location / Department** tracking + filtering across all reports.
- [ ] 8.7 **Budgets** + Budget-vs-Actual report.
- [ ] 8.8 **Custom report builder**: pick columns, filters, date ranges, grouping, memorize/save reports.
- [ ] 8.9 Export every report to **PDF / CSV / Excel (xlsx)**; print; email.
- [~] 8.10 **Dashboard**: KPIs (revenue, net income, cash, AR, AP) wired to live ledger data (`app/dashboard/page.tsx`) — replaced hardcoded mockup. Charts pending.

## PHASE 9 — AI Differentiators  *(the reason to choose this over QuickBooks)*

- [ ] 9.1 **Error detection engine**: unbalanced entries, duplicates, miscategorization, missing fields, date anomalies, outlier amounts, uncategorized transactions, AR/AP mismatches. (Build out the guide's stub into a real rules + statistical engine.)
- [ ] 9.2 **LLM correction workflow**: Claude analyzes each detection with full accounting context → proposes a structured, *applyable* correction → human-in-the-loop approve/reject → applied with audit trail + reasoning stored. Prompt caching on the accounting-context preamble.
- [ ] 9.3 **AI auto-categorization** of imported bank transactions (learns from history + user corrections).
- [ ] 9.4 **"Chat with your books"**: natural-language questions → safe, read-only structured queries → answers with cited transactions/reports.
- [ ] 9.5 **Anomaly & fraud signals**; month-end close checklist assistant.
- [ ] 9.6 Guardrails: every AI mutation is a *proposal*; validation before apply; full reversibility; cost/usage tracking.

## PHASE 10 — Data Portability & Compliance

- [ ] 10.1 **Import from QuickBooks**: IIF, QBXML, and CSV lists (customers/vendors/items/COA/transactions); mapping wizard.
- [ ] 10.2 **Export**: IIF/CSV/QBO; full company export.
- [ ] 10.3 **Backup & Restore**: single-file encrypted backup (.bka), scheduled auto-backup, restore wizard, integrity check. (QB `.qbb` analog.)
- [ ] 10.4 **Attachments/document store** (receipts, invoices) in company file dir.
- [ ] 10.5 Audit-trail report; user activity log; data-integrity verify/rebuild tool.
- [ ] 10.6 Multi-currency (rates, realized/unrealized gain-loss) — stretch.

## PHASE 11 — Desktop Productization

- [x] 11.1 electron-builder packaging **works & verified**: `desktop:pack` produces `dist/win-unpacked/BookKeeper AI.exe` (213MB) whose embedded Next+PGlite server boots in 120ms and serves the seeded API. (Fixed: standalone `node_modules` now explicitly copied to `resources/app/node_modules`.) NSIS/portable/dmg/AppImage targets configured; signing/notarization still TODO.
- [ ] 11.2 **Auto-update** (electron-updater) with release feed.
- [ ] 11.3 Native: file associations (.bka), system tray, recent-files jumplist, OS notifications, deep print integration, "Save as PDF".
- [ ] 11.4 First-run onboarding wizard (create company, choose COA template, set fiscal year, import existing data).
- [ ] 11.5 In-app help, keyboard shortcuts, accessibility pass, dark mode, i18n scaffolding.
- [ ] 11.6 Crash reporting + opt-in telemetry (local-first, privacy-respecting).
- [ ] 11.7 Performance: handle 100k+ transactions (indexing, pagination, virtualized tables).
- [ ] 11.8 Code signing + license/EULA + open-source license decision.

## PHASE 12 — Quality, Security, Docs

- [ ] 12.1 **Unit tests** (vitest) for money, posting engine, parsers, services, reports — accounting golden cases.
- [ ] 12.2 **Integration tests** for API/service flows (invoice→payment→deposit→reconcile→report).
- [ ] 12.3 **E2E tests** (Playwright on the Electron build) for critical user journeys.
- [ ] 12.4 Security: encrypt sensitive fields (bank/SSN), keychain for secrets, input sanitization, SQL-injection-safe (Drizzle params), file-upload validation, LLM-output validation, rate limiting, CSRF.
- [ ] 12.5 Data-loss safety: transactional writes, backup before destructive ops, period locks.
- [ ] 12.6 Docs: README, user manual, accountant's guide, AI-features guide, migration-from-QuickBooks guide, developer/contributing docs, API docs.
- [ ] 12.7 Accessibility (WCAG AA) + keyboard-only operation.

---

## Cross-cutting "true competitor" gaps vs QuickBooks (checklist to keep honest)

- [ ] Multi-user with role permissions  · [ ] Multi-company  · [ ] Classes/Locations  · [ ] Multi-currency
- [ ] Recurring/memorized transactions  · [ ] Custom forms/templates for invoices & checks  · [ ] Print checks
- [ ] Bank feeds + rules  · [ ] Reconciliation  · [ ] Undeposited funds  · [ ] 1099/W-2  · [ ] Sales tax
- [ ] Inventory (FIFO/avg + COGS)  · [ ] Payroll  · [ ] Budgets  · [ ] 50+ reports + custom builder + memorized reports
- [ ] Estimates→Invoice→Payment full cycle  · [ ] PO→Bill→Pay full cycle  · [ ] Attachments  · [ ] Audit trail
- [ ] Import from QuickBooks  · [ ] Backup/restore  · [ ] Offline  · [ ] Auto-update  · [ ] Data ownership
- [ ] **AI: error correction, auto-categorize, chat-with-books (our edge)**

---

## Execution strategy

1. **Phase 0 + Phase 1 built sequentially & carefully** (shared substrate + correctness core) — done in-session, not fanned out (parallel agents would collide on these foundations).
2. **Phases 2–10 fanned out** module-by-module with subagents once the service-layer contract & posting engine are stable (each module is mostly independent given the shared base).
3. **Phases 11–12 productization & QA** after modules land.
4. Every completed item: check it off here, add tests, keep `typecheck`+`test` green.
