import { DollarSign, TrendingUp, FileText, BookOpen, Wallet } from 'lucide-react';
import { getServerContext } from '@/lib/context';
import { profitAndLoss } from '@/lib/services/reports';
import { listAccounts } from '@/lib/services/accounts';
import { Money, formatCurrency } from '@/lib/money';

export const dynamic = 'force-dynamic';

const CASH_SUBTYPES = new Set(['checking', 'savings']);

export default async function DashboardPage() {
  const ctx = await getServerContext();
  const [pl, accounts] = await Promise.all([profitAndLoss(ctx), listAccounts(ctx)]);

  const sumWhere = (pred: (a: (typeof accounts)[number]) => boolean) =>
    Money.add(...accounts.filter(pred).map((a) => a.balance)).toString();

  const cash = sumWhere((a) => a.type === 'asset' && CASH_SUBTYPES.has(a.subtype));
  const ar = sumWhere((a) => a.subtype === 'accounts_receivable');
  const ap = sumWhere((a) => a.subtype === 'accounts_payable');

  const cards = [
    { icon: DollarSign, label: 'Revenue (YTD)', value: pl.totalIncome, accent: 'electric' },
    { icon: TrendingUp, label: 'Net Profit (YTD)', value: pl.netIncome, accent: 'emerald' },
    { icon: Wallet, label: 'Cash on Hand', value: cash, accent: 'gold' },
    { icon: FileText, label: 'Accounts Receivable', value: ar, accent: 'navy' },
    { icon: BookOpen, label: 'Accounts Payable', value: ap, accent: 'electric' },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <h1 className="text-3xl font-extrabold text-navy mb-8">Executive Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-6">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.label}
              className="rounded-2xl p-6 bg-white border-b-4 border-electric shadow-xl flex flex-col items-start hover:scale-[1.025] transition-all duration-300"
            >
              <Icon className="h-7 w-7 text-electric mb-2" />
              <span className="text-2xl font-semibold text-navy tabular-nums">
                {formatCurrency(c.value)}
              </span>
              <span className="mt-1 text-sm text-navy/50 font-medium">{c.label}</span>
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-sm text-navy/40">
        Live figures from your company ledger. Post invoices, bills, and payments to see them update.
      </p>
    </main>
  );
}
