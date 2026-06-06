/**
 * QuickBooks import helpers.
 *
 * Supports:
 *   - IIF (Intuit Interchange Format) — tab-delimited; header rows start with '!',
 *     data rows follow until the next header or end of file.
 *     parseIIF()  – pure parse, returns normalized objects.
 *     importIIF() – parse then insert via existing services; skips duplicates.
 *
 *   - CSV (customer or vendor lists) via papaparse.
 *     importCustomersCSV() / importVendorsCSV() accept a user-supplied column mapping.
 *
 * None of these functions write journal entries. They only create master-data records
 * (accounts, customers, vendors). GL impact happens later when transactions are posted.
 */
import Papa from 'papaparse';
import { and, eq } from 'drizzle-orm';
import { accounts, customers as customersTable, vendors as vendorsTable } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import { createAccount } from './accounts';
import { createCustomer } from './customers';
import { createVendor } from './vendors';

// ---------------------------------------------------------------------------
// IIF type+subtype mapping
// ---------------------------------------------------------------------------

/**
 * Map QuickBooks IIF ACCNTTYPE values to our (type, subtype) pairs.
 * Unmapped types fall back to ('expense', 'operating_expenses').
 */
const IIF_TYPE_MAP: Record<string, { type: string; subtype: string }> = {
  // Assets
  BANK: { type: 'asset', subtype: 'checking' },
  SAVINGS: { type: 'asset', subtype: 'savings' },
  'ACCOUNTS RECEIVABLE': { type: 'asset', subtype: 'accounts_receivable' },
  ARACCNT: { type: 'asset', subtype: 'accounts_receivable' },
  INVENTORY: { type: 'asset', subtype: 'inventory' },
  'FIXED ASSET': { type: 'asset', subtype: 'fixed_assets' },
  FIXEDASSET: { type: 'asset', subtype: 'fixed_assets' },
  OTHERASSET: { type: 'asset', subtype: 'fixed_assets' },
  'OTHER ASSET': { type: 'asset', subtype: 'fixed_assets' },
  OCASSET: { type: 'asset', subtype: 'checking' },

  // Liabilities
  'ACCOUNTS PAYABLE': { type: 'liability', subtype: 'accounts_payable' },
  APACCNT: { type: 'liability', subtype: 'accounts_payable' },
  ACCSPAY: { type: 'liability', subtype: 'accounts_payable' },
  'CREDIT CARD': { type: 'liability', subtype: 'credit_card' },
  CREDITCARD: { type: 'liability', subtype: 'credit_card' },
  LTLIABILITY: { type: 'liability', subtype: 'long_term_liability' },
  'LONG TERM LIABILITY': { type: 'liability', subtype: 'long_term_liability' },
  OCLIABILITY: { type: 'liability', subtype: 'accounts_payable' },
  'OTHER CURRENT LIABILITY': { type: 'liability', subtype: 'accounts_payable' },

  // Equity
  EQUITY: { type: 'equity', subtype: 'owners_equity' },
  'RETAINED EARNINGS': { type: 'equity', subtype: 'retained_earnings' },

  // Revenue
  INCOME: { type: 'revenue', subtype: 'sales' },
  'OTHER INCOME': { type: 'revenue', subtype: 'other_income' },
  OTHERINCOME: { type: 'revenue', subtype: 'other_income' },

  // Expenses
  EXPENSE: { type: 'expense', subtype: 'operating_expenses' },
  'COST OF GOODS SOLD': { type: 'expense', subtype: 'cost_of_goods_sold' },
  COGS: { type: 'expense', subtype: 'cost_of_goods_sold' },
  'OTHER EXPENSE': { type: 'expense', subtype: 'operating_expenses' },
  OTHEREXPENSE: { type: 'expense', subtype: 'operating_expenses' },
  PAYROLL: { type: 'expense', subtype: 'payroll' },
};

function mapIifType(iifType: string): { type: string; subtype: string } {
  const key = iifType.trim().toUpperCase();
  return IIF_TYPE_MAP[key] ?? { type: 'expense', subtype: 'operating_expenses' };
}

