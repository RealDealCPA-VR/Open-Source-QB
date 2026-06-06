/**
 * Role-based access control. Roles live on `user_companies` (owner/admin/accountant/viewer).
 * Services that mutate sensitive data can call `requireRole(ctx, ['owner','admin'])` to enforce.
 * The owner of a company always passes.
 */
import { and, eq } from 'drizzle-orm';
import { companies, userCompanies } from '@/lib/db/schema';
import { type ServiceContext, ServiceError } from './_base';

export type Role = 'owner' | 'admin' | 'accountant' | 'viewer';

/** Capability rank — higher can do everything a lower role can. */
const RANK: Record<Role, number> = { viewer: 0, accountant: 1, admin: 2, owner: 3 };

export async function getRole(ctx: ServiceContext): Promise<Role | null> {
  if (!ctx.userId) return null;
  // Company owner is always 'owner'.
  const [company] = await ctx.db
    .select({ ownerId: companies.ownerId })
    .from(companies)
    .where(eq(companies.id, ctx.companyId));
  if (company?.ownerId === ctx.userId) return 'owner';

  const [m] = await ctx.db
    .select({ role: userCompanies.role })
    .from(userCompanies)
    .where(and(eq(userCompanies.userId, ctx.userId), eq(userCompanies.companyId, ctx.companyId)));
  return (m?.role as Role) ?? null;
}

/** Throw FORBIDDEN unless the current user's role meets the minimum (or is in the allowed set). */
export async function requireRole(ctx: ServiceContext, allowed: Role | Role[]): Promise<Role> {
  const role = await getRole(ctx);
  if (!role) throw new ServiceError('FORBIDDEN', 'You do not have access to this company.');
  const list = Array.isArray(allowed) ? allowed : [allowed];
  const minRank = Math.min(...list.map((r) => RANK[r]));
  if (RANK[role] < minRank) {
    throw new ServiceError('FORBIDDEN', `This action requires one of: ${list.join(', ')}.`);
  }
  return role;
}

/** Convenience: viewers cannot write. */
export async function requireWrite(ctx: ServiceContext): Promise<Role> {
  return requireRole(ctx, ['accountant', 'admin', 'owner']);
}
