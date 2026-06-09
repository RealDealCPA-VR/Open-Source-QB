/**
 * Unit tests for the minimal .xlsx writer — verifies the zip opens, contains
 * the required OPC parts, and the worksheet XML carries values with the right
 * cell types (inline strings vs numbers) and proper XML escaping.
 */
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { buildXlsx, columnRef } from './xlsx';

function readEntry(zip: AdmZip, name: string): string {
  const entry = zip.getEntry(name);
  expect(entry, `zip entry ${name}`).toBeTruthy();
  return entry!.getData().toString('utf-8');
}

describe('buildXlsx', () => {
  const buffer = buildXlsx({
    sheetName: 'P&L',
    title: 'Profit & Loss',
    subtitle: '1/1/2026 - 6/9/2026',
    columns: [
      { header: 'Account' },
      { header: 'Amount', numeric: true },
    ],
    rows: [
      ['Sales & Services <Co>', '1234.50'],
      ['Rent "HQ"', -200],
      ['No amount', null],
    ],
    totals: [['TOTAL', '1034.50']],
  });

  it('produces a zip that opens and contains all required parts', () => {
    const zip = new AdmZip(buffer);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('_rels/.rels');
    expect(names).toContain('xl/workbook.xml');
    expect(names).toContain('xl/_rels/workbook.xml.rels');
    expect(names).toContain('xl/worksheets/sheet1.xml');
  });

  it('declares the workbook and worksheet content types', () => {
    const zip = new AdmZip(buffer);
    const ct = readEntry(zip, '[Content_Types].xml');
    expect(ct).toContain('spreadsheetml.sheet.main+xml');
    expect(ct).toContain('spreadsheetml.worksheet+xml');
    const rels = readEntry(zip, 'xl/_rels/workbook.xml.rels');
    expect(rels).toContain('worksheets/sheet1.xml');
  });

  it('writes numeric-column money strings and numbers as number cells', () => {
    const zip = new AdmZip(buffer);
    const sheet = readEntry(zip, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<v>1234.5</v>');
    expect(sheet).toContain('<v>-200</v>');
    expect(sheet).toContain('<v>1034.5</v>');
  });

  it('writes strings as inline strings with XML escaping', () => {
    const zip = new AdmZip(buffer);
    const sheet = readEntry(zip, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('Sales &amp; Services &lt;Co&gt;');
    expect(sheet).toContain('Rent &quot;HQ&quot;');
    expect(sheet).toContain('t="inlineStr"');
    // Title + subtitle rows present.
    expect(sheet).toContain('Profit &amp; Loss');
    expect(sheet).toContain('1/1/2026 - 6/9/2026');
    // Header row present.
    expect(sheet).toContain('Account');
  });

  it('sanitizes illegal sheet names and escapes the rest', () => {
    const zip = new AdmZip(buffer);
    const wb = readEntry(zip, 'xl/workbook.xml');
    expect(wb).toContain('name="P&amp;L"');

    const bad = buildXlsx({
      sheetName: 'A/R [Aging]: Detail * Over 31 Characters Long',
      columns: [{ header: 'X' }],
      rows: [],
    });
    const wb2 = readEntry(new AdmZip(bad), 'xl/workbook.xml');
    const name = /name="([^"]+)"/.exec(wb2)?.[1] ?? '';
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[[\]:*?/\\]/);
  });

  it('skips empty cells but keeps row numbering contiguous', () => {
    const zip = new AdmZip(buffer);
    const sheet = readEntry(zip, 'xl/worksheets/sheet1.xml');
    // Title(1), subtitle(2), spacer skipped, header(4), 3 data rows(5-7), totals(8).
    expect(sheet).toContain('<row r="4">');
    expect(sheet).toContain('<row r="8">');
  });

  it('throws without columns', () => {
    expect(() => buildXlsx({ columns: [], rows: [] })).toThrow();
  });
});

describe('columnRef', () => {
  it('maps indices to spreadsheet letters', () => {
    expect(columnRef(0)).toBe('A');
    expect(columnRef(25)).toBe('Z');
    expect(columnRef(26)).toBe('AA');
    expect(columnRef(27)).toBe('AB');
    expect(columnRef(52)).toBe('BA');
  });
});
