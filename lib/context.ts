/**
 * Request/server context resolution. Server components and API route handlers call
 * `getServerContext()` to obtain a ServiceContext (db + current company + current user).
 *
 * Resolution order:
 *  1. Authenticated session (lib/auth) → the user + their selected/first company.
 *  2. Fallback: `ensureDevCompany` (first-run / dev / no session), still honoring a selected
 *     company cookie if present.
 */
import { cookies } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { ensureDevCompany } from '@/lib/services/company';
import { companies, userCompanies } from '@/lib/db/schema';
import { getSessionUserId } from '@/lib/auth';
import type { ServiceContext } from '@/lib/services/_base';

export const COMPANY_COOKIE = 'bka_company';

async function selectedCompanyCookie(): Promise<string | undefined> {
  try {
    const store = await cookies();
    return store.get(COMPANY_COOKIE)?.value || undefined;
  } catch {
    return undefined;
  }
}

export async function getServerContext(): Promise<ServiceContext> {
  const db = await getDb();
  const userId = await getSessionUserId();

  if (userId) {
    const sel = await selectedCompanyCookie();
    let companyId: string | undefined;
    if (sel) {
      const [m] = await db
        .select({ companyId: userCompanies.companyId })
        .from(userCompanies)
        .where(and(eq(userCompanies.userId, userId), eq(userCompanies.companyId, sel)));
      if (m) companyId = sel;
    }
    if (!companyId) {
      const [m] = await db
        .select({ companyId: userCompanies.companyId })
        .from(userCompanies)
        .where(eq(userCompanies.userId, userId))
        .limit(1);
      companyId = m?.companyId;
    }
    if (!companyId) {
      const [owned] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.ownerId, userId))
        .limit(1);
      companyId = owned?.id;
    }
    if (companyId) return { db, companyId, userId };
  }

  // Fallback (no/invalid session, dev, first run).
  const fb = await ensureDevCompany(db);
  const sel = await selectedCompanyCookie();
  if (sel) {
    const [c] = await db.select().from(companies).where(eq(companies.id, sel));
    if (c) return { db, companyId: c.id, userId: c.ownerId };
  }
  return { db, companyId: fb.companyId, userId: fb.userId };
}
