import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, userCompanies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { getRole, requireRole, requireWrite } from './rbac';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-rbac');
let db: DB;
let ownerCtx: ServiceContext;
let viewerCtx: ServiceContext;

describe('RBAC', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);
    const [owner] = await db.insert(users).values({ email: 'o@t.local', name: 'Owner', passwordHash: 'x' }).returning();
    const [viewer] = await db.insert(users).values({ email: 'v@t.local', name: 'Viewer', passwordHash: 'x' }).returning();
    const [co] = await db.insert(companies).values({ name: 'RBAC Co', ownerId: owner.id }).returning();
    await db.insert(userCompanies).values({ userId: viewer.id, companyId: co.id, role: 'viewer' });
    ownerCtx = { db, companyId: co.id, userId: owner.id };
    viewerCtx = { db, companyId: co.id, userId: viewer.id };
  });
  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('recognizes the company owner', async () => {
    expect(await getRole(ownerCtx)).toBe('owner');
    await expect(requireWrite(ownerCtx)).resolves.toBe('owner');
    await expect(requireRole(ownerCtx, 'admin')).resolves.toBe('owner');
  });

  it('blocks viewers from write actions', async () => {
    expect(await getRole(viewerCtx)).toBe('viewer');
    await expect(requireWrite(viewerCtx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
