/**
 * PDF renderer for purchase orders.
 *
 * Mirrors the invoice.ts layout/quality using pdf-lib with standard Helvetica
 * fonts (embedded in every PDF viewer — no external font files required).
 *
 * Layout (US Letter, portrait):
 *   - Company name header (top-left), "PURCHASE ORDER #XXXX" label (top-right)
 *   - PO date / expected date beneath the number
 *   - "Vendor" block
 *   - Horizontal rule separator
 *   - Line-items table (description | account | qty | rate | amount)
 *   - Total block
 *   - Memo block (if provided)
 *   - Light footer rule at bottom
 */

import { PDFDocument, StandardFonts, rgb, PageSizes } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface PurchaseOrderPdfLine {
  description: string;
  accountCode?: string | null;
  quantity: string | number;
  rate: string | number;
  amount: string | number;
}

export interface PurchaseOrderPdfData {
  company: { name: string };
  vendorName: string;
  po: {
    number: number | string;
    date: string;
    expectedDate?: string | null;
    total: string | number;
    status: string;
    memo?: string | null;
  };
  lines: PurchaseOrderPdfLine[];
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
const COLOR_LIGHT  = rgb(0.90, 0.92, 0.95);
const COLOR_BLACK  = rgb(0, 0, 0);
const COLOR_GRAY   = rgb(0.45, 0.45, 0.50);
// Orange accent to distinguish PO from invoice/estimate
const COLOR_ORANGE = rgb(0.85, 0.42, 0.08);

// ---------------------------------------------------------------------------
// renderPurchaseOrderPdf
// ---------------------------------------------------------------------------

export async function renderPurchaseOrderPdf(data: PurchaseOrderPdfData): Promise<Uint8Array> {
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
  // HEADER — company name (left) + PO label (right)
  // -------------------------------------------------------------------------

  page.drawText(trunc(data.company.name, 40), {
    x: MARGIN_L,
    y: cursor,
    font: bold,
    size: 22,
    color: COLOR_NAVY,
  });

  const poLabel  = 'PURCHASE ORDER';
  const poLabelW = bold.widthOfTextAtSize(poLabel, 16);
  page.drawText(poLabel, {
    x: MARGIN_R - poLabelW,
    y: cursor,
    font: bold,
    size: 16,
    color: COLOR_ORANGE,
  });

  cursor -= 22;

  const numStr = `#${data.po.number}`;
  const numW   = bold.widthOfTextAtSize(numStr, 12);
  page.drawText(numStr, {
    x: MARGIN_R - numW,
    y: cursor,
    font: bold,
    size: 12,
    color: COLOR_NAVY,
  });

  cursor -= 16;

  const dateStr   = `Date: ${data.po.date}`;
  const dateLabelW = regular.widthOfTextAtSize(dateStr, 10);
  page.drawText(dateStr, {
    x: MARGIN_R - dateLabelW,
    y: cursor,
    font: regular,
    size: 10,
    color: COLOR_GRAY,
  });

  cursor -= 14;

  if (data.po.expectedDate) {
    const expStr   = `Expected: ${data.po.expectedDate}`;
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

  // Status badge (top-right, below dates)
  const statusLabel = data.po.status.toUpperCase();
  const statusW     = bold.widthOfTextAtSize(statusLabel, 8);
  page.drawText(statusLabel, {
    x: MARGIN_R - statusW,
    y: cursor,
    font: bold,
    size: 8,
    color: data.po.status === 'open' ? COLOR_ORANGE : COLOR_GRAY,
  });

  cursor -= 14;

  // -------------------------------------------------------------------------
  // VENDOR block (left side)
  // -------------------------------------------------------------------------

  const vendorY = PAGE_H - 48 - 22 - 16;

  page.drawText('VENDOR', {
    x: MARGIN_L,
    y: vendorY,
    font: bold,
    size: 8,
    color: COLOR_GRAY,
  });

  page.drawText(trunc(data.vendorName, 45), {
    x: MARGIN_L,
    y: vendorY - 14,
    font: bold,
    size: 12,
    color: COLOR_NAVY,
  });

  cursor = Math.min(cursor, vendorY - 14) - 28;

  // -------------------------------------------------------------------------
  // SEPARATOR
  // -------------------------------------------------------------------------

  drawRule(cursor, COLOR_ORANGE, 1.5);
  cursor -= 18;

  // -------------------------------------------------------------------------
  // LINE-ITEMS TABLE HEADER
  // -------------------------------------------------------------------------

  // Columns: description | account | qty | rate | amount
  const COL_DESC = MARGIN_L;
  const COL_ACCT = MARGIN_L + CONTENT_W * 0.40;
  const COL_QTY  = MARGIN_L + CONTENT_W * 0.58;
  const COL_RATE = MARGIN_L + CONTENT_W * 0.72;
  const COL_AMT  = MARGIN_R;

  const TH_SIZE = 8;

  page.drawText('DESCRIPTION', {
    x: COL_DESC,
    y: cursor,
    font: bold,
    size: TH_SIZE,
    color: COLOR_GRAY,
  });

  page.drawText('ACCOUNT', {
    x: COL_ACCT,
    y: cursor,
    font: bold,
    size: TH_SIZE,
    color: COLOR_GRAY,
  });

  const qtyLabel  = 'QTY';
  const qtyLabelW = bold.widthOfTextAtSize(qtyLabel, TH_SIZE);
  page.drawText(qtyLabel, {
    x: COL_QTY - qtyLabelW / 2,
    y: cursor,
    font: bold,
    size: TH_SIZE,
    color: COLOR_GRAY,
  });

  const rateLabel  = 'RATE';
  const rateLabelW = bold.widthOfTextAtSize(rateLabel, TH_SIZE);
  page.drawText(rateLabel, {
    x: COL_RATE - rateLabelW / 2,
    y: cursor,
    font: bold,
    size: TH_SIZE,
    color: COLOR_GRAY,
  });

  const amtLabel  = 'AMOUNT';
  const amtLabelW = bold.widthOfTextAtSize(amtLabel, TH_SIZE);
  page.drawText(amtLabel, {
    x: COL_AMT - amtLabelW,
    y: cursor,
    font: bold,
    size: TH_SIZE,
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

    const desc     = trunc(String(line.description || '—'), 30);
    const acct     = trunc(String(line.accountCode || ''), 14);
    const qtyStr   = String(line.quantity ?? '');
    const rateStr  = fmt(line.rate);
    const amtStr   = fmt(line.amount);

    page.drawText(desc, {
      x: COL_DESC,
      y: cursor,
      font: regular,
      size: LINE_SIZE,
      color: COLOR_BLACK,
    });

    if (acct) {
      page.drawText(acct, {
        x: COL_ACCT,
        y: cursor,
        font: regular,
        size: 9,
        color: COLOR_GRAY,
      });
    }

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
  // TOTAL BLOCK (right-aligned)
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

  cursor -= 2;
  page.drawLine({
    start: { x: TOT_LABEL_X, y: cursor },
    end:   { x: TOT_VALUE_X, y: cursor },
    thickness: 0.75,
    color: COLOR_NAVY,
  });
  cursor -= 14;

  drawTotalRow('Total', fmt(data.po.total), { bold: true, size: 12 });

  // Tinted highlight box for total
  const rectH = 22;
  page.drawRectangle({
    x: TOT_LABEL_X - 6,
    y: cursor - 6,
    width: TOT_VALUE_X - TOT_LABEL_X + 12,
    height: rectH,
    color: rgb(1.0, 0.95, 0.88),
  });

  const totalStr = fmt(data.po.total);
  page.drawText('PO Total', {
    x: TOT_LABEL_X,
    y: cursor + 2,
    font: bold,
    size: 11,
    color: COLOR_ORANGE,
  });

  const totalW = bold.widthOfTextAtSize(totalStr, 11);
  page.drawText(totalStr, {
    x: TOT_VALUE_X - totalW,
    y: cursor + 2,
    font: bold,
    size: 11,
    color: COLOR_ORANGE,
  });

  cursor -= TOT_ROW + 4;

  // -------------------------------------------------------------------------
  // MEMO (if provided)
  // -------------------------------------------------------------------------

  if (data.po.memo) {
    cursor -= 8;
    const memoText = trunc(data.po.memo, 200);
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
  // AUTHORIZATION SECTION
  // -------------------------------------------------------------------------

  const AUTH_Y = 100;
  drawRule(AUTH_Y + 30, COLOR_LIGHT, 0.5);

  page.drawText('Authorized By', {
    x: MARGIN_L,
    y: AUTH_Y + 14,
    font: bold,
    size: 8,
    color: COLOR_GRAY,
  });

  // Signature line
  page.drawLine({
    start: { x: MARGIN_L, y: AUTH_Y },
    end:   { x: MARGIN_L + 180, y: AUTH_Y },
    thickness: 0.75,
    color: COLOR_NAVY,
  });

  page.drawText('Date', {
    x: MARGIN_L + 200,
    y: AUTH_Y + 14,
    font: bold,
    size: 8,
    color: COLOR_GRAY,
  });

  page.drawLine({
    start: { x: MARGIN_L + 200, y: AUTH_Y },
    end:   { x: MARGIN_L + 360, y: AUTH_Y },
    thickness: 0.75,
    color: COLOR_NAVY,
  });

  // -------------------------------------------------------------------------
  // FOOTER
  // -------------------------------------------------------------------------

  const FOOTER_Y = 36;
  drawRule(FOOTER_Y + 10, COLOR_LIGHT, 0.5);

  const footerText = `${data.company.name}  —  Purchase Order`;
  const ftW = regular.widthOfTextAtSize(footerText, 8);
  page.drawText(footerText, {
    x: (PAGE_W - ftW) / 2,
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
