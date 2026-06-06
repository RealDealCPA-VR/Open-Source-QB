import { getServerContext } from '@/lib/context';
import { trialBalance } from '@/lib/services/reports';
import { formatCurrency } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function TrialBalancePage() {
  const ctx = await getServerContext();
  const tb = await trialBalance(ctx);

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-3xl font-extrabold text-navy">Trial Balance</h1>
        <span
          className={`px-3 py-1 rounded-full text-xs font-semibold ${
            tb.balanced ? 'bg-emerald/15 text-emerald' : 'bg-red-100 text-red-600'
          }`}
        >
          {tb.balanced ? 'In balance' : 'OUT OF BALANCE'}
        </span>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 max-w-3xl">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-navy/10 text-navy/70 text-sm">
              <th className="py-2 px-3 text-left font-semibold">Code</th>
              <th className="py-2 px-3 text-left font-semibold">Account</th>
              <th className="py-2 px-3 text-right font-semibold">Debit</th>
              <th className="py-2 px-3 text-right font-semibold">Credit</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-navy/40">
                  No posted transactions yet.
                </td>
              </tr>
            )}
            {tb.rows.map((r) => (
              <tr key={r.accountId} className="border-b border-slate-100 hover:bg-electric/5">
                <td className="py-2 px-3 text-navy/60 tabular-nums">{r.code}</td>
                <td className="py-2 px-3 text-navy">{r.name}</td>
                <td className="py-2 px-3 text-right tabular-nums text-navy">
                  {Number(r.debit) ? formatCurrency(r.debit) : ''}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-navy">
                  {Number(r.credit) ? formatCurrency(r.credit) : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-navy/20 font-bold text-navy">
              <td className="py-3 px-3" colSpan={2}>
                Total
              </td>
              <td className="py-3 px-3 text-right tabular-nums">{formatCurrency(tb.totalDebit)}</td>
              <td className="py-3 px-3 text-right tabular-nums">{formatCurrency(tb.totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </main>
  );
}
