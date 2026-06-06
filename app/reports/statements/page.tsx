'use client';

import { useEffect, useState, useCallback } from 'react';
import { FileText, Printer, Download } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Label,
  Select,
  Table,
  Th,
  Td,
  Tr,
  PageHeader,
  Badge,
  toast,
  Toaster,
} from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Customer {
  id: string;
  displayName: string;
}

interface StatementLine {
  date: string;
  type: 'invoice' | 'payment';
  ref: string | null;
  amount: string;
  runningBalance: string;
}

interface CustomerStatement {
  customer: {
    id: string;
    displayName: string;
    companyName: string | null;
    email: string | null;
  };
  from: string | null;
  to: string | null;
  openingBalance: string;
  lines: StatementLine[];
  closingBalance: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CustomerStatementsPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);

  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [statement, setStatement] = useState<CustomerStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load customer list for the picker
  useEffect(() => {
    setCustomersLoading(true);
    api
      .get<Customer[]>('/api/customers')
      .then(setCustomers)
      .catch((err) =>
        toast(err instanceof ApiError ? err.message : 'Failed to load customers', 'danger'),
      )
      .finally(() => setCustomersLoading(false));
  }, []);

  const loadStatement = useCallback(async () => {
    if (!selectedCustomerId) {
      toast('Please select a customer.', 'danger');
      return;
    }
    setLoading(true);
    setError(null);
    setStatement(null);
    try {
      const params = new URLSearchParams({ customerId: selectedCustomerId });
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const data = await api.get<CustomerStatement>(`/api/reports/customer-statement?${params}`);
      setStatement(data);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load statement.';
      setError(msg);
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, [selectedCustomerId, fromDate, toDate]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const headerLabel = statement
    ? [
        statement.from ? `From: ${fmtDate(statement.from)}` : null,
        statement.to ? `To: ${fmtDate(statement.to)}` : null,
      ]
        .filter(Boolean)
        .join('  |  ') || 'All Dates'
    : '';

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <Toaster />

      <PageHeader
        title="Customer Statement"
        icon={FileText}
        action={
          statement && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const params = new URLSearchParams({ customerId: selectedCustomerId });
                  if (fromDate) params.set('from', fromDate);
                  if (toDate) params.set('to', toDate);
                  window.open(`/api/reports/customer-statement/pdf?${params}`, '_blank');
                }}
              >
                <Download className="h-4 w-4" />
                PDF
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.print()}
              >
                <Printer className="h-4 w-4" />
                Print
              </Button>
            </div>
          )
        }
      />

      {/* ---- Filter bar ---- */}
      <Card className="mb-6 print:hidden">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="customer">Customer</Label>
            <Select
              id="customer"
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              disabled={customersLoading}
            >
              <option value="">
                {customersLoading ? 'Loading…' : '— Select a customer —'}
              </option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="from">From Date</Label>
            <Input
              id="from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="to">To Date</Label>
            <Input
              id="to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>

          <Button onClick={loadStatement} disabled={loading || !selectedCustomerId}>
            {loading ? 'Loading…' : 'View Statement'}
          </Button>
        </div>
      </Card>

      {/* ---- Statement ---- */}
      {!statement && !loading && !error && (
        <Card>
          <div className="flex flex-col items-center justify-center py-16 text-navy/40 text-sm gap-2">
            <FileText className="h-10 w-10 opacity-30" />
            <p>Select a customer and click View Statement.</p>
          </div>
        </Card>
      )}

      {loading && (
        <Card>
          <div className="flex items-center justify-center py-16 text-navy/50 text-sm">
            Loading…
          </div>
        </Card>
      )}

      {!loading && error && (
        <Card>
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <p className="text-red-600 text-sm">{error}</p>
            <Button variant="secondary" size="sm" onClick={loadStatement}>
              Retry
            </Button>
          </div>
        </Card>
      )}

      {statement && !loading && (
        <>
          {/* Customer header */}
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-navy">{statement.customer.displayName}</h2>
              {statement.customer.companyName && (
                <p className="text-sm text-navy/60">{statement.customer.companyName}</p>
              )}
              {statement.customer.email && (
                <p className="text-sm text-navy/60">{statement.customer.email}</p>
              )}
            </div>
            <div className="text-right text-sm text-navy/60">
              {headerLabel && <p>{headerLabel}</p>}
              <p className="mt-1 text-base font-semibold text-navy">
                Balance Due:{' '}
                <span className="tabular-nums">{formatCurrency(statement.closingBalance)}</span>
              </p>
            </div>
          </div>

          <Card className="p-0 overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Type</Th>
                  <Th>Reference</Th>
                  <Th className="text-right">Charges</Th>
                  <Th className="text-right">Credits</Th>
                  <Th className="text-right">Balance</Th>
                </tr>
              </thead>
              <tbody>
                {/* Opening balance row */}
                {statement.from && (
                  <tr className="bg-slate-50 text-navy/60 text-sm">
                    <Td colSpan={5} className="italic">
                      Opening balance — {fmtDate(statement.from)}
                    </Td>
                    <Td className="text-right tabular-nums font-semibold">
                      {formatCurrency(statement.openingBalance)}
                    </Td>
                  </tr>
                )}

                {statement.lines.length === 0 ? (
                  <tr>
                    <Td colSpan={6} className="py-12 text-center text-navy/40">
                      No activity in this period.
                    </Td>
                  </tr>
                ) : (
                  statement.lines.map((line, idx) => (
                    <Tr key={idx}>
                      <Td className="tabular-nums">{fmtDate(line.date)}</Td>
                      <Td>
                        {line.type === 'invoice' ? (
                          <Badge tone="warning">Invoice</Badge>
                        ) : (
                          <Badge tone="success">Payment</Badge>
                        )}
                      </Td>
                      <Td className="text-navy/70">
                        {line.type === 'invoice' && line.ref ? `#${line.ref}` : (line.ref ?? '—')}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {line.type === 'invoice' ? formatCurrency(line.amount) : ''}
                      </Td>
                      <Td className="text-right tabular-nums text-emerald-700">
                        {line.type === 'payment' ? formatCurrency(line.amount) : ''}
                      </Td>
                      <Td className="text-right tabular-nums font-semibold">
                        {formatCurrency(line.runningBalance)}
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-navy/20 bg-navy/5 font-bold text-navy">
                  <td colSpan={5} className="py-3 px-4">
                    Closing Balance
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {formatCurrency(statement.closingBalance)}
                  </td>
                </tr>
              </tfoot>
            </Table>
          </Card>
        </>
      )}
    </main>
  );
}
