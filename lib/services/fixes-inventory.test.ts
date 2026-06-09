/**
 * Regression tests for the inventory-package audit fixes:
 *
 *  1. Reorder point is settable (setReorderPoint) and feeds the reorder report.
 *  2. Physical counts reject non-inventory item types and FIFO-tracked items
 *     (assertPhysicalCountable, used by POST /api/inventory/physical-count).
 *  3. FIFO postings honor item.assetAccountId instead of always hitting 1300.
 *  4. inventoryValuation values FIFO items from remaining layers, average-cost
 *     items at averageCost, excludes non-inventory items, and ties to GL 1300.
 *  5. buildAssembly/unbuildAssembly reject FIFO-tracked assemblies/components.
 *  6. unbuildAssembly conserves total inventory value when component average
 *     costs have drifted since the build (no silent value creation).
 *  7. setBom rejects circular BOMs (direct and indirect) but allows diamonds.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts, items } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { trialBalance } from './reports';
import { receiveStock, consumeStock } from './fifo';
import {
  adjustInventory,
  inventoryValuation,
  setReorderPoint,
  assertNotFifoTracked,
  assertPhysicalCountable,
} from './inventory';
import { setBom, buildAssembly, unbuildAssembly } from './assemblies';
import { reorderReport } from './inventoryOps';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-fixes-inventory-d4e5f6');
let db: DB;
let userId: string;

/** Create a fresh company with the standard accounts and return its context. */
async function newCompany(name: string): Promise<{ ctx: ServiceContext; acct: Record<string, string> }> {
  const [company] = await db.insert(companies).values({ name, ownerId: userId }).returning();
  const ctx: ServiceContext = { db, companyId: company.id, userId };

  const defs: Array<[string, string, string, string]> = [
    ['1000', 'Checking',           'asset',   'checking'],
    ['1300', 'Inventory Asset',    'asset',   'inventory'],
    ['1310', 'Inventory — Custom', 'asset',   'inventory'],
    ['3000', "Owner's Equity",     'equity',  'owners_equity'],
    ['5000', 'Cost of Goods Sold', 'expense', 'cost_of_goods_sold'],
  ];

  const acct: Record<string, string> = {};
  for (const [code, acctName, type, subtype] of defs) {
    const row = await createAccount(ctx, { code, name: acctName, type: type as never, subtype });
    acct[code] = row.id;
  }
  return { ctx, acct };
}

/** Raw-insert an item for a company (bypasses the items service on purpose). */
async function newItem(
  ctx: ServiceContext,
  name: string,
  overrides: Partial<typeof items.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(items)
    .values({
      companyId: ctx.companyId,
      name,
      type: 'inventory',
      quantityOnHand: '0',
      averageCost: '0',
      ...overrides,
    })
    .returning();
  return row.id;
}

async function accountBalance(accountId: string): Promise<string> {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  return row.balance ?? '0';
}

beforeAll(async () => {
  db = await getDb(TEST_DIR);
  const [user] = await db
    .insert(users)
    .values({ email: 'owner@fixes-inventory.local', name: 'Fixes Owner', passwordHash: 'x' })
    .returning();
  userId = user.id;
});

