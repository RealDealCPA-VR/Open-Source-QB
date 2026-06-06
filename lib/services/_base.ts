/**
 * Service-layer base. Every business module (accounts, invoices, bills, payments, …) is a set of
 * pure functions that take a ServiceContext and operate through Drizzle. UI and API routes are thin
 * wrappers over these services, which keeps the accounting logic testable without a browser/Electron.
 *
 * Conventions:
 *  - Services throw `ServiceError` (with a stable `code`) on failure; API routes translate to HTTP.
 *  - Every mutation writes an `audit_logs` row via `writeAudit`.
 *  - Multi-tenant safety: every query is scoped by `ctx.companyId`. Never trust a client-supplied id
 *    without checking it belongs to the company.
 */
import type { DB } from '@/lib/db';
import { auditLogs } from '@/lib/db/schema';

export interface ServiceContext {
  db: DB;
  companyId: string;
  /** Acting user; nullable for system/automation actions. */
  userId: string | null;
}

export type ServiceErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'UNBALANCED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'PERIOD_CLOSED'
  | 'INTERNAL';

export class ServiceError extends Error {
  constructor(
    public code: ServiceErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export const notFound = (what: string) => new ServiceError('NOT_FOUND', `${what} not found`);
export const validation = (msg: string, details?: unknown) =>
  new ServiceError('VALIDATION', msg, details);

export type AuditAction = 'create' | 'update' | 'delete' | 'void' | 'llm_correction';

/** Record a mutation in the audit trail. Call inside the same transaction as the mutation. */
export async function writeAudit(
  ctx: ServiceContext,
  params: {
    action: AuditAction;
    entityType: string;
    entityId: string;
    oldValues?: unknown;
    newValues?: unknown;
    llmReasoning?: string;
  },
): Promise<void> {
  await ctx.db.insert(auditLogs).values({
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    oldValues: params.oldValues ?? null,
    newValues: params.newValues ?? null,
    llmReasoning: params.llmReasoning ?? null,
  });
}

/** Run a function inside a DB transaction, returning its result. */
export async function inTransaction<T>(
  ctx: ServiceContext,
  fn: (txCtx: ServiceContext) => Promise<T>,
): Promise<T> {
  return ctx.db.transaction(async (tx) => fn({ ...ctx, db: tx as unknown as DB }));
}
