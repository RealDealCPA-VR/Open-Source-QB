# TODO — QB Desktop Parity (Audit of 2026-06-09)

> Source of truth for remaining work. Generated from a 95-agent fan-out audit
> (10 domains; every gap existence-verified, every bug adversarially confirmed).
> Full machine-readable detail (evidence, file:line, fix sketches): `audit-findings.json`.
> The previous master plan (claiming completion) is archived at `TODO-archive-2026-06-06.md`.
>
> Scope constraints honored: payroll is simple AFTER-THE-FACT (no direct deposit, no IRS
> e-file); credential-gated integrations (Plaid live keys, payment processors, CA certs)
> are out of scope and not listed.

**Status legend:** `[ ]` todo · `[~]` in progress · `[x]` done


## 📊 Status after remediation session (2026-06-09)

**All 72 confirmed bugs fixed** (each with regression tests). **78 of 123 gaps built** — every
critical and every high-severity gap is closed; the 45 open boxes below are medium/low.
**UI perfection pass complete**: design system unified (one palette, no !important hacks, kit
gained Modal sizes / ConfirmDialog / EmptyState / Button-loading / numeric cells / skeletons),
then 188 reviewed findings fixed across all ~95 pages (consistent money/date formatting,
loading/empty/error states, confirm dialogs, focus management, per-route loading.tsx).

**Verification:** tsc clean · next build exit 0 · vitest 1204 tests / 109 files all passing
(was 781/74 at session start). Schema migrations 0011-0015 added (sourceRef, sales receipts,
void/refund columns, partial-PO billing, billable-line links, employee address/accruals).

Machine-readable audit detail remains in audit-findings.json.

## Execution plan

1. **Wave 0 — posting-core prerequisites**: persist `sourceRef` on journal entries (unblocks
   drill-down, dedup guards, deposit backfill); opening-balance-equity posting.
2. **Wave 1 — all 72 confirmed bugs**, partitioned into 8 file-disjoint packages, each with
   regression tests.
3. **Wave 2 — critical/high gaps** (perpetual inventory on forms, Write Checks, Sales
   Receipts, payment void/unapply, bank-feed match/exclude, undo reconciliation,
   credit-card workflow, employer payroll taxes, payroll items, RBAC enforcement,
   report drill-down, registers, closing date, editable documents).
4. **Wave 3 — medium/low gaps** (preferences depth, condense, custom fields, UoM, etc.).
5. **UI perfection pass** (workflow-driven page-by-page review + fixes).
6. Final: `tsc` clean · full vitest suite green · `next build` exit 0.

