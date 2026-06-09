/**
 * Unit tests for the generic report PDF renderer — valid PDF bytes, page
 * orientation, pagination of long reports, and resilience to exotic input.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildReportPdf } from './reportPdf';

const COLUMNS = [
  { header: 'Account' },
  { header: 'Debit', numeric: true },
  { header: 'Credit', numeric: true },
];

describe('buildReportPdf', () => {
  it('produces a loadable single-page portrait PDF with header metadata', async () => {
    const bytes = await buildReportPdf({
      title: 'Trial Balance',
      company: 'Test Co LLC',
      subtitle: 'As of 6/9/2026',
      columns: COLUMNS,
      rows: [
        ['1000 Cash', '500.00', ''],
        ['4000 Revenue', '', '500.00'],
      ],
      totals: [['TOTAL', '500.00', '500.00']],
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBe(612);
    expect(height).toBe(792);
  });

  it('renders landscape when requested', async () => {
    const bytes = await buildReportPdf({
      title: 'P&L by Month',
      columns: COLUMNS,
      rows: [['x', '1.00', '2.00']],
      landscape: true,
    });
    const doc = await PDFDocument.load(bytes);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBe(792);
    expect(height).toBe(612);
  });

  it('paginates long reports onto multiple pages', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => [
      `Account ${i}`,
      `${i}.00`,
      '',
    ]);
    const bytes = await buildReportPdf({
      title: 'General Ledger',
      columns: COLUMNS,
      rows,
      totals: [['TOTAL', '44850.00', '0.00']],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('survives non-WinAnsi characters and very long cell text', async () => {
    const bytes = await buildReportPdf({
      title: 'Funky 报表 Report',
      columns: [{ header: 'Memo' }, { header: 'Amt', numeric: true }],
      rows: [
        ['日本語テキスト with emoji 🚀 and a very long memo '.repeat(10), '12.00'],
        [null, undefined],
      ],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('rejects empty column sets', async () => {
    await expect(
      buildReportPdf({ title: 'X', columns: [], rows: [] }),
    ).rejects.toThrow();
  });
});