afterAll(async () => {
  await closeDb(TEST_DIR);
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Reorder point
// ---------------------------------------------------------------------------

describe('setReorderPoint + reorder report', () => {
  let ctx: ServiceContext;
  let itemId: string;

  beforeAll(async () => {
    ({ ctx } = await newCompany('Reorder Co'));
    itemId = await newItem(ctx, 'Reorder Widget', { quantityOnHand: '5' });
  });

  it('round-trips a reorder point and surfaces the item in reorderReport', async () => {
    const row = await setReorderPoint(ctx, itemId, 10);
    expect(row.reorderPoint).toBe('10.0000');

    const report = await reorderReport(ctx);
    expect(report.count).toBe(1);
    expect(report.rows[0].id).toBe(itemId);
    expect(report.rows[0].reorderPoint).toBe('10.0000');
    expect(report.rows[0].quantityOnHand).toBe('5.0000');
  });

  it('rejects a negative reorder point', async () => {
    await expect(setReorderPoint(ctx, itemId, -1)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a non-numeric reorder point', async () => {
    await expect(setReorderPoint(ctx, itemId, 'abc')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('clears the reorder point with null and drops out of the report', async () => {
    const row = await setReorderPoint(ctx, itemId, null);
    expect(row.reorderPoint).toBeNull();

    const report = await reorderReport(ctx);
    expect(report.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Physical count guards
// ---------------------------------------------------------------------------

describe('assertPhysicalCountable (physical-count preconditions)', () => {
  let ctx: ServiceContext;

  beforeAll(async () => {
    ({ ctx } = await newCompany('Count Co'));
  });

  it('rejects non-inventory item types', async () => {
    const serviceItemId = await newItem(ctx, 'Consulting Hour', { type: 'service' });
    await expect(assertPhysicalCountable(ctx, serviceItemId)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('rejects FIFO-tracked items (layers exist)', async () => {
    const fifoItemId = await newItem(ctx, 'FIFO Counted Widget');
    await receiveStock(ctx, {
      itemId: fifoItemId,
      quantity: '5',
      unitCost: '2.00',
      date: new Date('2025-02-01'),
    });

    await expect(assertPhysicalCountable(ctx, fifoItemId)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(assertNotFifoTracked(ctx, fifoItemId)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('allows an average-cost inventory item', async () => {
    const avgItemId = await newItem(ctx, 'Avg Counted Widget', { quantityOnHand: '3' });
    await expect(assertPhysicalCountable(ctx, avgItemId)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. FIFO postings honor item.assetAccountId
// ---------------------------------------------------------------------------

describe('FIFO receive/consume with a custom inventory asset account', () => {
  let ctx: ServiceContext;
  let acct: Record<string, string>;
  let itemId: string;

  beforeAll(async () => {
    ({ ctx, acct } = await newCompany('Custom Asset Co'));
    itemId = await newItem(ctx, 'Custom Asset Widget', { assetAccountId: undefined });
    // Point the item at the custom 1310 account
    await db.update(items).set({ assetAccountId: acct['1310'] }).where(eq(items.id, itemId));
  });

  it('receiveStock debits the item asset account, not 1300', async () => {
    await receiveStock(ctx, {
      itemId,
      quantity: '10',
      unitCost: '5.00',
      date: new Date('2025-03-01'),
    });

    expect(await accountBalance(acct['1310'])).toBe('50.00');
    expect(Number(await accountBalance(acct['1300']))).toBe(0);

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('consumeStock credits the item asset account, not 1300', async () => {
    const result = await consumeStock(ctx, {
      itemId,
      quantity: '4',
      date: new Date('2025-03-05'),
    });

    expect(result.totalCOGS).toBe('20.00');
    expect(await accountBalance(acct['1310'])).toBe('30.00');
    expect(Number(await accountBalance(acct['1300']))).toBe(0);
    expect(await accountBalance(acct['5000'])).toBe('20.00');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Inventory valuation across both costing methods
// ---------------------------------------------------------------------------

describe('inventoryValuation (FIFO from layers, average from averageCost)', () => {
  let ctx: ServiceContext;
  let acct: Record<string, string>;
  let avgItemId: string;
  let fifoItemId: string;

  beforeAll(async () => {
    ({ ctx, acct } = await newCompany('Valuation Co'));

    // Average-cost item: receive 5 @ $3.00 = $15
    avgItemId = await newItem(ctx, 'Avg Valued Widget');
    await adjustInventory(ctx, {
      itemId: avgItemId,
      quantityChange: '5',
      unitCost: '3.00',
      date: new Date('2025-04-01'),
    });

    // FIFO item: receive 10 @ $5 + 10 @ $7, consume 12 → 8 @ $7 = $56 remains
    fifoItemId = await newItem(ctx, 'FIFO Valued Widget');
    await receiveStock(ctx, { itemId: fifoItemId, quantity: '10', unitCost: '5.00', date: new Date('2025-04-02') });
    await receiveStock(ctx, { itemId: fifoItemId, quantity: '10', unitCost: '7.00', date: new Date('2025-04-03') });
    await consumeStock(ctx, { itemId: fifoItemId, quantity: '12', date: new Date('2025-04-04') });

    // Non-inventory item with bogus stock values — must be excluded
    await newItem(ctx, 'Phantom Service', {
      type: 'service',
      quantityOnHand: '99',
      averageCost: '10.00',
    });
  });

  it('values FIFO items from remaining layers and excludes non-inventory items', async () => {
    const valuation = await inventoryValuation(ctx);

    expect(valuation.items).toHaveLength(2);

    const fifoRow = valuation.items.find((r) => r.id === fifoItemId)!;
    expect(fifoRow.costingMethod).toBe('fifo');
    expect(fifoRow.quantityOnHand).toBe('8.0000');
    expect(fifoRow.averageCost).toBe('7.0000');
    expect(fifoRow.totalValue).toBe('56.00');

    const avgRow = valuation.items.find((r) => r.id === avgItemId)!;
    expect(avgRow.costingMethod).toBe('average');
    expect(avgRow.totalValue).toBe('15.00');

    expect(valuation.grandTotal).toBe('71.00');
  });

  it('grand total ties to the GL inventory asset account (1300)', async () => {
    const valuation = await inventoryValuation(ctx);
    // 1300 carries: +15 (avg receipt) +50 +70 (FIFO receipts) -64 (FIFO COGS) = 71
    expect(await accountBalance(acct['1300'])).toBe('71.00');
    expect(valuation.grandTotal).toBe('71.00');
  });
});

// ---------------------------------------------------------------------------
// 5. Assembly FIFO guards
// ---------------------------------------------------------------------------

describe('buildAssembly/unbuildAssembly reject FIFO-tracked items', () => {
  let ctx: ServiceContext;

  beforeAll(async () => {
    ({ ctx } = await newCompany('Assembly Guard Co'));
  });

  it('buildAssembly rejects when a component is FIFO-tracked', async () => {
    const assemblyId = await newItem(ctx, 'Guarded Assembly');
    const fifoCompId = await newItem(ctx, 'FIFO Component');
    await receiveStock(ctx, {
      itemId: fifoCompId,
      quantity: '10',
      unitCost: '2.00',
      date: new Date('2025-05-01'),
    });

    await setBom(ctx, assemblyId, [{ componentItemId: fifoCompId, quantity: '1' }]);

    await expect(
      buildAssembly(ctx, { assemblyItemId: assemblyId, quantity: '1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('unbuildAssembly rejects when a component became FIFO-tracked after the build', async () => {
    const assemblyId = await newItem(ctx, 'Drifting Assembly');
    const compId = await newItem(ctx, 'Avg-Then-FIFO Component');
    await adjustInventory(ctx, {
      itemId: compId,
      quantityChange: '10',
      unitCost: '2.00',
      date: new Date('2025-05-02'),
    });
    await setBom(ctx, assemblyId, [{ componentItemId: compId, quantity: '2' }]);
    await buildAssembly(ctx, { assemblyItemId: assemblyId, quantity: '1' });

    // The component is now switched to FIFO tracking
    await receiveStock(ctx, {
      itemId: compId,
      quantity: '5',
      unitCost: '3.00',
      date: new Date('2025-05-03'),
    });

    await expect(
      unbuildAssembly(ctx, { assemblyItemId: assemblyId, quantity: '1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

// ---------------------------------------------------------------------------
// 6. unbuildAssembly conserves inventory value after cost drift
// ---------------------------------------------------------------------------

describe('unbuildAssembly value conservation', () => {
  let ctx: ServiceContext;
  let assemblyId: string;
  let compId: string;

  beforeAll(async () => {
    ({ ctx } = await newCompany('Unbuild Drift Co'));

    compId = await newItem(ctx, 'Drift Component');
    // 10 @ $2.00 → value $20
    await adjustInventory(ctx, {
      itemId: compId,
      quantityChange: '10',
      unitCost: '2.00',
      date: new Date('2025-06-01'),
    });

    assemblyId = await newItem(ctx, 'Drift Assembly');
    await setBom(ctx, assemblyId, [{ componentItemId: compId, quantity: '2' }]);
    // Build 1: consumes 2 @ $2 = $4 → assembly avg $4.0000, component qty 8
    await buildAssembly(ctx, { assemblyItemId: assemblyId, quantity: '1' });

    // Component cost drifts: +10 @ $5.00 → qty 18, avg = (8*2 + 10*5)/18 = 3.6667
    await adjustInventory(ctx, {
      itemId: compId,
      quantityChange: '10',
      unitCost: '5.00',
      date: new Date('2025-06-02'),
    });
  });

  it('returns components at the assembly value removed, not their drifted average cost', async () => {
    const [compBefore] = await db.select().from(items).where(eq(items.id, compId));
    expect(compBefore.averageCost).toBe('3.6667');

    await unbuildAssembly(ctx, { assemblyItemId: assemblyId, quantity: '1' });

    const [comp] = await db.select().from(items).where(eq(items.id, compId));
    const [assembly] = await db.select().from(items).where(eq(items.id, assemblyId));

    expect(assembly.quantityOnHand).toBe('0.0000');
    expect(comp.quantityOnHand).toBe('20.0000');
    // Value conservation: removed $4 from the assembly, so the 2 returned
    // units come back at $2.00 each → (18*3.6667 + 4) / 20 ≈ 3.5000.
    // The buggy behavior left averageCost at 3.6667 (creating ~$3.33 of
    // inventory value out of thin air with no GL entry).
    expect(comp.averageCost).toBe('3.5000');
  });
});

// ---------------------------------------------------------------------------
// 7. setBom cycle detection
// ---------------------------------------------------------------------------

describe('setBom circular BOM detection', () => {
  let ctx: ServiceContext;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ ctx } = await newCompany('BOM Cycle Co'));
    for (const name of ['A', 'B', 'C', 'P', 'Q', 'R', 'S']) {
      ids[name] = await newItem(ctx, `Cycle Item ${name}`);
    }
  });

  it('still rejects direct self-reference', async () => {
    await expect(
      setBom(ctx, ids.A, [{ componentItemId: ids.A, quantity: '1' }]),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a 2-node cycle (A↔B)', async () => {
    await setBom(ctx, ids.A, [{ componentItemId: ids.B, quantity: '1' }]);
    await expect(
      setBom(ctx, ids.B, [{ componentItemId: ids.A, quantity: '1' }]),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a deeper cycle (A→B→C→A)', async () => {
    await setBom(ctx, ids.B, [{ componentItemId: ids.C, quantity: '1' }]);
    await expect(
      setBom(ctx, ids.C, [{ componentItemId: ids.A, quantity: '1' }]),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('allows a legitimate shared-subassembly diamond (P→Q→S, P→R→S)', async () => {
    await setBom(ctx, ids.Q, [{ componentItemId: ids.S, quantity: '1' }]);
    await setBom(ctx, ids.R, [{ componentItemId: ids.S, quantity: '2' }]);
    const bom = await setBom(ctx, ids.P, [
      { componentItemId: ids.Q, quantity: '1' },
      { componentItemId: ids.R, quantity: '1' },
    ]);
    expect(bom).toHaveLength(2);
  });
});
