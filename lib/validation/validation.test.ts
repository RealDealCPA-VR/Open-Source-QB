/**
 * Unit tests for lib/validation — the shared zod helpers and the per-domain
 * request-body schemas adopted by the API routes this wave.
 */
import { describe, it, expect } from 'vitest';
import {
  zMoney,
  zMoneyPositive,
  zDecimal,
  zDate,
  zUuid,
  zLines,
  zodErrorBody,
} from './helpers';
import { createAccountSchema, updateAccountSchema } from './accounts';
import { createCustomerSchema, updateCustomerSchema } from './customers';
import { createVendorSchema } from './vendors';
import { createJournalEntrySchema } from './journal';
import { receivePaymentSchema } from './payments';
import { createDepositSchema } from './deposits';
import { createTransferSchema } from './transfers';
import { createExpenseSchema } from './expenses';
import { createCreditMemoSchema } from './creditMemos';
import { createVendorCreditSchema } from './vendorCredits';
import { createEstimateSchema } from './estimates';
import { createSalesReceiptSchema } from './salesReceipts';
import {
  companySettingsSchema,
  updateCompanyBodySchema,
  setClosingDateSchema,
  customFieldsSettingSchema,
} from './company';
import { createInvoiceBodySchema, updateInvoiceSchema } from './invoices';
import { createBillSchema } from './bills';
import { createItemSchema, updateItemSchema } from './items';
import { runPaycheckSchema, createPayRunSchema } from './payroll';
import { createEmployeeSchema, updateEmployeeSchema } from './employees';
import { createPayrollItemSchema } from './payrollItems';
import { salesOrderActionSchema, createSalesOrderSchema } from './salesOrders';
import { purchaseOrderActionSchema } from './purchaseOrders';
import { createItemReceiptSchema, itemReceiptActionSchema } from './itemReceipts';
import { payBillsSchema } from './billPayments';
import { createRecurringTemplateSchema } from './recurring';
import { createTimeEntrySchema, updateTimeEntrySchema } from './timeEntries';
import { createJobSchema } from './jobs';
import { createClassSchema, createLocationSchema } from './dimensions';
import { createBudgetSchema, setBudgetLineSchema } from './budgets';
import { createAssetSchema, fixedAssetActionSchema } from './fixedAssets';
import { logMilesSchema } from './mileage';
import { z } from 'zod';

const UUID = '7b9d8c3e-5f2a-4d1b-9c8e-123456789abc';
const UUID2 = '1a2b3c4d-5e6f-4a1b-8c9d-abcdefabcdef';

