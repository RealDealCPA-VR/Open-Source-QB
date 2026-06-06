/**
 * Smoke tests for PDF render functions.
 *
 * Each test just verifies that the render function returns a non-empty Uint8Array
 * with the PDF magic bytes (%PDF). No database or service layer is exercised.
 */
import { describe, it, expect } from 'vitest';
import { renderEstimatePdf } from './estimate';
import { renderPurchaseOrderPdf } from './purchaseOrder';
import { renderStatementPdf } from './statement';
import type { CustomerStatement } from '@/lib/services/statements';

// ---------------------------------------------------------------------------
// Estimate
// ---------------------------------------------------------------------------

describe('renderEstimatePdf', () => {
  it('returns a non-empty Uint8Array with PDF magic bytes', async () => {
    const bytes = await renderEstimatePdf({
      company: { name: 'Acme Corp' },
      customerName: 'Jane Smith',
      estimate: {
        number: 42,
        date: 'June 6, 2026',
        expirationDate: 'July 6, 2026',
        subtotal: '1000.00',
        taxAmount: '80.00',
        total: '1080.00',
        memo: 'Valid for 30 days.',
      },
      lines: [
        { description: 'Consulting services', quantity: 10, rate: '100.00', amount: '1000.00' },
      ],
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);
    // PDF files start with %PDF
    const header = String.fromCharCode(...bytes.slice(0, 4));
    expect(header).toBe('%PDF');
  });
});

// ---------------------------------------------------------------------------
// Purchase Order
// ---------------------------------------------------------------------------

describe('renderPurchaseOrderPdf', () => {
  it('returns a non-empty Uint8Array with PDF magic bytes', async () => {
    const bytes = await renderPurchaseOrderPdf({
      company: { name: 'Acme Corp' },
      vendorName: 'Office Supplies Inc.',
      po: {
        number: 101,
        date: 'June 6, 2026',
        expectedDate: 'June 20, 2026',
        total: '500.00',
        status: 'open',
        memo: 'Deliver to loading dock B.',
      },
      lines: [
        {
          description: 'Printer paper (case)',
          accountCode: '6300',
          quantity: 5,
          rate: '100.00',
          amount: '500.00',
        },
      ],
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);
    const header = String.fromCharCode(...bytes.slice(0, 4));
    expect(header).toBe('%PDF');
  });
});

// ---------------------------------------------------------------------------
// Statement
// ---------------------------------------------------------------------------

describe('renderStatementPdf', () => {
  it('returns a non-empty Uint8Array with PDF magic bytes', async () => {
    const statement: CustomerStatement = {
      customer: {
        id: 'cust-1',
        displayName: 'Jane Smith',
        companyName: 'Smith LLC',
        email: 'jane@smith.com',
      },
      from: '2026-01-01',
      to: '2026-06-06',
      openingBalance: '0.00',
      lines: [
        {
          date: '2026-03-15',
          type: 'invoice',
          ref: '1001',
          amount: '1500.00',
          runningBalance: '1500.00',
        },
        {
          date: '2026-04-01',
          type: 'payment',
          ref: 'PMT-001',
          amount: '750.00',
          runningBalance: '750.00',
        },
      ],
      closingBalance: '750.00',
    };

    const bytes = await renderStatementPdf(statement, 'Acme Corp');

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);
    const header = String.fromCharCode(...bytes.slice(0, 4));
    expect(header).toBe('%PDF');
  });
});
