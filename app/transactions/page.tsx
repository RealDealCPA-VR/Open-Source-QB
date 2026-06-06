import { TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { getServerContext } from '@/lib/context';
import { listEntries } from '@/lib/services/journal';
import { formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  posted: 'bg-emerald/15 text-emerald',
  draft: 'bg-gold/20 text-gold',
  void: 'bg-slate-100 text-slate-500 line-through',
};

export default async function TransactionsPage() {
  const ctx = await getServerContext();
  const entries = await listEntries(ctx, { limit: 200 });

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <h1 className="text-3xl font-extrabold text-navy mb-6 flex items-center gap-3">
        <TrendingUp className="text-electric h-8 w-8" /> Transactions
      </h1>
      <div className="rounded-2xl bg-white p-6 shadow-2xl border border-slate-100">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-navy/10 text-navy/70 text-sm">
              <th className="py-2.5 px-4 text-left font-semibold">#</th>
              <th className="py-2.5 px-4 text-left font-semibold">Date</th>
              <th className="py-2.5 px-4 text-left font-semibold">Description</th>
              <th className="py-2.5 px-4 text-left font-semibold">Reference</th>
              <th className="py-2.5 px-4 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-navy/40">
                  No transactions yet. Create invoices, bills, payments, or journal entries to get started.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-slate-100 hover:bg-electric/5">
                <td className="py-2.5 px-4 text-navy/60 tabular-nums">{e.entryNumber}</td>
                <td className="py-2.5 px-4 text-navy whitespace-nowrap">{formatDate(e.date)}</td>
                <td className="py-2.5 px-4 text-navy">{e.description}</td>
                <td className="py-2.5 px-4 text-navy/60">{e.reference ?? ''}</td>
                <td className="py-2.5 px-4">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_TONE[e.status] ?? ''}`}>
                    {e.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 text-sm text-navy/40">
          Showing the {Math.min(entries.length, 200)} most recent entries.{' '}
          <Link href="/journal" className="text-electric hover:underline">
            Add a journal entry →
          </Link>
        </div>
      </div>
    </main>
  );
}
