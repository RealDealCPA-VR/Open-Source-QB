# Audit Remediation — 2026-06-06

A fan-out audit (12 domain finders + per-finding adversarial verification) surfaced **54 confirmed
defects** (2 critical, 17 high, 19 medium, 16 low) plus 8 correctly-refuted false positives.

**Baseline & final state:** `tsc` clean · `next build` exit 0 · test suite **781 passing** (was 774;
+7 regression tests in `lib/services/auditFixes.test.ts`). Every fix below was verified against the
full suite.

## Fixed (41 of 54)

### Security (critical/high)
- **Paystub PDF auth bypass** (`app/api/payroll/paystub/route.ts`) — now authorizes by the portal
  employee (own stubs only) or a main-app session; unauthenticated callers get 403.
- **Unauthenticated `getServerContext` fallback** (`lib/context.ts`) — no longer honors a client
  `bka_company` cookie and no longer impersonates a real tenant. Fails closed (403) once any user
  exists; genuine first-run seeding still works. `BKA_ALLOW_DEV_FALLBACK=1` re-opens dev behavior.
- **Password-reset token leak** (`app/api/auth/request-reset`) — token returned only in the offline
  desktop build (`BKA_OFFLINE=1`, set by `electron/main.js`, 127.0.0.1-bound); always logged
  server-side; generic 200 otherwise.
- **`/api/companies/select`** — now requires a session + verified membership before setting the cookie.
- **Token audience binding** (`lib/auth.ts`) — session tokens carry a `kind` (`user`/`portal`); a
  portal token can no longer be replayed as a main-app session, and vice versa.
- **Cookies `Secure` in production** — login / signup / portal-login.
- **Backup route** no longer leaks raw internal error text.
- **`.env` no longer bundled into the desktop installer** (`package.json` extraResources filter).

### Accounting / tax correctness
- **Posting engine** (`posting.ts`): cached account balances now derive from the SAME rounded line
  values that are persisted; `assertBalanced` rounds per line and requires EXACT balance (no sub-cent
  tolerance that could persist an unbalanced entry).
- **Sales tax & commissions** exclude `void`/`draft` invoices (`salesTax`, `combinedTax`, `salesReps`).
- **Payroll reports** (`payrollReports.ts`): half-open `[start, end)` quarter/year boundaries (no
  double-count on the boundary day); tax-line queries scoped to the company's own paychecks (was
  reading every tenant's `paycheck_lines`); decimal-exact money (was IEEE-754 `parseFloat`); dead
  global query removed.
- **Federal withholding** (`payrollTax.ts`) subtracts the standard deduction before the brackets
  (was over-withholding gross). FICA still uses full gross.
- **Payments** (`payments.ts`): per-invoice over-application rejected; invoice load now filtered by id.
- **Reconciliation** (`reconcile.ts`): cleared balance now includes the opening (last-reconciled)
  balance, so the statement comparison is correct.
- **Retainage** (`invoices.markPaidAmount`): balance due computed against billed base (total − retainage).
- **Credit-limit check** compares in base currency (converts each open invoice + new exposure by rate).
- **Depreciation** (`fixedAssets.postDepreciation`): per-asset/per-date idempotency guard (409 on re-post).
- **Inventory costing-method guard**: `recordCOGS`/`adjustInventory` refuse FIFO-tracked items (they
  would otherwise value COGS at a null/zero average cost and diverge from the FIFO layers).
- **PO→Bill** (`purchaseOrders.convertToBill`): null line account now a clear validation error, not a crash.
- **payBills** rejects a non-bank/non-credit-card payment account.
- **Deactivating an account** with a non-zero balance is rejected.

### Data integrity / logic
- **Customer merge** (`merge.ts`) now re-points jobs, time entries, mileage logs, customer prices,
  bill lines and expense lines (were orphaned), with customer-price de-duplication.
- **Recurring** (`recurring.ts`): catch-up loop so an overdue template can't be immediately re-fired.
- **billTimeToInvoice** (`timeTracking.ts`): invoice + entry stamping in one transaction; refuses a
  fully un-priced (zero-total) batch.
- **CSV import** (`import.ts`): honors the declared `dateFormat` (no locale-guessing); occurrence-aware
  hash + in-batch dedup so legitimately-repeated lines aren't dropped on re-import.
- **fiscal-periods** route validates dates and `start <= end`.

## Deferred — require a DB schema migration (code change is small; left as follow-ups)
- **#3 Payment FX**: AR drift when paying foreign-currency invoices — needs currency/exchangeRate
  columns on `paymentsReceived` + a realized FX gain/loss account.
- **#5 PO→Bill atomicity**: wrap creation+stamp in one transaction + unique constraint on
  `converted_bill_id` (the null-account crash is already fixed).
- **#22 Journal entry-number race**: unique index on `(company_id, entry_number)` + atomic allocation.
- **#24 Check-number race**: partial unique index + in-transaction allocation.
- **#32 Plaid sync pagination**: needs a `plaid_cursor` column (also credential-gated / inactive).
- **#44 Vendor credit vs `amountPaid`**: needs an `amountCredited` column to separate credits from cash.
- **#45 / #48 Inventory & FIFO valuation drift**: running `inventoryValue` / per-layer `valueRemaining`
  columns so the subledger ties exactly to GL 1300.

## Deferred — design decision
- **#37 budgetVsActual**: needs a report-semantics redesign (separate income/expense totals,
  favorable/unfavorable variance, non-P&L account handling). Does not corrupt the ledger.

## Deferred — concurrency hardening (low risk on the single-connection PGlite desktop)
- **#25 / #46 / #47**: move read-validate-write into one transaction with `FOR UPDATE` for the cloud
  (Neon) path. These do not produce wrong numbers under normal single-writer operation.

## Not a defect (deliberately not changed)
- **#41 per-line tax rounding**: the finding itself notes leaving the current per-line rounding is
  acceptable; it does not affect GL balance.

## Operational note
- The Neon credential that was present in a bundled `.env` should be **rotated** — it may already
  exist in a previously-built artifact. Keep `DATABASE_URL` in `.env.local` only.
