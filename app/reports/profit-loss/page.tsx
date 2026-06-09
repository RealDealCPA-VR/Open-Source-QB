import Link from 'next/link';
import { BarChart2 } from 'lucide-react';
import { Button, Card, Input, Label, PageHeader } from '@/components/ui';
import { getServerContext } from '@/lib/context';
import { profitAndLoss } from '@/lib/services/reports';
import { getCompany } from '@/lib/services/company';
import { ytdRange } from '@/lib/ytd';
import { formatCurrency } from '@/lib/money';

export const dynamic = 'force-dynamic';

function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseParamDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  // Parse as local midnight so the rendered date matches what the user picked
  // regardless of the server's UTC offset.
  const d = new Date(`${v}T00:00:00`);
  return isNaN(d.getTime()) ? undefined : d;
}

function Section({
  title,
  lines,
  total,
  rangeQs,
}: {
  title: string;
  lines: { accountId: string; code: string; name: string; amount: string }[];
  total: string;
  rangeQs: string;
}) {
  return (
    <>
      <tr className="bg-navy/5">
        <td className="py-2 px-3 font-bold text-navy" colSpan={2}>
          {title}
        </td>
      </tr>
      {lines.map((l) => (
        <tr key={l.accountId} className="border-b border-slate-100 hover:bg-electric/5">
          {/* QuickZoom: drill from the report line into the account register, scoped to the period */}
          <td className="py-2 px-3 pl-8">
            <Link
              href={`/registers/${l.accountId}${rangeQs}`}
              className="text-navy hover:text-electric hover:underline"
              title={`Open ${l.name} register`}
            >
              {l.name}
            </Link>
          </td>
          <td className="py-2 px-3 text-right tabular-nums">
            <Link
              href={`/registers/${l.accountId}${rangeQs}`}
              className="text-navy hover:text-electric hover:underline"
              title={`Open ${l.name} register`}
            >
              {formatCurrency(l.amount)}
            </Link>
          </td>
        </tr>
      ))}
      <tr className="border-t border-navy/20 font-semibold text-navy/80">
        <td className="py-2 px-3">Total {title}</td>
        <td className="py-2 px-3 text-right tabular-nums">{formatCurrency(total)}</td>
      </tr>
    </>
  );
}

export default async function ProfitLossPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const ctx = await getServerContext();
  const params = await searchParams;

  // Default to the company's fiscal year-to-date (settings.fiscalYearEnd, else Jan 1).
  const company = await getCompany(ctx);
  const ytd = ytdRange(company?.settings?.fiscalYearEnd);
  const from = parseParamDate(params.from) ?? ytd.from;
  const to = parseParamDate(params.to) ?? ytd.to;
  const fromStr = toInputDate(from);
  const toStr = toInputDate(to);
  const rangeQs = `?from=${fromStr}&to=${toStr}`;

  const pl = await profitAndLoss(ctx, { from, to });
  const net = Number(pl.netIncome);

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <div className="max-w-3xl">
        <PageHeader
          title="Profit & Loss"
          icon={BarChart2}
          action={
            <span className="text-sm text-navy/60">
              {from.toLocaleDateString('en-US')} – {to.toLocaleDateString('en-US')}
            </span>
          }
        />
      </div>

      {/* Date-range picker (plain GET form — server-rendered page) */}
      <Card className="mb-6 max-w-3xl">
        <form method="get" className="flex items-end gap-3 flex-wrap p-4">
          <div>
            <Label htmlFor="pl-from">From</Label>
            <Input id="pl-from" type="date" name="from" defaultValue={fromStr} />
          </div>
          <div>
            <Label htmlFor="pl-to">To</Label>
            <Input id="pl-to" type="date" name="to" defaultValue={toStr} />
          </div>
          <Button type="submit" variant="secondary" size="sm" className="mb-0.5">
            Run Report
          </Button>
        </form>
      </Card>

      <Card className="p-6 max-w-3xl">
        <table className="w-full border-collapse">
          <tbody>
            <Section title="Income" lines={pl.income} total={pl.totalIncome} rangeQs={rangeQs} />
            <tr>
              <td className="py-2" colSpan={2} />
            </tr>
            <Section title="Expenses" lines={pl.expenses} total={pl.totalExpenses} rangeQs={rangeQs} />
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
      </Card>
    </main>
  );
}
