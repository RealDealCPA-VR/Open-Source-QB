/**
 * Bank file import service — parse, dedupe, and stage bank transactions.
 *
 * Supports OFX (Open Financial Exchange), QBO (QuickBooks Online export, which is OFX/SGML),
 * and CSV. Parsed rows land in the `bank_transactions` staging table with `matched = false`.
 * Categorization rules are applied immediately to set `suggestedAccountId`.
 *
 * IMPORTANT: No GL posting happens here. The reconcile/match step handles posting.
 */
import { createHash } from 'node:crypto';

// papaparse has no bundled types and @types/papaparse is not installed.
// We import via require and declare only the surface we use.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Papa = require('papaparse') as {
  parse<T>(
    input: string,
    config?: {
      header?: boolean;
      skipEmptyLines?: boolean;
      transformHeader?: (header: string) => string;
    },
  ): { data: T[]; errors: Array<{ message: string }> };
};
import { and, eq } from 'drizzle-orm';
import { bankAccounts, bankTransactions, fileImports } from '@/lib/db/schema';
import { toAmountString } from '@/lib/money';
import { type ServiceContext, ServiceError, notFound, validation, writeAudit } from './_base';
import { listRules, applyRules } from './rules';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ParsedTransaction {
  /** OFX financial-institution transaction ID — used for dedupe. */
  fitId?: string;
  date: Date;
  description: string;
  /** Positive = credit to bank account (deposit); negative = debit (payment). */
  amount: string; // decimal string, stored directly in DB
}

export type FileType = 'ofx' | 'qbo' | 'csv';

export interface CsvMapping {
  /** Column name or 0-based index for each field. */
  dateCol: string | number;
  descriptionCol: string | number;
  amountCol: string | number;
  /** If the file has separate debit/credit columns, provide both; amountCol is ignored. */
  debitCol?: string | number;
  creditCol?: string | number;
  fitIdCol?: string | number;
  /** Moment/date-fns-style format hint, e.g. "MM/DD/YYYY". */
  dateFormat?: string;
}

export interface ImportSummary {
  fileImportId: string;
  parsed: number;
  imported: number;
  skippedDupes: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// OFX / QBO date parsing
// ---------------------------------------------------------------------------

/**
 * Parse an OFX DTPOSTED value. Formats observed in the wild:
 *   20240115120000.000[-5:EST]  (full with tz offset — we strip and parse as UTC)
 *   20240115120000
 *   20240115
 */
function parseOFXDate(raw: string): Date {
  // Strip everything after the dot (fractional seconds + tz annotation).
  const clean = raw.trim().replace(/\..*$/, '');
  const year = clean.slice(0, 4);
  const month = clean.slice(4, 6);
  const day = clean.slice(6, 8);
  const hour = clean.slice(8, 10) || '00';
  const min = clean.slice(10, 12) || '00';
  const sec = clean.slice(12, 14) || '00';
  // Construct as UTC to avoid local-tz drift.
  return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
}

// ---------------------------------------------------------------------------
// OFX / QBO SGML parser (line-based; does NOT require XML conversion)
// ---------------------------------------------------------------------------

/**
 * Minimal recursive-descent parser for OFX/QBO SGML.
 *
 * Real-world OFX/QBO files use SGML with unclosed leaf tags — they cannot be
 * processed by an XML parser without a brittle regex-replacement pass that
 * re-breaks on its own output.  Instead we walk the file line-by-line:
 *   <CONTAINER>       → push a new object onto the stack
 *   </CONTAINER>      → pop back to parent
 *   <LEAF>value       → assign value to current object
 *
 * When the same leaf or container tag appears more than once at the same level
 * (as STMTTRN always does) we promote the value to an array automatically.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OFXNode = Record<string, any>;

function parseOFXSgml(content: string): OFXNode {
  // Strip the text header that QuickBooks / most banks emit before <OFX>.
  const idx = content.search(/<OFX[\s>]/i);
  const body = idx === -1 ? content.trim() : content.slice(idx).trim();

  const lines = body.split(/\r?\n/);
  // Stack entries: the object being built + the tag name that opened it.
  const stack: Array<{ tag: string; obj: OFXNode }> = [];
  const root: OFXNode = {};
  let current: OFXNode = root;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Closing tag: </TAG>
    const closeMatch = line.match(/^<\/([A-Z0-9_.]+)>$/i);
    if (closeMatch) {
      stack.pop();
      current = stack.length > 0 ? stack[stack.length - 1].obj : root;
      continue;
    }

    // Leaf tag with value on same line: <TAG>value (no closing tag in SGML)
    const leafMatch = line.match(/^<([A-Z0-9_.]+)>(.+)$/i);
    if (leafMatch) {
      const tag = leafMatch[1].toUpperCase();
      const value = leafMatch[2].trim();
      const existing = current[tag];
      if (existing === undefined) {
        current[tag] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        current[tag] = [existing, value];
      }
      continue;
    }

    // Container opening tag: <TAG> alone on a line
    const openMatch = line.match(/^<([A-Z0-9_.]+)>$/i);
    if (openMatch) {
      const tag = openMatch[1].toUpperCase();
      const newObj: OFXNode = {};
      const existing = current[tag];
      if (existing === undefined) {
        current[tag] = newObj;
      } else if (Array.isArray(existing)) {
        existing.push(newObj);
      } else {
        current[tag] = [existing, newObj];
      }
      stack.push({ tag, obj: newObj });
      current = newObj;
      continue;
    }
    // Any other line (e.g. "OFXHEADER:100") is silently skipped.
  }

  return root;
}

/**
 * Navigate the parsed SGML tree to the BANKTRANLIST node.
 * Handles both bank (BANKMSGSRSV1) and credit-card (CREDITCARDMSGSRSV1) message sets.
 */
function findBankTranList(doc: OFXNode): OFXNode | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = doc as any;
  return (
    d?.OFX?.BANKMSGSRSV1?.STMTTRNRS?.STMTRS?.BANKTRANLIST ??
    d?.OFX?.CREDITCARDMSGSRSV1?.CCSTMTTRNRS?.CCSTMTRS?.BANKTRANLIST ??
    null
  );
}