## Bugs (72) — fix all
- [x] **[CRITICAL]** (sales-ar) Invoice API silently drops discountType, currency, and exchangeRate that the UI sends
- [x] **[CRITICAL]** (data-portability) Backup download and restore API is completely unauthenticated (full data exfiltration/overwrite)
- [x] **[HIGH]** (gl-company) Creating an account from the UI fails with a 500 unless the user types an exact enum subtype
- [x] **[HIGH]** (gl-company) General Ledger register running balance ignores all activity before the 'from' date (no beginning balance)
- [x] **[HIGH]** (gl-company) sourceRef is accepted from 20+ posting callers but silently discarded — GL entries have no link to their source documents
- [x] **[HIGH]** (sales-ar) applyToInvoice (credit memo) recomputes balanceDue from invoice.total, ignoring retainage
- [x] **[HIGH]** (sales-ar) Customer statements omit credit memos, overstating what the customer owes
- [x] **[HIGH]** (sales-ar) receivePayment has no foreign-currency handling — A/R never clears in the GL for FX invoices
- [x] **[HIGH]** (purchases-ap) PO-to-bill conversion is not atomic — double-conversion can double-post A/P
- [x] **[HIGH]** (banking) Credit-card (liability) reconciliation math is sign-inverted — can never balance against a normal statement
- [x] **[HIGH]** (banking) Reconciled transactions can be voided/unmatched with no guard, silently corrupting the reconciliation opening balance
- [x] **[HIGH]** (banking) An in-progress reconciliation can never be cancelled or have its statement balance corrected
- [x] **[HIGH]** (inventory) Reorder point is not settable anywhere — reorder report and low-stock alerts are permanently empty
- [x] **[HIGH]** (inventory) physicalCount bypasses the FIFO costing-method guard and corrupts FIFO-tracked items
- [x] **[HIGH]** (inventory) buildAssembly/unbuildAssembly bypass the FIFO guard — FIFO components consumed at $0 without depleting layers
- [x] **[HIGH]** (payroll) 941 worksheet line 5a/5c/6 understates total tax: prints employee withheld amounts and omits the entire employer FICA share
- [x] **[HIGH]** (payroll) W-2 and 941 aggregations include paychecks whose GL posting was voided
- [x] **[HIGH]** (reports) Year-end close zeroes out P&L (and Budget vs Actual / P&L by class / monthly P&L) for the closed year
- [x] **[HIGH]** (reports) Cash Flow statement does not tie to cash: hardcoded account codes, missing liability/asset sections, and double-counts net income after year-end close
- [x] **[HIGH]** (data-portability) Restore extracts over a live, open PGlite database and never clears the target directory
- [x] **[HIGH]** (app-shell-ux) Root route '/' is a leftover hardcoded mock dashboard — and it is the Electron start page
- [x] **[HIGH]** (app-shell-ux) All Electron application-menu actions are dead — no renderer ever subscribes to the IPC events
- [x] **[HIGH]** (app-shell-ux) Launch-time recurring/memorized-transaction run always fails with 403 in the packaged app
- [x] **[HIGH]** (integrity-security) Multi-line foreign-currency invoices throw UNBALANCED and cannot be created (per-line FX rounding)
- [x] **[HIGH]** (integrity-security) GET/POST /api/companies is completely unauthenticated — cross-tenant company listing and rogue company creation
- [x] **[HIGH]** (integrity-security) Duplicate invoiceId/billId in a payment's applications bypasses the over-application guard and desyncs AR/AP control accounts from the subledger
- [x] **[HIGH]** (integrity-security) createAccount openingBalance writes the cached balance with no offsetting journal entry — breaks double-entry and the app's own integrity check
- [x] **[MEDIUM]** (gl-company) Account opening balance sets the cached balance with no offsetting GL entry — chart of accounts disagrees with every report and trips the integrity checker
- [x] **[MEDIUM]** (gl-company) Audit Trail UI before/after diff is always empty — the detail fetch was never implemented
- [x] **[MEDIUM]** (gl-company) Closed fiscal periods can never be reopened — reopenPeriod is dead code with no API route or UI, while the error message tells users to reopen
- [x] **[MEDIUM]** (gl-company) updateAccount accepts self/cyclic/cross-company parentId — cyclic accounts silently vanish from the account tree
- [x] **[MEDIUM]** (gl-company) Year-end close ignores the company's configured fiscal year end — hardcoded to the calendar year
- [x] **[MEDIUM]** (sales-ar) Estimate and sales-order conversion is not atomic — failure after invoice creation leaves the source document convertible again
- [x] **[MEDIUM]** (purchases-ap) Applying a vendor credit inflates bills.amountPaid, conflating credits with cash paid
- [x] **[MEDIUM]** (purchases-ap) 1099 totals include credit-card-funded bill payments (IRS says exclude; QB Desktop excludes them)
- [x] **[MEDIUM]** (purchases-ap) Recurring bill/invoice templates freeze the document date instead of using the run date
- [x] **[MEDIUM]** (banking) OFX parser breaks on OFX 2.x XML files and single-line SGML files
- [x] **[MEDIUM]** (banking) Categorization rule 'setPayee' is accepted and stored but never applied anywhere
- [x] **[MEDIUM]** (banking) Bank-feed categorize is not atomic — GL entry posts before the staging row is flagged, outside any shared transaction
- [x] **[MEDIUM]** (inventory) FIFO postings ignore item.assetAccountId and always hit account 1300
- [x] **[MEDIUM]** (inventory) Average-cost valuation report values FIFO-tracked items at zero (and includes non-inventory items)
- [x] **[MEDIUM]** (inventory) unbuildAssembly creates/destroys inventory value with no GL entry when component costs have drifted
- [x] **[MEDIUM]** (payroll) POST /api/payroll silently disables documented auto-withholding by coercing missing taxes to []
- [x] **[MEDIUM]** (payroll) Timezone mismatch: pay dates stored as UTC midnight but W-2/941 period ranges built in server-local time, misclassifying boundary-day paychecks
- [x] **[MEDIUM]** (payroll) Auto-withholding applies SS wage base and Additional Medicare by annualizing the current period instead of YTD wages
- [x] **[MEDIUM]** (reports) A/R and A/P aging 'as of' a past date is wrong — uses live balanceDue and includes invoices/bills created after asOf
- [x] **[MEDIUM]** (reports) General Ledger report with a 'from' date has no opening balance — running balance and 'Closing Balance' are wrong
- [x] **[MEDIUM]** (reports) Budget vs Actual semantics broken: income and expenses summed into one total; no favorable/unfavorable variance; balance-sheet budget lines compare to zero
- [x] **[MEDIUM]** (reports) Budget vs Actual by Class silently drops actuals that have no matching budget line
- [x] **[MEDIUM]** (reports) Inventory Valuation report values FIFO-tracked items at average cost, so it misstates value and cannot tie to GL inventory
- [x] **[MEDIUM]** (data-portability) Restore accepts any zip with no validation — a wrong or junk file silently 'succeeds' and bricks the company file
- [x] **[MEDIUM]** (data-portability) Electron File-menu items (Backup Company, New/Open Company, Import Bank File) are dead — no renderer listener
- [x] **[MEDIUM]** (app-shell-ux) Dashboard KPIs labeled 'YTD' actually show all-time totals
- [x] **[MEDIUM]** (app-shell-ux) Global search results never link to the found record — always to the unfiltered list page
- [x] **[MEDIUM]** (app-shell-ux) Command palette destination list is out of sync with the sidebar despite claiming otherwise
- [x] **[MEDIUM]** (integrity-security) creditMemos.applyToInvoice recomputes balanceDue from invoice.total, ignoring retainage — re-introduces the holdback and can show a positive balance on a settled invoice
- [x] **[LOW]** (gl-company) Journal Entries page tests status === 'voided' but the enum value is 'void' — voided entries are mis-styled and unlabeled
- [x] **[LOW]** (gl-company) Electron File > New Company / Open Company menu items are dead — no renderer ever subscribes to the menu channel
- [x] **[LOW]** (sales-ar) listInvoices/listCreditMemos fetch the entire table and filter in JavaScript
- [x] **[LOW]** (purchases-ap) listBillPayments returns OLDEST-first with a default limit of 100, contradicting its documented contract
- [x] **[LOW]** (purchases-ap) GL descriptions/memos for bills and bill payments embed the vendor UUID instead of the vendor name
- [x] **[LOW]** (banking) Deposit GL entries carry a permanent 'deposit:pending' sourceRef that is never backfilled
- [x] **[LOW]** (banking) listClearable loads every cleared reconciliation item in the entire database on each call
- [x] **[LOW]** (inventory) setBom allows circular BOMs (only direct self-reference is blocked)
- [x] **[LOW]** (inventory) physicalCount accepts non-inventory item types despite its loader's name
- [x] **[LOW]** (payroll) W-2 download picker excludes inactive employees, blocking W-2s for terminated staff
- [x] **[LOW]** (reports) General Ledger report omits deactivated accounts entirely, so GL no longer reconciles to the journal/trial balance
- [x] **[LOW]** (data-portability) IIF account import silently drops accounts on derived-code collisions and reports no per-row errors
- [x] **[LOW]** (app-shell-ux) Offline desktop app loads its UI font from Google Fonts CDN
- [x] **[LOW]** (app-shell-ux) Modals cannot be closed with Escape and have no focus trap
- [x] **[LOW]** (app-shell-ux) Sidebar and palette navigation use full-page loads instead of client-side routing
- [x] **[LOW]** (integrity-security) bankCategorize.categorize/unmatch are not transactional — GL posting and matched-flag update can diverge, enabling duplicate postings

