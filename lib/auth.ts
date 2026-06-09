/**
 * Local authentication for the desktop app.
 *
 * Credentials are checked against the local `users` table (bcrypt). Sessions are stateless,
 * stored in an HMAC-signed cookie (no edge crypto needed in middleware — middleware only checks
 * cookie presence; full verification happens here in the Node runtime). The signing secret is
 * generated once and persisted in the company data directory so it survives restarts.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, resolveDataDir } from '@/lib/db';
import { users } from '@/lib/db/schema';

export const SESSION_COOKIE = 'bka_session';
export const PORTAL_COOKIE = 'bka_portal'; // employee self-service session
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  if (process.env.BKA_AUTH_SECRET) return process.env.BKA_AUTH_SECRET;
  const dir = resolveDataDir();
  const file = path.join(dir, '.auth-secret');
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    fs.mkdirSync(dir, { recursive: true });
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  } catch {
    // Last-resort ephemeral secret (sessions won't survive restart, but login still works).
    return 'bookkeeper-ai-dev-secret';
  }
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Token audience: a main-app user session vs. an employee self-service portal session. */
export type TokenKind = 'user' | 'portal';

export function createSessionToken(userId: string, kind: TokenKind = 'user'): string {
  const payload = JSON.stringify({ userId, kind, exp: Date.now() + SESSION_TTL_MS });
  const body = Buffer.from(payload).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(
  token: string | undefined | null,
  expectedKind: TokenKind = 'user',
): { userId: string } | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  // constant-time compare
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof data.userId !== 'string' || typeof data.exp !== 'number') return null;
    if (Date.now() > data.exp) return null;
    // Bind the token to its audience so a portal token cannot be replayed as a main-app
    // session (and vice versa). Legacy tokens with no `kind` are treated as 'user'.
    const kind: TokenKind = data.kind === 'portal' ? 'portal' : 'user';
    if (kind !== expectedKind) return null;
    return { userId: data.userId };
  } catch {
    return null;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash || hash === 'dev') return false; // seed/demo users cannot log in
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** Resolve the current authenticated user id from the session cookie (verified). */
export async function getSessionUserId(): Promise<string | null> {
  try {
    const store = await cookies();
    return verifySessionToken(store.get(SESSION_COOKIE)?.value)?.userId ?? null;
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const db = await getDb();
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, totpEnabled: users.totpEnabled })
    .from(users)
    .where(eq(users.id, userId));
  return user ?? null;
}

/** Resolve the current employee id from the portal session cookie (verified). */
export async function getPortalEmployeeId(): Promise<string | null> {
  try {
    const store = await cookies();
    return verifySessionToken(store.get(PORTAL_COOKIE)?.value, 'portal')?.userId ?? null;
  } catch {
    return null;
  }
}
