'use client';

import Link from 'next/link';
import { Truck } from 'lucide-react';
import { formatCurrency } from '@/lib/money';
import SimpleReport from '../_components/SimpleReport';

interface PurchasesByVendorRow {
  vendorId: string;
  vendorName: string;
  totalExpenses: string;
  billCount: number;
}

interface PurchasesByVendorData {
  rows: PurchasesByVendorRow[];
}

export default function PurchasesByVendorPage() {
  return (
    <SimpleReport<PurchasesByVendorData, PurchasesByVendorRow>
      title="Purchases by Vendor"
      icon={Truck}
      csvName="purchases-by-vendor.csv"
      emptyText="No vendor bills in this period."
      controls="range"
      buildUrl={({ from, to }) => `/api/reports/purchases-by-vendor?from=${from}&to=${to}`}
      getRows={(d) => d.rows}
      columns={[
        {
          header: 'Vendor',
          cell: (r) => (
            <Link href="/vendors" className="font-medium text-electric hover:underline" title="Open vendors list">
              {r.vendorName}
            </Link>
          ),
          csv: (r) => r.vendorName,
        },
        {
          header: 'Bills',
          className: 'text-right tabular-nums',
          cell: (r) => r.billCount,
          csv: (r) => r.billCount,
        },
        {
          header: 'Total Purchases',
          className: 'text-right tabular-nums',
          cell: (r) => <span className="font-semibold">{formatCurrency(r.totalExpenses)}</span>,
          csv: (r) => r.totalExpenses,
        },
      ]}
    />
  );
}
