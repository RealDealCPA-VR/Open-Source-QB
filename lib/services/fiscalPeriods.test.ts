import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { postJournalEntry } from './posting';
import { closePeriod, reopenPeriod, listPeriods } from './fiscalPeriods';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-fiscal-periods');
let ctx: ServiceContext;
let db: DB;
const acct: Record<string, string> = {};

describe('Fiscal period close enforcement', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);
    const [u] = await db.insert(users).values({ email: 'fp@t.local', name: 'FP', passwordHash: 'x' }).returning();
    const [c] = await db.insert(companies).values({ name: 'FP Co', ownerId: u.id }).returning();
    ctx = { db, companyId: c.id, userId: u.id };
    acct['1000'] = (await createAccount(ctx, { code: '1000', name: 'Cash', type: 'asset', subtype: 'checking' })).id;
    acct['4000'] = (await createAccount(ctx, { code: '4000', name: 'Sales', type: 'revenue', subtype: 'sales' })).id;
  });
  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('blocks posting into a closed period and allows it after reopen', async () => {
    // Close January 2025
    const period = await closePeriod(ctx, {
      periodStart: new Date('2025-01-01'),
      periodEnd: new Date('2025-01-31'),
    });
    expect((await listPeriods(ctx)).length).toBe(1);

    const entry = {
      date: new Date('2025-01-15'),
      description: 'In closed period',
      lines: [
        { accountId: acct['1000'], debit: '100.00' },
        { accountId: acct['4000'], credit: '100.00' },
      ],
    };
    await expect(postJournalEntry(ctx, entry)).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });

    // A date outside the closed period is fine
    await expect(
      postJournalEntry(ctx, { ...entry, date: new Date('2025-02-15') }),
    ).resolves.toBeTruthy();

    // Reopen January -> posting now allowed
    await reopenPeriod(ctx, period.id);
    await expect(postJournalEntry(ctx, entry)).resolves.toBeTruthy();
  });
});
