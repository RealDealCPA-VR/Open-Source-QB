/**
 * PDF renderer for printable US personal-format checks.
 *
 * Uses pdf-lib with standard Helvetica fonts (no external files needed).
 *
 * Layout (US Letter, portrait) — standard personal-check proportions
 * in the upper portion of the page, leaving the lower portion for the
 * MICR area stub (decorative rules only — actual MICR encoding requires
 * a specialised font we do not ship):
 *
 *   - Company name (payer / drawer) — top-left
 *   - Check number — top-right
 *   - Date — right side, below check number
 *   - "Pay to the Order of" line with payee name
 *   - Numeric amount box — right side of payee line
 *   - Amount-in-words line with trailing fill rule
 *   - Memo line — bottom-left
 *   - Signature line — bottom-right
 *   - Decorative MICR-area rule near the bottom
 */

import { PDFDocument, StandardFonts, rgb, PageSizes } from 'pdf-lib';

// ---------------------------------------------------------------------------
// numberToWords — converts a decimal amount string/number to check-style words
// ---------------------------------------------------------------------------

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

/** Convert a non-negative integer < 1,000 to English words. */
function threeDigitsToWords(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    const remainder = n % 10;
    return TENS[Math.floor(n / 10)] + (remainder ? '-' + ONES[remainder] : '');
  }
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return ONES[hundreds] + ' Hundred' + (rest ? ' ' + threeDigitsToWords(rest) : '');
}

const MAGNITUDES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

/** Convert a non-negative integer to English words. Returns 'Zero' for 0. */
function integerToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return 'Zero';
  n = Math.floor(n);
  if (n === 0) return 'Zero';

  const parts: string[] = [];
  let magnitude = 0;

  while (n > 0) {
    const chunk = n % 1000;
    if (chunk !== 0) {
      const chunkWords = threeDigitsToWords(chunk);
      parts.unshift(
        magnitude > 0 ? chunkWords + ' ' + MAGNITUDES[magnitude] : chunkWords,
      );
    }
    n = Math.floor(n / 1000);
    magnitude++;
  }

  return parts.join(' ');
}

/**
 * Convert a decimal amount (string or number) to the check-style
 * "One Hundred Twenty-Three and 45/100" format.
 *
 * Exported so it can be tested and reused by the UI for live preview.
 */
export function numberToWords(amount: string | number): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!Number.isFinite(n) || n < 0) return 'Zero and 00/100';

  const dollars = Math.floor(n);
  const cents = Math.round((n - dollars) * 100);
  const centsStr = String(cents).padStart(2, '0');

  const dollarWords = integerToWords(dollars);
  return `${dollarWords} and ${centsStr}/100`;
}

// ---------------------------------------------------------------------------
// Check PDF data types
// ---------------------------------------------------------------------------

export interface CheckPdfData {
  /** Payer / company name — printed top-left as the drawer. */
  company: { name: string };
  /** Name of the payee (individual or vendor). */
  payee: string;
  /** Dollar amount as a decimal string, e.g. "1234.56". */
  amountNumeric: string;
  /** Pre-computed words; if omitted, derived from amountNumeric. */
  amountWords?: string;
  /** ISO date string YYYY-MM-DD or any human-readable date. */
  date: string;
  /** Optional memo / note line. */
  memo?: string | null;
  /** Optional check number — printed top-right. */
  checkNumber?: string | number | null;
}

// ---------------------------------------------------------------------------
// Layout constants (US Letter)
// ---------------------------------------------------------------------------

const PAGE_W = PageSizes.Letter[0]; // 612 pt
const PAGE_H = PageSizes.Letter[1]; // 792 pt

// The check body occupies the top ~3.5 inches (252 pt) of the page.
// A real personal check is ~2.75" tall in a continuous form; we give it
// generous breathing room on Letter paper.
const CHECK_TOP = PAGE_H - 48;      // 744 pt from bottom
const CHECK_BOTTOM = PAGE_H - 300;  // 492 pt from bottom

const ML = 48;                      // left margin
const MR = PAGE_W - 48;             // right margin

// Colors
const C_NAVY  = rgb(0.09, 0.13, 0.27);
const C_GRAY  = rgb(0.45, 0.45, 0.50);
const C_LIGHT = rgb(0.82, 0.86, 0.90);
const C_BLACK = rgb(0, 0, 0);

// ---------------------------------------------------------------------------
// renderCheckPdf
// ---------------------------------------------------------------------------

