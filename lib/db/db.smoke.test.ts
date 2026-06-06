import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, closeDb } from './index';
import { users } from './schema';
import path from 'node:path';
import fs from 'node:fs';

// Use a throwaway data dir so the test is hermetic.
const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-smoke');

describe('PGlite local database', () => {
  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('boots, migrates, and round-trips a row', async () => {
    const db = await getDb(TEST_DIR);

    const [inserted] = await db
      .insert(users)
      .values({ email: 'smoke@test.local', name: 'Smoke Test', passwordHash: 'x' })
      .returning();

    expect(inserted.id).toBeTruthy();
    expect(inserted.email).toBe('smoke@test.local');

    const found = await db.select().from(users).where(eq(users.email, 'smoke@test.local'));
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('Smoke Test');
  });
});
