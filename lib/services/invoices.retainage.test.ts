import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts, customers } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createInvoice } from './invoices';
import { trialBalance } from './reports';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-invoice-retainage');
let db: DB;
let ctx: ServiceContext;
let customerId: string;
let incomeId: string;

describe('Invoice retainage (holdback)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);
    const [u] = await db.insert(users).values({ email: 'ret@t.local', name: 'R', passwordHash: 'x' }).returning();
    const [c] = await db.insert(companies).values({ name: 'Ret Co', ownerId: u.id }).returning();
    ctx = { db, companyId: c.id, userId: u.id };
    const seed: Array<[string, string, string, string]> = [
      ['1200', 'A/R', 'asset', 'accounts_receivable'],
      ['2200', 'Sales Tax Payable', 'liability', 'long_term_liability'],
      ['4000', 'Sales Income', 'revenue', 'sales'],
    ];
    for (const [code, name, type, subtype] of seed) {
      const [a] = await db.insert(accounts).values({ companyId: c.id, code, name, type: type as never, subtype: subtype as never }).returning();
      if (code === '4000') incomeId = a.id;
    }
    const [cust] = await db.insert(customers).values({ companyId: c.id, displayName: 'Builder Co' }).returning();
    customerId = cust.id;
  });
  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('holds back retainage, reduces balance due, auto-creates 1250, and stays balanced', async () => {
    const inv = await createInvoice(ctx, {
      customerId,
      date: new Date('2026-06-01'),
      lines: [{ description: 'Phase 1', quantity: 1, rate: 10000, accountId: incomeId }],
      retainagePercent: 10,
    });
    expect(inv.total).toBe('10000.00');
    expect(inv.retainageAmount).toBe('1000.00');
    expect(inv.balanceDue).toBe('9000.00'); // total - retainage

    // Retainage Receivable (1250) auto-created
    const [ret] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, '1250')));
    expect(ret).toBeTruthy();
    expect(ret.balance).toBe('1000.00'); // debit-normal asset

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });
});
