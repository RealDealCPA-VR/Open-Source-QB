/**
 * Bank Reconciliation service.
 *
 * The reconciliation workflow follows the standard accounting practice:
 *   1. startReconciliation  — open a session against a bank statement.
 *   2. listClearable        — show un-cleared GL lines for the bank account.
 *   3. toggleCleared        — mark / un-mark individual lines as cleared.
 *   4. getProgress          — compare cleared balance to statement balance.
 *   5. completeReconciliation — finalize when difference ≤ $0.01.
 *
 * No journal entries are created by reconciliation itself; it is purely a
 * matching / confirmation step.  The GL lines being reconciled were already
 * posted by other services (invoices, expenses, transfers, etc.).
 */
import { and, desc, eq, isNull, lte, ne } from 'drizzle-orm';
import {
  accounts,
  bankAccounts,
  journalEntries,
  journalEntryLines,
  reconciliationItems,
  reconciliations,
} from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import {
  type ServiceContext,
  ServiceError,
  inTransaction,
  notFound,
  validation,
  writeAudit,
} from './_base';

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface StartReconciliationInput {
  bankAccountId: string;
  statementDate: Date;
  /** The ending balance shown on the bank statement (positive = asset balance). */
  statementBalance: string | number;
}

export interface ClearableLine {
  journalEntryLineId: string;
  journalEntryId: string;
  date: Date;
  description: string;
  /** Positive = credit to the bank account (money out), negative = debit (money in). */
  debit: string | null;
  credit: string | null;
  memo: string | null;
  isCleared: boolean;
}

