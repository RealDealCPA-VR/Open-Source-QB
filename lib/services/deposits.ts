/**
 * Deposits service — Undeposited Funds -> Make Deposit.
 *
 * Workflow:
 *  1. Customer payments are received into Undeposited Funds (code 1050).
 *  2. The bookkeeper selects those payments and "makes a deposit" into a real
 *     bank account.  `createDeposit` posts:
 *       Dr  <depositAccountId>   total     (bank account asset increases)
 *       Cr  1050 Undeposited Funds  total  (UF asset clears)
 *     and records a `deposits` header + one `depositLines` row per payment.
 *
 * "Undeposited" heuristic: a paymentsReceived row is considered undeposited
 * when its `depositAccountId` equals the UF account (code 1050) and its `id`
 * does not appear in any existing depositLines row.
 */
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  accounts,
  customers,
  deposits,
  depositLines,
  paymentsReceived,
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
import { postJournalEntry } from './posting';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateDepositInput {
  /** The bank account (asset) that will receive the funds. Must NOT be 1050. */
  depositAccountId: string;
  date: Date;
  /** IDs of paymentsReceived rows to include in this deposit. */
  paymentIds: string[];
  memo?: string | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolve the Undeposited Funds account id by code 1050, scoped to company. */
async function getUFAccountId(ctx: ServiceContext): Promise<string> {
  const [row] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, '1050')));
  if (!row) throw new ServiceError('NOT_FOUND', 'Undeposited Funds account (1050) not found.');
  return row.id;
}

// ---------------------------------------------------------------------------
// listUndepositedPayments
// ---------------------------------------------------------------------------

/**
 * Return paymentsReceived rows that:
 *  - belong to this company
 *  - have depositAccountId = the Undeposited Funds (1050) account
 *  - have NOT yet been referenced by any depositLines row
 */
export async function listUndepositedPayments(ctx: ServiceContext) {
  const ufId = await getUFAccountId(ctx);

  // Collect all payment IDs that are already in a deposit line.
  const usedRows = await ctx.db
    .select({ paymentId: depositLines.paymentId })
    .from(depositLines)
    .innerJoin(deposits, eq(depositLines.depositId, deposits.id))
    .where(eq(deposits.companyId, ctx.companyId));

  const usedIds = usedRows
    .map((r) => r.paymentId)
    .filter((id): id is string => id !== null);

  // Base condition: belongs to company, landed in UF.
  const baseConditions = and(
    eq(paymentsReceived.companyId, ctx.companyId),
    eq(paymentsReceived.depositAccountId, ufId),
  );

  if (usedIds.length === 0) {
    // No deposits yet — all UF payments are undeposited.
    const rows = await ctx.db
      .select()
      .from(paymentsReceived)
      .where(baseConditions)
      .orderBy(paymentsReceived.date);
    // Enrich with customer displayName for UI convenience.
    return enrichWithCustomer(ctx, rows);
  }

  const rows = await ctx.db
    .select()
    .from(paymentsReceived)
    .where(and(baseConditions, notInArray(paymentsReceived.id, usedIds)))
    .orderBy(paymentsReceived.date);

  return enrichWithCustomer(ctx, rows);
}

async function enrichWithCustomer(
  ctx: ServiceContext,
  rows: Array<typeof paymentsReceived.$inferSelect>,
) {
  if (rows.length === 0) return [];
  const custIds = [...new Set(rows.map((r) => r.customerId))];
  const custRows = await ctx.db
    .select({ id: customers.id, displayName: customers.displayName })
    .from(customers)
    .where(and(eq(customers.companyId, ctx.companyId), inArray(customers.id, custIds)));
  const custMap = new Map(custRows.map((c) => [c.id, c.displayName]));
  return rows.map((r) => ({ ...r, customerName: custMap.get(r.customerId) ?? null }));
}

// ---------------------------------------------------------------------------
// createDeposit
// ---------------------------------------------------------------------------

