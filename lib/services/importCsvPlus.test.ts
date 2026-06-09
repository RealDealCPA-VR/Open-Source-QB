/**
 * Tests for the extended CSV mapper (skipRows, flipSign, previewCSV) and
 * QFX file-type acceptance in the banking import service.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts, bankAccounts, fileImports } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { parseCSV, previewCSV, importTransactions } from './import';

const SAMPLE_CSV = `Date,Description,Amount
2024-01-15,Stripe Payout,2500.00
2024-01-20,AWS Cloud Services,-220.50
2024-01-25,Google Ads,-150.00
`;

/** A QFX file is OFX with an Intuit header — same SGML body. */
const SAMPLE_QFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>USD
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240210
<TRNAMT>-42.00
<FITID>QFX001
<NAME>COFFEE SHOP
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240212
<TRNAMT>900.00
<FITID>QFX002
<NAME>CLIENT PAYMENT
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

describe('CSV mapper extensions (pure parsing)', () => {
  it('skipRows drops a bank-export preamble before the header', () => {
    const withPreamble = `Acme Bank Export\n"Account: ****1234"\n${SAMPLE_CSV}`;
    const txns = parseCSV(withPreamble, {
      dateCol: 'Date',
      descriptionCol: 'Description',
      amountCol: 'Amount',
      skipRows: 2,
    });
    expect(txns).toHaveLength(3);
    expect(txns[0].description).toBe('Stripe Payout');
    expect(txns[0].amount).toBe('2500.00');
  });

  it('flipSign negates single-amount-column values', () => {
    const txns = parseCSV(SAMPLE_CSV, {
      dateCol: 'Date',
      descriptionCol: 'Description',
      amountCol: 'Amount',
      flipSign: true,
    });
    expect(txns[0].amount).toBe('-2500.00');
    expect(txns[1].amount).toBe('220.50');
  });

  it('flipSign also applies after debit/credit split resolution', () => {
    const splitCsv = `Date,Desc,Debit,Credit\n2024-02-01,Payment,100.00,\n2024-02-02,Deposit,,500.00\n`;
    const txns = parseCSV(splitCsv, {
      dateCol: 'Date',
      descriptionCol: 'Desc',
      amountCol: 'Debit',
      debitCol: 'Debit',
      creditCol: 'Credit',
      flipSign: true,
    });
    expect(txns[0].amount).toBe('100.00'); // debit (normally -100) flipped
    expect(txns[1].amount).toBe('-500.00');
  });

  it('honors dateFormat together with skipRows', () => {
    const euCsv = `junk line\nDate,Description,Amount\n03/04/2024,Ambiguous,10.00\n`;
    const txns = parseCSV(euCsv, {
      dateCol: 'Date',
      descriptionCol: 'Description',
      amountCol: 'Amount',
      dateFormat: 'DD/MM/YYYY',
      skipRows: 1,
    });
    expect(txns[0].date.toISOString().slice(0, 10)).toBe('2024-04-03');
  });
});

describe('previewCSV', () => {
  it('returns headers, limited rows, and the total parsed count', () => {
    const preview = previewCSV(
      SAMPLE_CSV,
      { dateCol: 'Date', descriptionCol: 'Description', amountCol: 'Amount' },
      2,
    );
    expect(preview.error).toBeNull();
    expect(preview.headers).toEqual(['Date', 'Description', 'Amount']);
    expect(preview.totalParsed).toBe(3);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0]).toMatchObject({ description: 'Stripe Payout', amount: '2500.00' });
    expect(preview.rows[0].date.slice(0, 10)).toBe('2024-01-15');
  });

  it('keeps headers and reports the error when the mapping fails', () => {
    const preview = previewCSV(SAMPLE_CSV, {
      dateCol: 'Nope',
      descriptionCol: 'Description',
      amountCol: 'Amount',
    });
    expect(preview.error).toBeTruthy();
    expect(preview.rows).toHaveLength(0);
    expect(preview.totalParsed).toBe(0);
    expect(preview.headers).toEqual(['Date', 'Description', 'Amount']); // still usable for re-mapping
  });

  it('detects headers after skipRows', () => {
    const withPreamble = `Acme Bank Export\n${SAMPLE_CSV}`;
    const preview = previewCSV(withPreamble, {
      dateCol: 'Date',
      descriptionCol: 'Description',
      amountCol: 'Amount',
      skipRows: 1,
    });
    expect(preview.headers).toEqual(['Date', 'Description', 'Amount']);
    expect(preview.error).toBeNull();
    expect(preview.totalParsed).toBe(3);
  });
});

describe('QFX import (integration)', () => {
  const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-import-plus');
  let db: DB;
  let ctx: ServiceContext;
  let bankAccountId: string;

  beforeAll(async () => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    db = await getDb(TEST_DIR);
    const [user] = await db
      .insert(users)
      .values({ email: 'qfx@test.local', name: 'QFX', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'QFX Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };
    const [gl] = await db
      .insert(accounts)
      .values({ companyId: company.id, code: '1000', name: 'Checking', type: 'asset', subtype: 'checking' })
      .returning();
    const [ba] = await db
      .insert(bankAccounts)
      .values({ companyId: company.id, accountId: gl.id, bankName: 'QFX Bank', accountNumber: '0001' })
      .returning();
    bankAccountId = ba.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('accepts fileType "qfx" and parses it as OFX', async () => {
    const summary = await importTransactions(ctx, {
      bankAccountId,
      fileType: 'qfx',
      content: SAMPLE_QFX,
      filename: 'feb2024.qfx',
    });
    expect(summary.parsed).toBe(2);
    expect(summary.imported).toBe(2);
    expect(summary.errors).toBe(0);

    // The frozen file_type enum has no 'qfx' — stored as 'ofx'.
    const [row] = await db.select().from(fileImports).where(eq(fileImports.id, summary.fileImportId));
    expect(row.fileType).toBe('ofx');
    expect(row.filename).toBe('feb2024.qfx');
    expect(row.status).toBe('completed');
  });
});