export async function renderCheckPdf(data: CheckPdfData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function hRule(y: number, x1 = ML, x2 = MR, thickness = 0.5, color = C_LIGHT) {
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  }

  function text(
    s: string,
    x: number,
    y: number,
    opts: { size?: number; font?: typeof regular; color?: typeof C_BLACK; rightAlign?: boolean } = {},
  ) {
    const { size = 10, font = regular, color = C_BLACK, rightAlign = false } = opts;
    const drawX = rightAlign ? x - font.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: drawX, y, font, size, color });
  }

  // -------------------------------------------------------------------------
  // Outer check border
  // -------------------------------------------------------------------------

  page.drawRectangle({
    x: ML - 4,
    y: CHECK_BOTTOM - 4,
    width: MR - ML + 8,
    height: CHECK_TOP - CHECK_BOTTOM + 8,
    borderColor: C_LIGHT,
    borderWidth: 1,
    color: rgb(1, 1, 1), // white fill
    opacity: 0,
  });

  // -------------------------------------------------------------------------
  // ROW 1 — Company name (top-left) + Check number (top-right)
  // -------------------------------------------------------------------------

  let cursor = CHECK_TOP - 2;

  text(data.company.name, ML, cursor, { font: bold, size: 13, color: C_NAVY });

  if (data.checkNumber != null && String(data.checkNumber).trim() !== '') {
    const checkNumStr = `Check #${data.checkNumber}`;
    text(checkNumStr, MR, cursor, { font: bold, size: 10, color: C_NAVY, rightAlign: true });
  }

  cursor -= 16;

  // Company subtitle label
  text('Payer', ML, cursor, { size: 8, color: C_GRAY });

  cursor -= 20;
  hRule(cursor, ML, MR, 0.75, C_LIGHT);
  cursor -= 18;

  // -------------------------------------------------------------------------
  // ROW 2 — Date (right-aligned)
  // -------------------------------------------------------------------------

  const DATE_LABEL_X = MR - 160;

  text('Date', DATE_LABEL_X, cursor, { size: 8, color: C_GRAY });

  const dateLineY = cursor;
  hRule(dateLineY - 14, DATE_LABEL_X + 28, MR, 0.75, C_NAVY);

  text(data.date, MR, dateLineY - 12, { size: 10, color: C_BLACK, rightAlign: true });

  cursor -= 38;

  // -------------------------------------------------------------------------
  // ROW 3 — "Pay to the Order of" + payee + amount box
  // -------------------------------------------------------------------------

  const AMOUNT_BOX_W = 110;
  const AMOUNT_BOX_X = MR - AMOUNT_BOX_W;
  const PAYEE_LINE_END = AMOUNT_BOX_X - 10;

  // Label
  text('Pay to the Order of', ML, cursor, { size: 8, color: C_GRAY });
  cursor -= 14;

  // Payee name
  const payeeY = cursor;
  text(data.payee, ML, payeeY, { font: bold, size: 12, color: C_BLACK });

  // Payee underline (fill up to the amount box)
  hRule(payeeY - 3, ML, PAYEE_LINE_END, 0.75, C_NAVY);

  // Amount box (border rectangle)
  const BOX_H = 22;
  page.drawRectangle({
    x: AMOUNT_BOX_X,
    y: payeeY - BOX_H + 12,
    width: AMOUNT_BOX_W,
    height: BOX_H,
    borderColor: C_NAVY,
    borderWidth: 1,
  });

  // Dollar sign inside box
  text('$', AMOUNT_BOX_X + 6, payeeY, { size: 11, color: C_NAVY });

  // Numeric amount right-aligned inside box
  const numFmt = parseFloat(data.amountNumeric);
  const numDisplay = isNaN(numFmt)
    ? data.amountNumeric
    : numFmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  text(numDisplay, MR - 6, payeeY, {
    font: bold,
    size: 11,
    color: C_BLACK,
    rightAlign: true,
  });

  cursor -= 34;

  // -------------------------------------------------------------------------
  // ROW 4 — Amount in words
  // -------------------------------------------------------------------------

  const words = data.amountWords ?? numberToWords(data.amountNumeric);

  text('Amount', ML, cursor, { size: 8, color: C_GRAY });
  cursor -= 14;

  const wordsY = cursor;
  text(words, ML, wordsY, { font: oblique, size: 10, color: C_BLACK });

  // Trailing fill rule after the words
  const wordsW = oblique.widthOfTextAtSize(words, 10);
  const fillStart = ML + wordsW + 6;
  if (fillStart < MR - 20) {
    hRule(wordsY - 2, fillStart, MR - 6, 0.5, C_GRAY);
  }

  // "DOLLARS" suffix right-aligned on the same baseline
  text('DOLLARS', MR, wordsY, { size: 8, color: C_GRAY, rightAlign: true });

  hRule(wordsY - 14, ML, MR, 0.75, C_NAVY);

  cursor -= 40;

  // -------------------------------------------------------------------------
  // ROW 5 — Memo (left) + Signature line (right)
  // -------------------------------------------------------------------------

  const SIG_LINE_X = ML + (MR - ML) * 0.55;

  // Memo
  text('Memo', ML, cursor, { size: 8, color: C_GRAY });
  hRule(cursor - 14, ML, SIG_LINE_X - 20, 0.75, C_NAVY);
  if (data.memo) {
    text(data.memo, ML, cursor - 12, { size: 9, color: C_BLACK });
  }

  // Signature
  text('Authorized Signature', SIG_LINE_X, cursor, { size: 8, color: C_GRAY });
  hRule(cursor - 14, SIG_LINE_X, MR, 0.75, C_NAVY);

  cursor -= 30;

  // -------------------------------------------------------------------------
  // MICR area (decorative — shows the routing/account number zone)
  // -------------------------------------------------------------------------

  const MICR_Y = CHECK_BOTTOM + 10;
  hRule(MICR_Y + 18, ML, MR, 0.5, C_LIGHT);
  hRule(MICR_Y, ML, MR, 0.5, C_LIGHT);

  text('⑆ ROUTING ⑆  ACCOUNT  ⑆  CHECK#', ML + 4, MICR_Y + 5, {
    size: 7,
    color: C_LIGHT,
  });

  // -------------------------------------------------------------------------
  // Footer stub — "NOT NEGOTIABLE / VOID IF NOT USED WITHIN 90 DAYS"
  // -------------------------------------------------------------------------

  const STUB_Y = CHECK_BOTTOM - 30;
  const disclaimer = 'VOID AFTER 90 DAYS  —  NOT NEGOTIABLE WITHOUT AUTHORIZED SIGNATURE';
  const dW = regular.widthOfTextAtSize(disclaimer, 7);
  page.drawText(disclaimer, {
    x: (PAGE_W - dW) / 2,
    y: STUB_Y,
    font: regular,
    size: 7,
    color: C_GRAY,
  });

  // -------------------------------------------------------------------------
  // Finalize
  // -------------------------------------------------------------------------

  return pdfDoc.save();
}
