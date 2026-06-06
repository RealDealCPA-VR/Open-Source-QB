/**
 * Cash-Basis Balance Sheet.
 *
 * ACCOUNTING BASIS OVERVIEW
 * ─────────────────────────
 * On an accrual Balance Sheet, Accounts Receivable (AR, code 1200) and Accounts Payable (AP,
 * code 2000) represent amounts owed but not yet exchanged in cash. A cash-basis Balance Sheet
 * excludes these balances because cash-basis accounting recognises no receivables or payables —
 * only cash transactions count.
 *
 * CONVERSION METHOD (Balance Sheet indirect adjustment)
 * ──────────────────────────────────────────────────────
 * 1. Start from the standard accrual Balance Sheet (balanceSheet from reports.ts).
 * 2. Remove every line whose COA code is 1200 (AR) from the assets section.
 * 3. Remove every line whose COA code is 2000 (AP) from the liabilities section.
 * 4. Reduce total equity by (arRemoved − apRemoved) to keep Assets = Liabilities + Equity.
 *
 * WHY THIS KEEPS THE EQUATION BALANCED
 * ──────────────────────────────────────
 * The accrual sheet satisfies: Assets = Liabilities + Equity.
 * We remove ΔA from assets and ΔL from liabilities, so the right side changes by −ΔL.
 * To restore balance we must reduce assets by ΔA, which means equity must shrink by (ΔA − ΔL),
 * i.e. equity' = equity − (arRemoved − apRemoved).
 *
 * In practice most companies carry AR > 0 and AP > 0 so cash-basis equity is lower than
 * accrual equity (unreceived revenue is excluded from both sides).
 */
import { Money, toAmountString } from '@/lib/money';
import type { ServiceContext } from './_base';
import { balanceSheet, type ReportLine } from './reports';

// ---- COA codes for the mandatory adjustments ----
const AR_CODE = '1200'; // Accounts Receivable (asset, debit-normal)
const AP_CODE = '2000'; // Accounts Payable     (liability, credit-normal)

/** Shape of a single AR/AP line that was removed from the accrual sheet. */
export interface RemovedLine {
  accountId: string;
  code: string;
  name: string;
  amount: string;
}

/** The cash-basis Balance Sheet returned by balanceSheetCashBasis. */
export interface BalanceSheetCashBasis {
  basis: 'cash';
  /** Asset lines after removing AR (code 1200). */
  assets: ReportLine[];
  /** Liability lines after removing AP (code 2000). */
  liabilities: ReportLine[];
  /** Equity lines from the accrual sheet (unchanged except totals). */
  equity: ReportLine[];
  /** Retained earnings line amount (net income to date, same as accrual). */
  retainedEarnings: string;
  /** Totals after the cash-basis adjustments. */
  totals: {
    totalAssets: string;
    totalLiabilities: string;
    totalEquity: string;
    /** Total liabilities + equity (should equal totalAssets). */
    totalLiabilitiesAndEquity: string;
  };
  /** True when totalAssets = totalLiabilities + totalEquity (within 1 cent). */
  balanced: boolean;
  /** Date the report is computed as of (undefined = all-time). */
  asOf?: string;
  /**
   * Details of what was adjusted.
   *  arRemoved: total AR balance removed from assets (positive = AR existed).
   *  apRemoved: total AP balance removed from liabilities (positive = AP existed).
   *  equityAdjustment: amount deducted from equity to restore the accounting equation
   *                    = arRemoved − apRemoved.
   */
  adjustments: {
    arRemoved: string;
    apRemoved: string;
    equityAdjustment: string;
    removedArLines: RemovedLine[];
    removedApLines: RemovedLine[];
  };
}

/**
 * Compute a cash-basis Balance Sheet as of an optional date.
 *
 * The function delegates to the canonical `balanceSheet()` from reports.ts (do NOT edit
 * reports.ts) and then strips AR and AP, adjusting equity so that the accounting equation
 * Assets = Liabilities + Equity continues to hold.
 *
 * @param ctx   Service context — scoped to ctx.companyId.
 * @param asOf  Optional upper date bound (defaults to all posted activity).
 * @returns     A BalanceSheetCashBasis with basis:'cash' and an adjustments summary.
 */
export async function balanceSheetCashBasis(
  ctx: ServiceContext,
  asOf?: Date,
): Promise<BalanceSheetCashBasis> {
  // 1. Fetch the accrual Balance Sheet (source of truth — do NOT re-query the GL directly).
  const accrual = await balanceSheet(ctx, asOf);

  // 2. Separate AR lines from the rest of the assets.
  const removedArLines: RemovedLine[] = [];
  const cashAssets: ReportLine[] = [];
  let arRemoved = Money.zero();

  for (const line of accrual.assets) {
    if (line.code === AR_CODE) {
      removedArLines.push({ accountId: line.accountId, code: line.code, name: line.name, amount: line.amount });
      arRemoved = arRemoved.plus(Money.of(line.amount));
    } else {
      cashAssets.push(line);
    }
  }

  // 3. Separate AP lines from the rest of the liabilities.
  const removedApLines: RemovedLine[] = [];
  const cashLiabilities: ReportLine[] = [];
  let apRemoved = Money.zero();

  for (const line of accrual.liabilities) {
    if (line.code === AP_CODE) {
      removedApLines.push({ accountId: line.accountId, code: line.code, name: line.name, amount: line.amount });
      apRemoved = apRemoved.plus(Money.of(line.amount));
    } else {
      cashLiabilities.push(line);
    }
  }

  // 4. Compute adjusted totals.
  //    totalAssets'      = totalAssets      − arRemoved
  //    totalLiabilities' = totalLiabilities − apRemoved
  //    equityAdjustment  = arRemoved − apRemoved   (always reduces equity on a net-AR basis)
  //    totalEquity'      = totalEquity      − equityAdjustment
  const totalAssets = Money.sub(accrual.totalAssets, arRemoved);
  const totalLiabilities = Money.sub(accrual.totalLiabilities, apRemoved);
  const equityAdjustment = arRemoved.minus(apRemoved);
  const totalEquity = Money.sub(accrual.totalEquity, equityAdjustment);
  const totalLiabilitiesAndEquity = totalLiabilities.plus(totalEquity);

  const balanced = Money.equalWithinCent(totalAssets, totalLiabilitiesAndEquity);

  return {
    basis: 'cash',
    assets: cashAssets,
    liabilities: cashLiabilities,
    equity: accrual.equity,
    retainedEarnings: accrual.retainedEarnings,
    totals: {
      totalAssets: toAmountString(totalAssets),
      totalLiabilities: toAmountString(totalLiabilities),
      totalEquity: toAmountString(totalEquity),
      totalLiabilitiesAndEquity: toAmountString(totalLiabilitiesAndEquity),
    },
    balanced,
    asOf: accrual.asOf,
    adjustments: {
      arRemoved: toAmountString(arRemoved),
      apRemoved: toAmountString(apRemoved),
      equityAdjustment: toAmountString(equityAdjustment),
      removedArLines,
      removedApLines,
    },
  };
}
