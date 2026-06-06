import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { createBankAccount, listBankAccounts } from './bankAccounts';
import { createTaxRate, listTaxRates } from './salesTax';
import { ServiceError } from './_base';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-setup');
let ctx: ServiceContext;
let db: DB;

describe('Bank accounts & sales tax setup', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);
    const [u] = await db.insert(users).values({ email: 's@t.local', name: 'S', passwordHash: 'x' }).returning();
    const [c] = await db.insert(companies).values({ name: 'Setup Co', ownerId: u.id }).returning();
    ctx = { db, companyId: c.id, userId: u.id };
  });
  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('creates a bank account linked to an asset GL account', async () => {
    const gl = await createAccount(ctx, { code: '1000', name: 'Checking', type: 'asset', subtype: 'checking' });
    const ba = await createBankAccount(ctx, { accountId: gl.id, bankName: 'First Bank', accountNumber: '1234' });
    expect(ba.bankName).toBe('First Bank');
    const list = await listBankAccounts(ctx);
    expect(list).toHaveLength(1);
    expect(list[0].glAccountName).toBe('Checking');
  });

  it('rejects a bank account on a revenue GL account', async () => {
    const rev = await createAccount(ctx, { code: '4000', name: 'Sales', type: 'revenue', subtype: 'sales' });
    await expect(
      createBankAccount(ctx, { accountId: rev.id, bankName: 'Bad', accountNumber: '0' }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it('creates a tax rate and validates the fraction range', async () => {
    const r = await createTaxRate(ctx, { name: 'CA Sales Tax', rate: 0.0825 });
    expect(r.rate).toBe('0.082500');
    await expect(createTaxRate(ctx, { name: 'Bad', rate: 8.25 })).rejects.toMatchObject({ code: 'VALIDATION' });
    const rates = await listTaxRates(ctx);
    expect(rates.length).toBe(1);
  });
});
