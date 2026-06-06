/**
 * Chart of Accounts service. CRUD + hierarchy for the company's accounts.
 */
import { and, asc, eq } from 'drizzle-orm';
import { accounts } from '@/lib/db/schema';
import { toAmountString } from '@/lib/money';
import { type ServiceContext, notFound, validation, writeAudit } from './_base';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface CreateAccountInput {
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  parentId?: string | null;
  openingBalance?: string | number | null;
  description?: string | null;
}

export async function listAccounts(ctx: ServiceContext, opts?: { includeInactive?: boolean }) {
  const where = opts?.includeInactive
    ? eq(accounts.companyId, ctx.companyId)
    : and(eq(accounts.companyId, ctx.companyId), eq(accounts.isActive, true));
  return ctx.db.select().from(accounts).where(where).orderBy(asc(accounts.code));
}

export async function getAccount(ctx: ServiceContext, id: string) {
  const [row] = await ctx.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.companyId, ctx.companyId)));
  if (!row) throw notFound('Account');
  return row;
}

export async function createAccount(ctx: ServiceContext, input: CreateAccountInput) {
  if (!input.code?.trim()) throw validation('Account code is required.');
  if (!input.name?.trim()) throw validation('Account name is required.');

  // Enforce unique code per company.
  const existing = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, input.code)));
  if (existing.length) throw validation(`Account code "${input.code}" already exists.`);

  const [row] = await ctx.db
    .insert(accounts)
    .values({
      companyId: ctx.companyId,
      code: input.code.trim(),
      name: input.name.trim(),
      type: input.type,
      subtype: input.subtype as never,
      parentId: input.parentId ?? null,
      balance: toAmountString(input.openingBalance ?? 0),
      description: input.description ?? null,
    })
    .returning();

  await writeAudit(ctx, {
    action: 'create',
    entityType: 'account',
    entityId: row.id,
    newValues: row,
  });
  return row;
}

export async function updateAccount(
  ctx: ServiceContext,
  id: string,
  patch: Partial<Pick<CreateAccountInput, 'name' | 'subtype' | 'parentId' | 'description'>> & {
    isActive?: boolean;
  },
) {
  const before = await getAccount(ctx, id);
  const [row] = await ctx.db
    .update(accounts)
    .set({
      name: patch.name ?? before.name,
      subtype: (patch.subtype as never) ?? before.subtype,
      parentId: patch.parentId === undefined ? before.parentId : patch.parentId,
      description: patch.description === undefined ? before.description : patch.description,
      isActive: patch.isActive === undefined ? before.isActive : patch.isActive,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, id))
    .returning();

  await writeAudit(ctx, {
    action: 'update',
    entityType: 'account',
    entityId: id,
    oldValues: before,
    newValues: row,
  });
  return row;
}

/** Soft-delete: deactivate. Hard delete is blocked once the account has activity. */
export async function deactivateAccount(ctx: ServiceContext, id: string) {
  return updateAccount(ctx, id, { isActive: false });
}

/** Build a parent→children tree for UI rendering. */
export async function getAccountTree(ctx: ServiceContext) {
  const rows = await listAccounts(ctx, { includeInactive: true });
  type Node = (typeof rows)[number] & { children: Node[] };
  const byId = new Map<string, Node>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: Node[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}
