'use client';

import { useEffect, useState } from 'react';
import { BarChart2 } from 'lucide-react';
import { Button, Card, Badge, Input, Label, PageHeader, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency, Money } from '@/lib/money';

// ---------------------------------------------------------------------------
// Types (must match ClassifiedBalanceSheet from the service)
// ---------------------------------------------------------------------------

interface ClassifiedLine {
  accountId: string;
  code: string;
  name: string;
  subtype: string;
  amount: string;
}

interface ClassifiedSection {
  lines: ClassifiedLine[];
  total: string;
}

interface ClassifiedBalanceSheet {
  currentAssets: ClassifiedSection;
  nonCurrentAssets: ClassifiedSection;
  totalAssets: string;
  currentLiabilities: ClassifiedSection;
  longTermLiabilities: ClassifiedSection;
  totalLiabilities: string;
  equity: ClassifiedLine[];
  retainedEarnings: string;
  totalEquity: string;
  balanced: boolean;
  asOf?: string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionTable({
  label,
  section,
}: {
  label: string;
  section: ClassifiedSection;
}) {
  if (section.lines.length === 0) {
    return (
      <div className="mb-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-navy/40 px-4 py-1">
          {label}
        </div>
        <div className="px-4 py-2 text-sm text-navy/30 italic">None</div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-navy/50 px-4 py-2 bg-slate-50 border-b border-slate-100">
        {label}
      </div>
      {section.lines.map((line) => (
        <div
          key={line.accountId}
          className="flex items-center justify-between px-4 py-2 border-b border-slate-50 hover:bg-electric/5"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-navy/40 tabular-nums text-xs w-12 flex-shrink-0">{line.code}</span>
            <span className="text-navy text-sm truncate">{line.name}</span>
          </div>
          <span className="tabular-nums text-sm text-navy font-medium ml-4 flex-shrink-0">
            {formatCurrency(line.amount)}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/80 border-b border-slate-200">
        <span className="text-sm font-semibold text-navy/70">Total {label}</span>
        <span className="tabular-nums text-sm font-bold text-navy">{formatCurrency(section.total)}</span>
      </div>
    </div>
  );
}

function GroupCard({
  title,
  children,
  total,
  totalLabel,
}: {
  title: string;
  children: React.ReactNode;
  total: string;
  totalLabel: string;
}) {
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="bg-navy/5 px-4 py-3 border-b border-slate-100">
        <h2 className="text-base font-bold text-navy">{title}</h2>
      </div>
      <div className="divide-y divide-slate-50">{children}</div>
      <div className="flex items-center justify-between px-4 py-3 bg-navy/5 border-t-2 border-navy/15">
        <span className="font-bold text-navy">{totalLabel}</span>
        <span className="tabular-nums font-extrabold text-navy text-base">{formatCurrency(total)}</span>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ClassifiedBalanceSheetPage() {
  const [report, setReport] = useState<ClassifiedBalanceSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState('');

  async function fetchReport() {
    setLoading(true);
    try {
      const url = asOf
        ? `/api/reports/balance-sheet-classified?asOf=${encodeURIComponent(asOf)}`
        : '/api/reports/balance-sheet-classified';
      const data = await api.get<ClassifiedBalanceSheet>(url);
      setReport(data);
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : 'Failed to load report',
        'danger',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader title="Classified Balance Sheet" icon={BarChart2} />

      {/* As-of filter */}
      <Card className="p-4 mb-6 max-w-3xl">
        <form
          className="flex items-end gap-3 flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            fetchReport();
          }}
        >
          <div>
            <Label htmlFor="asOf">As of</Label>
            <Input
              id="asOf"
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="w-44"
            />
          </div>
          <Button type="submit" variant="secondary" size="sm" loading={loading} className="mb-0.5">
            Run Report
          </Button>
        </form>
      </Card>

      {/* Balance status + as-of date */}
      {!loading && report && (
        <div className="flex items-center gap-3 mb-6">
          {report.balanced ? (
            <Badge tone="success">In balance</Badge>
          ) : (
            <Badge tone="danger">OUT OF BALANCE</Badge>
          )}
          {report.asOf && (
            <span className="text-sm text-navy/50">
              As of {new Date(report.asOf).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
          )}
        </div>
      )}

      {loading && (
        <Card>
          <div className="p-12 text-center text-navy/40 text-sm">Loading classified balance sheet...</div>
        </Card>
      )}

      {!loading && report && (
        <div className="max-w-3xl">
          {/* Assets */}
          <GroupCard
            title="Assets"
            total={report.totalAssets}
            totalLabel="Total Assets"
          >
            <SectionTable label="Current Assets" section={report.currentAssets} />
            <SectionTable label="Non-Current Assets" section={report.nonCurrentAssets} />
          </GroupCard>

          {/* Liabilities */}
          <GroupCard
            title="Liabilities"
            total={report.totalLiabilities}
            totalLabel="Total Liabilities"
          >
            <SectionTable label="Current Liabilities" section={report.currentLiabilities} />
            <SectionTable label="Long-Term Liabilities" section={report.longTermLiabilities} />
          </GroupCard>

          {/* Equity */}
          <Card className="mb-6 overflow-hidden">
            <div className="bg-navy/5 px-4 py-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-navy">Equity</h2>
            </div>
            {report.equity.length === 0 && (
              <div className="px-4 py-3 text-sm text-navy/30 italic">None</div>
            )}
            {report.equity.map((line) => (
              <div
                key={line.accountId}
                className="flex items-center justify-between px-4 py-2 border-b border-slate-50 hover:bg-electric/5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-navy/40 tabular-nums text-xs w-12 flex-shrink-0">{line.code}</span>
                  <span className="text-navy text-sm truncate">{line.name}</span>
                </div>
                <span className="tabular-nums text-sm text-navy font-medium ml-4 flex-shrink-0">
                  {formatCurrency(line.amount)}
                </span>
              </div>
            ))}
            {/* Retained earnings line */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50/60">
              <span className="text-navy/70 text-sm italic">Retained Earnings (Net Income)</span>
              <span className="tabular-nums text-sm font-medium text-navy">
                {formatCurrency(report.retainedEarnings)}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-3 bg-navy/5 border-t-2 border-navy/15">
              <span className="font-bold text-navy">Total Equity</span>
              <span className="tabular-nums font-extrabold text-navy text-base">
                {formatCurrency(report.totalEquity)}
              </span>
            </div>
          </Card>

          {/* Summary row: Liabilities + Equity */}
          <div className="rounded-2xl bg-navy text-white px-5 py-4 flex items-center justify-between shadow-lg">
            <span className="font-bold">Total Liabilities + Equity</span>
            <span className="tabular-nums text-lg font-extrabold">
              {formatCurrency(Money.add(report.totalLiabilities, report.totalEquity))}
            </span>
          </div>
        </div>
      )}
    </main>
  );
}
