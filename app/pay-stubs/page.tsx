'use client';

import { useEffect, useState, useCallback } from 'react';
import { FileText, Download } from 'lucide-react';
import {
  Card,
  Table,
  Th,
  Td,
  Tr,
  Badge,
  PageHeader,
  toast,
} from '@/components/ui';
import { api } from '@/lib/client';
import { formatCurrency } from '@/lib/money';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Paycheck {
  id: string;
  employeeId: string;
  payDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  grossPay: string;
  totalTaxes: string;
  totalDeductions: string;
  netPay: string;
  postedEntryId: string | null;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  return value.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Pay Stubs Page
// ---------------------------------------------------------------------------

export default function PayStubsPage() {
  const [paychecks, setPaychecks] = useState<Paycheck[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const employeeMap = Object.fromEntries(
    employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`]),
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [paycheckList, employeeList] = await Promise.all([
        api.get<Paycheck[]>('/api/payroll'),
        api.get<Employee[]>('/api/employees'),
      ]);
      setPaychecks(paycheckList);
      setEmployees(employeeList);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load pay stubs.';
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function openPaystubPdf(paycheckId: string) {
    window.open(`/api/payroll/paystub?paycheckId=${encodeURIComponent(paycheckId)}`, '_blank');
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader title="Pay Stubs" icon={FileText} />

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-navy/40 text-sm">
            Loading pay stubs…
          </div>
        ) : paychecks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-navy/40">
            <FileText className="h-10 w-10 opacity-30" />
            <p className="text-sm">No paychecks yet. Run a payroll to get started.</p>
          </div>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Employee</Th>
                <Th>Pay Date</Th>
                <Th>Period</Th>
                <Th className="text-right">Gross Pay</Th>
                <Th className="text-right">Taxes</Th>
                <Th className="text-right">Deductions</Th>
                <Th className="text-right">Net Pay</Th>
                <Th>GL Posted</Th>
                <Th className="text-right">Pay Stub</Th>
              </Tr>
            </thead>
            <tbody>
              {paychecks.map((pc) => (
                <Tr key={pc.id}>
                  <Td className="font-semibold text-navy">
                    {employeeMap[pc.employeeId] ?? pc.employeeId.slice(0, 8)}
                  </Td>
                  <Td className="text-navy/70">{fmtDate(pc.payDate)}</Td>
                  <Td className="text-navy/60 text-sm">
                    {pc.periodStart && pc.periodEnd
                      ? `${fmtDate(pc.periodStart)} – ${fmtDate(pc.periodEnd)}`
                      : '—'}
                  </Td>
                  <Td className="text-right tabular-nums font-medium">
                    {formatCurrency(pc.grossPay)}
                  </Td>
                  <Td className="text-right tabular-nums text-navy/70">
                    {formatCurrency(pc.totalTaxes)}
                  </Td>
                  <Td className="text-right tabular-nums text-navy/70">
                    {formatCurrency(pc.totalDeductions)}
                  </Td>
                  <Td className="text-right tabular-nums font-semibold text-green-700">
                    {formatCurrency(pc.netPay)}
                  </Td>
                  <Td>
                    {pc.postedEntryId ? (
                      <Badge tone="success">Posted</Badge>
                    ) : (
                      <Badge tone="neutral">Pending</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <button
                      onClick={() => openPaystubPdf(pc.id)}
                      className="inline-flex items-center gap-1 text-xs text-navy/40 hover:text-electric transition-colors font-medium"
                      title="View Pay Stub PDF"
                    >
                      <Download className="h-3.5 w-3.5" /> Pay Stub PDF
                    </button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Summary footer */}
      {paychecks.length > 0 && !loading && (
        <div className="mt-4 flex gap-6 text-sm text-navy/50">
          <span>
            {paychecks.length} paycheck{paychecks.length !== 1 ? 's' : ''}
          </span>
          <span>
            Total gross:{' '}
            <span className="font-semibold text-navy/70">
              {formatCurrency(
                paychecks
                  .reduce((s, p) => s + Number(p.grossPay), 0)
                  .toFixed(2),
              )}
            </span>
          </span>
          <span>
            Total net:{' '}
            <span className="font-semibold text-navy/70">
              {formatCurrency(
                paychecks
                  .reduce((s, p) => s + Number(p.netPay), 0)
                  .toFixed(2),
              )}
            </span>
          </span>
        </div>
      )}
    </main>
  );
}