export async function createDeposit(ctx: ServiceContext, input: CreateDepositInput) {
  if (!input.paymentIds || input.paymentIds.length === 0) {
    throw validation('A deposit must include at least one payment.');
  }
  if (!input.depositAccountId) {
    throw validation('depositAccountId is required.');
  }

  const ufId = await getUFAccountId(ctx);

  // The deposit target must not be the UF account itself.
  if (input.depositAccountId === ufId) {
    throw validation('Cannot deposit into Undeposited Funds. Choose a bank account.');
  }

  // Verify deposit account belongs to this company.
  const [depAcct] = await ctx.db
    .select({ id: accounts.id, type: accounts.type, code: accounts.code })
    .from(accounts)
    .where(and(eq(accounts.id, input.depositAccountId), eq(accounts.companyId, ctx.companyId)));
  if (!depAcct) throw notFound('Deposit account');
  if (depAcct.type !== 'asset') {
    throw validation('Deposit account must be an asset (bank) account.');
  }

  // Load the selected payments and verify they all belong to this company,
  // all point to UF, and none are already deposited.
  const payRows = await ctx.db
    .select()
    .from(paymentsReceived)
    .where(
      and(
        eq(paymentsReceived.companyId, ctx.companyId),
        inArray(paymentsReceived.id, input.paymentIds),
      ),
    );

  if (payRows.length !== input.paymentIds.length) {
    throw notFound('One or more payments');
  }

  for (const p of payRows) {
    if (p.depositAccountId !== ufId) {
      throw validation(
        `Payment ${p.id} was not deposited to Undeposited Funds and cannot be re-deposited.`,
      );
    }
  }

  // Check that none of these payments are already in a deposit line.
  const alreadyUsed = await ctx.db
    .select({ paymentId: depositLines.paymentId })
    .from(depositLines)
    .innerJoin(deposits, eq(depositLines.depositId, deposits.id))
    .where(
      and(
        eq(deposits.companyId, ctx.companyId),
        inArray(depositLines.paymentId, input.paymentIds),
      ),
    );

  if (alreadyUsed.length > 0) {
    throw new ServiceError(
      'CONFLICT',
      `One or more payments have already been deposited: ${alreadyUsed.map((r) => r.paymentId).join(', ')}`,
    );
  }

  // Sum the selected payments.
  let total = Money.zero();
  for (const p of payRows) {
    total = total.plus(Money.of(p.amount));
  }
  const totalStr = toAmountString(total);

  if (total.isZero()) {
    throw validation('Total deposit amount must be greater than zero.');
  }

  return inTransaction(ctx, async (tx) => {
    // 1. Post GL: Dr bank account / Cr Undeposited Funds
    const entry = await postJournalEntry(tx, {
      date: input.date,
      description: input.memo ? `Deposit: ${input.memo}` : 'Bank Deposit',
      sourceRef: `deposit:pending`,
      lines: [
        { accountId: input.depositAccountId, debit: totalStr, memo: 'Deposit to bank' },
        { accountId: ufId, credit: totalStr, memo: 'Undeposited Funds cleared' },
      ],
    });

    // 2. Insert the deposit header.
    const [deposit] = await tx.db
      .insert(deposits)
      .values({
        companyId: tx.companyId,
        depositAccountId: input.depositAccountId,
        date: input.date,
        total: totalStr,
        memo: input.memo ?? null,
        postedEntryId: entry.id,
      })
      .returning();

    // 3. Insert one deposit line per payment.
    await tx.db.insert(depositLines).values(
      payRows.map((p) => ({
        depositId: deposit.id,
        paymentId: p.id,
        description: null,
        amount: p.amount,
      })),
    );

    // 4. Audit log.
    await writeAudit(tx, {
      action: 'create',
      entityType: 'deposit',
      entityId: deposit.id,
      newValues: {
        depositAccountId: input.depositAccountId,
        date: input.date,
        total: totalStr,
        paymentIds: input.paymentIds,
        postedEntryId: entry.id,
      },
    });

    return { ...deposit, lines: payRows.map((p) => p.id) };
  });
}

// ---------------------------------------------------------------------------
// listDeposits
// ---------------------------------------------------------------------------

export async function listDeposits(ctx: ServiceContext) {
  const rows = await ctx.db
    .select()
    .from(deposits)
    .where(eq(deposits.companyId, ctx.companyId))
    .orderBy(deposits.date);

  if (rows.length === 0) return [];

  // Enrich with deposit account name.
  const acctIds = [...new Set(rows.map((r) => r.depositAccountId))];
  const acctRows = await ctx.db
    .select({ id: accounts.id, name: accounts.name, code: accounts.code })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), inArray(accounts.id, acctIds)));
  const acctMap = new Map(acctRows.map((a) => [a.id, { name: a.name, code: a.code }]));

  // Attach lines (payment ids) to each deposit.
  const depositIds = rows.map((r) => r.id);
  const lineRows = await ctx.db
    .select()
    .from(depositLines)
    .where(inArray(depositLines.depositId, depositIds));

  const linesByDeposit = new Map<string, typeof lineRows>();
  for (const l of lineRows) {
    const arr = linesByDeposit.get(l.depositId) ?? [];
    arr.push(l);
    linesByDeposit.set(l.depositId, arr);
  }

  return rows.map((d) => ({
    ...d,
    accountName: acctMap.get(d.depositAccountId)?.name ?? null,
    accountCode: acctMap.get(d.depositAccountId)?.code ?? null,
    lines: linesByDeposit.get(d.id) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// getDeposit
// ---------------------------------------------------------------------------

export async function getDeposit(ctx: ServiceContext, id: string) {
  const [deposit] = await ctx.db
    .select()
    .from(deposits)
    .where(and(eq(deposits.id, id), eq(deposits.companyId, ctx.companyId)));
  if (!deposit) throw notFound('Deposit');

  const lines = await ctx.db
    .select()
    .from(depositLines)
    .where(eq(depositLines.depositId, id));

  return { ...deposit, lines };
}
