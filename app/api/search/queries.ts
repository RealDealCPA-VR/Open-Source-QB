/**
 * Global-search data layer: parallel, LIMIT-capped, companyId-scoped lookups across every
 * searchable record type. Kept separate from route.ts (which may only export HTTP handlers)
 * so it can be integration-tested directly against a PGlite instance.
 *
 * Scope (each capped at SEARCH_LIMIT rows):
 *  - customers / vendors by display name; items by name or SKU
 *  - invoices by invoice number; bills by bill number
 *  - payments received by reference
 *  - employees by first/last/full name
 *  - accounts by name or code
 *  - journal entries by entry number or description
 *  - exact amounts ("123.45", "$1,234.50") against invoice/bill/expense totals
 */
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import type { DB } from '@/lib/db';
import {
  accounts,
  bills,
  customers,
  employees,
  expenses,
  invoices,
  items,
  journalEntries,
  paymentsReceived,
  vendors,
} from '@/lib/db/schema';

/** Per-type result cap — keeps the palette snappy even on large files. */
export const SEARCH_LIMIT = 5;

/**
 * If the query looks like a money amount ("123.45", "$1,234.5", "1200"), return the
 * normalized numeric string for exact-total matching; otherwise null.
 */
export function parseAmountQuery(q: string): string | null {
  const cleaned = q.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Hit groups keyed by short names (cust/vend/itm/inv predate this widening — kept stable so
 * existing buildResults callers/tests keep compiling; buildResults accepts Partial<SearchHits>).
 */
export interface SearchHits {
  cust: { id: string; label: string }[];
  vend: { id: string; label: string }[];
  itm: { id: string; label: string }[];
  inv: { id: string; num: number | string | null }[];
  bill: { id: string; num: string | null }[];
  pay: { id: string; reference: string | null; amount: string }[];
  emp: { id: string; name: string }[];
  acct: { id: string; code: string; name: string }[];
  je: { id: string; entryNumber: number; description: string }[];
  /** Exact-amount matches against document totals. */
  amtInv: { id: string; num: number | string | null; total: string }[];
  amtBill: { id: string; num: string | null; total: string }[];
  amtExp: { id: string; payee: string | null; total: string }[];
}

/** Run all type queries in parallel. Every query is scoped to companyId. */
export async function runGlobalSearch(db: DB, companyId: string, q: string): Promise<SearchHits> {
  const like = `%${q}%`;
  const amount = parseAmountQuery(q);
  const none = Promise.resolve([]);

  const [
    cust,
    vend,
    itm,
    inv,
    bill,
    pay,
    emp,
    acct,
    je,
    amtInv,
    amtBill,
    amtExp,
  ] = await Promise.all([
    db
      .select({ id: customers.id, label: customers.displayName })
      .from(customers)
      .where(and(eq(customers.companyId, companyId), ilike(customers.displayName, like)))
      .limit(SEARCH_LIMIT),
    db
      .select({ id: vendors.id, label: vendors.displayName })
      .from(vendors)
      .where(and(eq(vendors.companyId, companyId), ilike(vendors.displayName, like)))
      .limit(SEARCH_LIMIT),
    db
      .select({ id: items.id, label: items.name })
      .from(items)
      .where(
        and(eq(items.companyId, companyId), or(ilike(items.name, like), ilike(items.sku, like))),
      )
      .limit(SEARCH_LIMIT),
    db
      .select({ id: invoices.id, num: invoices.invoiceNumber })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          sql`CAST(${invoices.invoiceNumber} AS TEXT) ILIKE ${like}`,
        ),
      )
      .limit(SEARCH_LIMIT),
    db
      .select({ id: bills.id, num: bills.billNumber })
      .from(bills)
      .where(and(eq(bills.companyId, companyId), ilike(bills.billNumber, like)))
      .limit(SEARCH_LIMIT),
    db
      .select({
        id: paymentsReceived.id,
        reference: paymentsReceived.reference,
        amount: paymentsReceived.amount,
      })
      .from(paymentsReceived)
      .where(
        and(eq(paymentsReceived.companyId, companyId), ilike(paymentsReceived.reference, like)),
      )
      .limit(SEARCH_LIMIT),
    db
      .select({
        id: employees.id,
        name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      })
      .from(employees)
      .where(
        and(
          eq(employees.companyId, companyId),
          or(
            ilike(employees.firstName, like),
            ilike(employees.lastName, like),
            sql`(${employees.firstName} || ' ' || ${employees.lastName}) ILIKE ${like}`,
          ),
        ),
      )
      .limit(SEARCH_LIMIT),
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(
        and(
          eq(accounts.companyId, companyId),
          or(ilike(accounts.name, like), ilike(accounts.code, like)),
        ),
      )
      .limit(SEARCH_LIMIT),
    db
      .select({
        id: journalEntries.id,
        entryNumber: journalEntries.entryNumber,
        description: journalEntries.description,
      })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, companyId),
          or(
            sql`CAST(${journalEntries.entryNumber} AS TEXT) ILIKE ${like}`,
            ilike(journalEntries.description, like),
          ),
        ),
      )
      .limit(SEARCH_LIMIT),
    // Exact-amount matches only run when the query parses as a money amount.
    amount === null
      ? none
      : db
          .select({ id: invoices.id, num: invoices.invoiceNumber, total: invoices.total })
          .from(invoices)
          .where(
            and(
              eq(invoices.companyId, companyId),
              sql`${invoices.total} = CAST(${amount} AS NUMERIC)`,
            ),
          )
          .limit(SEARCH_LIMIT),
    amount === null
      ? none
      : db
          .select({ id: bills.id, num: bills.billNumber, total: bills.total })
          .from(bills)
          .where(
            and(eq(bills.companyId, companyId), sql`${bills.total} = CAST(${amount} AS NUMERIC)`),
          )
          .limit(SEARCH_LIMIT),
    amount === null
      ? none
      : db
          .select({ id: expenses.id, payee: expenses.payeeName, total: expenses.total })
          .from(expenses)
          .where(
            and(
              eq(expenses.companyId, companyId),
              sql`${expenses.total} = CAST(${amount} AS NUMERIC)`,
            ),
          )
          .limit(SEARCH_LIMIT),
  ]);

  return {
    cust,
    vend,
    itm,
    inv,
    bill,
    pay,
    emp,
    acct,
    je,
    amtInv: amtInv as SearchHits['amtInv'],
    amtBill: amtBill as SearchHits['amtBill'],
    amtExp: amtExp as SearchHits['amtExp'],
  };
}