describe('shared field helpers', () => {
  it('zMoney accepts 2dp strings and numbers, rejects >2dp and garbage', () => {
    expect(zMoney.safeParse('1500.00').success).toBe(true);
    expect(zMoney.safeParse('-25.5').success).toBe(true);
    expect(zMoney.safeParse(99).success).toBe(true);
    expect(zMoney.safeParse(10.25).success).toBe(true);
    expect(zMoney.safeParse('10.505').success).toBe(false);
    expect(zMoney.safeParse('abc').success).toBe(false);
    expect(zMoney.safeParse('$10').success).toBe(false);
    expect(zMoney.safeParse(null).success).toBe(false);
  });

  it('zMoneyPositive rejects zero and negatives', () => {
    expect(zMoneyPositive.safeParse('0.01').success).toBe(true);
    expect(zMoneyPositive.safeParse('0').success).toBe(false);
    expect(zMoneyPositive.safeParse('-5').success).toBe(false);
  });

  it('zDecimal allows arbitrary precision (fx rates, quantities)', () => {
    expect(zDecimal.safeParse('1.085634').success).toBe(true);
    expect(zDecimal.safeParse(0.333333).success).toBe(true);
    expect(zDecimal.safeParse('1.2.3').success).toBe(false);
  });

  it('zDate transforms ISO strings to Date and rejects junk', () => {
    const ok = zDate.safeParse('2026-06-09');
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data).toBeInstanceOf(Date);
      expect(ok.data.toISOString().startsWith('2026-06-09')).toBe(true);
    }
    expect(zDate.safeParse('not-a-date').success).toBe(false);
    expect(zDate.safeParse(20260609).success).toBe(false);
    expect(zDate.safeParse(undefined).success).toBe(false);
  });

  it('zUuid and zLines enforce shape', () => {
    expect(zUuid.safeParse(UUID).success).toBe(true);
    expect(zUuid.safeParse('not-a-uuid').success).toBe(false);
    const lines = zLines(z.object({ a: z.string() }));
    expect(lines.safeParse([]).success).toBe(false);
    expect(lines.safeParse([{ a: 'x' }]).success).toBe(true);
  });

  it('zodErrorBody flattens field errors and keeps dotted line paths', () => {
    const result = createJournalEntrySchema.safeParse({
      description: '',
      lines: [{ accountId: 'bad', debit: 'xx' }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const body = zodErrorBody(result.error);
    expect(body.code).toBe('VALIDATION');
    expect(typeof body.error).toBe('string');
    expect(body.fields.date?.length).toBeGreaterThan(0);
    const paths = body.issues.map((i) => i.path);
    expect(paths).toContain('lines.0.accountId');
    expect(paths).toContain('lines.0.debit');
  });
});

describe('domain schemas mirror service inputs', () => {
  it('accounts: create requires code/name/type, defaults blank subtype', () => {
    const ok = createAccountSchema.safeParse({ code: '1000', name: 'Checking', type: 'asset' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.subtype).toBe('');
    expect(createAccountSchema.safeParse({ code: '1', name: '', type: 'asset' }).success).toBe(false);
    expect(createAccountSchema.safeParse({ code: '1', name: 'X', type: 'banana' }).success).toBe(false);
    // PATCH keeps absent keys absent (so the service preserves existing values).
    const patch = updateAccountSchema.safeParse({ name: 'Renamed' });
    expect(patch.success).toBe(true);
    if (patch.success) expect('parentId' in patch.data).toBe(false);
  });

  it('customers: empty email allowed, bad email rejected, partial update preserves key absence', () => {
    expect(createCustomerSchema.safeParse({ displayName: 'Acme', email: '' }).success).toBe(true);
    expect(createCustomerSchema.safeParse({ displayName: 'Acme', email: 'nope' }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ displayName: '  ' }).success).toBe(false);
    const patch = updateCustomerSchema.safeParse({ notes: null });
    expect(patch.success).toBe(true);
    if (patch.success) {
      expect(patch.data.notes).toBeNull();
      expect('displayName' in patch.data).toBe(false);
    }
  });

  it('vendors: displayName required, unknown keys stripped', () => {
    const ok = createVendorSchema.safeParse({ displayName: 'Supplier', evil: 'x' });
    expect(ok.success).toBe(true);
    if (ok.success) expect('evil' in ok.data).toBe(false);
    expect(createVendorSchema.safeParse({}).success).toBe(false);
  });

  it('payments: full happy path coerces date, applications may be empty', () => {
    const ok = receivePaymentSchema.safeParse({
      customerId: UUID,
      date: '2026-01-15',
      method: 'check',
      amount: '1500.00',
      applications: [],
      exchangeRate: '1.085634',
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.date).toBeInstanceOf(Date);
    expect(
      receivePaymentSchema.safeParse({
        customerId: UUID,
        date: '2026-01-15',
        method: 'iou',
        amount: '10',
        applications: [],
      }).success,
    ).toBe(false);
  });

  it('deposits: requires at least one source of funds', () => {
    const base = { depositAccountId: UUID, date: '2026-01-15' };
    expect(createDepositSchema.safeParse(base).success).toBe(false);
    expect(createDepositSchema.safeParse({ ...base, paymentIds: [UUID2] }).success).toBe(true);
    expect(
      createDepositSchema.safeParse({
        ...base,
        extraLines: [{ accountId: UUID2, amount: '100.00' }],
      }).success,
    ).toBe(true);
  });

  it('transfers: rejects same from/to account and non-positive amounts', () => {
    const ok = createTransferSchema.safeParse({
      date: '2026-01-15',
      fromAccountId: UUID,
      toAccountId: UUID2,
      amount: '250.00',
    });
    expect(ok.success).toBe(true);
    expect(
      createTransferSchema.safeParse({
        date: '2026-01-15',
        fromAccountId: UUID,
        toAccountId: UUID,
        amount: '250.00',
      }).success,
    ).toBe(false);
    expect(
      createTransferSchema.safeParse({
        date: '2026-01-15',
        fromAccountId: UUID,
        toAccountId: UUID2,
        amount: '0',
      }).success,
    ).toBe(false);
  });

  it('expenses: requires payee (vendorId or payeeName) and at least one line', () => {
    const line = { accountId: UUID2, amount: '45.00' };
    expect(
      createExpenseSchema.safeParse({
        date: '2026-01-15',
        method: 'check',
        paymentAccountId: UUID,
        payeeName: 'Office Depot',
        lines: [line],
      }).success,
    ).toBe(true);
    expect(
      createExpenseSchema.safeParse({
        date: '2026-01-15',
        method: 'check',
        paymentAccountId: UUID,
        lines: [line],
      }).success,
    ).toBe(false);
    expect(
      createExpenseSchema.safeParse({
        date: '2026-01-15',
        method: 'check',
        paymentAccountId: UUID,
        payeeName: 'X',
        lines: [],
      }).success,
    ).toBe(false);
  });

  it('credit memos / vendor credits / estimates / sales receipts: line grids validated', () => {
    expect(
      createCreditMemoSchema.safeParse({
        customerId: UUID,
        date: '2026-01-15',
        lines: [{ quantity: 1, rate: '10.00', restock: false }],
      }).success,
    ).toBe(true);
    expect(
      createVendorCreditSchema.safeParse({
        vendorId: UUID,
        date: '2026-01-15',
        lines: [{ accountId: UUID2, amount: '-5' }],
      }).success,
    ).toBe(false); // amount must be positive
    expect(
      createEstimateSchema.safeParse({
        customerId: UUID,
        date: '2026-01-15',
        expirationDate: '2026-02-15',
        lines: [{ quantity: '2.5', rate: '99.99' }],
      }).success,
    ).toBe(true);
    const sr = createSalesReceiptSchema.safeParse({
      date: '2026-01-15',
      lines: [{ quantity: 1, rate: '10' }],
    });
    expect(sr.success).toBe(true);
    if (sr.success) expect(sr.data.lines[0].taxable).toBe(true); // default
  });
});

describe('second-wave domain schemas', () => {
  it('invoices: empty lines allowed only with a non-empty billables selection', () => {
    const base = { customerId: UUID, date: '2026-01-15' };
    expect(createInvoiceBodySchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(
      createInvoiceBodySchema.safeParse({
        ...base,
        lines: [],
        billables: { timeEntryIds: [UUID2], markupPercent: 10 },
      }).success,
    ).toBe(true);
    // Empty selection does not count as a source of lines.
    expect(
      createInvoiceBodySchema.safeParse({ ...base, lines: [], billables: { timeEntryIds: [] } })
        .success,
    ).toBe(false);
    expect(
      createInvoiceBodySchema.safeParse({
        ...base,
        status: 'bogus',
        lines: [{ quantity: 1, rate: '10' }],
      }).success,
    ).toBe(false);
    // PUT schema: full replace, lines required, absent customFields key stays absent.
    const upd = updateInvoiceSchema.safeParse({ ...base, lines: [{ quantity: 1, rate: 5 }] });
    expect(upd.success).toBe(true);
    if (upd.success) expect('customFields' in upd.data).toBe(false);
    expect(updateInvoiceSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
  });

  it('bills: vendorId/date/lines required, line money fields permissive (nullish)', () => {
    expect(
      createBillSchema.safeParse({
        vendorId: UUID,
        date: '2026-01-15',
        lines: [{ accountId: UUID2, amount: '120.50' }],
      }).success,
    ).toBe(true);
    expect(
      createBillSchema.safeParse({
        vendorId: UUID,
        date: '2026-01-15',
        lines: [{ itemId: UUID2, quantity: 3, unitCost: '9.99' }],
      }).success,
    ).toBe(true);
    expect(createBillSchema.safeParse({ vendorId: UUID, date: '2026-01-15', lines: [] }).success).toBe(false);
    expect(createBillSchema.safeParse({ date: '2026-01-15', lines: [{ amount: '1' }] }).success).toBe(false);
  });

  it('items: type enum enforced, reorderPoint allows "" to clear, patch preserves key absence', () => {
    expect(createItemSchema.safeParse({ name: 'Widget' }).success).toBe(true);
    expect(createItemSchema.safeParse({ name: 'Widget', type: 'banana' }).success).toBe(false);
    expect(createItemSchema.safeParse({ name: '  ' }).success).toBe(false);
    const patch = updateItemSchema.safeParse({ reorderPoint: '' });
    expect(patch.success).toBe(true);
    if (patch.success) {
      expect('reorderPoint' in patch.data).toBe(true);
      expect('name' in patch.data).toBe(false);
    }
  });

  it('payroll: taxes [] vs absent preserved; pay runs need a non-empty employees array', () => {
    const explicit = runPaycheckSchema.safeParse({
      employeeId: UUID,
      payDate: '2026-01-15',
      grossPay: '2000.00',
      taxes: [],
    });
    expect(explicit.success).toBe(true);
    if (explicit.success) expect(explicit.data.taxes).toEqual([]);
    const auto = runPaycheckSchema.safeParse({ employeeId: UUID, payDate: '2026-01-15', grossPay: 2000 });
    expect(auto.success).toBe(true);
    if (auto.success) expect('taxes' in auto.data).toBe(false);
    expect(
      runPaycheckSchema.safeParse({ employeeId: UUID, payDate: '2026-01-15', periodsPerYear: 0 }).success,
    ).toBe(false);
    expect(createPayRunSchema.safeParse({ payDate: '2026-01-15', employees: [] }).success).toBe(false);
    expect(
      createPayRunSchema.safeParse({
        payDate: '2026-01-15',
        employees: [{ employeeId: UUID, hours: 80, timeEntryIds: [UUID2] }],
      }).success,
    ).toBe(true);
  });

  it('employees + payroll items: enums enforced, updates keep absent keys absent', () => {
    expect(
      createEmployeeSchema.safeParse({ firstName: 'Pat', lastName: 'Lee', payType: 'hourly', payRate: '25' })
        .success,
    ).toBe(true);
    expect(
      createEmployeeSchema.safeParse({ firstName: 'Pat', lastName: 'Lee', payType: 'weekly', payRate: '25' })
        .success,
    ).toBe(false);
    const patch = updateEmployeeSchema.safeParse({ ssn: '123-45-6789', w4: { filingStatus: 'married' } });
    expect(patch.success).toBe(true);
    if (patch.success) expect('payRate' in patch.data).toBe(false);
    expect(createPayrollItemSchema.safeParse({ name: '401k', kind: 'deduction', pretax: true }).success).toBe(true);
    expect(createPayrollItemSchema.safeParse({ name: 'X', kind: 'salary' }).success).toBe(false);
  });

  it('sales/purchase order actions: discriminated unions on action', () => {
    expect(
      salesOrderActionSchema.safeParse({ action: 'convert', lines: [{ lineId: UUID, quantity: 2 }] }).success,
    ).toBe(true);
    expect(salesOrderActionSchema.safeParse({ action: 'convert', lines: [] }).success).toBe(false);
    expect(salesOrderActionSchema.safeParse({ action: 'status', status: 'closed' }).success).toBe(true);
    expect(salesOrderActionSchema.safeParse({ action: 'explode' }).success).toBe(false);
    expect(
      createSalesOrderSchema.safeParse({
        customerId: UUID,
        date: '2026-01-15',
        lines: [{ quantity: 1, rate: '10' }],
      }).success,
    ).toBe(true);
    expect(purchaseOrderActionSchema.safeParse({ action: 'void' }).success).toBe(true);
    expect(
      purchaseOrderActionSchema.safeParse({ action: 'convert', billNumber: 'B-100', date: '2026-02-01' })
        .success,
    ).toBe(true);
    expect(purchaseOrderActionSchema.safeParse({ action: 'convert', lines: [{ lineId: 'x', quantity: 1 }] }).success).toBe(false);
  });

  it('item receipts: lines need itemId/quantity/unitCost; convert/void actions parse', () => {
    expect(
      createItemReceiptSchema.safeParse({
        vendorId: UUID,
        date: '2026-01-15',
        purchaseOrderId: UUID2,
        lines: [{ itemId: UUID2, quantity: 5, unitCost: '2.50' }],
      }).success,
    ).toBe(true);
    expect(
      createItemReceiptSchema.safeParse({
        vendorId: UUID,
        date: '2026-01-15',
        lines: [{ quantity: 5, unitCost: '2.50' }],
      }).success,
    ).toBe(false);
    expect(itemReceiptActionSchema.safeParse({ action: 'void' }).success).toBe(true);
    expect(itemReceiptActionSchema.safeParse({ action: 'convert', dueDate: '2026-03-01' }).success).toBe(true);
  });

  it('bill payments: method enum + non-empty applications', () => {
    expect(
      payBillsSchema.safeParse({
        vendorId: UUID,
        date: '2026-01-15',
        method: 'check',
        paymentAccountId: UUID2,
        applications: [{ billId: UUID, amountApplied: '100.00', discountTaken: '2.00' }],
      }).success,
    ).toBe(true);
    expect(
      payBillsSchema.safeParse({
        vendorId: UUID,
        date: '2026-01-15',
        method: 'iou',
        paymentAccountId: UUID2,
        applications: [{ billId: UUID, amountApplied: '100.00' }],
      }).success,
    ).toBe(false);
    expect(
      payBillsSchema.safeParse({
        vendorId: UUID,
        date: '2026-01-15',
        method: 'cash',
        paymentAccountId: UUID2,
        applications: [],
      }).success,
    ).toBe(false);
  });

  it('recurring: docType/frequency enums, template object required', () => {
    expect(
      createRecurringTemplateSchema.safeParse({
        name: 'Monthly rent',
        docType: 'bill',
        frequency: 'monthly',
        nextRunDate: '2026-07-01',
        template: { vendorId: UUID, lines: [] },
      }).success,
    ).toBe(true);
    expect(
      createRecurringTemplateSchema.safeParse({
        name: 'X',
        docType: 'paycheck',
        frequency: 'monthly',
        template: {},
      }).success,
    ).toBe(false);
    expect(
      createRecurringTemplateSchema.safeParse({ name: 'X', docType: 'bill', frequency: 'monthly' }).success,
    ).toBe(false);
  });

  it('time entries / jobs / classes / locations: required fields enforced', () => {
    expect(createTimeEntrySchema.safeParse({ date: '2026-01-15', hours: '7.5' }).success).toBe(true);
    expect(createTimeEntrySchema.safeParse({ date: '2026-01-15' }).success).toBe(false);
    const patch = updateTimeEntrySchema.safeParse({ hours: 8 });
    expect(patch.success).toBe(true);
    if (patch.success) expect('billable' in patch.data).toBe(false);
    expect(createJobSchema.safeParse({ name: 'Kitchen remodel', customerId: UUID }).success).toBe(true);
    expect(createJobSchema.safeParse({ customerId: UUID }).success).toBe(false);
    expect(createClassSchema.safeParse({ name: 'East', parentId: UUID }).success).toBe(true);
    expect(createClassSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createLocationSchema.safeParse({ name: 'Warehouse' }).success).toBe(true);
    expect(createLocationSchema.safeParse({}).success).toBe(false);
  });

  it('budgets / fixed assets / mileage: coercions and required fields', () => {
    const budget = createBudgetSchema.safeParse({ name: 'FY26', fiscalYear: '2026' });
    expect(budget.success).toBe(true);
    if (budget.success) expect(budget.data.fiscalYear).toBe(2026);
    const line = setBudgetLineSchema.safeParse({ accountId: UUID, month: '3', amount: 1500 });
    expect(line.success).toBe(true);
    if (line.success) {
      expect(line.data.month).toBe(3);
      expect(line.data.amount).toBe('1500'); // service wants a string
    }
    expect(
      createAssetSchema.safeParse({
        name: 'Truck',
        cost: '35000.00',
        usefulLifeMonths: 60,
        placedInService: '2026-01-01',
      }).success,
    ).toBe(true);
    expect(
      createAssetSchema.safeParse({ name: 'Truck', cost: '35000.00', usefulLifeMonths: 0, placedInService: '2026-01-01' }).success,
    ).toBe(false);
    expect(fixedAssetActionSchema.safeParse({ action: 'depreciate', date: '2026-01-31' }).success).toBe(true);
    expect(fixedAssetActionSchema.safeParse({ action: 'sell' }).success).toBe(false);
    expect(logMilesSchema.safeParse({ miles: 42.5 }).success).toBe(true);
    expect(logMilesSchema.safeParse({ miles: 'a lot' }).success).toBe(false);
  });
});

describe('company preferences schemas', () => {
  it('accepts a full preferences payload and strips unknown keys', () => {
    const parsed = companySettingsSchema.safeParse({
      legalName: 'Acme LLC',
      ein: '12-3456789',
      fiscalYearEnd: '12-31',
      currency: 'USD',
      accountNumbersEnabled: true,
      reportBasis: 'cash',
      defaultCustomerTerms: 'net_15',
      defaultVendorTerms: 'net_60',
      defaultExpenseAccountId: null,
      payrollPayPeriod: 'biweekly',
      payrollStandardHours: 40,
      negativeStockWarning: false,
      closingDatePasswordHash: 'evil',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect('closingDatePasswordHash' in parsed.data).toBe(false);
  });

  it('rejects bad fiscalYearEnd / ein / reportBasis / hours', () => {
    expect(companySettingsSchema.safeParse({ fiscalYearEnd: '13-45' }).success).toBe(false);
    expect(companySettingsSchema.safeParse({ ein: 'banana' }).success).toBe(false);
    expect(companySettingsSchema.safeParse({ reportBasis: 'maybe' }).success).toBe(false);
    expect(companySettingsSchema.safeParse({ payrollStandardHours: -3 }).success).toBe(false);
    expect(companySettingsSchema.safeParse({ payrollStandardHours: 500 }).success).toBe(false);
  });

  it('updateCompanyBodySchema supports both the settings object and legacy flat keys', () => {
    const modern = updateCompanyBodySchema.safeParse({
      name: 'New Name',
      settings: { timezone: 'UTC', defaultInvoiceMemo: 'Thanks!' },
    });
    expect(modern.success).toBe(true);
    const legacy = updateCompanyBodySchema.safeParse({
      currency: 'EUR',
      fiscalYearEnd: '06-30',
      industry: 'consulting',
    });
    expect(legacy.success).toBe(true);
    expect(updateCompanyBodySchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('customFields capped at 7 per entity, names required', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ name: `F${i}` }));
    expect(customFieldsSettingSchema.safeParse({ customer: seven, vendor: [], item: [], invoice: [] }).success).toBe(true);
    expect(
      customFieldsSettingSchema.safeParse({
        customer: [...seven, { name: 'one too many' }],
        vendor: [],
        item: [],
        invoice: [],
      }).success,
    ).toBe(false);
    expect(
      customFieldsSettingSchema.safeParse({ customer: [{ name: '  ' }], vendor: [], item: [], invoice: [] }).success,
    ).toBe(false);
  });

  it('setClosingDateSchema: YYYY-MM-DD or null only', () => {
    expect(setClosingDateSchema.safeParse({ closingDate: '2025-12-31' }).success).toBe(true);
    expect(setClosingDateSchema.safeParse({ closingDate: null, password: null }).success).toBe(true);
    expect(setClosingDateSchema.safeParse({ closingDate: '12/31/2025' }).success).toBe(false);
    expect(setClosingDateSchema.safeParse({}).success).toBe(false);
  });
});
