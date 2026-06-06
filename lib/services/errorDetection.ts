/**
 * AI Error Detection service — rules-based scan over journal entries to surface
 * data-quality issues. Findings are stored as `error_detections` rows so the LLM
 * corrector and the UI can reference them by id.
 *
 * Rules (each produces one or more detections):
 *   1. Unbalanced posted entries (total debit ≠ total credit within a cent) — CRITICAL
 *   2. Duplicate journal entries (same date + description + total debit amount) — HIGH
 *   3. Missing description or zero-amount lines — LOW
 *   4. Outlier amounts (> mean + 3 * stddev within an account) — MEDIUM
 *
 * Multi-tenant: every query is scoped by ctx.companyId.
 */
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import {
  errorDetections,
  journalEntries,
  journalEntryLines,
} from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import type { ServiceContext } from './_base';
import { writeAudit } from './_base';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DetectionRow = typeof errorDetections.$inferSelect;

// ---------------------------------------------------------------------------
// detectErrors
// ---------------------------------------------------------------------------

/**
 * Run all rule checks for the company and persist any NEW detections (skips
 * entries that already have an unresolved detection of the same type).
 * Returns the full list of detections just inserted during this run.
 */
export async function detectErrors(ctx: ServiceContext): Promise<DetectionRow[]> {
  const created: DetectionRow[] = [];

  // Collect each rule's detections in order; each helper appends to `created`.
  await detectUnbalanced(ctx, created);
  await detectDuplicates(ctx, created);
  await detectMissingFields(ctx, created);
  await detectOutliers(ctx, created);

  return created;
}

// ---------------------------------------------------------------------------
// listErrors
// ---------------------------------------------------------------------------

/**
 * List error_detections for the company.
 * @param resolved  undefined = all, true = resolved only, false = open only.
 */
export async function listErrors(
  ctx: ServiceContext,
  opts?: { resolved?: boolean },
): Promise<DetectionRow[]> {
  const conds = [eq(errorDetections.companyId, ctx.companyId)];

  if (opts?.resolved === true) {
    conds.push(isNotNull(errorDetections.resolvedAt));
  } else if (opts?.resolved === false) {
    conds.push(isNull(errorDetections.resolvedAt));
  }

  return ctx.db
    .select()
    .from(errorDetections)
    .where(and(...conds))
    .orderBy(errorDetections.detectedAt);
}

// ---------------------------------------------------------------------------
// Internal rule helpers
// ---------------------------------------------------------------------------

/**
 * Rule 1 — Unbalanced posted entries.
 * A correctly-posted entry should have SUM(debit) == SUM(credit). We re-verify
 * from raw lines rather than trusting the posting engine (which guards this), so
 * that any data imported via direct SQL or a broken migration is caught.
 */