// ---------------------------------------------------------------------------
// Parsed IIF shapes
// ---------------------------------------------------------------------------

export interface IIFAccount {
  name: string;
  accntType: string;
  desc?: string;
  accnum?: string;
}

export interface IIFCustomer {
  name: string;
  companyName?: string;
  email?: string;
  phone?: string;
  billAddr1?: string;
  billCity?: string;
  billState?: string;
  billZip?: string;
  billCountry?: string;
}

export interface IIFVendor {
  name: string;
  companyName?: string;
  email?: string;
  phone?: string;
  addr1?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface ParsedIIF {
  accounts: IIFAccount[];
  customers: IIFCustomer[];
  vendors: IIFVendor[];
}

// ---------------------------------------------------------------------------
// parseIIF
// ---------------------------------------------------------------------------

/**
 * Parse an IIF file string. Header rows (starting with '!') declare the
 * field names for the section that follows; data rows (same prefix without '!')
 * carry the values. We support ACCNT, CUST, and VEND sections.
 */
export function parseIIF(content: string): ParsedIIF {
  const result: ParsedIIF = { accounts: [], customers: [], vendors: [] };

  // Normalise line endings, split into non-empty lines.
  const lines = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd());

  /** Current section info */
  let section: 'ACCNT' | 'CUST' | 'VEND' | null = null;
  let headers: string[] = [];

  for (const line of lines) {
    if (!line) continue;

    if (line.startsWith('!')) {
      // Header row — determine section and extract column names.
      const cols = line.slice(1).split('\t');
      const sectionKey = cols[0].trim().toUpperCase();
      if (sectionKey === 'ACCNT' || sectionKey === 'CUST' || sectionKey === 'VEND') {
        section = sectionKey;
        headers = cols.map((c) => c.trim().toUpperCase());
      } else {
        // Unknown section (TRANS, INVITEM, etc.) — skip until next header.
        section = null;
        headers = [];
      }
      continue;
    }

    // Data row — must match current section.
    if (!section) continue;

    const cols = line.split('\t');
    const rowType = cols[0]?.trim().toUpperCase();

    if (section === 'ACCNT' && rowType === 'ACCNT') {
      const row = zipIIF(headers, cols);
      if (row.NAME) {
        result.accounts.push({
          name: row.NAME,
          accntType: row.ACCNTTYPE ?? '',
          desc: row.DESC ?? undefined,
          accnum: row.ACCNUM ?? undefined,
        });
      }
    } else if (section === 'CUST' && rowType === 'CUST') {
      const row = zipIIF(headers, cols);
      if (row.NAME) {
        result.customers.push({
          name: row.NAME,
          companyName: row.COMPANYNAME ?? undefined,
          email: row.EMAIL ?? undefined,
          phone: row.PHONE1 ?? undefined,
          billAddr1: row.BADDR1 ?? undefined,
          billCity: row.BCITY ?? undefined,
          billState: row.BSTATE ?? undefined,
          billZip: row.BZIP ?? undefined,
          billCountry: row.BCOUNTRY ?? undefined,
        });
      }
    } else if (section === 'VEND' && rowType === 'VEND') {
      const row = zipIIF(headers, cols);
      if (row.NAME) {
        result.vendors.push({
          name: row.NAME,
          companyName: row.COMPANYNAME ?? undefined,
          email: row.EMAIL ?? undefined,
          phone: row.PHONE1 ?? undefined,
          addr1: row.ADDR1 ?? undefined,
          city: row.CITY ?? undefined,
          state: row.STATE ?? undefined,
          zip: row.ZIP ?? undefined,
          country: row.COUNTRY ?? undefined,
        });
      }
    }
  }

  return result;
}

