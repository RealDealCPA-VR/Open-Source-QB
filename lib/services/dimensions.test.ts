import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import {
  listClasses,
  createClass,
  deactivateClass,
  listLocations,
  createLocation,
  deactivateLocation,
} from './dimensions';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-dimensions');
let ctx: ServiceContext;
let ctxOther: ServiceContext; // second company — for scoping assertions
let db: DB;

describe('Dimensions service (classes + locations)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    // Primary company
    const [user] = await db
      .insert(users)
      .values({ email: 'owner@dimensions.test', name: 'Owner', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Primary Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // Second company (for scoping tests)
    const [user2] = await db
      .insert(users)
      .values({ email: 'other@dimensions.test', name: 'Other', passwordHash: 'x' })
      .returning();
    const [company2] = await db
      .insert(companies)
      .values({ name: 'Other Co', ownerId: user2.id })
      .returning();
    ctxOther = { db, companyId: company2.id, userId: user2.id };
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ---- Classes ----------------------------------------------------------------

  describe('Classes', () => {
    it('starts with an empty list', async () => {
      const list = await listClasses(ctx);
      expect(list).toHaveLength(0);
    });

    it('creates a top-level class', async () => {
      const cls = await createClass(ctx, { name: 'Marketing' });
      expect(cls.name).toBe('Marketing');
      expect(cls.companyId).toBe(ctx.companyId);
      expect(cls.parentId).toBeNull();
      expect(cls.isActive).toBe(true);
    });

    it('creates a child class under a valid parent', async () => {
      const parent = await createClass(ctx, { name: 'Operations' });
      const child = await createClass(ctx, { name: 'West Region', parentId: parent.id });
      expect(child.parentId).toBe(parent.id);
    });

    it('lists all active classes for the company', async () => {
      const list = await listClasses(ctx);
      const names = list.map((c) => c.name);
      expect(names).toContain('Marketing');
      expect(names).toContain('Operations');
      expect(names).toContain('West Region');
    });

    it('rejects parentId that belongs to another company', async () => {
      const otherCls = await createClass(ctxOther, { name: 'Foreign' });
      await expect(
        createClass(ctx, { name: 'Bad Child', parentId: otherCls.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects blank name', async () => {
      await expect(createClass(ctx, { name: '   ' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    });

    it('deactivates a class', async () => {
      const cls = await createClass(ctx, { name: 'ToDeactivate' });
      const deactivated = await deactivateClass(ctx, cls.id);
      expect(deactivated.isActive).toBe(false);

      // Should not appear in the active list.
      const list = await listClasses(ctx);
      expect(list.find((c) => c.id === cls.id)).toBeUndefined();
    });

    it('deactivating twice is idempotent', async () => {
      const cls = await createClass(ctx, { name: 'ToDeactivateTwice' });
      await deactivateClass(ctx, cls.id);
      const again = await deactivateClass(ctx, cls.id);
      expect(again.isActive).toBe(false);
    });

    it('cannot deactivate a class from another company', async () => {
      const otherCls = await createClass(ctxOther, { name: 'OtherCo Class' });
      await expect(deactivateClass(ctx, otherCls.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('scoping: classes from other company do not appear in this company list', async () => {
      const list = await listClasses(ctx);
      const allIds = list.map((c) => c.companyId);
      expect(allIds.every((id) => id === ctx.companyId)).toBe(true);
    });
  });

  // ---- Locations --------------------------------------------------------------

  describe('Locations', () => {
    it('starts with an empty list', async () => {
      const list = await listLocations(ctx);
      expect(list).toHaveLength(0);
    });

    it('creates a location', async () => {
      const loc = await createLocation(ctx, { name: 'HQ' });
      expect(loc.name).toBe('HQ');
      expect(loc.companyId).toBe(ctx.companyId);
      expect(loc.isActive).toBe(true);
    });

    it('lists active locations', async () => {
      await createLocation(ctx, { name: 'East Office' });
      await createLocation(ctx, { name: 'West Office' });
      const list = await listLocations(ctx);
      const names = list.map((l) => l.name);
      expect(names).toContain('HQ');
      expect(names).toContain('East Office');
      expect(names).toContain('West Office');
    });

    it('rejects blank name', async () => {
      await expect(createLocation(ctx, { name: '' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    });

    it('deactivates a location', async () => {
      const loc = await createLocation(ctx, { name: 'ToRemove' });
      const deactivated = await deactivateLocation(ctx, loc.id);
      expect(deactivated.isActive).toBe(false);

      const list = await listLocations(ctx);
      expect(list.find((l) => l.id === loc.id)).toBeUndefined();
    });

    it('deactivating twice is idempotent', async () => {
      const loc = await createLocation(ctx, { name: 'IdempotentLoc' });
      await deactivateLocation(ctx, loc.id);
      const again = await deactivateLocation(ctx, loc.id);
      expect(again.isActive).toBe(false);
    });

    it('cannot deactivate a location from another company', async () => {
      const otherLoc = await createLocation(ctxOther, { name: 'OtherCo Loc' });
      await expect(deactivateLocation(ctx, otherLoc.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('scoping: locations from other company do not appear in this company list', async () => {
      const list = await listLocations(ctx);
      const allIds = list.map((l) => l.companyId);
      expect(allIds.every((id) => id === ctx.companyId)).toBe(true);
    });
  });
});
