/**
 * PDF renderer for estimates (price quotes).
 *
 * Mirrors the invoice.ts layout/quality using pdf-lib with standard Helvetica
 * fonts (embedded in every PDF viewer — no external font files required).
 *
 * Layout (US Letter, portrait):
 *   - Company name header (top-left), "ESTIMATE #XXXX" label (top-right)
 *   - Estimate date / expiration date beneath the number
 *   - "Prepared For" block (customer)
 *   - Horizontal rule separator
 *   - Line-items table (description | qty | rate | amount)
 *   - Totals block (subtotal, tax, total)
 *   - Memo block (if provided)
 *   - Light footer rule at bottom
 */

import { PDFDocument, StandardFonts, rgb, PageSizes } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface EstimatePdfLine {
  description: string;
  quantity: string | number;
  rate: string | number;
  amount: string | number;
}

export interface EstimatePdfData {
  company: { name: string };
  customerName: string;
  estimate: {
    number: number | string;
    date: string;
    expirationDate?: string | null;
    subtotal: string | number;
    taxAmount: string | number;
    total: string | number;
    memo?: string | null;
  };
  lines: EstimatePdfLine[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(value: string | number): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    isNaN(n) ? 0 : n,
  );
}

function trunc(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// US Letter: 612 x 792 pt
const PAGE_W = PageSizes.Letter[0];
const PAGE_H = PageSizes.Letter[1];

const MARGIN_L = 48;
const MARGIN_R = PAGE_W - 48;
const CONTENT_W = MARGIN_R - MARGIN_L;

const COLOR_NAVY   = rgb(0.09, 0.13, 0.27);
const COLOR_ACCENT = rgb(0.20, 0.47, 0.96);
const COLOR_LIGHT  = rgb(0.90, 0.92, 0.95);
const COLOR_BLACK  = rgb(0, 0, 0);
const COLOR_GRAY   = rgb(0.45, 0.45, 0.50);
// Teal accent to visually distinguish estimate from invoice
const COLOR_TEAL   = rgb(0.05, 0.60, 0.55);

// ---------------------------------------------------------------------------
// renderEstimatePdf
// ---------------------------------------------------------------------------

export async function renderEstimatePdf(data: EstimatePdfData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  let cursor = PAGE_H - 48;

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function drawRule(y: number, color = COLOR_LIGHT, thickness = 0.75) {
    page.drawLine({
      start: { x: MARGIN_L, y },
      end:   { x: MARGIN_R, y },
      thickness,
      color,
    });
  }

  // -------------------------------------------------------------------------
  // HEADER — company name (left) + estimate label (right)
  // -------------------------------------------------------------------------

  page.drawText(trunc(data.company.name, 40), {
    x: MARGIN_L,
    y: cursor,
    font: bold,
    size: 22,
    color: COLOR_NAVY,
  });

  const estLabel = 'ESTIMATE';
  const estLabelW = bold.widthOfTextAtSize(estLabel, 18);
  page.drawText(estLabel, {
    x: MARGIN_R - estLabelW,
    y: cursor,
    font: bold,
    size: 18,
    color: COLOR_TEAL,
  });

  cursor -= 22;

  const numStr = `#${data.estimate.number}`;
  const numW = bold.widthOfTextAtSize(numStr, 12);
  page.drawText(numStr, {
    x: MARGIN_R - numW,
    y: cursor,
    font: bold,
    size: 12,
    color: COLOR_NAVY,
  });

  cursor -= 16;

  const dateStr = `Date: ${data.estimate.date}`;
  const dateLabelW = regular.widthOfTextAtSize(dateStr, 10);
  page.drawText(dateStr, {
    x: MARGIN_R - dateLabelW,
    y: cursor,
    font: regular,
    size: 10,
    color: COLOR_GRAY,
  });

  cursor -= 14;

  if (data.estimate.expirationDate) {
    const expStr = `Expires: ${data.estimate.expirationDate}`;
    const expLabelW = regular.widthOfTextAtSize(expStr, 10);
    page.drawText(expStr, {
      x: MARGIN_R - expLabelW,
      y: cursor,
      font: regular,
      size: 10,
      color: COLOR_GRAY,
    });
    cursor -= 14;
  }

  // -------------------------------------------------------------------------
  // PREPARED FOR block (left side)
  // -------------------------------------------------------------------------

  const prepY = PAGE_H - 48 - 22 - 16;

  page.drawText('PREPARED FOR', {
    x: MARGIN_L,
    y: prepY,
    font: bold,
    size: 8,
    color: COLOR_GRAY,
  });

  page.drawText(trunc(data.customerName, 45), {
    x: MARGIN_L,
    y: prepY - 14,
    font: bold,
    size: 12,
    color: COLOR_NAVY,
  });

  cursor = Math.min(cursor, prepY - 14) - 28;

  // -------------------------------------------------------------------------
  // SEPARATOR
  // -------------------------------------------------------------------------

  drawRule(cursor, COLOR_TEAL, 1.5);
  cursor -= 18;

  // -------------------------------------------------------------------------
  // LINE-ITEMS TABLE HEADER
  // -------------------------------------------------------------------------

  const COL_DESC = MARGIN_L;
  const COL_QTY  = MARGIN_L + CONTENT_W * 0.58;
  const COL_RATE = MARGIN_L + CONTENT_W * 0.72;
  const COL_AMT  = MARGIN_R;

  const TABLE_HEADER_SIZE = 8;

  page.drawText('DESCRIPTION', {
    x: COL_DESC,
    y: cursor,
    font: bold,
    size: TABLE_HEADER_SIZE,
    color: COLOR_GRAY,
  });

  const qtyLabel  = 'QTY';
  const qtyLabelW = bold.widthOfTextAtSize(qtyLabel, TABLE_HEADER_SIZE);
  page.drawText(qtyLabel, {
    x: COL_QTY - qtyLabelW / 2,
    y: cursor,
    font: bold,
    size: TABLE_HEADER_SIZE,
    color: COLOR_GRAY,
  });

  const rateLabel  = 'RATE';
  const rateLabelW = bold.widthOfTextAtSize(rateLabel, TABLE_HEADER_SIZE);
  page.drawText(rateLabel, {
    x: COL_RATE - rateLabelW / 2,
    y: cursor,
    font: bold,
    size: TABLE_HEADER_SIZE,
    color: COLOR_GRAY,
  });

  const amtLabel  = 'AMOUNT';
  const amtLabelW = bold.widthOfTextAtSize(amtLabel, TABLE_HEADER_SIZE);
  page.drawText(amtLabel, {
    x: COL_AMT - amtLabelW,
    y: cursor,
    font: bold,
    size: TABLE_HEADER_SIZE,
    color: COLOR_GRAY,
  });

  cursor -= 6;
  drawRule(cursor);
  cursor -= 14;

  // -------------------------------------------------------------------------
  // LINE ITEMS
  // -------------------------------------------------------------------------

  const ROW_H     = 16;
  const LINE_SIZE = 10;

  for (const line of data.lines) {
    if (cursor < 160) {
      page.drawText('(continued on next page)', {
        x: MARGIN_L,
        y: cursor,
        font: regular,
        size: 8,
        color: COLOR_GRAY,
      });
      cursor -= ROW_H;
      break;
    }

    const desc    = trunc(String(line.description || '—'), 55);
    const qtyStr  = String(line.quantity ?? '');
    const rateStr = fmt(line.rate);
    const amtStr  = fmt(line.amount);

    page.drawText(desc, {
      x: COL_DESC,
      y: cursor,
      font: regular,
      size: LINE_SIZE,
      color: COLOR_BLACK,
    });

    const qtyW = regular.widthOfTextAtSize(qtyStr, LINE_SIZE);
    page.drawText(qtyStr, {
      x: COL_QTY - qtyW / 2,
      y: cursor,
      font: regular,
      size: LINE_SIZE,
      color: COLOR_BLACK,
    });

    const rateW = regular.widthOfTextAtSize(rateStr, LINE_SIZE);
    page.drawText(rateStr, {
      x: COL_RATE - rateW / 2,
      y: cursor,
      font: regular,
      size: LINE_SIZE,
      color: COLOR_BLACK,
    });

    const amtW = regular.widthOfTextAtSize(amtStr, LINE_SIZE);
    page.drawText(amtStr, {
      x: COL_AMT - amtW,
      y: cursor,
      font: regular,
      size: LINE_SIZE,
      color: COLOR_BLACK,
    });

    cursor -= ROW_H;
    drawRule(cursor + 2);
    cursor -= 4;
  }

  cursor -= 8;

  // -------------------------------------------------------------------------
  // TOTALS BLOCK (right-aligned)
  // -------------------------------------------------------------------------

  const TOT_LABEL_X = MARGIN_L + CONTENT_W * 0.62;
  const TOT_VALUE_X = MARGIN_R;
  const TOT_SIZE    = 10;
  const TOT_ROW     = 16;

  function drawTotalRow(
    label: string,
    value: string,
    opts: { bold?: boolean; size?: number } = {},
  ) {
    const sz   = opts.size ?? TOT_SIZE;
    const font  = opts.bold ? bold : regular;
    const color = opts.bold ? COLOR_NAVY : COLOR_GRAY;

    page.drawText(label, { x: TOT_LABEL_X, y: cursor, font, size: sz, color });

    const valW = font.widthOfTextAtSize(value, sz);
    page.drawText(value, { x: TOT_VALUE_X - valW, y: cursor, font, size: sz, color });

    cursor -= TOT_ROW;
  }

  drawTotalRow('Subtotal', fmt(data.estimate.subtotal));

  const taxVal = parseFloat(String(data.estimate.taxAmount)) || 0;
  if (taxVal !== 0) {
    drawTotalRow('Tax', fmt(data.estimate.taxAmount));
  }

  cursor -= 2;
  page.drawLine({
    start: { x: TOT_LABEL_X, y: cursor },
    end:   { x: TOT_VALUE_X, y: cursor },
    thickness: 0.75,
    color: COLOR_NAVY,
  });
  cursor -= 14;

  drawTotalRow('Total', fmt(data.estimate.total), { bold: true, size: 12 });

  // Tinted highlight box for the total
  const rectH = 22;
  page.drawRectangle({
    x: TOT_LABEL_X - 6,
    y: cursor - 6,
    width: TOT_VALUE_X - TOT_LABEL_X + 12,
    height: rectH,
    color: rgb(0.88, 0.98, 0.97),
  });

  const estimateTotal = fmt(data.estimate.total);
  page.drawText('Estimate Total', {
    x: TOT_LABEL_X,
    y: cursor + 2,
    font: bold,
    size: 11,
    color: COLOR_TEAL,
  });

  const etW = bold.widthOfTextAtSize(estimateTotal, 11);
  page.drawText(estimateTotal, {
    x: TOT_VALUE_X - etW,
    y: cursor + 2,
    font: bold,
    size: 11,
    color: COLOR_TEAL,
  });

  cursor -= TOT_ROW + 4;

  // -------------------------------------------------------------------------
  // MEMO (if provided)
  // -------------------------------------------------------------------------

  if (data.estimate.memo) {
    cursor -= 8;
    const memoText = trunc(data.estimate.memo, 200);
    page.drawText('Notes', {
      x: MARGIN_L,
      y: cursor,
      font: bold,
      size: 8,
      color: COLOR_GRAY,
    });
    cursor -= 14;
    page.drawText(memoText, {
      x: MARGIN_L,
      y: cursor,
      font: regular,
      size: 9,
      color: COLOR_NAVY,
      maxWidth: CONTENT_W,
    });
  }

  // -------------------------------------------------------------------------
  // FOOTER
  // -------------------------------------------------------------------------

  const FOOTER_Y = 36;
  drawRule(FOOTER_Y + 10, COLOR_LIGHT, 0.5);

  const footerText = `${data.company.name}  —  This estimate is valid until ${data.estimate.expirationDate ?? 'further notice'}.`;
  const ftW = regular.widthOfTextAtSize(footerText, 8);
  page.drawText(footerText, {
    x: Math.max(MARGIN_L, (PAGE_W - ftW) / 2),
    y: FOOTER_Y,
    font: regular,
    size: 8,
    color: COLOR_GRAY,
  });

  // -------------------------------------------------------------------------
  // Finalize
  // -------------------------------------------------------------------------

  return pdfDoc.save();
}