/** Zip IIF header row + data row into an object keyed by column names. */
function zipIIF(headers: string[], cols: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    const val = cols[i]?.trim() ?? '';
    if (val) obj[headers[i]] = val;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Import result
// ---------------------------------------------------------------------------

export interface ImportCounts {
  accounts: number;
  customers: number;
  vendors: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// importIIF
// ---------------------------------------------------------------------------

/**
 * Parse an IIF string, then insert records via the existing service layer.
 * Duplicates (by account code OR displayName) are silently skipped.
 */
export async function importIIF(
  ctx: ServiceContext,
  content: string,
): Promise<ImportCounts> {
  const parsed = parseIIF(content);
  const counts: ImportCounts = { accounts: 0, customers: 0, vendors: 0, skipped: 0 };

  // ---- Accounts ----
  for (const acc of parsed.accounts) {
    // Derive a short code: use ACCNUM if present, else sanitise the name.
    const code = acc.accnum?.trim() || sanitiseCode(acc.name);
    if (!code) { counts.skipped++; continue; }

    // Check for existing account with same code in this company.
    const existing = await ctx.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, code)));
    if (existing.length) { counts.skipped++; continue; }

    const { type, subtype } = mapIifType(acc.accntType);
    try {
      await createAccount(ctx, {
        code,
        name: acc.name,
        type: type as never,
        subtype,
        description: acc.desc ?? null,
      });
      counts.accounts++;
    } catch (err) {
      if (err instanceof ServiceError && err.code === 'VALIDATION') {
        counts.skipped++;
      } else {
        throw err;
      }
    }
  }

  // ---- Customers ----
  for (const cust of parsed.customers) {
    const displayName = cust.name.trim();
    if (!displayName) { counts.skipped++; continue; }

    const existing = await ctx.db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.companyId, ctx.companyId),
          eq(customersTable.displayName, displayName),
        ),
      );
    if (existing.length) { counts.skipped++; continue; }

    try {
      await createCustomer(ctx, {
        displayName,
        companyName: cust.companyName ?? null,
        email: cust.email ?? null,
        phone: cust.phone ?? null,
        billingAddress:
          cust.billAddr1 || cust.billCity
            ? {
                line1: cust.billAddr1 ?? '',
                city: cust.billCity ?? '',
                state: cust.billState ?? '',
                zip: cust.billZip ?? '',
                country: cust.billCountry ?? '',
              }
            : null,
      });
      counts.customers++;
    } catch (err) {
      if (err instanceof ServiceError && err.code === 'VALIDATION') {
        counts.skipped++;
      } else {
        throw err;
      }
    }
  }

  // ---- Vendors ----
  for (const vend of parsed.vendors) {
    const displayName = vend.name.trim();
    if (!displayName) { counts.skipped++; continue; }

    const existing = await ctx.db
      .select({ id: vendorsTable.id })
      .from(vendorsTable)
      .where(
        and(
          eq(vendorsTable.companyId, ctx.companyId),
          eq(vendorsTable.displayName, displayName),
        ),
      );
    if (existing.length) { counts.skipped++; continue; }

    try {
      await createVendor(ctx, {
        displayName,
        companyName: vend.companyName ?? null,
        email: vend.email ?? null,
        phone: vend.phone ?? null,
        address:
          vend.addr1 || vend.city
            ? {
                street: vend.addr1 ?? '',
                city: vend.city ?? '',
                state: vend.state ?? '',
                zip: vend.zip ?? '',
                country: vend.country ?? '',
              }
            : null,
      });
      counts.vendors++;
    } catch (err) {
      if (err instanceof ServiceError && err.code === 'VALIDATION') {
        counts.skipped++;
      } else {
        throw err;
      }
    }
  }

  return counts;
}

// ---------------------------------------------------------------------------
// CSV column mapping type
// ---------------------------------------------------------------------------

/**
 * Caller-supplied mapping from canonical field names to CSV column headers.
 * All fields are optional; unmapped fields are left null.
 */
