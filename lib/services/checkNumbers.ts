/**
 * Check-number sequencing helpers (read-only).
 *
 * nextCheckNumber — scans billPayments.reference and expenses.reference
 *   for the highest numeric value and returns max+1 as a formatted string.
 *   Optionally filtered to a specific paymentAccountId so you get the
 *   next check number per bank account.
 *
 * reserveCheckNumber — alias for nextCheckNumber; returns the next
 *   available number without mutating any state (callers embed it in
 *   their own document as the reference field).
 *
 * These functions are intentionally read-only. Writing the chosen number
 * into billPayments or expenses is the responsibility of those services.
 */
import { and, eq, sql } from 'drizzle-orm';
import { billPayments, expenses } from '@/lib/db/schema';
import type { ServiceContext } from './_base';

/** Parse a string reference as a non-negative integer. Returns null if non-numeric. */
function parseRef(ref: string | null | undefined): number | null {
  if (!ref) return null;
  const trimmed = ref.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  return isNaN(n) ? null : n;
}

/**
 * Return the next available check number as a string.
 *
 * Scans numeric reference values across both billPayments and expenses
 * for this company (optionally scoped to a paymentAccountId) and returns
 * max + 1. If no numeric references exist, returns "1001" (a sensible
 * starting point for a new checkbook).
 */
export async function nextCheckNumber(
  ctx: ServiceContext,
  paymentAccountId?: string,
): Promise<string> {
  // Pull all references for the company (+ optional account filter).
  // We fetch raw varchar values and parse in JS so we stay compatible with
  // PGlite which may not support REGEXP_MATCHES in all builds.
  const bpQuery = ctx.db
    .select({ reference: billPayments.reference })
    .from(billPayments)
    .where(
      and(
        eq(billPayments.companyId, ctx.companyId),
        ...(paymentAccountId
          ? [eq(billPayments.paymentAccountId, paymentAccountId)]
          : []),
      ),
    );

  const expQuery = ctx.db
    .select({ reference: expenses.reference })
    .from(expenses)
    .where(
      and(
        eq(expenses.companyId, ctx.companyId),
        ...(paymentAccountId
          ? [eq(expenses.paymentAccountId, paymentAccountId)]
          : []),
      ),
    );

  const [bpRefs, expRefs] = await Promise.all([bpQuery, expQuery]);

  const allRefs = [
    ...bpRefs.map((r) => r.reference),
    ...expRefs.map((r) => r.reference),
  ];

  let max = 0;
  for (const ref of allRefs) {
    const n = parseRef(ref);
    if (n !== null && n > max) max = n;
  }

  // If no numeric references found, start at 1001.
  const next = max > 0 ? max + 1 : 1001;
  return String(next);
}

/**
 * Alias for nextCheckNumber — returns the next available check number
 * without reserving it (stateless; idempotent).
 */
export async function reserveCheckNumber(
  ctx: ServiceContext,
  paymentAccountId?: string,
): Promise<string> {
  return nextCheckNumber(ctx, paymentAccountId);
}
