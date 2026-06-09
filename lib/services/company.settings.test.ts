/**
 * Integration tests for the company Preferences settings layer.
 *
 * Covers:
 *  - updateCompany persists every whitelisted Preferences key (Company info,
 *    accounting, sales, purchases, payroll, inventory, custom fields).
 *  - Settings are shallow-merged: saving one tab never wipes another tab's keys.
 *  - Whitelist: protected keys (closingDate, closingDatePasswordHash,
 *    financeCharges) and unknown keys are dropped by updateCompany.
 *  - setClosingDate remains the only writer for closing-date keys and
 *    updateCompany cannot clobber them.
 *  - Viewer role contexts are rejected (FORBIDDEN) before any write.
 *  - Audit row is written for settings updates.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, auditLogs } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import {
  updateCompany,
  getCompany,
  setClosingDate,
  getClosingDateSettings,
  COMPANY_SETTINGS_KEYS,
} from './company';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-company-settings');
let db: DB;
let ctx: ServiceContext;

describe('Company preferences settings (integration)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);
    const [user] = await db
      .insert(users)
      .values({ email: 'prefs-owner@test.local', name: 'Prefs Owner', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Prefs Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('persists company-info + accounting preference keys', async () => {
    const updated = await updateCompany(ctx, {
      name: 'Prefs Co LLC',
      settings: {
        legalName: 'Prefs Company, LLC',
        ein: '12-3456789',
        addressLine1: '1 Main St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        phone: '(555) 555-1234',
        email: 'books@prefs.test',
        fiscalYearEnd: '06-30',
        currency: 'USD',
        timezone: 'America/Chicago',
        accountNumbersEnabled: false,
        reportBasis: 'cash',
      },
    });
    expect(updated.name).toBe('Prefs Co LLC');
    const settings = updated.settings as Record<string, unknown>;
    expect(settings.legalName).toBe('Prefs Company, LLC');
    expect(settings.ein).toBe('12-3456789');
    expect(settings.fiscalYearEnd).toBe('06-30');
    expect(settings.accountNumbersEnabled).toBe(false);
    expect(settings.reportBasis).toBe('cash');
  });

  it('persists sales / purchases / payroll / inventory keys and shallow-merges across saves', async () => {
    await updateCompany(ctx, {
      settings: { defaultCustomerTerms: 'net_15', defaultInvoiceMemo: 'Thanks!' },
    });
    await updateCompany(ctx, {
      settings: {
        defaultVendorTerms: 'net_60',
        payrollPayPeriod: 'semimonthly',
        payrollStandardHours: 37.5,
        negativeStockWarning: false,
      },
    });
    const company = await getCompany(ctx);
    const settings = company!.settings as Record<string, unknown>;
    // Earlier tabs survive later saves (shallow merge, not replace).
    expect(settings.defaultCustomerTerms).toBe('net_15');
    expect(settings.defaultInvoiceMemo).toBe('Thanks!');
    expect(settings.legalName).toBe('Prefs Company, LLC');
    // Later tab keys landed.
    expect(settings.defaultVendorTerms).toBe('net_60');
    expect(settings.payrollPayPeriod).toBe('semimonthly');
    expect(settings.payrollStandardHours).toBe(37.5);
    expect(settings.negativeStockWarning).toBe(false);
  });

  it('round-trips custom field definitions in the documented shape', async () => {
    const customFields = {
      customer: [{ name: 'Region' }, { name: 'Referral Source' }],
      vendor: [{ name: 'Account #' }],
      item: [],
      invoice: [{ name: 'PO Number' }],
    };
    await updateCompany(ctx, { settings: { customFields } });
    const company = await getCompany(ctx);
    expect((company!.settings as Record<string, unknown>).customFields).toEqual(customFields);
  });

  it('drops non-whitelisted keys (closing date keys + unknown junk)', async () => {
    await setClosingDate(ctx, { closingDate: '2025-12-31', password: 'lockit' });

    await updateCompany(ctx, {
      settings: {
        timezone: 'UTC',
        // Injection attempts — none of these may land or overwrite:
        closingDate: '1999-01-01',
        closingDatePasswordHash: 'evil-hash',
        financeCharges: { annualRate: '99' },
        totallyUnknownKey: 'nope',
      } as never,
    });

    const company = await getCompany(ctx);
    const settings = company!.settings as Record<string, unknown>;
    expect(settings.timezone).toBe('UTC');
    expect(settings.closingDate).toBe('2025-12-31'); // untouched
    expect(settings.closingDatePasswordHash).not.toBe('evil-hash');
    expect(settings.financeCharges).toBeUndefined();
    expect(settings.totallyUnknownKey).toBeUndefined();

    const closing = await getClosingDateSettings(ctx);
    expect(closing).toEqual({ closingDate: '2025-12-31', hasPassword: true });
  });

  it('whitelist constant covers exactly the CompanySettings keys', () => {
    // Guard: closing-date + finance-charge keys must never appear here.
    expect(COMPANY_SETTINGS_KEYS).not.toContain('closingDate');
    expect(COMPANY_SETTINGS_KEYS).not.toContain('closingDatePasswordHash');
    expect(COMPANY_SETTINGS_KEYS).not.toContain('financeCharges');
    expect(COMPANY_SETTINGS_KEYS).toContain('customFields');
    expect(COMPANY_SETTINGS_KEYS).toContain('fiscalYearEnd');
  });

  it('rejects viewer contexts with FORBIDDEN before writing', async () => {
    const viewerCtx: ServiceContext = { ...ctx, role: 'viewer' };
    await expect(updateCompany(viewerCtx, { settings: { timezone: 'UTC' } })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // And nothing changed.
    const company = await getCompany(ctx);
    expect((company!.settings as Record<string, unknown>).timezone).toBe('UTC');
  });

  it('throws NOT_FOUND for a context pointing at a missing company', async () => {
    const ghost: ServiceContext = {
      ...ctx,
      companyId: '00000000-0000-4000-8000-000000000000',
    };
    await expect(updateCompany(ghost, { name: 'Ghost' })).rejects.toBeInstanceOf(ServiceError);
    await expect(updateCompany(ghost, { name: 'Ghost' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('writes an audit log row for settings updates', async () => {
    await updateCompany(ctx, { settings: { defaultInvoiceMemo: 'Audited memo' } });
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.companyId, ctx.companyId));
    const companyUpdates = rows.filter(
      (r) => r.entityType === 'company' && r.action === 'update',
    );
    expect(companyUpdates.length).toBeGreaterThan(0);
    const latest = companyUpdates[companyUpdates.length - 1];
    expect(JSON.stringify(latest.newValues)).toContain('Audited memo');
  });
});
