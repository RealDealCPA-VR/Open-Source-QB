/**
 * Company service — create/open company files and seed a default Chart of Accounts.
 * A "company file" maps to a PGlite data directory (see lib/db). For now we operate on the
 * active database; multi-file management is layered on in the Electron shell.
 */
import { eq } from 'drizzle-orm';
import { accounts, companies, users, userCompanies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { notFound, writeAudit } from './_base';
import type { DB } from '@/lib/db';

type AccountSeed = { code: string; name: string; type: string; subtype: string };

/** A sensible general-business default Chart of Accounts. */
export const DEFAULT_COA: AccountSeed[] = [
  { code: '1000', name: 'Checking', type: 'asset', subtype: 'checking' },
  { code: '1010', name: 'Savings', type: 'asset', subtype: 'savings' },
  { code: '1050', name: 'Undeposited Funds', type: 'asset', subtype: 'checking' },
  { code: '1200', name: 'Accounts Receivable', type: 'asset', subtype: 'accounts_receivable' },
  { code: '1250', name: 'Retainage Receivable', type: 'asset', subtype: 'accounts_receivable' },
  { code: '1300', name: 'Inventory Asset', type: 'asset', subtype: 'inventory' },
  { code: '1500', name: 'Fixed Assets', type: 'asset', subtype: 'fixed_assets' },
  { code: '2000', name: 'Accounts Payable', type: 'liability', subtype: 'accounts_payable' },
  { code: '2100', name: 'Credit Card', type: 'liability', subtype: 'credit_card' },
  { code: '2200', name: 'Sales Tax Payable', type: 'liability', subtype: 'long_term_liability' },
  { code: '2300', name: 'Payroll Liabilities', type: 'liability', subtype: 'long_term_liability' },
  { code: '3000', name: "Owner's Equity", type: 'equity', subtype: 'owners_equity' },
  { code: '3900', name: 'Retained Earnings', type: 'equity', subtype: 'retained_earnings' },
  { code: '4000', name: 'Sales Income', type: 'revenue', subtype: 'sales' },
  { code: '4100', name: 'Service Income', type: 'revenue', subtype: 'service_revenue' },
  { code: '4900', name: 'Other Income', type: 'revenue', subtype: 'other_income' },
  { code: '5000', name: 'Cost of Goods Sold', type: 'expense', subtype: 'cost_of_goods_sold' },
  { code: '6000', name: 'Advertising & Marketing', type: 'expense', subtype: 'operating_expenses' },
  { code: '6100', name: 'Bank & Merchant Fees', type: 'expense', subtype: 'operating_expenses' },
  { code: '6200', name: 'Insurance', type: 'expense', subtype: 'operating_expenses' },
  { code: '6300', name: 'Office Supplies', type: 'expense', subtype: 'operating_expenses' },
  { code: '6400', name: 'Rent', type: 'expense', subtype: 'operating_expenses' },
  { code: '6500', name: 'Payroll Expense', type: 'expense', subtype: 'payroll' },
  { code: '6600', name: 'Utilities', type: 'expense', subtype: 'operating_expenses' },
  { code: '6700', name: 'Taxes & Licenses', type: 'expense', subtype: 'taxes' },
];

export async function listCompanies(db: DB) {
  return db.select().from(companies);
}

export async function createCompany(
  db: DB,
  input: { name: string; ownerId: string; seedCoa?: boolean },
) {
  const [company] = await db
    .insert(companies)
    .values({ name: input.name, ownerId: input.ownerId })
    .returning();

  await db
    .insert(userCompanies)
    .values({ userId: input.ownerId, companyId: company.id, role: 'owner' });

  if (input.seedCoa !== false) {
    await db.insert(accounts).values(
      DEFAULT_COA.map((a) => ({
        companyId: company.id,
        code: a.code,
        name: a.name,
        type: a.type as never,
        subtype: a.subtype as never,
      })),
    );
  }
  return company;
}

/**
 * Dev/first-run helper: ensure there is at least one user + company so the UI has a context.
 * In production this is replaced by the onboarding wizard + auth.
 */
export async function ensureDevCompany(db: DB): Promise<{ companyId: string; userId: string }> {
  const [existingCompany] = await db.select().from(companies).limit(1);
  if (existingCompany) {
    const [owner] = await db.select().from(users).where(eq(users.id, existingCompany.ownerId));
    return { companyId: existingCompany.id, userId: owner?.id ?? existingCompany.ownerId };
  }
  const [user] = await db
    .insert(users)
    .values({ email: 'demo@bookkeeper.local', name: 'Demo User', passwordHash: 'dev' })
    .returning();
  const company = await createCompany(db, { name: 'Demo Company', ownerId: user.id });
  return { companyId: company.id, userId: user.id };
}

export async function getCompany(ctx: ServiceContext) {
  const [row] = await ctx.db.select().from(companies).where(eq(companies.id, ctx.companyId));
  return row ?? null;
}

export interface UpdateCompanyInput {
  name?: string;
  settings?: {
    fiscalYearEnd?: string;
    currency?: string;
    timezone?: string;
    [key: string]: unknown;
  };
}

/**
 * Update the active company's name and/or settings JSONB (deep-merged).
 * Scoped to ctx.companyId. Writes an audit log row and returns the updated row.
 */
export async function updateCompany(ctx: ServiceContext, input: UpdateCompanyInput) {
  const existing = await getCompany(ctx);
  if (!existing) throw notFound('company');

  const mergedSettings = {
    ...(existing.settings ?? {}),
    ...(input.settings ?? {}),
  };

  const [updated] = await ctx.db
    .update(companies)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      settings: mergedSettings,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, ctx.companyId))
    .returning();

  await writeAudit(ctx, {
    action: 'update',
    entityType: 'company',
    entityId: ctx.companyId,
    oldValues: { name: existing.name, settings: existing.settings },
    newValues: { name: updated.name, settings: updated.settings },
  });

  return updated;
}