## Missing QB Desktop features (123)
- [x] **[CRITICAL/medium]** (sales-ar) Sales Receipts do not exist at all
- [x] **[CRITICAL/medium]** (sales-ar) Selling an inventory item on an invoice never posts COGS or decrements quantity on hand
- [x] **[CRITICAL/medium]** (purchases-ap) Write Checks / direct expense entry does not exist — the expenses tables are completely orphaned
- [x] **[CRITICAL/medium]** (app-shell-ux) No item column or lookup-as-you-type on sales/purchase line-item grids
- [x] **[CRITICAL/large]** (gl-company) No QB-style account registers (editable register views for bank/credit-card/AR/AP)
- [x] **[CRITICAL/large]** (banking) Bank-feed 'Match to existing transaction' does not exist — review is Add-only
- [x] **[CRITICAL/large]** (banking) 'Write Checks' transaction does not exist; Print Checks records nothing and there is no check queue
- [x] **[CRITICAL/large]** (inventory) Sales and purchase forms are completely disconnected from inventory (no perpetual inventory)
- [x] **[CRITICAL/large]** (reports) No report drill-down (QuickZoom) anywhere
- [x] **[HIGH/small]** (sales-ar) Job and class tagging on invoices is unreachable — job-costing revenue can never be populated through the app
- [x] **[HIGH/small]** (purchases-ap) Pay Bills has no user interface — API only
- [x] **[HIGH/small]** (banking) No 'Exclude' for bank-feed transactions
- [x] **[HIGH/small]** (app-shell-ux) No error boundaries or route loading states anywhere in the app
- [x] **[HIGH/medium]** (gl-company) No drill-down (QuickZoom) from any report or GL row to the underlying transaction
- [x] **[HIGH/medium]** (gl-company) No account merge
- [x] **[HIGH/medium]** (gl-company) No closing date with closing-date password
- [x] **[HIGH/medium]** (sales-ar) No refund checks — credit memos and overpayments cannot be refunded
- [x] **[HIGH/medium]** (sales-ar) Overpayments/unapplied payments are stranded: no later application, and payments cannot be voided or unapplied
- [x] **[HIGH/medium]** (sales-ar) No billable-expense passthrough onto invoices
- [x] **[HIGH/medium]** (sales-ar) Sales tax is not computed on estimates or credit memos
- [x] **[HIGH/medium]** (sales-ar) Invoice UI cannot select items or apply sales tax
- [x] **[HIGH/medium]** (purchases-ap) No credit card charge / credit card credit transaction type
- [x] **[HIGH/medium]** (purchases-ap) No partial receipt / partial billing of purchase orders
- [x] **[HIGH/medium]** (purchases-ap) Bill payments cannot be voided, deleted, or unapplied — paid-in-error is a permanent dead end
- [x] **[HIGH/medium]** (banking) No Undo Last Reconciliation
- [x] **[HIGH/medium]** (banking) No reconciliation reports (summary/detail/discrepancy)
- [x] **[HIGH/medium]** (banking) No beginning-balance display, mismatch detection, or repair workflow
- [x] **[HIGH/medium]** (banking) No credit-card workflow: enter charges, reconcile (sign-aware), and pay-credit-card prompt
- [ ] **[HIGH/medium]** (inventory) Group/bundle items do not expand into components on sales forms
- [ ] **[HIGH/medium]** (payroll) Employer payroll taxes and company contributions cannot be computed or recorded
- [x] **[HIGH/medium]** (payroll) No employee edit, deactivate, or termination; SSN / address / W-4 / state fields can never be entered
- [x] **[HIGH/medium]** (payroll) No paycheck void, delete, or edit
- [x] **[HIGH/medium]** (payroll) No payroll summary / detail / liability-balance reports
- [x] **[HIGH/medium]** (payroll) No itemized earnings: every paycheck is a single 'Gross Pay' line — no hours x rate, overtime, bonus, or commission items
- [x] **[HIGH/medium]** (reports) Core financial statements have no date-range/as-of selection (and no API routes)
- [x] **[HIGH/medium]** (reports) A/R & A/P Aging Detail, Open Invoices, and Collections reports missing
- [x] **[HIGH/medium]** (reports) Reconciliation reports and undo-reconciliation missing
- [x] **[HIGH/medium]** (data-portability) CSV list import limited to customers and vendors — no items or Chart of Accounts CSV import
- [x] **[HIGH/medium]** (data-portability) No 'export lists' capability at all — customers, vendors, items, CoA, employees cannot be exported to CSV/Excel/IIF
- [x] **[HIGH/medium]** (data-portability) No Rebuild Data utility — verify exists but is read-only with no repair action
- [x] **[HIGH/medium]** (data-portability) Backup is whole-data-dir, not per-company — restoring one company's .bka wipes all companies
- [x] **[HIGH/medium]** (app-shell-ux) No automatic backup on close or scheduled backup
- [x] **[HIGH/medium]** (app-shell-ux) Home dashboard has no insights, reminders, or actionable cards
- [ ] **[HIGH/medium]** (app-shell-ux) Core financial reports have no print/email/export and no date-range controls
- [x] **[HIGH/medium]** (integrity-security) RBAC exists but is never enforced — every company member can do everything
- [x] **[HIGH/medium]** (integrity-security) No way to void/delete/unapply a received payment or bill payment
- [x] **[HIGH/medium]** (integrity-security) Employer payroll taxes (employer FICA match, FUTA) are never computed or recorded
- [x] **[HIGH/large]** (sales-ar) No progress invoicing from estimates
- [x] **[HIGH/large]** (sales-ar) Invoices (and estimates/sales orders) cannot be edited after creation
- [ ] **[HIGH/large]** (purchases-ap) No item receipts — QB 'Receive Items' before the bill is entirely absent
- [x] **[HIGH/large]** (purchases-ap) Bills cannot carry item lines and purchases never update inventory
- [x] **[HIGH/large]** (banking) No bank account register view
- [ ] **[HIGH/large]** (payroll) No payroll item system or GL mapping — all postings hardcoded to accounts 6500/2300/1000
- [x] **[HIGH/large]** (data-portability) IIF import handles only accounts/customers/vendors — no items, classes, employees, transactions, or opening balances
- [x] **[HIGH/large]** (integrity-security) Inventory is not integrated with invoices or bills — no automatic COGS or quantity relief on sale, no item receipt on purchase
- [x] **[MEDIUM/small]** (gl-company) No reversing journal entries
- [x] **[MEDIUM/small]** (gl-company) No fiscal-period management UI
- [x] **[MEDIUM/small]** (sales-ar) Customer price lists exist but are never applied when invoicing; no QB-style price levels
- [x] **[MEDIUM/small]** (purchases-ap) Vendor credits cannot be unapplied and there is no vendor refund flow
- [x] **[MEDIUM/small]** (banking) No service charge / interest earned entry during reconciliation
- [x] **[MEDIUM/small]** (banking) No Missing Check Numbers report
- [x] **[MEDIUM/small]** (banking) Undo categorization (unmatch) is dead code — no API route or UI exposes it
- [ ] **[MEDIUM/small]** (inventory) No inventory value adjustment (revaluation) — quantity-only adjustments
- [ ] **[MEDIUM/small]** (inventory) Items UI/API cannot set account mappings, taxable flag, or show quantity on hand
- [x] **[MEDIUM/small]** (payroll) W-2 worksheet missing Boxes 3/5 (SS/Medicare wages), state boxes 15-17, and employer EIN
- [x] **[MEDIUM/small]** (payroll) Pay stubs have no year-to-date column
- [x] **[MEDIUM/small]** (reports) Sales by Customer, Purchases by Vendor, and P&L % of Income are implemented but unreachable (dead code)
- [x] **[MEDIUM/small]** (reports) No Comparative Balance Sheet (prior period/year columns)
- [ ] **[MEDIUM/small]** (app-shell-ux) No calculator/QuickMath in amount fields
- [ ] **[MEDIUM/small]** (app-shell-ux) Line-item grids lack keyboard row add/delete
- [ ] **[MEDIUM/small]** (app-shell-ux) No active-company indicator or quick switcher in the shell; window title is static
- [x] **[MEDIUM/medium]** (gl-company) Journal entries cannot be edited — void-and-retype is the only correction path
- [x] **[MEDIUM/medium]** (gl-company) Sub-account hierarchy exists in the schema but is unusable: no UI to create/view sub-accounts and no report roll-up
- [ ] **[MEDIUM/medium]** (gl-company) Year-end close is a hard posted closing entry, not QB's soft close — multi-year P&L ranges show the closed year as zero
- [ ] **[MEDIUM/medium]** (gl-company) Multi-company file management is half-built: switcher only — dead File-menu actions, no per-company data dirs, no rename/delete, no recent-files
- [x] **[MEDIUM/medium]** (sales-ar) Finance charges / late fees do not exist
- [ ] **[MEDIUM/medium]** (sales-ar) Sales orders cannot be partially invoiced (no backorder tracking)
- [ ] **[MEDIUM/medium]** (sales-ar) No pending (non-posting) invoices — every invoice posts immediately
- [ ] **[MEDIUM/medium]** (sales-ar) No custom fields on customers (or any sales form)
- [x] **[MEDIUM/medium]** (purchases-ap) Early-payment discounts (discounts taken) and vendor terms are not implemented
- [ ] **[MEDIUM/medium]** (purchases-ap) Bills cannot be edited after creation
- [ ] **[MEDIUM/medium]** (purchases-ap) 1099 tracking lacks account mapping, 1099-MISC, and payment-method awareness
- [x] **[MEDIUM/medium]** (purchases-ap) Check printing is disconnected from transactions — no print queue, no check register
- [ ] **[MEDIUM/medium]** (purchases-ap) Memorized bills are half-built: raw-JSON entry, no auto-enter options, limited document types
- [ ] **[MEDIUM/medium]** (purchases-ap) Pay Sales Tax has no per-agency liability tracking; agency liability accounts are dead config
- [x] **[MEDIUM/medium]** (purchases-ap) Bill class / billable customer:job tagging is dropped by the service even though the schema supports it
- [x] **[MEDIUM/medium]** (banking) Make Deposits lacks cash back, extra deposit lines, payment-method grouping, and delete/void
- [ ] **[MEDIUM/medium]** (banking) CSV import UI exposes a fraction of the mapper and has no preview
- [ ] **[MEDIUM/medium]** (inventory) Missing QB item types: other charge, discount, subtotal, payment, and sales-tax items
- [ ] **[MEDIUM/medium]** (inventory) Units of measure not implemented (dead schema column)
- [ ] **[MEDIUM/medium]** (inventory) Inventory valuation reporting is thin: no as-of-date, no valuation detail, no stock status reports, and the average-cost valuation has no UI
- [ ] **[MEDIUM/medium]** (payroll) No pre-tax vs post-tax deduction distinction and no garnishment support
- [x] **[MEDIUM/medium]** (payroll) No 940 (FUTA) worksheet and no W-3 transmittal worksheet
- [x] **[MEDIUM/medium]** (payroll) No sick / vacation accrual tracking
- [x] **[MEDIUM/medium]** (payroll) Pay-liabilities flow is a single lump-sum journal against 2300 — no per-item/per-period liability tracking
- [ ] **[MEDIUM/medium]** (payroll) No pay runs / scheduled batch payroll
- [x] **[MEDIUM/medium]** (reports) Sales by Item, Purchases by Item, and Sales by Rep reports missing
- [x] **[MEDIUM/medium]** (reports) Banking reports missing: Missing Checks, Check Detail, Deposit Detail
- [ ] **[MEDIUM/medium]** (reports) Report export incomplete: no Excel anywhere, no PDF for any financial report, CSV on only ~7 of 18 report pages
- [ ] **[MEDIUM/medium]** (reports) Inventory Valuation has no as-of date and no Detail report
- [ ] **[MEDIUM/medium]** (reports) Budget vs Actual lacks period columns and period selection
- [x] **[MEDIUM/medium]** (reports) No Transaction List by Date / Transaction Detail report with filters
- [ ] **[MEDIUM/medium]** (data-portability) Report CSV export inconsistent; no Excel export for any report
- [ ] **[MEDIUM/medium]** (data-portability) No scheduled/automatic backups and no backup-before-destructive-operations
- [ ] **[MEDIUM/medium]** (app-shell-ux) Almost no keyboard shortcuts (only Ctrl+K) and no QB date-entry keys
- [ ] **[MEDIUM/medium]** (app-shell-ux) No .bka file association / open-company-from-OS, and Electron is hardwired to a single 'default' company dir
- [ ] **[MEDIUM/medium]** (app-shell-ux) Global search scope is shallow and palette has no actions
- [x] **[MEDIUM/medium]** (integrity-security) No protection for reconciled transactions and no Undo Last Reconciliation
- [ ] **[MEDIUM/large]** (gl-company) Company preferences coverage is a fraction of QBD's Preferences dialog
- [ ] **[MEDIUM/large]** (reports) Report customization is minimal: no column picker, no entity/class/memo filters, no custom headers, no basis toggle on standard reports
- [ ] **[MEDIUM/large]** (data-portability) No Condense/Archive utility for old closed periods
- [ ] **[MEDIUM/large]** (integrity-security) Zod validation declared as an architecture rule but never implemented — mutating routes pass raw JSON into services
- [ ] **[LOW/small]** (sales-ar) No packing slips
- [x] **[LOW/small]** (sales-ar) Statements: single chronological format only — no open-item statement, no batch generation
- [ ] **[LOW/small]** (banking) QFX files are rejected even though the parser already handles them
- [ ] **[LOW/small]** (inventory) No physical inventory worksheet / batch count entry
- [ ] **[LOW/small]** (data-portability) No migration-from-QuickBooks documentation
- [x] **[LOW/small]** (app-shell-ux) No window-state persistence in Electron
- [ ] **[LOW/small]** (integrity-security) Year-end close hardcodes calendar year, ignoring the company's fiscalYearEnd setting
- [ ] **[LOW/medium]** (inventory) No pending builds
- [ ] **[LOW/medium]** (inventory) Sales orders do not commit stock / no quantity-available tracking
- [ ] **[LOW/medium]** (payroll) Time tracking is not connected to payroll
- [ ] **[LOW/medium]** (reports) No Transaction History (linked-transactions) view