/**
 * Tests for qbImport — IIF parsing and round-trip import via service layer.
 *
 * A tiny PGlite instance is spun up for each suite so the tests exercise the
 * real service layer (accounts / customers / vendors) without a browser.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { parseIIF, importIIF } from './qbImport';

// ---------------------------------------------------------------------------
// Shared IIF fixture
// ---------------------------------------------------------------------------

const SAMPLE_IIF = `!ACCNT\tNAME\tACCNTTYPE\tDESC\tACCNUM
ACCNT\tChecking Account\tBANK\tMain checking\t1010
ACCNT\tAccounts Receivable\tARACCNT\tA/R\t1200
ACCNT\tOffice Supplies\tEXPENSE\tGeneral office supplies\t6010
!CUST\tNAME\tCOMPANYNAME\tEMAIL\tPHONE1\tBADDR1\tBCITY\tBSTATE\tBZIP
CUST\tAcme Corp\tAcme Corporation\tacme@example.com\t555-0100\t1 Main St\tSpringfield\tIL\t62701
CUST\tBeta LLC\t\tbeta@example.com\t\t\t\t\t
!VEND\tNAME\tCOMPANYNAME\tEMAIL\tPHONE1
VEND\tSupplies Co\tSupplies Company Inc\tsupplies@example.com\t555-9999
`;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-qbimport');
let ctx: ServiceContext;
let db: DB;

describe('qbImport', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'qbimport@test.local', name: 'QB Test', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'QB Import Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // parseIIF — pure parse, no DB
  // -------------------------------------------------------------------------

  describe('parseIIF', () => {
    it('parses ACCNT rows', () => {
      const result = parseIIF(SAMPLE_IIF);
      expect(result.accounts).toHaveLength(3);

      const checking = result.accounts.find((a) => a.name === 'Checking Account');
      expect(checking).toBeDefined();
      expect(checking!.accntType).toBe('BANK');
      expect(checking!.accnum).toBe('1010');
      expect(checking!.desc).toBe('Main checking');

      const ar = result.accounts.find((a) => a.name === 'Accounts Receivable');
      expect(ar).toBeDefined();
      expect(ar!.accntType).toBe('ARACCNT');
    });

    it('parses CUST rows', () => {
      const result = parseIIF(SAMPLE_IIF);
      expect(result.customers).toHaveLength(2);

      const acme = result.customers.find((c) => c.name === 'Acme Corp');
      expect(acme).toBeDefined();
      expect(acme!.companyName).toBe('Acme Corporation');
      expect(acme!.email).toBe('acme@example.com');
      expect(acme!.billAddr1).toBe('1 Main St');
      expect(acme!.billCity).toBe('Springfield');
    });

    it('parses VEND rows', () => {
      const result = parseIIF(SAMPLE_IIF);
      expect(result.vendors).toHaveLength(1);
      expect(result.vendors[0].name).toBe('Supplies Co');
      expect(result.vendors[0].companyName).toBe('Supplies Company Inc');
      expect(result.vendors[0].email).toBe('supplies@example.com');
    });

    it('ignores unknown section types (e.g. TRANS)', () => {
      const iif = `!TRANS\tTRNSTYPE\tDATE\n!ACCNT\tNAME\tACCNTTYPE\nACCNT\tCash\tBANK\n`;
      const result = parseIIF(iif);
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0].name).toBe('Cash');
    });

    it('handles Windows CRLF line endings', () => {
      const crlf = SAMPLE_IIF.replace(/\n/g, '\r\n');
      const result = parseIIF(crlf);
      expect(result.accounts).toHaveLength(3);
      expect(result.customers).toHaveLength(2);
    });

    it('returns empty arrays for empty content', () => {
      const result = parseIIF('');
      expect(result.accounts).toHaveLength(0);
      expect(result.customers).toHaveLength(0);
      expect(result.vendors).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // importIIF — round-trip to DB
  // -------------------------------------------------------------------------

  describe('importIIF', () => {
    it('creates accounts, customers, and vendors from IIF', async () => {
      const counts = await importIIF(ctx, SAMPLE_IIF);
      expect(counts.accounts).toBe(3);
      expect(counts.customers).toBe(2);
      expect(counts.vendors).toBe(1);
      expect(counts.skipped).toBe(0);
    });

    it('skips duplicates on a second import of the same content', async () => {
      const counts = await importIIF(ctx, SAMPLE_IIF);
      expect(counts.accounts).toBe(0);
      expect(counts.customers).toBe(0);
      expect(counts.vendors).toBe(0);
      // All 6 records already exist → all skipped.
      expect(counts.skipped).toBe(6);
    });

    it('maps BANK account type to asset/checking', async () => {
      // Use a new company so we start fresh.
      const [u] = await db
        .insert(users)
        .values({ email: 'typemap@test.local', name: 'Type Map', passwordHash: 'x' })
        .returning();
      const [co] = await db
        .insert(companies)
        .values({ name: 'Type Map Co', ownerId: u.id })
        .returning();
      const typeCtx: ServiceContext = { db, companyId: co.id, userId: u.id };

      const iif = `!ACCNT\tNAME\tACCNTTYPE\nACCNT\tMy Bank\tBANK\n`;
      await importIIF(typeCtx, iif);

      // Verify the account was written with correct type/subtype.
      const { accounts: acctTable } = await import('@/lib/db/schema');
      const { eq, and } = await import('drizzle-orm');
      const rows = await db
        .select()
        .from(acctTable)
        .where(and(eq(acctTable.companyId, co.id), eq(acctTable.name, 'My Bank')));
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('asset');
      expect(rows[0].subtype).toBe('checking');
    });

    it('handles IIF with only ACCNT section', async () => {
      const [u] = await db
        .insert(users)
        .values({ email: 'accntonly@test.local', name: 'Accnt Only', passwordHash: 'x' })
        .returning();
      const [co] = await db
        .insert(companies)
        .values({ name: 'Accnt Only Co', ownerId: u.id })
        .returning();
      const onlyCtx: ServiceContext = { db, companyId: co.id, userId: u.id };

      const iif = `!ACCNT\tNAME\tACCNTTYPE\nACCNT\tSales Revenue\tINCOME\n`;
      const counts = await importIIF(onlyCtx, iif);
      expect(counts.accounts).toBe(1);
      expect(counts.customers).toBe(0);
      expect(counts.vendors).toBe(0);
    });
  });
});
