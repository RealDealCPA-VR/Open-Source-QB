'use client';
/**
 * Cash-Basis Profit & Loss report page.
 *
 * Displays the same income/expense lines as the accrual P&L, but with the totals
 * adjusted for the net change in Accounts Receivable (AR) and Accounts Payable (AP)
 * over the selected period. The adjustments are shown explicitly so the user can
 * understand exactly how cash income/expenses differ from accrual.
 */
import * as React from 'react';
import { Wallet } from 'lucide-react';
import { formatCurrency, Money, toAmountString } from '@/lib/money';
import { api } from '@/lib/client';
import { Button, Card, PageHeader, toast } from '@/components/ui';
import type { ProfitAndLossCashBasis } from '@/lib/services/cashBasisReports';
import { RangeControls } from '../_components/shared';

// ---- Section sub-component ----
function Section({
  title,
  lines,
  accrualTotal,
  adjustment,
  adjustmentLabel,
  cashTotal,
}: {
  title: string;
  lines: { accountId: string; code: string; name: string; amount: string }[];
  accrualTotal: string;
  adjustment: string;
  adjustmentLabel: string;
  cashTotal: string;
}) {
  const adjustAmt = parseFloat(adjustment);
  return (
    <>
      <tr className="bg-navy/5">
        <td className="py-2 px-3 font-bold text-navy" colSpan={2}>
          {title}
        </td>
      </tr>
      {lines.map((l) => (
        <tr key={l.accountId} className="border-b border-slate-100">
          <td className="py-2 px-3 pl-8 text-navy">{l.name}</td>
          <td className="py-2 px-3 text-right tabular-nums text-navy">
            {formatCurrency(l.amount)}
          </td>
        </tr>
      ))}
      {lines.length === 0 && (
        <tr>
          <td className="py-2 px-3 pl-8 text-navy/40 italic" colSpan={2}>
            No {title.toLowerCase()} accounts with activity
          </td>
        </tr>
      )}
      {/* Accrual subtotal */}
      <tr className="border-t border-navy/20 text-navy/70">
        <td className="py-1.5 px-3 pl-8 text-sm">Accrual total {title.toLowerCase()}</td>
        <td className="py-1.5 px-3 text-right tabular-nums text-sm">
          {formatCurrency(accrualTotal)}
        </td>
      </tr>
      {/* AR / AP adjustment row */}
      <tr className={`text-sm ${adjustAmt !== 0 ? 'text-gold' : 'text-navy/40'}`}>
        <td className="py-1 px-3 pl-8 italic">{adjustmentLabel}</td>
        <td className="py-1 px-3 text-right tabular-nums italic">
          {adjustAmt !== 0 ? `(${formatCurrency(Math.abs(adjustAmt))})` : formatCurrency(0)}
        </td>
      </tr>
      {/* Cash-adjusted total */}
      <tr className="border-t border-navy/20 font-semibold text-navy/80">
        <td className="py-2 px-3">Cash {title.toLowerCase()}</td>
        <td className="py-2 px-3 text-right tabular-nums">{formatCurrency(cashTotal)}</td>
      </tr>
    </>
  );
}

// ---- Main page ----
export default function ProfitLossCashPage() {
  const [report, setReport] = React.useState<ProfitAndLossCashBasis | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');

  const fetchReport = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const url = `/api/reports/profit-loss-cash${params.size ? '?' + params.toString() : ''}`;
      const data = await api.get<ProfitAndLossCashBasis>(url);
      setReport(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load report';
      setError(msg);
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  React.useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  const net = report ? parseFloat(report.netIncome) : 0;

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader title="Profit & Loss (Cash Basis)" icon={Wallet} />

      {/* Explainer banner */}
      <Card className="mb-6 p-4 border-l-4 border-electric bg-electric/5 max-w-3xl">
        <h2 className="font-semibold text-navy mb-1 text-sm">Cash vs Accrual — what this report shows</h2>
        <p className="text-navy/70 text-sm leading-relaxed">
          <strong>Accrual basis</strong> records income when it is earned (invoice sent) and expenses
          when they are incurred (bill received), regardless of cash movement.
          <br />
          <strong>Cash basis</strong> records income only when cash is received and expenses only when
          cash is paid. It is calculated here using the indirect method:
        </p>
        <ul className="mt-2 ml-4 list-disc text-sm text-navy/70 space-y-0.5">
          <li>
            <strong>AR adjustment:</strong> if Accounts Receivable (1200) grew, you earned more than
            you collected — that growth is subtracted from cash income.
          </li>
          <li>
            <strong>AP adjustment:</strong> if Accounts Payable (2000) grew, you incurred more than
            you paid — that growth is subtracted from cash expenses.
          </li>
        </ul>
      </Card>

      {/* Date range controls */}
      <Card className="p-4 mb-6 max-w-3xl">
        <RangeControls
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          onRun={() => void fetchReport()}
        />
      </Card>

      {/* Report table */}
      {loading && (
        <p className="text-navy/50 text-sm">Loading...</p>
      )}
      {error && !loading && (
        <div className="flex items-center gap-3">
          <p className="text-red-600 text-sm">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => void fetchReport()}>
            Retry
          </Button>
        </div>
      )}
      {!loading && !error && report && (
        <Card className="p-6 max-w-3xl">
          <table className="w-full border-collapse">
            <tbody>
              <Section
                title="Income"
                lines={report.income}
                accrualTotal={toAmountString(Money.add(...report.income.map((l) => l.amount)))}
                adjustment={report.arAdjustment}
                adjustmentLabel={`AR adjustment (increase in receivables: ${formatCurrency(report.arAdjustment)})`}
                cashTotal={report.totalIncome}
              />
              <tr>
                <td className="py-2" colSpan={2} />
              </tr>
              <Section
                title="Expenses"
                lines={report.expenses}
                accrualTotal={toAmountString(Money.add(...report.expenses.map((l) => l.amount)))}
                adjustment={report.apAdjustment}
                adjustmentLabel={`AP adjustment (increase in payables: ${formatCurrency(report.apAdjustment)})`}
                cashTotal={report.totalExpenses}
              />
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-navy/30 text-lg font-extrabold">
                <td className="py-3 px-3 text-navy">Net Income (Cash Basis)</td>
                <td
                  className={`py-3 px-3 text-right tabular-nums ${
                    net >= 0 ? 'text-emerald' : 'text-red-600'
                  }`}
                >
                  {formatCurrency(report.netIncome)}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Period footer */}
          {(report.from || report.to) && (
            <p className="mt-4 text-xs text-navy/40">
              Period:{' '}
              {report.from ? new Date(report.from).toLocaleDateString() : 'start'} —{' '}
              {report.to ? new Date(report.to).toLocaleDateString() : 'today'}
            </p>
          )}
        </Card>
      )}
    </main>
  );
}
