/**
 * PDF renderers for IRS payroll tax forms.
 *
 * renderW2Pdf   — Employee W-2 Wage and Tax Statement (simplified layout)
 * render941Pdf  — Employer's Quarterly Federal Tax Return (Form 941, simplified)
 *
 * Uses pdf-lib with standard Helvetica fonts (no external font files required).
 * Returns a Uint8Array of the PDF bytes.
 *
 * DISCLAIMER: These are simplified approximations for record-keeping purposes
 * and are NOT substitutes for the official IRS printed forms. Always file using
 * forms published by the IRS at irs.gov.
 */

import { PDFDocument, StandardFonts, rgb, PageSizes } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Format a decimal string / number as USD currency. */
function fmt(value: string | number): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    isNaN(n) ? 0 : n,
  );
}

const PAGE_W = PageSizes.Letter[0]; // 612 pt
const PAGE_H = PageSizes.Letter[1]; // 792 pt

const ML = 48;
const MR = PAGE_W - 48;

const C_NAVY  = rgb(0.09, 0.13, 0.27);
const C_GRAY  = rgb(0.45, 0.45, 0.50);
const C_LIGHT = rgb(0.88, 0.90, 0.93);
const C_BLACK = rgb(0, 0, 0);
const C_ACCENT = rgb(0.20, 0.47, 0.96);

// ---------------------------------------------------------------------------
// W-2 types + renderer
// ---------------------------------------------------------------------------

export interface W2PdfInput {
  company: { name: string; address?: string | null };
  employee: { firstName: string; lastName: string; ssn?: string | null };
  year: number;
  /** Box 1: Wages, tips, other compensation. */
  wages: string | number;
  /** Box 2: Federal income tax withheld. */
  federalWithheld: string | number;
  /** Box 4: Social security tax withheld. */
  socialSecurity: string | number;
  /** Box 6: Medicare tax withheld. */
  medicare: string | number;
}

/**
 * Render a simplified W-2 statement as a PDF.
 * Returns the PDF bytes as Uint8Array.
 */
