/**
 * Integration tests for the company-file password (file-open lock).
 *
 * Covers: default-unprotected status, set/verify/change/remove, the < 4 char guard, the
 * "current password required to change/remove" guard, that the hash is stored on the primary
 * (earliest) company, and that verifyFilePassword returns true for an unprotected file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { companies, users } from '@/lib/db/schema';
import { ServiceError } from './_base';
import {
  getFileLockStatus,
  verifyFilePassword,
  setFilePassword,
  removeFilePassword,
} from './fileLock';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-file-lock');
let db: DB;

describe('Company-file password (integration)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);
    const [user] = await db
      .insert(users)
      .values({ email: 'lock-owner@test.local', name: 'Lock Owner', passwordHash: 'x' })
      .returning();
    // Two companies: the earlier one is the "primary" that holds the file password.
    await db.insert(companies).values({ name: 'Primary Co', ownerId: user.id }).returning();
    await new Promise((r) => setTimeout(r, 5)); // ensure a distinct createdAt ordering
    await db.insert(companies).values({ name: 'Second Co', ownerId: user.id }).returning();
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('reports unprotected by default and verifies any/empty password as open', async () => {
    const status = await getFileLockStatus(db);
    expect(status.enabled).toBe(false);
    expect(status.companyName).toBe('Primary Co');
    expect(await verifyFilePassword(db, '')).toBe(true);
    expect(await verifyFilePassword(db, 'anything')).toBe(true);
  });

  it('rejects a password shorter than 4 characters', async () => {
    await expect(setFilePassword(db, 'abc')).rejects.toBeInstanceOf(ServiceError);
  });

  it('sets a password, then enables + verifies correctly', async () => {
    await setFilePassword(db, 'hunter2');
    const status = await getFileLockStatus(db);
    expect(status.enabled).toBe(true);
    expect(await verifyFilePassword(db, 'hunter2')).toBe(true);
    expect(await verifyFilePassword(db, 'wrong')).toBe(false);
    expect(await verifyFilePassword(db, '')).toBe(false);
  });

  it('stores the hash on the primary company only', async () => {
    const rows = await db.select().from(companies);
    const primary = rows.find((r) => r.name === 'Primary Co')!;
    const second = rows.find((r) => r.name === 'Second Co')!;
    const fl = (primary.settings as Record<string, unknown> | null)?.fileLock as
      | { enabled?: boolean; hash?: string }
      | undefined;
    expect(fl?.enabled).toBe(true);
    expect(typeof fl?.hash).toBe('string');
    expect(fl?.hash).not.toContain('hunter2'); // never store plaintext
    expect((second.settings as Record<string, unknown> | null)?.fileLock).toBeUndefined();
  });

  it('requires the current password to change it', async () => {
    await expect(setFilePassword(db, 'newpass1', { currentPassword: 'wrong' })).rejects.toBeInstanceOf(
      ServiceError,
    );
    await setFilePassword(db, 'newpass1', { currentPassword: 'hunter2' });
    expect(await verifyFilePassword(db, 'newpass1')).toBe(true);
    expect(await verifyFilePassword(db, 'hunter2')).toBe(false);
  });

  it('requires the current password to remove it, then reverts to unprotected', async () => {
    await expect(removeFilePassword(db, 'wrong')).rejects.toBeInstanceOf(ServiceError);
    await removeFilePassword(db, 'newpass1');
    const status = await getFileLockStatus(db);
    expect(status.enabled).toBe(false);
    expect(await verifyFilePassword(db, 'anything')).toBe(true);
  });
});