export interface CsvColumnMapping {
  displayName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  billingAddress_line1?: string;
  billingAddress_city?: string;
  billingAddress_state?: string;
  billingAddress_zip?: string;
  billingAddress_country?: string;
  // vendor-specific
  address_line1?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  address_country?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// importCustomersCSV
// ---------------------------------------------------------------------------

/**
 * Parse a CSV string with papaparse and insert customers using the supplied
 * column mapping. Rows missing a displayName value are silently skipped.
 * Duplicate displayNames within the company are also skipped.
 */
export async function importCustomersCSV(
  ctx: ServiceContext,
  content: string,
  mapping: CsvColumnMapping,
): Promise<ImportCounts> {
  const counts: ImportCounts = { accounts: 0, customers: 0, vendors: 0, skipped: 0 };

  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  });

  for (const row of parsed.data) {
    const displayName = mapping.displayName ? (row[mapping.displayName] ?? '').trim() : '';
    if (!displayName) { counts.skipped++; continue; }

    // Duplicate check.
    const existing = await ctx.db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.companyId, ctx.companyId),
          eq(customersTable.displayName, displayName),
        ),
      );
    if (existing.length) { counts.skipped++; continue; }

    const line1 = mapping.billingAddress_line1 ? (row[mapping.billingAddress_line1] ?? '') : '';
    const city   = mapping.billingAddress_city  ? (row[mapping.billingAddress_city]  ?? '') : '';
    const state  = mapping.billingAddress_state ? (row[mapping.billingAddress_state] ?? '') : '';
    const zip    = mapping.billingAddress_zip   ? (row[mapping.billingAddress_zip]   ?? '') : '';
    const country = mapping.billingAddress_country ? (row[mapping.billingAddress_country] ?? '') : '';

    try {
      await createCustomer(ctx, {
        displayName,
        companyName: mapping.companyName ? (row[mapping.companyName] ?? null) : null,
        email: mapping.email ? (row[mapping.email] ?? null) : null,
        phone: mapping.phone ? (row[mapping.phone] ?? null) : null,
        billingAddress: line1 || city ? { line1, city, state, zip, country } : null,
        notes: mapping.notes ? (row[mapping.notes] ?? null) : null,
      });
      counts.customers++;
    } catch (err) {
      if (err instanceof ServiceError && err.code === 'VALIDATION') {
        counts.skipped++;
      } else {
        throw err;
      }
    }
  }

  return counts;
}

// ---------------------------------------------------------------------------
// importVendorsCSV
// ---------------------------------------------------------------------------

/**
 * Parse a CSV string with papaparse and insert vendors using the supplied
 * column mapping. Rows missing a displayName value are silently skipped.
 * Duplicate displayNames within the company are also skipped.
 */
export async function importVendorsCSV(
  ctx: ServiceContext,
  content: string,
  mapping: CsvColumnMapping,
): Promise<ImportCounts> {
  const counts: ImportCounts = { accounts: 0, customers: 0, vendors: 0, skipped: 0 };

  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  });

  for (const row of parsed.data) {
    const displayName = mapping.displayName ? (row[mapping.displayName] ?? '').trim() : '';
    if (!displayName) { counts.skipped++; continue; }

    // Duplicate check.
    const existing = await ctx.db
      .select({ id: vendorsTable.id })
      .from(vendorsTable)
      .where(
        and(
          eq(vendorsTable.companyId, ctx.companyId),
          eq(vendorsTable.displayName, displayName),
        ),
      );
    if (existing.length) { counts.skipped++; continue; }

    const street  = mapping.address_line1   ? (row[mapping.address_line1]   ?? '') : '';
    const city    = mapping.address_city    ? (row[mapping.address_city]    ?? '') : '';
    const state   = mapping.address_state   ? (row[mapping.address_state]   ?? '') : '';
    const zip     = mapping.address_zip     ? (row[mapping.address_zip]     ?? '') : '';
    const country = mapping.address_country ? (row[mapping.address_country] ?? '') : '';

    try {
      await createVendor(ctx, {
        displayName,
        companyName: mapping.companyName ? (row[mapping.companyName] ?? null) : null,
        email: mapping.email ? (row[mapping.email] ?? null) : null,
        phone: mapping.phone ? (row[mapping.phone] ?? null) : null,
        address: street || city ? { street, city, state, zip, country } : null,
        notes: mapping.notes ? (row[mapping.notes] ?? null) : null,
      });
      counts.vendors++;
    } catch (err) {
      if (err instanceof ServiceError && err.code === 'VALIDATION') {
        counts.skipped++;
      } else {
        throw err;
      }
    }
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert an account name to a short alphanumeric code (max 20 chars). */
function sanitiseCode(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .toUpperCase()
    .slice(0, 20);
}