export async function renderW2Pdf(input: W2PdfInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  // Convenience helpers
  function hRule(y: number, x1 = ML, x2 = MR, thickness = 0.5, color = C_LIGHT) {
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  }

  function txt(
    s: string,
    x: number,
    y: number,
    opts: { size?: number; font?: typeof regular; color?: typeof C_BLACK; rightAlign?: boolean } = {},
  ) {
    const { size = 10, font = regular, color = C_BLACK, rightAlign = false } = opts;
    const drawX = rightAlign ? x - font.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: drawX, y, font, size, color });
  }

  let cursor = PAGE_H - 48;

  // ----- Header -----
  txt('W-2 Wage and Tax Statement', ML, cursor, { font: bold, size: 18, color: C_NAVY });
  cursor -= 20;
  txt(`Tax Year ${input.year}`, ML, cursor, { size: 11, color: C_GRAY });

  // IRS disclaimer badge (right)
  const disc = 'INFORMATIONAL COPY — NOT OFFICIAL IRS FORM';
  txt(disc, MR, PAGE_H - 48, { size: 7, color: C_GRAY, rightAlign: true });

  cursor -= 10;
  hRule(cursor, ML, MR, 1.5, C_ACCENT);
  cursor -= 20;

  // ----- Employer section -----
  txt('a  Employer name, address, and ZIP code', ML, cursor, { size: 8, color: C_GRAY });
  cursor -= 14;
  txt(input.company.name, ML, cursor, { font: bold, size: 11, color: C_BLACK });
  cursor -= 14;
  if (input.company.address) {
    txt(input.company.address, ML, cursor, { size: 10, color: C_BLACK });
    cursor -= 14;
  }

  cursor -= 8;
  hRule(cursor);
  cursor -= 16;

  // ----- Employee section -----
  txt('e  Employee name', ML, cursor, { size: 8, color: C_GRAY });
  const empName = `${input.employee.firstName} ${input.employee.lastName}`;
  cursor -= 14;
  txt(empName, ML, cursor, { font: bold, size: 11, color: C_BLACK });

  // SSN (right side)
  if (input.employee.ssn) {
    const maskedSsn = input.employee.ssn.replace(/\d(?=\d{4})/g, '*');
    txt('d  Employee SSN', MR - 180, cursor + 14, { size: 8, color: C_GRAY });
    txt(maskedSsn, MR - 180, cursor, { size: 11, color: C_BLACK });
  }

  cursor -= 24;
  hRule(cursor);
  cursor -= 20;

  // ----- Box layout -----
  // Draw a box-style layout: label (small gray) + value (bold black)
  function drawBox(
    label: string,
    boxLabel: string,
    value: string | number,
    x: number,
    y: number,
    w: number,
  ) {
    // Border rectangle
    page.drawRectangle({
      x,
      y: y - 34,
      width: w,
      height: 42,
      borderColor: C_LIGHT,
      borderWidth: 0.75,
    });
    // Box number
    txt(boxLabel, x + 4, y + 4, { size: 7, color: C_GRAY });
    // Label
    txt(label, x + 4, y - 6, { size: 8, color: C_GRAY });
    // Value
    txt(fmt(value), x + w - 4, y - 20, { font: bold, size: 11, color: C_BLACK, rightAlign: true });
  }

  const COL1 = ML;
  const COL2 = ML + (MR - ML) / 2 + 4;
  const BOXW = (MR - ML) / 2 - 4;

  drawBox('Wages, tips, other compensation', '1', input.wages,          COL1, cursor, BOXW);
  drawBox('Federal income tax withheld',      '2', input.federalWithheld, COL2, cursor, BOXW);
  cursor -= 50;

  drawBox('Social security tax withheld', '4', input.socialSecurity, COL1, cursor, BOXW);
  drawBox('Medicare tax withheld',         '6', input.medicare,       COL2, cursor, BOXW);
  cursor -= 50;

  // ----- Totals summary -----
  cursor -= 8;
  hRule(cursor);
  cursor -= 18;

  txt('Summary', ML, cursor, { font: bold, size: 10, color: C_NAVY });
  cursor -= 16;

  const totalWithheld =
    parseFloat(String(input.federalWithheld)) +
    parseFloat(String(input.socialSecurity)) +
    parseFloat(String(input.medicare));

  const rows: Array<[string, string | number]> = [
    ['Box 1 — Wages, tips, other compensation',   input.wages],
    ['Box 2 — Federal income tax withheld',        input.federalWithheld],
    ['Box 4 — Social security tax withheld',       input.socialSecurity],
    ['Box 6 — Medicare tax withheld',              input.medicare],
    ['Total taxes withheld (Boxes 2 + 4 + 6)',     totalWithheld],
  ];

  for (const [label, value] of rows) {
    txt(label, ML, cursor, { size: 10, color: C_GRAY });
    txt(fmt(value), MR, cursor, { font: bold, size: 10, color: C_BLACK, rightAlign: true });
    cursor -= 16;
  }

  // ----- Footer -----
  cursor -= 16;
  hRule(cursor, ML, MR, 0.5, C_LIGHT);
  cursor -= 14;
  txt(
    `${input.company.name}  —  W-2 for ${empName}  —  Tax Year ${input.year}`,
    PAGE_W / 2,
    cursor,
    { size: 7, color: C_GRAY, rightAlign: false },
  );
  // center the footer
  const footerStr = `${input.company.name}  —  W-2 for ${empName}  —  Tax Year ${input.year}`;
  const ftW = regular.widthOfTextAtSize(footerStr, 7);
  page.drawText(footerStr, { x: (PAGE_W - ftW) / 2, y: cursor, font: regular, size: 7, color: C_GRAY });

  return pdfDoc.save();
}

// ---------------------------------------------------------------------------
// Form 941 types + renderer
// ---------------------------------------------------------------------------

export interface Form941Totals {
  /** Total wages, tips, and other compensation paid this quarter. */
  wages: string | number;
  /** Total federal income tax withheld from wages. */
  federalWithheld: string | number;
  /** Total Social Security tax (employee share). */
  socialSecurity: string | number;
  /** Total Medicare tax (employee share). */
  medicare: string | number;
}

export interface Form941PdfInput {
  company: { name: string; address?: string | null };
  /** Calendar quarter: 1, 2, 3, or 4. */
  quarter: 1 | 2 | 3 | 4;
  year: number;
  totals: Form941Totals;
}

const QUARTER_LABELS: Record<number, string> = {
  1: 'January, February, March',
  2: 'April, May, June',
  3: 'July, August, September',
  4: 'October, November, December',
};

/**
 * Render a simplified Form 941 (Employer's Quarterly Federal Tax Return) as a PDF.
 * Returns the PDF bytes as Uint8Array.
 */
