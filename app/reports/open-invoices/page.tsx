'use client';

import Link from 'next/link';
import { FileText } from 'lucide-react';
import { formatCurrency } from '@/lib/money';
import SimpleReport from '../_components/SimpleReport';
import { fmtDate, type CsvCell } from '../_components/shared';

interface OpenInvoiceRow {
  invoiceId: string;
  invoiceNumber: number;
  customerId: string;
  customerName: string;
  date: string;
  dueDate: string | null;
  terms: string | null;
  daysOverdue: number;
  total: string;
  balanceDue: string;
}

interface OpenInvoicesData {
  asOf: string;
  rows: OpenInvoiceRow[];
  totalOpen: string;
}

export default function OpenInvoicesPage() {
  return (
    <SimpleReport<OpenInvoicesData, OpenInvoiceRow>
      title="Open Invoices"
      icon={FileText}
      csvName="open-invoices.csv"
      emptyText="No open invoices — everything is paid."
      controls="none"
      buildUrl={() => '/api/reports/open-invoices'}
      getRows={(d) => d.rows}
      subtitle={(d) => `As of ${fmtDate(d.asOf)}`}
      columns={[
        {
          header: 'Customer',
          cell: (r) => <span className="font-medium">{r.customerName}</span>,
          csv: (r) => r.customerName,
        },
        {
          header: 'Invoice #',
          cell: (r) => (
            <Link href="/invoices" className="text-electric hover:underline" title="Open invoices list">
              {r.invoiceNumber}
            </Link>
          ),
          csv: (r) => r.invoiceNumber,
        },
        { header: 'Date', cell: (r) => fmtDate(r.date), csv: (r) => fmtDate(r.date) },
        { header: 'Due Date', cell: (r) => fmtDate(r.dueDate), csv: (r) => fmtDate(r.dueDate) },
        { header: 'Terms', cell: (r) => r.terms ?? '—', csv: (r) => r.terms ?? '' },
        {
          header: 'Days Overdue',
          className: 'text-right tabular-nums',
          cell: (r) =>
            r.daysOverdue > 0 ? <span className="text-red-600 font-semibold">{r.daysOverdue}</span> : '—',
          csv: (r) => r.daysOverdue,
        },
        {
          header: 'Total',
          className: 'text-right tabular-nums',
          cell: (r) => formatCurrency(r.total),
          csv: (r) => r.total,
        },
        {
          header: 'Balance Due',
          className: 'text-right tabular-nums',
          cell: (r) => <span className="font-semibold">{formatCurrency(r.balanceDue)}</span>,
          csv: (r) => r.balanceDue,
        },
      ]}
      footerRows={(d) => [
        {
          cells: ['TOTAL', '', '', '', '', '', '', formatCurrency(d.totalOpen)] as CsvCell[],
          emphasized: true,
        },
      ]}
    />
  );
}