export interface ReconciliationProgress {
  reconciliationId: string;
  statementBalance: string;
  /** Sum of natural-side amounts for all lines currently marked cleared. */
  clearedBalance: string;
  /** statementBalance − clearedBalance.  Should be 0.00 to complete. */
  difference: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Load a reconciliation row, enforcing company scope. */
async function loadReconciliation(ctx: ServiceContext, reconciliationId: string) {
  // reconciliations does not carry companyId directly — scope via bankAccounts.
  const [row] = await ctx.db
    .select({
      id: reconciliations.id,
      bankAccountId: reconciliations.bankAccountId,
      statementDate: reconciliations.statementDate,
      statementBalance: reconciliations.statementBalance,
      reconciledBalance: reconciliations.reconciledBalance,
      status: reconciliations.status,
      createdBy: reconciliations.createdBy,
      createdAt: reconciliations.createdAt,
      completedAt: reconciliations.completedAt,
      // also pull the GL account id and companyId for scope check
      companyId: bankAccounts.companyId,
      glAccountId: bankAccounts.accountId,
    })
    .from(reconciliations)
    .innerJoin(bankAccounts, eq(reconciliations.bankAccountId, bankAccounts.id))
    .where(eq(reconciliations.id, reconciliationId));

  if (!row) throw notFound('Reconciliation');
  if (row.companyId !== ctx.companyId) throw notFound('Reconciliation');
  return row;
}

/** Compute the sum of cleared line amounts (natural balance direction for an asset account). */
async function computeClearedBalance(
  ctx: ServiceContext,
  reconciliationId: string,
): Promise<ReturnType<typeof Money.zero>> {
  // Pull every cleared item for this reconciliation.
  const items = await ctx.db
    .select({
      debit: journalEntryLines.debit,
      credit: journalEntryLines.credit,
    })
    .from(reconciliationItems)
    .innerJoin(
      journalEntryLines,
      eq(reconciliationItems.journalEntryLineId, journalEntryLines.id),
    )
    .where(
      and(
        eq(reconciliationItems.reconciliationId, reconciliationId),
        eq(reconciliationItems.isCleared, true),
      ),
    );

  // For a bank (asset) account the natural-side amount is debit − credit.
  let cleared = Money.zero();
  for (const item of items) {
    const d = Money.of(item.debit);
    const c = Money.of(item.credit);
    cleared = cleared.plus(d).minus(c);
  }
  return cleared;
}

// ---------------------------------------------------------------------------
// Public service functions
// ---------------------------------------------------------------------------

/**
 * List all reconciliations for this company, joined to bankAccounts so the caller
 * gets bankName and accountNumber for display purposes. Most-recent first.
 */
export async function listReconciliations(ctx: ServiceContext) {
  const rows = await ctx.db
    .select({
      id: reconciliations.id,
      bankAccountId: reconciliations.bankAccountId,
      statementDate: reconciliations.statementDate,
      statementBalance: reconciliations.statementBalance,
      reconciledBalance: reconciliations.reconciledBalance,
      status: reconciliations.status,
      createdBy: reconciliations.createdBy,
      createdAt: reconciliations.createdAt,
      completedAt: reconciliations.completedAt,
      bankName: bankAccounts.bankName,
      accountNumber: bankAccounts.accountNumber,
    })
    .from(reconciliations)
    .innerJoin(bankAccounts, eq(reconciliations.bankAccountId, bankAccounts.id))
    .where(eq(bankAccounts.companyId, ctx.companyId))
    .orderBy(desc(reconciliations.createdAt));
  return rows;
}

/**
 * Open a new reconciliation session for a bank account.
 * Throws CONFLICT if there is already an in-progress session for this bank account.
 */
export async function startReconciliation(
  ctx: ServiceContext,
  input: StartReconciliationInput,
): Promise<typeof reconciliations.$inferSelect> {
  if (!input.bankAccountId?.trim()) throw validation('bankAccountId is required.');
  if (!input.statementDate) throw validation('statementDate is required.');
  if (input.statementBalance == null) throw validation('statementBalance is required.');

  // Verify the bank account belongs to this company.
  const [bankAcct] = await ctx.db
    .select()
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.id, input.bankAccountId),
        eq(bankAccounts.companyId, ctx.companyId),
      ),
    );
  if (!bankAcct) throw notFound('Bank account');

  // Guard: only one in_progress reconciliation per bank account at a time.
  const [existing] = await ctx.db
    .select({ id: reconciliations.id })
    .from(reconciliations)
    .innerJoin(bankAccounts, eq(reconciliations.bankAccountId, bankAccounts.id))
    .where(
      and(
        eq(reconciliations.bankAccountId, input.bankAccountId),
        eq(bankAccounts.companyId, ctx.companyId),
        eq(reconciliations.status, 'in_progress'),
      ),
    );
  if (existing) {
    throw new ServiceError(
      'CONFLICT',
      `Bank account already has an in-progress reconciliation (id: ${existing.id}).`,
    );
  }

  return inTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(reconciliations)
      .values({
        bankAccountId: input.bankAccountId,
        statementDate: input.statementDate,
        statementBalance: toAmountString(input.statementBalance),
        status: 'in_progress',
        createdBy: tx.userId ?? '00000000-0000-0000-0000-000000000000',
      })
      .returning();

    await writeAudit(tx, {
      action: 'create',
      entityType: 'reconciliation',
      entityId: row.id,
      newValues: {
        bankAccountId: input.bankAccountId,
        statementDate: input.statementDate,
        statementBalance: toAmountString(input.statementBalance),
      },
    });

    return row;
  });
}

/**
 * List all posted journal entry lines on the bank account's GL account that
 * occurred on or before `asOf` and have not yet been cleared in any *completed*
 * reconciliation. Lines cleared in the current in-progress session are included
 * (with isCleared = true) so the UI can show their current toggle state.
 *
 * @param reconciliationId  Optional: when provided, isCleared reflects the
 *                          current session's state.  Without it every line shows
 *                          isCleared = false.
 */