export async function render941Pdf(input: Form941PdfInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  function hRule(y: number, x1 = ML, x2 = MR, thickness = 0.5, color = C_LIGHT) {
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  }

  function txt(
    s: string,
    x: number,
    y: number,
    opts: { size?: number; font?: typeof regular; color?: typeof C_BLACK; rightAlign?: boolean } = {},
  ) {
    const { size = 10, font = regular, color = C_BLACK, rightAlign = false } = opts;
    const drawX = rightAlign ? x - font.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: drawX, y, font, size, color });
  }

  let cursor = PAGE_H - 48;

  // ----- Header -----
  txt('Form 941', ML, cursor, { font: bold, size: 20, color: C_NAVY });
  cursor -= 18;
  txt("Employer's Quarterly Federal Tax Return", ML, cursor, { font: bold, size: 12, color: C_NAVY });
  cursor -= 14;
  txt(
    `Quarter ${input.quarter} (${QUARTER_LABELS[input.quarter]})  —  Year ${input.year}`,
    ML,
    cursor,
    { size: 10, color: C_GRAY },
  );

  const disc = 'INFORMATIONAL COPY — NOT OFFICIAL IRS FORM';
  txt(disc, MR, PAGE_H - 48, { size: 7, color: C_GRAY, rightAlign: true });

  cursor -= 10;
  hRule(cursor, ML, MR, 1.5, C_ACCENT);
  cursor -= 20;

  // ----- Employer info -----
  txt('Name', ML, cursor, { size: 8, color: C_GRAY });
  cursor -= 14;
  txt(input.company.name, ML, cursor, { font: bold, size: 11, color: C_BLACK });
  if (input.company.address) {
    cursor -= 14;
    txt(input.company.address, ML, cursor, { size: 10, color: C_BLACK });
  }

  cursor -= 24;
  hRule(cursor);
  cursor -= 20;

  // ----- Line items (Part 1 of 941) -----
  txt('Part 1: Tell us about your return for this quarter', ML, cursor, {
    font: bold, size: 10, color: C_NAVY,
  });
  cursor -= 20;

  // Helper: draw a numbered line
  function drawLine941(lineNum: string, description: string, value: string | number) {
    txt(`${lineNum}.`, ML, cursor, { size: 10, color: C_GRAY });
    txt(description, ML + 24, cursor, { size: 10, color: C_BLACK });
    txt(fmt(value), MR, cursor, { font: bold, size: 10, color: C_BLACK, rightAlign: true });
    cursor -= 6;
    hRule(cursor, ML + 24, MR, 0.3, C_LIGHT);
    cursor -= 14;
  }

  const { wages, federalWithheld, socialSecurity, medicare } = input.totals;

  const totalSSAndMedicare =
    parseFloat(String(socialSecurity)) + parseFloat(String(medicare));

  const totalTaxBeforeAdjustments =
    parseFloat(String(federalWithheld)) + totalSSAndMedicare;

  drawLine941('1',  'Number of employees who received wages (N/A — see payroll records)', '');
  drawLine941('2',  'Wages, tips, and other compensation',                                wages);
  drawLine941('3',  'Federal income tax withheld from wages, tips, and other compensation', federalWithheld);
  drawLine941('5a', 'Taxable social security wages (employee share)',                      socialSecurity);
  drawLine941('5c', 'Taxable Medicare wages & tips (employee share)',                      medicare);
  drawLine941('5d', 'Total social security and Medicare taxes (lines 5a + 5c)',             totalSSAndMedicare);

  cursor -= 4;
  hRule(cursor, ML, MR, 1, C_NAVY);
  cursor -= 18;

  txt('6.  Total taxes before adjustments (line 3 + line 5d)', ML, cursor, {
    font: bold, size: 10, color: C_NAVY,
  });
  txt(fmt(totalTaxBeforeAdjustments), MR, cursor, {
    font: bold, size: 11, color: C_NAVY, rightAlign: true,
  });
  cursor -= 20;

  // Adjustments / deposits placeholder
  txt(
    '(Lines 7–15 — adjustments, deposits, and balance due — require manual completion.)',
    ML,
    cursor,
    { size: 8, color: C_GRAY },
  );
  cursor -= 30;

  // ----- Summary box -----
  hRule(cursor, ML, MR, 1, C_LIGHT);
  cursor -= 16;
  txt('Summary', ML, cursor, { font: bold, size: 10, color: C_NAVY });
  cursor -= 16;

  const summaryRows: Array<[string, string | number]> = [
    ['Wages, tips, other compensation (Line 2)',           wages],
    ['Federal income tax withheld (Line 3)',               federalWithheld],
    ['Social security tax withheld (Line 5a)',             socialSecurity],
    ['Medicare tax withheld (Line 5c)',                    medicare],
    ['Total social security + Medicare (Line 5d)',         totalSSAndMedicare],
    ['Total taxes before adjustments (Line 6)',            totalTaxBeforeAdjustments],
  ];

  for (const [label, value] of summaryRows) {
    txt(label, ML, cursor, { size: 10, color: C_GRAY });
    if (value !== '') {
      txt(fmt(value), MR, cursor, { font: bold, size: 10, color: C_BLACK, rightAlign: true });
    }
    cursor -= 16;
  }

  // ----- Footer -----
  cursor -= 10;
  hRule(cursor, ML, MR, 0.5, C_LIGHT);
  cursor -= 14;
  const footerStr = `${input.company.name}  —  Form 941 Q${input.quarter} ${input.year}`;
  const ftW = regular.widthOfTextAtSize(footerStr, 7);
  page.drawText(footerStr, { x: (PAGE_W - ftW) / 2, y: cursor, font: regular, size: 7, color: C_GRAY });

  return pdfDoc.save();
}
