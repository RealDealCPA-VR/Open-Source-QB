import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts, customers, taxRates } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createInvoice, getInvoice } from './invoices';
import { trialBalance } from './reports';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-invoice-perline-tax');
let db: DB;
let ctx: ServiceContext;
let customerId: string;
let incomeId: string;
let rateA: string;
let rateB: string;

describe('Per-line tax rates on invoices', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);
    const [u] = await db.insert(users).values({ email: 'plt@t.local', name: 'PLT', passwordHash: 'x' }).returning();
    const [c] = await db.insert(companies).values({ name: 'PLT Co', ownerId: u.id }).returning();
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
    const [cust] = await db.insert(customers).values({ companyId: c.id, displayName: 'Tax Co' }).returning();
    customerId = cust.id;
    const [ra] = await db.insert(taxRates).values({ companyId: c.id, name: 'CA 8.25%', rate: '0.082500' }).returning();
    const [rb] = await db.insert(taxRates).values({ companyId: c.id, name: 'NY 4%', rate: '0.040000' }).returning();
    rateA = ra.id;
    rateB = rb.id;
  });
  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('taxes each line at its own rate and stays balanced', async () => {
    // Line 1: $100 @ 8.25% = 8.25 ; Line 2: $200 @ 4% = 8.00 ; total tax = 16.25
    const inv = await createInvoice(ctx, {
      customerId,
      date: new Date('2026-05-01'),
      lines: [
        { description: 'CA item', quantity: 1, rate: 100, accountId: incomeId, taxRateId: rateA },
        { description: 'NY item', quantity: 1, rate: 200, accountId: incomeId, taxRateId: rateB },
      ],
    });
    expect(inv.subtotal).toBe('300.00');
    expect(inv.taxAmount).toBe('16.25');
    expect(inv.total).toBe('316.25');

    const full = await getInvoice(ctx, inv.id);
    expect(full.lines.find((l) => l.description === 'CA item')?.taxRateId).toBe(rateA);

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });
});