export async function listClearable(
  ctx: ServiceContext,
  bankAccountId: string,
  asOf: Date,
  reconciliationId?: string,
): Promise<ClearableLine[]> {
  // Verify bank account belongs to this company.
  const [bankAcct] = await ctx.db
    .select({ accountId: bankAccounts.accountId, companyId: bankAccounts.companyId })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.id, bankAccountId),
        eq(bankAccounts.companyId, ctx.companyId),
      ),
    );
  if (!bankAcct) throw notFound('Bank account');

  const glAccountId = bankAcct.accountId;

  // Fetch all posted lines on the GL account up to asOf that are not yet
  // permanently cleared (i.e. cleared in a completed reconciliation).
  //
  // A line is "permanently cleared" when a reconciliation_items row exists for it
  // pointing to a completed reconciliation.  We exclude those from the list.
  const rows = await ctx.db
    .select({
      journalEntryLineId: journalEntryLines.id,
      journalEntryId: journalEntryLines.journalEntryId,
      date: journalEntries.date,
      description: journalEntries.description,
      debit: journalEntryLines.debit,
      credit: journalEntryLines.credit,
      memo: journalEntryLines.memo,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(
      and(
        eq(journalEntryLines.accountId, glAccountId),
        eq(journalEntries.companyId, ctx.companyId),
        eq(journalEntries.status, 'posted'),
        ne(journalEntries.status, 'void'),
        lte(journalEntries.date, asOf),
      ),
    );

  // If a reconciliationId is given, fetch the current session's cleared state.
  const clearedSet = new Set<string>();
  if (reconciliationId) {
    const sessionItems = await ctx.db
      .select({ lineId: reconciliationItems.journalEntryLineId })
      .from(reconciliationItems)
      .where(
        and(
          eq(reconciliationItems.reconciliationId, reconciliationId),
          eq(reconciliationItems.isCleared, true),
        ),
      );
    for (const si of sessionItems) clearedSet.add(si.lineId);
  }

  // Identify lines permanently cleared by a *completed* reconciliation so we
  // can omit them (they are already reconciled and should not appear again).
  const lineIds = rows.map((r) => r.journalEntryLineId);
  const permanentlyClearedIds = new Set<string>();
  if (lineIds.length > 0) {
    const completed = await ctx.db
      .select({ lineId: reconciliationItems.journalEntryLineId })
      .from(reconciliationItems)
      .innerJoin(
        reconciliations,
        eq(reconciliationItems.reconciliationId, reconciliations.id),
      )
      .where(
        and(
          eq(reconciliations.status, 'completed'),
          eq(reconciliationItems.isCleared, true),
        ),
      );
    for (const c of completed) permanentlyClearedIds.add(c.lineId);
  }

  return rows
    .filter((r) => !permanentlyClearedIds.has(r.journalEntryLineId))
    .map((r) => ({
      journalEntryLineId: r.journalEntryLineId,
      journalEntryId: r.journalEntryId,
      date: r.date,
      description: r.description,
      debit: r.debit,
      credit: r.credit,
      memo: r.memo,
      isCleared: clearedSet.has(r.journalEntryLineId),
    }));
}

/**
 * Mark or un-mark a journal entry line as cleared within a reconciliation session.
 * Uses an upsert so calling with isCleared=true twice is idempotent.
 */
export async function toggleCleared(
  ctx: ServiceContext,
  reconciliationId: string,
  journalEntryLineId: string,
  isCleared: boolean,
): Promise<void> {
  const recon = await loadReconciliation(ctx, reconciliationId);
  if (recon.status !== 'in_progress') {
    throw validation('Cannot modify a reconciliation that is not in_progress.');
  }

  // Verify the journal entry line is on the correct bank GL account and
  // belongs to this company.
  const [line] = await ctx.db
    .select({
      id: journalEntryLines.id,
      accountId: journalEntryLines.accountId,
      companyId: journalEntries.companyId,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(
      and(
        eq(journalEntryLines.id, journalEntryLineId),
        eq(journalEntries.companyId, ctx.companyId),
        eq(journalEntryLines.accountId, recon.glAccountId),
      ),
    );
  if (!line) throw notFound('Journal entry line');

  // Manual upsert: check for an existing row and INSERT or UPDATE accordingly.
  // We cannot use onConflictDoUpdate because reconciliation_items does not define
  // a named UNIQUE constraint in the Drizzle schema (schema.ts is read-only), and
  // PGlite rejects ON CONFLICT on ad-hoc column lists without an underlying index.
  const [existing] = await ctx.db
    .select({ id: reconciliationItems.id })
    .from(reconciliationItems)
    .where(
      and(
        eq(reconciliationItems.reconciliationId, reconciliationId),
        eq(reconciliationItems.journalEntryLineId, journalEntryLineId),
      ),
    );

  if (existing) {
    await ctx.db
      .update(reconciliationItems)
      .set({ isCleared, clearedDate: isCleared ? new Date() : null })
      .where(eq(reconciliationItems.id, existing.id));
  } else {
    await ctx.db.insert(reconciliationItems).values({
      reconciliationId,
      journalEntryLineId,
      isCleared,
      clearedDate: isCleared ? new Date() : null,
    });
  }
}

/**
 * Return the current reconciliation progress: statement balance, cleared balance,
 * and the difference that must reach 0.00 to complete.
 */
export async function getProgress(
  ctx: ServiceContext,
  reconciliationId: string,
): Promise<ReconciliationProgress> {
  const recon = await loadReconciliation(ctx, reconciliationId);
  const clearedBalance = await computeClearedBalance(ctx, reconciliationId);
  const statementBalance = Money.of(recon.statementBalance);
  const difference = statementBalance.minus(clearedBalance);

  return {
    reconciliationId,
    statementBalance: toAmountString(statementBalance),
    clearedBalance: toAmountString(clearedBalance),
    difference: toAmountString(difference),
  };
}

/**
 * Finalize the reconciliation.
 *
 * Requirements:
 *   - Status must be in_progress.
 *   - |difference| ≤ $0.01 (one cent tolerance for rounding).
 *
 * On success:
 *   - reconciliations row is set to status = 'completed', completedAt = now.
 *   - bankAccounts.lastReconciledDate and lastReconciledBalance are updated.
 */
export async function completeReconciliation(
  ctx: ServiceContext,
  reconciliationId: string,
): Promise<typeof reconciliations.$inferSelect> {
  const recon = await loadReconciliation(ctx, reconciliationId);

  if (recon.status !== 'in_progress') {
    throw validation(`Reconciliation is already ${recon.status}.`);
  }

  const clearedBalance = await computeClearedBalance(ctx, reconciliationId);
  const statementBalance = Money.of(recon.statementBalance);
  const difference = statementBalance.minus(clearedBalance).abs();

  if (!Money.equalWithinCent(difference, Money.zero())) {
    throw new ServiceError(
      'VALIDATION',
      `Cannot complete: difference is ${toAmountString(statementBalance.minus(clearedBalance))}. ` +
        `Statement balance ${toAmountString(statementBalance)} ≠ cleared balance ${toAmountString(clearedBalance)}.`,
      {
        statementBalance: toAmountString(statementBalance),
        clearedBalance: toAmountString(clearedBalance),
        difference: toAmountString(statementBalance.minus(clearedBalance)),
      },
    );
  }

  return inTransaction(ctx, async (tx) => {
    const now = new Date();

    const [updated] = await tx.db
      .update(reconciliations)
      .set({
        status: 'completed',
        reconciledBalance: toAmountString(clearedBalance),
        completedAt: now,
      })
      .where(eq(reconciliations.id, reconciliationId))
      .returning();

    // Stamp the bank account with the last-reconciled metadata.
    await tx.db
      .update(bankAccounts)
      .set({
        lastReconciledDate: recon.statementDate,
        lastReconciledBalance: toAmountString(statementBalance),
        updatedAt: now,
      })
      .where(eq(bankAccounts.id, recon.bankAccountId));

    await writeAudit(tx, {
      action: 'update',
      entityType: 'reconciliation',
      entityId: reconciliationId,
      oldValues: { status: 'in_progress' },
      newValues: {
        status: 'completed',
        reconciledBalance: toAmountString(clearedBalance),
        completedAt: now,
      },
    });

    return updated;
  });
}