/**
 * Parse an OFX or QBO file and return normalized transaction rows.
 * Handles SGML (unclosed tags) and arbitrary header lines before <OFX>.
 */
export function parseOFX(content: string): ParsedTransaction[] {
  let doc: OFXNode;
  try {
    doc = parseOFXSgml(content);
  } catch (err) {
    throw new ServiceError('VALIDATION', `Failed to parse OFX/QBO content: ${(err as Error).message}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(doc as any)?.OFX) throw new ServiceError('VALIDATION', 'No <OFX> root element found.');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stmtList = findBankTranList(doc) as any;
  if (!stmtList) return []; // valid OFX with no transactions

  // STMTTRN: single object (one txn) or array (multiple txns).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawTxns: any[] = Array.isArray(stmtList.STMTTRN)
    ? stmtList.STMTTRN
    : stmtList.STMTTRN
      ? [stmtList.STMTTRN]
      : [];

  return rawTxns.map((t, i) => {
    const fitId = t.FITID != null ? String(t.FITID) : undefined;
    const dtPosted = t.DTPOSTED ?? t.DTUSER ?? '';
    if (!dtPosted) throw new ServiceError('VALIDATION', `Transaction ${i + 1}: missing DTPOSTED.`);
    const date = parseOFXDate(String(dtPosted));
    const trnAmt = t.TRNAMT ?? '0';
    const amount = toAmountString(String(trnAmt));
    const name = String(t.NAME ?? t.PAYEE ?? '');
    const memo = String(t.MEMO ?? '');
    const description = [name, memo].filter(Boolean).join(' — ') || 'Imported transaction';

    return { fitId, date, description, amount };
  });
}

/**
 * Alias so callers can name the format explicitly; QBO is structurally identical to OFX.
 */
export const parseQBO = parseOFX;

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

/**
 * Parse a bank CSV export using the caller-supplied column mapping.
 * Positive amounts are deposits; negative are withdrawals (standard convention).
 * If debitCol/creditCol are provided, debits are stored as negative and credits as positive.
 */
export function parseCSV(content: string, mapping: CsvMapping): ParsedTransaction[] {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length) {
    // Non-fatal parse warnings — log but continue.
  }

  return result.data.map((row, i) => {
    const col = (key: string | number): string => {
      if (typeof key === 'number') {
        const vals = Object.values(row);
        return vals[key]?.trim() ?? '';
      }
      return (row[key] ?? row[key.toString()] ?? '').trim();
    };

    // Date
    const rawDate = col(mapping.dateCol);
    if (!rawDate) throw new ServiceError('VALIDATION', `CSV row ${i + 1}: missing date value.`);
    const date = new Date(rawDate);
    if (isNaN(date.getTime())) {
      throw new ServiceError('VALIDATION', `CSV row ${i + 1}: cannot parse date "${rawDate}".`);
    }

    // Amount: prefer separate debit/credit columns if specified.
    let amount: string;
    if (mapping.debitCol !== undefined && mapping.creditCol !== undefined) {
      const debitRaw = col(mapping.debitCol).replace(/[,$]/g, '');
      const creditRaw = col(mapping.creditCol).replace(/[,$]/g, '');
      const debit = debitRaw ? parseFloat(debitRaw) : 0;
      const credit = creditRaw ? parseFloat(creditRaw) : 0;
      // Credit = money coming IN (positive); Debit = money going OUT (negative).
      amount = toAmountString(credit - debit);
    } else {
      const rawAmt = col(mapping.amountCol).replace(/[,$]/g, '');
      if (!rawAmt) throw new ServiceError('VALIDATION', `CSV row ${i + 1}: missing amount value.`);
      amount = toAmountString(rawAmt);
    }

    // Description
    const description = col(mapping.descriptionCol) || 'Imported transaction';

    // Optional fitId
    const fitId =
      mapping.fitIdCol !== undefined
        ? col(mapping.fitIdCol) || undefined
        : undefined;

    return { fitId, date, description, amount };
  });
}

// ---------------------------------------------------------------------------
// Hash-based fitId fallback for CSV rows that lack an explicit fitId
// ---------------------------------------------------------------------------

/**
 * Derive a stable dedup key for a parsed transaction when the source file
 * doesn't provide a financial-institution transaction ID (fitId).
 *
 * The hash is a short SHA-256 prefix over "date|description|amount", which is
 * stable across repeated CSV re-imports of the same file and virtually
 * collision-free for the transaction volumes a small-business sees.
 *
 * We prefix it with "csv-hash:" so it cannot collide with a real OFX FITID.
 */
function hashFitId(txn: { date: Date; description: string; amount: string }): string {
  const raw = `${txn.date.toISOString()}|${txn.description}|${txn.amount}`;
  return 'csv-hash:' + createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------
// Import orchestrator
// ---------------------------------------------------------------------------

export interface ImportTransactionsInput {
  bankAccountId: string;
  /** 'ofx' and 'qbo' are treated identically. */
  fileType: FileType;
  content: string;
  csvMapping?: CsvMapping;
  /** Optional filename for audit purposes. */
  filename?: string;
}

/**
 * Full import pipeline:
 *  1. Validate bankAccountId belongs to company.
 *  2. Create a fileImports row (status = processing).
 *  3. Parse the file content.
 *  4. Dedupe: skip any fitId already present in bank_transactions for this account.
 *  5. Insert new rows into bank_transactions (matched = false).
 *  6. Apply categorization rules to set suggestedAccountId.
 *  7. Update fileImports with final counts and status = completed (or failed).
 *  8. Return ImportSummary.
 */
export async function importTransactions(
  ctx: ServiceContext,
  input: ImportTransactionsInput,
): Promise<ImportSummary> {
  // 1. Verify the bank account belongs to this company.
  const [bankAccount] = await ctx.db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(
      and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.companyId, ctx.companyId)),
    );
  if (!bankAccount) throw notFound('Bank account');

  // Map fileType enum: 'qbo' → stored as 'qbo', 'ofx' → stored as 'ofx', 'csv' → 'csv'.
  const fileTypeForDb = input.fileType === 'ofx' ? 'ofx' : input.fileType === 'qbo' ? 'qbo' : 'csv';

  // 2. Create fileImports row.
  const [importRow] = await ctx.db
    .insert(fileImports)
    .values({
      companyId: ctx.companyId,
      filename: input.filename ?? `import.${input.fileType}`,
      fileType: fileTypeForDb as never,
      status: 'processing',
      uploadedBy: ctx.userId ?? '00000000-0000-0000-0000-000000000000',
    })
    .returning();

  let parsed: ParsedTransaction[] = [];
  let parseError: string | null = null;

  // 3. Parse.
  try {
    if (input.fileType === 'csv') {
      if (!input.csvMapping) {
        throw validation('csvMapping is required for CSV imports.');
      }
      parsed = parseCSV(input.content, input.csvMapping);
    } else {
      // ofx and qbo use the same parser.
      parsed = parseOFX(input.content);
    }
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  // If parsing failed entirely, mark the import as failed and bail.
  if (parseError) {
    await ctx.db
      .update(fileImports)
      .set({ status: 'failed', errorLog: [{ line: 0, error: parseError }], completedAt: new Date() })
      .where(eq(fileImports.id, importRow.id));
    throw new ServiceError('VALIDATION', `Failed to parse import file: ${parseError}`);
  }

  // 4a. Apply hash-based fitId fallback for CSV rows that have no fitId.
  //     This ensures re-importing the same CSV doesn't create duplicate rows.
  for (const txn of parsed) {
    if (!txn.fitId) {
      txn.fitId = hashFitId(txn);
    }
  }

  // 4b. Dedupe: collect fitIds already staged for this bank account.
  const existingFitIds = new Set<string>();
  {
    const existing = await ctx.db
      .select({ fitId: bankTransactions.fitId })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.companyId, ctx.companyId),
          eq(bankTransactions.bankAccountId, input.bankAccountId),
        ),
      );
    for (const row of existing) {
      if (row.fitId) existingFitIds.add(row.fitId);
    }
  }

  const toInsert = parsed.filter((p) => !p.fitId || !existingFitIds.has(p.fitId));
  const skippedDupes = parsed.length - toInsert.length;

  // 5. Pre-fetch active rules once for bulk application.
  const rules = await listRules(ctx);

  // 6. Insert + apply rules row-by-row.
  const errorLog: Array<{ line: number; error: string }> = [];
  let importedCount = 0;

  for (let i = 0; i < toInsert.length; i++) {
    const txn = toInsert[i];
    try {
      // Apply rules to get suggested account.
      const suggestedAccountId = await applyRules(
        ctx,
        { description: txn.description, payee: undefined, amount: txn.amount },
        rules,
      );

      await ctx.db.insert(bankTransactions).values({
        companyId: ctx.companyId,
        bankAccountId: input.bankAccountId,
        fileImportId: importRow.id,
        fitId: txn.fitId ?? null,
        date: txn.date,
        description: txn.description,
        payee: null,
        amount: txn.amount,
        matched: false,
        suggestedAccountId: suggestedAccountId ?? null,
      });
      importedCount += 1;
    } catch (err) {
      errorLog.push({ line: i + 1, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // 7. Update fileImports with final counts.
  const finalStatus = errorLog.length > 0 && importedCount === 0 ? 'failed' : 'completed';
  await ctx.db
    .update(fileImports)
    .set({
      status: finalStatus,
      totalTransactions: parsed.length,
      importedTransactions: importedCount,
      failedTransactions: errorLog.length,
      errorLog: errorLog.length ? errorLog : null,
      completedAt: new Date(),
    })
    .where(eq(fileImports.id, importRow.id));

  // Audit trail.
  await writeAudit(ctx, {
    action: 'create',
    entityType: 'file_import',
    entityId: importRow.id,
    newValues: {
      fileType: input.fileType,
      bankAccountId: input.bankAccountId,
      parsed: parsed.length,
      imported: importedCount,
      skippedDupes,
      errors: errorLog.length,
    },
  });

  return {
    fileImportId: importRow.id,
    parsed: parsed.length,
    imported: importedCount,
    skippedDupes,
    errors: errorLog.length,
  };
}
