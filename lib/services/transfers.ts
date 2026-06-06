/**
 * Transfers service — move money between two accounts.
 *
 * A transfer from account A to account B posts a balanced journal entry:
 *   Dr  toAccount    amount   (money arrives here)
 *   Cr  fromAccount  amount   (money leaves here)
 *
 * For asset accounts (debit-normal) this means:
 *   - toAccount balance increases  (debit increases asset)
 *   - fromAccount balance decreases (credit decreases asset)
 *
 * The posted entry id is stored on the transfer row for full GL traceability.
 */
import { and, desc, eq } from 'drizzle-orm';
import { transfers } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import { type ServiceContext, inTransaction, notFound, validation, writeAudit } from './_base';
import { postJournalEntry } from './posting';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateTransferInput {
  date: Date;
  fromAccountId: string;
  toAccountId: string;
  /** Decimal string or number — must be > 0. */
  amount: string | number;
  memo?: string | null;
}

// ---------------------------------------------------------------------------
// createTransfer
// ---------------------------------------------------------------------------

export async function createTransfer(ctx: ServiceContext, input: CreateTransferInput) {
  // Validate from != to.
  if (input.fromAccountId === input.toAccountId) {
    throw validation('From account and to account must be different.');
  }

  const amount = Money.of(input.amount);
  if (!amount.greaterThan(0)) {
    throw validation('Transfer amount must be greater than zero.');
  }

  const amountStr = toAmountString(amount);

  return inTransaction(ctx, async (tx) => {
    // Post the journal entry: Dr toAccount, Cr fromAccount.
    const entry = await postJournalEntry(tx, {
      date: input.date,
      description: input.memo ? `Transfer: ${input.memo}` : 'Transfer between accounts',
      lines: [
        {
          accountId: input.toAccountId,
          debit: amountStr,
          memo: input.memo ?? null,
        },
        {
          accountId: input.fromAccountId,
          credit: amountStr,
          memo: input.memo ?? null,
        },
      ],
    });

    // Insert the transfer record.
    const [transfer] = await tx.db
      .insert(transfers)
      .values({
        companyId: tx.companyId,
        date: input.date,
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amount: amountStr,
        memo: input.memo ?? null,
        postedEntryId: entry.id,
      })
      .returning();

    await writeAudit(tx, {
      action: 'create',
      entityType: 'transfer',
      entityId: transfer.id,
      newValues: {
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amount: amountStr,
        postedEntryId: entry.id,
      },
    });

    return transfer;
  });
}

// ---------------------------------------------------------------------------
// listTransfers
// ---------------------------------------------------------------------------

export async function listTransfers(ctx: ServiceContext) {
  return ctx.db
    .select()
    .from(transfers)
    .where(eq(transfers.companyId, ctx.companyId))
    .orderBy(desc(transfers.date), desc(transfers.createdAt));
}

// ---------------------------------------------------------------------------
// getTransfer
// ---------------------------------------------------------------------------

export async function getTransfer(ctx: ServiceContext, id: string) {
  const [row] = await ctx.db
    .select()
    .from(transfers)
    .where(and(eq(transfers.companyId, ctx.companyId), eq(transfers.id, id)));
  if (!row) throw notFound('Transfer');
  return row;
}