async function detectUnbalanced(
  ctx: ServiceContext,
  out: DetectionRow[],
): Promise<void> {
  // Sum lines per entry for posted (non-void) entries.
  const sums = await ctx.db
    .select({
      entryId: journalEntryLines.journalEntryId,
      totalDebit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}::numeric), 0)`,
      totalCredit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}::numeric), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, ctx.companyId),
        eq(journalEntries.status, 'posted'),
      ),
    )
    .groupBy(journalEntryLines.journalEntryId);

  for (const row of sums) {
    if (Money.equalWithinCent(row.totalDebit, row.totalCredit)) continue;

    // Skip if an unresolved detection already exists for this entry + type.
    if (await alreadyDetected(ctx, row.entryId, 'unbalanced')) continue;

    const diff = toAmountString(Money.abs(Money.sub(row.totalDebit, row.totalCredit)));
    const [det] = await ctx.db
      .insert(errorDetections)
      .values({
        companyId: ctx.companyId,
        journalEntryId: row.entryId,
        errorType: 'unbalanced',
        severity: 'critical',
        description:
          `Unbalanced journal entry: debits ${toAmountString(row.totalDebit)} ≠ ` +
          `credits ${toAmountString(row.totalCredit)} (diff ${diff}).`,
      })
      .returning();
    out.push(det);
  }
}

/**
 * Rule 2 — Duplicate journal entries.
 * Entries with the same (date, description, total debit) within the same company
 * are flagged as likely duplicates. We group and find counts > 1.
 */
async function detectDuplicates(
  ctx: ServiceContext,
  out: DetectionRow[],
): Promise<void> {
  // Compute per-entry totals + entry header info.
  const entryTotals = await ctx.db
    .select({
      entryId: journalEntries.id,
      date: journalEntries.date,
      description: journalEntries.description,
      totalDebit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}::numeric), 0)`,
    })
    .from(journalEntries)
    .innerJoin(journalEntryLines, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, ctx.companyId),
        eq(journalEntries.status, 'posted'),
      ),
    )
    .groupBy(journalEntries.id, journalEntries.date, journalEntries.description);

  // Group in-memory to find duplicates (avoids a complex SQL self-join in PGlite).
  const groups = new Map<string, typeof entryTotals>();
  for (const row of entryTotals) {
    const key = `${row.date?.toISOString?.() ?? row.date}|${row.description}|${toAmountString(row.totalDebit)}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Flag each entry in the duplicate group that doesn't yet have a detection.
    for (const row of group) {
      if (await alreadyDetected(ctx, row.entryId, 'duplicate')) continue;

      const [det] = await ctx.db
        .insert(errorDetections)
        .values({
          companyId: ctx.companyId,
          journalEntryId: row.entryId,
          errorType: 'duplicate',
          severity: 'high',
          description:
            `Possible duplicate journal entry: "${row.description}" on ` +
            `${fmtDate(row.date)} for ${toAmountString(row.totalDebit)} — ` +
            `found ${group.length} matching entries.`,
        })
        .returning();
      out.push(det);
    }
  }
}

/**
 * Rule 3 — Missing description or zero-amount lines.
 * Covers two sub-cases:
 *   a) Journal entry has an empty/whitespace description.
 *   b) A journal entry line has both debit and credit null/0 (shouldn't happen
 *      after posting, but direct imports can introduce it).
 */
async function detectMissingFields(
  ctx: ServiceContext,
  out: DetectionRow[],
): Promise<void> {
  // 3a: entries with blank descriptions.
  const blankDesc = await ctx.db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ctx.companyId),
        sql`TRIM(${journalEntries.description}) = ''`,
      ),
    );

  for (const row of blankDesc) {
    if (await alreadyDetected(ctx, row.id, 'missing_field')) continue;
    const [det] = await ctx.db
      .insert(errorDetections)
      .values({
        companyId: ctx.companyId,
        journalEntryId: row.id,
        errorType: 'missing_field',
        severity: 'low',
        description: 'Journal entry has no description (blank memo).',
      })
      .returning();
    out.push(det);
  }

  // 3b: lines where both debit and credit are NULL (zero-amount lines).
  const zeroLines = await ctx.db
    .select({
      entryId: journalEntryLines.journalEntryId,
      lineId: journalEntryLines.id,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, ctx.companyId),
        isNull(journalEntryLines.debit),
        isNull(journalEntryLines.credit),
      ),
    );

  // Group by entry — one detection per entry (not per line).
  const zeroEntries = [...new Set(zeroLines.map((r) => r.entryId))];
  for (const entryId of zeroEntries) {
    if (await alreadyDetected(ctx, entryId, 'missing_field')) continue;
    const lineCount = zeroLines.filter((r) => r.entryId === entryId).length;
    const [det] = await ctx.db
      .insert(errorDetections)
      .values({
        companyId: ctx.companyId,
        journalEntryId: entryId,
        errorType: 'missing_field',
        severity: 'low',
        description: `${lineCount} zero-amount line(s) found (both debit and credit are null).`,
      })
      .returning();
    out.push(det);
  }
}

/**
 * Rule 4 — Outlier amounts per account (> mean + 3 * stddev).
 * We look at all debit amounts per account across posted entries and flag lines
 * whose absolute value is more than 3 standard deviations above the mean.
 * Only accounts with ≥ 3 lines are analysed (too few points → no stable stddev).
 */
async function detectOutliers(
  ctx: ServiceContext,
  out: DetectionRow[],
): Promise<void> {
  // Fetch all line amounts with their account id + entry id.
  const lines = await ctx.db
    .select({
      entryId: journalEntryLines.journalEntryId,
      accountId: journalEntryLines.accountId,
      debit: journalEntryLines.debit,
      credit: journalEntryLines.credit,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, ctx.companyId),
        eq(journalEntries.status, 'posted'),
      ),
    );

  // Group by account; compute the absolute amount (max of debit/credit).
  type LineInfo = { entryId: string; amount: number };
  const byAccount = new Map<string, LineInfo[]>();
  for (const l of lines) {
    const abs = Math.max(
      parseFloat(l.debit ?? '0') || 0,
      parseFloat(l.credit ?? '0') || 0,
    );
    const bucket = byAccount.get(l.accountId) ?? [];
    bucket.push({ entryId: l.entryId, amount: abs });
    byAccount.set(l.accountId, bucket);
  }

  for (const [accountId, bucket] of byAccount) {
    if (bucket.length < 3) continue; // insufficient data

    const amounts = bucket.map((b) => b.amount);
    const mean = amounts.reduce((s, x) => s + x, 0) / amounts.length;
    const variance =
      amounts.reduce((s, x) => s + (x - mean) ** 2, 0) / amounts.length;
    const stddev = Math.sqrt(variance);
    if (stddev === 0) continue; // all identical amounts → no outliers

    const threshold = mean + 3 * stddev;

    for (const { entryId, amount } of bucket) {
      if (amount <= threshold) continue;
      if (await alreadyDetected(ctx, entryId, 'unusual_pattern')) continue;

      const [det] = await ctx.db
        .insert(errorDetections)
        .values({
          companyId: ctx.companyId,
          journalEntryId: entryId,
          errorType: 'unusual_pattern',
          severity: 'medium',
          description:
            `Outlier amount ${toAmountString(amount)} on account ${accountId} ` +
            `(mean ${toAmountString(mean)}, stddev ${toAmountString(stddev)}, ` +
            `threshold ${toAmountString(threshold)}).`,
        })
        .returning();
      out.push(det);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True if an unresolved detection of the given type already exists for the entry. */
async function alreadyDetected(
  ctx: ServiceContext,
  journalEntryId: string,
  errorType: typeof errorDetections.$inferInsert['errorType'],
): Promise<boolean> {
  const existing = await ctx.db
    .select({ id: errorDetections.id })
    .from(errorDetections)
    .where(
      and(
        eq(errorDetections.companyId, ctx.companyId),
        eq(errorDetections.journalEntryId, journalEntryId),
        eq(errorDetections.errorType, errorType),
        isNull(errorDetections.resolvedAt),
      ),
    )
    .limit(1);
  return existing.length > 0;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '(unknown date)';
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}
