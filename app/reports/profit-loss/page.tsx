import { getServerContext } from '@/lib/context';
import { profitAndLoss } from '@/lib/services/reports';
import { formatCurrency } from '@/lib/money';

export const dynamic = 'force-dynamic';

function Section({
  title,
  lines,
  total,
}: {
  title: string;
  lines: { accountId: string; code: string; name: string; amount: string }[];
  total: string;
}) {
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
          <td className="py-2 px-3 text-right tabular-nums text-navy">{formatCurrency(l.amount)}</td>
        </tr>
      ))}
      <tr className="border-t border-navy/20 font-semibold text-navy/80">
        <td className="py-2 px-3">Total {title}</td>
        <td className="py-2 px-3 text-right tabular-nums">{formatCurrency(total)}</td>
      </tr>
    </>
  );
}

export default async function ProfitLossPage() {
  const ctx = await getServerContext();
  const pl = await profitAndLoss(ctx);
  const net = Number(pl.netIncome);

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <h1 className="text-3xl font-extrabold text-navy mb-6">Profit &amp; Loss</h1>
      <div className="rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 max-w-3xl">
        <table className="w-full border-collapse">
          <tbody>
            <Section title="Income" lines={pl.income} total={pl.totalIncome} />
            <tr>
              <td className="py-2" colSpan={2} />
            </tr>
            <Section title="Expenses" lines={pl.expenses} total={pl.totalExpenses} />
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-navy/30 text-lg font-extrabold">
              <td className="py-3 px-3 text-navy">Net Income</td>
              <td
                className={`py-3 px-3 text-right tabular-nums ${
                  net >= 0 ? 'text-emerald' : 'text-red-600'
                }`}
              >
                {formatCurrency(pl.netIncome)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </main>
  );
}
