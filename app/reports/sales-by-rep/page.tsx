'use client';

/**
 * Sales by Rep — per-rep sales totals (and earned commission) for a period.
 * Backed by the existing commissionReport service via /api/reports/commissions.
 */
import { Users } from 'lucide-react';
import { formatCurrency } from '@/lib/money';
import SimpleReport from '../_components/SimpleReport';
import { type CsvCell } from '../_components/shared';

interface CommissionRow {
  repId: string;
  name: string;
  salesTotal: string;
  commissionRate: string;
  commission: string;
}

interface CommissionData {
  rows: CommissionRow[];
  totals: { salesTotal: string; commission: string };
}

export default function SalesByRepPage() {
  return (
    <SimpleReport<CommissionData, CommissionRow>
      title="Sales by Rep"
      icon={Users}
      csvName="sales-by-rep.csv"
      emptyText="No rep-assigned sales in this period."
      controls="range"
      buildUrl={({ from, to }) => `/api/reports/commissions?from=${from}&to=${to}`}
      getRows={(d) => d.rows}
      columns={[
        { header: 'Sales Rep', cell: (r) => <span className="font-medium">{r.name}</span>, csv: (r) => r.name },
        {
          header: 'Total Sales',
          className: 'text-right tabular-nums',
          cell: (r) => <span className="font-semibold">{formatCurrency(r.salesTotal)}</span>,
          csv: (r) => r.salesTotal,
        },
        {
          header: 'Commission Rate',
          className: 'text-right tabular-nums',
          cell: (r) => `${(parseFloat(r.commissionRate) * 100).toFixed(2)}%`,
          csv: (r) => r.commissionRate,
        },
        {
          header: 'Commission',
          className: 'text-right tabular-nums',
          cell: (r) => formatCurrency(r.commission),
          csv: (r) => r.commission,
        },
      ]}
      footerRows={(d) => [
        {
          cells: ['TOTAL', formatCurrency(d.totals.salesTotal), '', formatCurrency(d.totals.commission)] as CsvCell[],
          emphasized: true,
        },
      ]}
    />
  );
}
