import { getServerContext } from '@/lib/context';
import { balanceSheet } from '@/lib/services/reports';
import { formatCurrency } from '@/lib/money';

export const dynamic = 'force-dynamic';

type Line = { accountId: string; code: string; name: string; amount: string };

function Group({ title, lines, total }: { title: string; lines: Line[]; total: string }) {
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

export default async function BalanceSheetPage() {
  const ctx = await getServerContext();
  const bs = await balanceSheet(ctx);
  const equityLines = [
    ...bs.equity,
    { accountId: 're', code: '3900', name: 'Net Income / Retained Earnings', amount: bs.retainedEarnings },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-3xl font-extrabold text-navy">Balance Sheet</h1>
        <span
          className={`px-3 py-1 rounded-full text-xs font-semibold ${
            bs.balanced ? 'bg-emerald/15 text-emerald' : 'bg-red-100 text-red-600'
          }`}
        >
          {bs.balanced ? 'Assets = Liabilities + Equity' : 'OUT OF BALANCE'}
        </span>
      </div>
      <div className="rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 max-w-3xl">
        <table className="w-full border-collapse">
          <tbody>
            <Group title="Assets" lines={bs.assets} total={bs.totalAssets} />
            <tr><td className="py-2" colSpan={2} /></tr>
            <Group title="Liabilities" lines={bs.liabilities} total={bs.totalLiabilities} />
            <tr><td className="py-2" colSpan={2} /></tr>
            <Group title="Equity" lines={equityLines} total={bs.totalEquity} />
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-navy/30 text-base font-extrabold text-navy">
              <td className="py-3 px-3">Total Liabilities + Equity</td>
              <td className="py-3 px-3 text-right tabular-nums">
                {formatCurrency(Number(bs.totalLiabilities) + Number(bs.totalEquity))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </main>
  );
}
