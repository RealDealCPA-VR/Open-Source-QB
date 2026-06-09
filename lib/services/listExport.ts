/**
 * List exports — QB Desktop "File > Utilities > Export > Lists" parity.
 *
 * Exports the five core name/item lists to CSV so data can leave the app in an
 * open format (data-ownership promise):
 *   customers, vendors, items, accounts (chart of accounts), employees.
 *
 * `exportListCsv(ctx, list)` returns { filename, csv }. The CSV is RFC-4180
 * escaped, CRLF-terminated, and prefixed with a UTF-8 BOM so Excel opens it
 * with correct encoding. Sensitive fields (SSN, password hashes, encrypted
 * vendor tax id) are intentionally NOT exported.
 */
import { asc, eq } from 'drizzle-orm';
import { accounts, customers, employees, items, vendors } from '@/lib/db/schema';
import { toAmountString } from '@/lib/money';
import { validation, type ServiceContext } from './_base';

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

export type ExportableList = 'customers' | 'vendors' | 'items' | 'accounts' | 'employees';

export const EXPORTABLE_LISTS: ExportableList[] = [
  'customers',
  'vendors',
  'items',
  'accounts',
  'employees',
];

/** Escape a single CSV cell per RFC 4180 (quote when it contains , " or newlines). */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build a CSV document from a header row + data rows (CRLF lines, UTF-8 BOM). */
export function buildCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvEscape).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function flattenAddress(addr: Record<string, string> | null | undefined): string {
  if (!addr) return '';
  const parts = [addr.line1, addr.line2, addr.city, addr.state, addr.zip, addr.country];
  return parts.filter(Boolean).join(', ');
}

// ---------------------------------------------------------------------------
// Per-list exporters
// ---------------------------------------------------------------------------

async function customersCsv(ctx: ServiceContext): Promise<string> {
  const rows = await ctx.db
    .select()
    .from(customers)
    .where(eq(customers.companyId, ctx.companyId))
    .orderBy(asc(customers.displayName));

  return buildCsv(
    [
      'Name',
      'Company',
      'Email',
      'Phone',
      'Billing Address',
      'Shipping Address',
      'Terms',
      'Credit Limit',
      'Taxable',
      'Balance',
      'Notes',
      'Active',
    ],
    rows.map((c) => [
      c.displayName,
      c.companyName,
      c.email,
      c.phone,
      flattenAddress(c.billingAddress),
      flattenAddress(c.shippingAddress),
      c.terms,
      c.creditLimit ? toAmountString(c.creditLimit) : '',
      c.taxable ? 'Y' : 'N',
      toAmountString(c.balance),
      c.notes,
      c.isActive ? 'Y' : 'N',
    ]),
  );
}

async function vendorsCsv(ctx: ServiceContext): Promise<string> {
  const rows = await ctx.db
    .select()
    .from(vendors)
    .where(eq(vendors.companyId, ctx.companyId))
    .orderBy(asc(vendors.displayName));

  return buildCsv(
    ['Name', 'Company', 'Email', 'Phone', 'Address', 'Terms', '1099 Vendor', 'Balance', 'Notes', 'Active'],
    rows.map((v) => [
      v.displayName,
      v.companyName,
      v.email,
      v.phone,
      flattenAddress(v.address),
      v.terms,
      v.is1099 ? 'Y' : 'N',
      toAmountString(v.balance),
      v.notes,
      v.isActive ? 'Y' : 'N',
    ]),
  );
}

async function itemsCsv(ctx: ServiceContext): Promise<string> {
  const rows = await ctx.db
    .select()
    .from(items)
    .where(eq(items.companyId, ctx.companyId))
    .orderBy(asc(items.name));

  // Account id -> "code · name" lookup for income/expense/asset columns.
  const acctRows = await ctx.db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.companyId, ctx.companyId));
  const acctLabel = new Map(acctRows.map((a) => [a.id, `${a.code} ${a.name}`]));

  return buildCsv(
    [
      'Name',
      'SKU',
      'Type',
      'Description',
      'Sales Price',
      'Purchase Cost',
      'Income Account',
      'Expense Account',
      'Asset Account',
      'Taxable',
      'Qty On Hand',
      'Reorder Point',
      'Average Cost',
      'Unit of Measure',
      'Active',
    ],
    rows.map((i) => [
      i.name,
      i.sku,
      i.type,
      i.description,
      i.salesPrice ? toAmountString(i.salesPrice) : '',
      i.purchaseCost ? toAmountString(i.purchaseCost) : '',
      i.incomeAccountId ? (acctLabel.get(i.incomeAccountId) ?? '') : '',
      i.expenseAccountId ? (acctLabel.get(i.expenseAccountId) ?? '') : '',
      i.assetAccountId ? (acctLabel.get(i.assetAccountId) ?? '') : '',
      i.taxable ? 'Y' : 'N',
      i.quantityOnHand ?? '',
      i.reorderPoint ?? '',
      i.averageCost ?? '',
      i.unitOfMeasure,
      i.isActive ? 'Y' : 'N',
    ]),
  );
}

async function accountsCsv(ctx: ServiceContext): Promise<string> {
  const rows = await ctx.db
    .select()
    .from(accounts)
    .where(eq(accounts.companyId, ctx.companyId))
    .orderBy(asc(accounts.code));

  const codeById = new Map(rows.map((a) => [a.id, a.code]));

  return buildCsv(
    ['Code', 'Name', 'Type', 'Subtype', 'Parent Code', 'Balance', 'Description', 'Active'],
    rows.map((a) => [
      a.code,
      a.name,
      a.type,
      a.subtype,
      a.parentId ? (codeById.get(a.parentId) ?? '') : '',
      toAmountString(a.balance),
      a.description,
      a.isActive ? 'Y' : 'N',
    ]),
  );
}

async function employeesCsv(ctx: ServiceContext): Promise<string> {
  const rows = await ctx.db
    .select()
    .from(employees)
    .where(eq(employees.companyId, ctx.companyId))
    .orderBy(asc(employees.lastName), asc(employees.firstName));

  return buildCsv(
    ['First Name', 'Last Name', 'Email', 'Pay Type', 'Pay Rate', 'Address', 'Active'],
    rows.map((e) => [
      e.firstName,
      e.lastName,
      e.email,
      e.payType,
      toAmountString(e.payRate),
      flattenAddress(e.address as Record<string, string> | null),
      e.isActive ? 'Y' : 'N',
    ]),
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Export one of the core lists to CSV. Throws VALIDATION on an unknown list
 * name. Returns the suggested download filename alongside the CSV body.
 */
export async function exportListCsv(
  ctx: ServiceContext,
  list: string,
): Promise<{ filename: string; csv: string }> {
  const today = new Date().toISOString().slice(0, 10);
  switch (list as ExportableList) {
    case 'customers':
      return { filename: `customers-${today}.csv`, csv: await customersCsv(ctx) };
    case 'vendors':
      return { filename: `vendors-${today}.csv`, csv: await vendorsCsv(ctx) };
    case 'items':
      return { filename: `items-${today}.csv`, csv: await itemsCsv(ctx) };
    case 'accounts':
      return { filename: `chart-of-accounts-${today}.csv`, csv: await accountsCsv(ctx) };
    case 'employees':
      return { filename: `employees-${today}.csv`, csv: await employeesCsv(ctx) };
    default:
      throw validation(
        `Unknown list "${list}". Exportable lists: ${EXPORTABLE_LISTS.join(', ')}.`,
      );
  }
}
