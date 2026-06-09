/**
 * Integration tests for the widened global search (app/api/search/queries.ts + results.ts):
 *  - every record type is matched (customers, vendors, items, invoices, bills, payments,
 *    employees, accounts, journal entries) with per-type LIMIT caps
 *  - exact-amount queries hit invoice/bill/expense totals
 *  - results are companyId-scoped (no cross-tenant leakage)
 *  - buildResults emits type-labeled entries, ?focus= links where supported, and dedupes
 *    records matched by both number and amount
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import {
  accounts,
  bills,
  companies,
  customers,
  employees,
  expenses,
  invoices,
  items,
  journalEntries,
  paymentsReceived,
  users,
  vendors,
} from '@/lib/db/schema';
import { parseAmountQuery, runGlobalSearch, SEARCH_LIMIT } from '@/app/api/search/queries';
import { buildResults } from '@/app/api/search/results';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-search-queries');
let db: DB;
let companyA: string;
let companyB: string;

describe('Global search (integration)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'search@test.local', name: 'Search', passwordHash: 'x' })
      .returning();
    const [a] = await db.insert(companies).values({ name: 'Co A', ownerId: user.id }).returning();
    const [b] = await db.insert(companies).values({ name: 'Co B', ownerId: user.id }).returning();
    companyA = a.id;
    companyB = b.id;

    // ----- Company A seed data -----
    const [cust] = await db
      .insert(customers)
      .values({ companyId: companyA, displayName: 'Acme Rocket Co' })
      .returning();
    const [vend] = await db
      .insert(vendors)
      .values({ companyId: companyA, displayName: 'Globex Supplies' })
      .returning();
    await db
      .insert(items)
      .values({ companyId: companyA, name: 'Widget Deluxe', sku: 'WID-9' });
    await db.insert(invoices).values({
      companyId: companyA,
      customerId: cust.id,
      invoiceNumber: 1042,
      date: new Date('2026-01-15'),
      total: '250.00',
    });
    await db.insert(bills).values({
      companyId: companyA,
      vendorId: vend.id,
      billNumber: 'B-7788',
      date: new Date('2026-01-20'),
      total: '99.99',
    });
    await db.insert(paymentsReceived).values({
      companyId: companyA,
      customerId: cust.id,
      date: new Date('2026-02-01'),
      reference: 'CHK-555',
      amount: '250.00',
    });
    await db.insert(employees).values({
      companyId: companyA,
      firstName: 'Maria',
      lastName: 'Gonzalez',
    });
    const [acct] = await db
      .insert(accounts)
      .values({
        companyId: companyA,
        code: '6400',
        name: 'Rent',
        type: 'expense' as never,
        subtype: 'operating_expenses' as never,
      })
      .returning();
    await db.insert(journalEntries).values({
      companyId: companyA,
      entryNumber: 77,
      date: new Date('2026-01-31'),
      description: 'Year-end depreciation adjustment',
      createdBy: user.id,
    });
    await db.insert(expenses).values({
      companyId: companyA,
      payeeName: 'Coffee Shop',
      date: new Date('2026-02-05'),
      paymentAccountId: acct.id,
      total: '42.42',
    });

    // Volume for the LIMIT check.
    for (let i = 1; i <= SEARCH_LIMIT + 2; i++) {
      await db
        .insert(customers)
        .values({ companyId: companyA, displayName: `Bulk Customer ${i}` });
    }

    // ----- Company B (isolation) -----
    await db
      .insert(customers)
      .values({ companyId: companyB, displayName: 'Isolated Tenant Customer' });
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('parseAmountQuery', () => {
    it('accepts plain, $-prefixed, and comma-grouped amounts', () => {
      expect(parseAmountQuery('123.45')).toBe('123.45');
      expect(parseAmountQuery('$1,234.50')).toBe('1234.50');
      expect(parseAmountQuery('250')).toBe('250');
    });
    it('rejects non-amounts', () => {
      expect(parseAmountQuery('acme')).toBeNull();
      expect(parseAmountQuery('12.345')).toBeNull();
      expect(parseAmountQuery('1.2.3')).toBeNull();
      expect(parseAmountQuery('')).toBeNull();
    });
  });

  describe('runGlobalSearch', () => {
    it('matches customers, vendors, and items by name', async () => {
      const hits = await runGlobalSearch(db, companyA, 'acme');
      expect(hits.cust.map((c) => c.label)).toContain('Acme Rocket Co');
      const v = await runGlobalSearch(db, companyA, 'globex');
      expect(v.vend.map((x) => x.label)).toContain('Globex Supplies');
      const i = await runGlobalSearch(db, companyA, 'WID-9');
      expect(i.itm.map((x) => x.label)).toContain('Widget Deluxe');
    });

    it('matches invoices and bills by document number', async () => {
      const inv = await runGlobalSearch(db, companyA, '1042');
      expect(inv.inv.map((x) => x.num)).toContain(1042);
      const bill = await runGlobalSearch(db, companyA, 'B-7788');
      expect(bill.bill.map((x) => x.num)).toContain('B-7788');
    });

    it('matches payments by reference', async () => {
      const hits = await runGlobalSearch(db, companyA, 'CHK-555');
      expect(hits.pay.length).toBe(1);
      expect(hits.pay[0].reference).toBe('CHK-555');
    });

    it('matches employees by first, last, and full name', async () => {
      expect((await runGlobalSearch(db, companyA, 'gonzalez')).emp.length).toBe(1);
      expect((await runGlobalSearch(db, companyA, 'maria gonzalez')).emp[0].name).toBe(
        'Maria Gonzalez',
      );
    });

    it('matches accounts by name and by code', async () => {
      expect((await runGlobalSearch(db, companyA, 'rent')).acct.length).toBe(1);
      expect((await runGlobalSearch(db, companyA, '6400')).acct[0].name).toBe('Rent');
    });

    it('matches journal entries by entry number and description', async () => {
      expect((await runGlobalSearch(db, companyA, 'depreciation')).je.length).toBe(1);
      const byNum = await runGlobalSearch(db, companyA, '77');
      expect(byNum.je.map((j) => j.entryNumber)).toContain(77);
    });

    it('matches exact amounts against invoice/bill/expense totals', async () => {
      const inv = await runGlobalSearch(db, companyA, '250.00');
      expect(inv.amtInv.length).toBe(1);
      expect(inv.amtInv[0].num).toBe(1042);

      const bill = await runGlobalSearch(db, companyA, '$99.99');
      expect(bill.amtBill.length).toBe(1);

      const exp = await runGlobalSearch(db, companyA, '42.42');
      expect(exp.amtExp.length).toBe(1);
      expect(exp.amtExp[0].payee).toBe('Coffee Shop');
    });

    it('skips amount queries for non-numeric input', async () => {
      const hits = await runGlobalSearch(db, companyA, 'acme');
      expect(hits.amtInv).toEqual([]);
      expect(hits.amtBill).toEqual([]);
      expect(hits.amtExp).toEqual([]);
    });

    it('caps each type at SEARCH_LIMIT', async () => {
      const hits = await runGlobalSearch(db, companyA, 'Bulk Customer');
      expect(hits.cust.length).toBe(SEARCH_LIMIT);
    });

    it('is companyId-scoped (no cross-tenant leakage)', async () => {
      const fromA = await runGlobalSearch(db, companyA, 'Isolated Tenant');
      expect(fromA.cust).toEqual([]);
      const fromB = await runGlobalSearch(db, companyB, 'acme');
      expect(fromB.cust).toEqual([]);
    });
  });

  describe('buildResults', () => {
    it('labels each type and uses ?focus= links where the page supports it', async () => {
      const [inv, bill, acct, je] = await Promise.all([
        runGlobalSearch(db, companyA, '1042'),
        runGlobalSearch(db, companyA, 'B-7788'),
        runGlobalSearch(db, companyA, '6400'),
        runGlobalSearch(db, companyA, 'depreciation'),
      ]);
      const results = [
        ...buildResults(inv),
        ...buildResults(bill),
        ...buildResults(acct),
        ...buildResults(je),
      ];

      const invoice = results.find((r) => r.type === 'Invoice');
      expect(invoice?.label).toBe('Invoice #1042');
      expect(invoice?.href).toMatch(/^\/invoices\?focus=/);

      const billRes = results.find((r) => r.type === 'Bill');
      expect(billRes?.label).toBe('Bill B-7788');
      expect(billRes?.href).toBe('/bills');

      const account = results.find((r) => r.type === 'Account');
      expect(account?.label).toContain('6400');
      expect(account?.href).toBe('/accounts');

      const journal = results.find((r) => r.type === 'Journal Entry');
      expect(journal?.label).toContain('JE #77');
      expect(journal?.href).toBe('/journal');
    });

    it('dedupes a record matched by both number and amount', async () => {
      // '250' matches invoice #1042 by amount only; '1042' by number only — force both paths:
      const hits = await runGlobalSearch(db, companyA, '250.00');
      const merged = {
        ...hits,
        // Simulate the same invoice also matching by number in the same query.
        inv: hits.amtInv.map((i) => ({ id: i.id, num: i.num })),
      };
      const results = buildResults(merged);
      const invoiceResults = results.filter((r) => r.type === 'Invoice');
      expect(invoiceResults.length).toBe(1);
    });

    it('formats amount-match labels with currency', async () => {
      const hits = await runGlobalSearch(db, companyA, '42.42');
      const results = buildResults(hits);
      const exp = results.find((r) => r.type === 'Expense');
      expect(exp?.label).toContain('Coffee Shop');
      expect(exp?.label).toContain('$42.42');
      expect(exp?.href).toBe('/expenses');
    });
  });
});
