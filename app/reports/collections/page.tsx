'use client';

/**
 * Collections Report — overdue invoices grouped by customer, with contact
 * details (email / phone) so the user can chase payment. CSV export included.
 */
import { useCallback, useEffect, useState } from 'react';
import { PhoneCall } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, Spinner, Table, Th, Td, Tr, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';
import { downloadCsv, fmtDate, type CsvCell } from '../_components/shared';

interface CollectionsInvoice {
  invoiceId: string;
  invoiceNumber: number;
  date: string;
  dueDate: string | null;
  daysOverdue: number;
  balanceDue: string;
}

interface CollectionsCustomer {
  customerId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  totalDue: string;
  invoices: CollectionsInvoice[];
}

interface CollectionsData {
  asOf: string;
  customers: CollectionsCustomer[];
  totalDue: string;
}

export default function CollectionsPage() {
  const [data, setData] = useState<CollectionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<CollectionsData>('/api/reports/collections'));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load collections report.';
      setError(msg);
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = () => {
    if (!data) return;
    const rows: CsvCell[][] = [];
    for (const c of data.customers) {
      for (const inv of c.invoices) {
        rows.push([
          c.customerName,
          c.email ?? '',
          c.phone ?? '',
          `Invoice #${inv.invoiceNumber}`,
          fmtDate(inv.date),
          fmtDate(inv.dueDate),
          inv.daysOverdue,
          inv.balanceDue,
        ]);
      }
      rows.push([`${c.customerName} TOTAL`, '', '', '', '', '', '', c.totalDue]);
    }
    rows.push(['TOTAL DUE', '', '', '', '', '', '', data.totalDue]);
    downloadCsv(
      'collections.csv',
      `Collections Report — As of ${fmtDate(data.asOf)}`,
      ['Customer', 'Email', 'Phone', 'Invoice', 'Date', 'Due Date', 'Days Overdue', 'Balance Due'],
      rows,
    );
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Collections Report"
        icon={PhoneCall}
        action={
          <div className="flex items-center gap-3">
            {data && <span className="text-sm text-navy/60">As of {fmtDate(data.asOf)}</span>}
            <Button variant="secondary" size="sm" disabled={!data || loading} onClick={exportCsv}>
              Download CSV
            </Button>
          </div>
        }
      />

      {loading && (
        <Card className="flex items-center justify-center gap-2 py-16 text-navy/50 text-sm">
          <Spinner className="text-electric" />
          Loading…
        </Card>
      )}

      {!loading && error && (
        <Card className="flex flex-col items-center justify-center py-16 gap-4">
          <p className="text-red-600 text-sm">{error}</p>
          <Button variant="secondary" size="sm" onClick={load}>
            Retry
          </Button>
        </Card>
      )}

      {!loading && !error && data && data.customers.length === 0 && (
        <Card>
          <EmptyState
            icon={PhoneCall}
            title="Nothing overdue"
            message="No collections calls needed."
          />
        </Card>
      )}

      {!loading && !error && data && data.customers.length > 0 && (
        <div className="space-y-4">
          {data.customers.map((c) => (
            <Card key={c.customerId} className="p-0 overflow-hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-2 bg-navy/5 px-4 py-3">
                <div>
                  <span className="font-bold text-navy">{c.customerName}</span>
                  <span className="ml-3 text-sm text-navy/60">
                    {c.email ?? 'no email'} · {c.phone ?? 'no phone'}
                  </span>
                </div>
                <span className="font-bold text-red-600 tabular-nums">
                  {formatCurrency(c.totalDue)} overdue
                </span>
              </div>
              <Table>
                <thead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Date</Th>
                    <Th>Due Date</Th>
                    <Th className="text-right">Days Overdue</Th>
                    <Th className="text-right">Balance Due</Th>
                  </tr>
                </thead>
                <tbody>
                  {c.invoices.map((inv) => (
                    <Tr key={inv.invoiceId}>
                      <Td>Invoice #{inv.invoiceNumber}</Td>
                      <Td>{fmtDate(inv.date)}</Td>
                      <Td>{fmtDate(inv.dueDate)}</Td>
                      <Td className="text-right tabular-nums text-red-600 font-semibold">
                        {inv.daysOverdue}
                      </Td>
                      <Td className="text-right tabular-nums font-semibold">
                        {formatCurrency(inv.balanceDue)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
          <Card className="flex items-center justify-between px-4 py-3 font-bold text-navy">
            <span>Total Due for Collection</span>
            <span className="tabular-nums text-red-600">{formatCurrency(data.totalDue)}</span>
          </Card>
        </div>
      )}
    </main>
  );
}
