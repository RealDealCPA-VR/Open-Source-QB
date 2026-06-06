/**
 * Bills (Accounts Payable) service.
 *
 * A Bill records an obligation to pay a vendor for goods or services received.
 * The posting pattern is the A/P mirror of an Invoice:
 *
 *   Dr  <expense / asset account>   (one line per bill line)
 *   Cr  Accounts Payable  2000      (consolidated total)
 *
 * All GL mutations go through `postJournalEntry`; `voidBill` delegates to
 * `voidJournalEntry` and flips the document status to 'void'.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { accounts, bills, billLines, vendors } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import { postJournalEntry, voidJournalEntry } from '@/lib/services/posting';
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

export interface BillLineInput {
  /** GL account to debit (expense or asset). */
  accountId: string;
  description?: string | null;
  /** Informational; stored but not used for GL math. */
  quantity?: string | number | null;
  /** The dollar amount for this line (must be > 0). */
  amount: string | number;
}

export interface CreateBillInput {
  vendorId: string;
  billNumber?: string | null;
  date: Date;
  dueDate?: Date | null;
  memo?: string | null;
  lines: BillLineInput[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the Accounts Payable account (code '2000') for this company. */
async function resolveApAccount(ctx: ServiceContext): Promise<string> {
  const [row] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, '2000')));
  if (!row) {
    throw new ServiceError(
      'NOT_FOUND',
      'Accounts Payable account (code 2000) not found. Ensure the default chart of accounts is seeded.',
    );
  }
  return row.id;
}

// ---------------------------------------------------------------------------
// createBill
// ---------------------------------------------------------------------------

export async function createBill(ctx: ServiceContext, input: CreateBillInput) {
  // --- Validate vendor belongs to this company ---
  const [vendor] = await ctx.db
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.id, input.vendorId), eq(vendors.companyId, ctx.companyId)));
  if (!vendor) throw notFound('Vendor');

  // --- Validate lines ---
  if (!input.lines || input.lines.length === 0) {
    throw validation('A bill must have at least one line.');
  }

  // Sum line amounts using Money (no JS floats).
  let total = Money.zero();
  for (const [i, line] of input.lines.entries()) {
    const amt = Money.of(line.amount);
    if (!amt.greaterThan(0)) {
      throw validation(`Line ${i + 1}: amount must be greater than zero.`);
    }
    total = total.plus(amt);
  }
  const totalStr = toAmountString(total);

  // Resolve A/P account before opening the transaction (read-only; no need to hold a tx lock).
  const apAccountId = await resolveApAccount(ctx);

  return inTransaction(ctx, async (tx) => {
    // --- Insert the bill header ---
    const [bill] = await tx.db
      .insert(bills)
      .values({
        companyId: tx.companyId,
        vendorId: input.vendorId,
        billNumber: input.billNumber ?? null,
        date: input.date,
        dueDate: input.dueDate ?? null,
        memo: input.memo ?? null,
        status: 'open',
        total: totalStr,
        amountPaid: '0.00',
        balanceDue: totalStr,
      })
      .returning();

    // --- Insert bill lines ---
    await tx.db.insert(billLines).values(
      input.lines.map((line, idx) => ({
        billId: bill.id,
        accountId: line.accountId,
        description: line.description ?? null,
        quantity: line.quantity != null ? toAmountString(line.quantity) : '1.0000',
        amount: toAmountString(line.amount),
        lineOrder: idx,
      })),
    );

    // --- Build posting lines ---
    // Dr each expense/asset account for its line amount; Cr A/P for the total.
    const postingLines = [
      // Debit lines (one per bill line)
      ...input.lines.map((line) => ({
        accountId: line.accountId,
        debit: toAmountString(line.amount),
        memo: line.description ?? null,
      })),
      // Credit line — Accounts Payable
      {
        accountId: apAccountId,
        credit: totalStr,
        memo: `Bill ${input.billNumber ?? bill.id} — ${vendor.id}`,
      },
    ];

    // --- Post to the GL ---
    const entry = await postJournalEntry(tx, {
      date: input.date,
      description: `Bill ${input.billNumber ? `#${input.billNumber}` : bill.id}`,
      reference: input.billNumber ?? null,
      sourceRef: `bill:${bill.id}`,
      lines: postingLines,
    });

    // --- Store the journal entry reference on the bill ---
    const [updated] = await tx.db
      .update(bills)
      .set({ postedEntryId: entry.id, updatedAt: new Date() })
      .where(eq(bills.id, bill.id))
      .returning();

    await writeAudit(tx, {
      action: 'create',
      entityType: 'bill',
      entityId: bill.id,
      newValues: { ...updated, linesCount: input.lines.length, total: totalStr },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// listBills
// ---------------------------------------------------------------------------

export async function listBills(
  ctx: ServiceContext,
  opts?: { vendorId?: string; status?: string },
) {
  const conditions = [eq(bills.companyId, ctx.companyId)];
  if (opts?.vendorId) conditions.push(eq(bills.vendorId, opts.vendorId));
  if (opts?.status) conditions.push(eq(bills.status, opts.status as never));

  return ctx.db
    .select()
    .from(bills)
    .where(and(...conditions))
    .orderBy(desc(bills.date), asc(bills.createdAt));
}

// ---------------------------------------------------------------------------
// getBill (header + lines)
// ---------------------------------------------------------------------------

export async function getBill(ctx: ServiceContext, id: string) {
  const [bill] = await ctx.db
    .select()
    .from(bills)
    .where(and(eq(bills.id, id), eq(bills.companyId, ctx.companyId)));
  if (!bill) throw notFound('Bill');

  const lines = await ctx.db
    .select()
    .from(billLines)
    .where(eq(billLines.billId, id))
    .orderBy(asc(billLines.lineOrder));

  return { ...bill, lines };
}

// ---------------------------------------------------------------------------
// voidBill
// ---------------------------------------------------------------------------

export async function voidBill(ctx: ServiceContext, id: string) {
  // Fetch the bill and verify company ownership.
  const [bill] = await ctx.db
    .select()
    .from(bills)
    .where(and(eq(bills.id, id), eq(bills.companyId, ctx.companyId)));
  if (!bill) throw notFound('Bill');

  if (bill.status === 'void') {
    // Idempotent — already voided.
    return bill;
  }

  if (bill.amountPaid && Money.gt(bill.amountPaid, 0)) {
    throw new ServiceError(
      'CONFLICT',
      'Cannot void a bill that has payments applied. Unapply payments first.',
    );
  }

  return inTransaction(ctx, async (tx) => {
    // Reverse the GL entry.
    if (bill.postedEntryId) {
      await voidJournalEntry(tx, bill.postedEntryId);
    }

    // Flip bill status to void and zero balanceDue.
    const [updated] = await tx.db
      .update(bills)
      .set({ status: 'void', balanceDue: '0.00', updatedAt: new Date() })
      .where(eq(bills.id, id))
      .returning();

    await writeAudit(tx, {
      action: 'void',
      entityType: 'bill',
      entityId: id,
      oldValues: { status: bill.status },
      newValues: { status: 'void' },
    });

    return updated;
  });
}
