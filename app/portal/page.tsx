'use client';
import { useEffect, useState } from 'react';
import { UserSquare, Download, LogOut } from 'lucide-react';
import { Button, Card, Badge } from '@/components/ui';
import { api } from '@/lib/client';
import { formatCurrency } from '@/lib/money';
import { formatDate } from '@/lib/utils';

interface Paycheck {
  id: string;
  payDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  grossPay: string;
  netPay: string;
}
interface Me {
  employee: { id: string; name: string; email: string | null; payType: string };
  paychecks: Paycheck[];
}

export default function PortalPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Me>('/api/portal/me')
      .then(setMe)
      .catch(() => {
        window.location.href = '/portal/login';
      })
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    try {
      await fetch('/api/portal/logout', { method: 'POST' });
    } finally {
      window.location.href = '/portal/login';
    }
  }

  if (loading) return <main className="min-h-screen grid place-items-center text-navy/40">Loading…</main>;
  if (!me) return null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <div className="flex items-center justify-between mb-8 max-w-3xl">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald h-12 w-12 flex items-center justify-center">
            <UserSquare className="text-white h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-navy">{me.employee.name}</h1>
            <p className="text-sm text-navy/50">{me.employee.email}</p>
          </div>
        </div>
        <Button variant="ghost" onClick={logout}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>

      <Card className="p-6 max-w-3xl">
        <h2 className="text-lg font-bold text-navy mb-4">My Pay Stubs</h2>
        {me.paychecks.length === 0 ? (
          <p className="text-navy/40">No paychecks yet.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-navy/10 text-navy/70 text-sm">
                <th className="py-2 px-3 text-left font-semibold">Pay Date</th>
                <th className="py-2 px-3 text-left font-semibold">Period</th>
                <th className="py-2 px-3 text-right font-semibold">Gross</th>
                <th className="py-2 px-3 text-right font-semibold">Net</th>
                <th className="py-2 px-3 text-right font-semibold">Stub</th>
              </tr>
            </thead>
            <tbody>
              {me.paychecks.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-emerald/5">
                  <td className="py-2 px-3 text-navy whitespace-nowrap">{formatDate(p.payDate)}</td>
                  <td className="py-2 px-3 text-navy/60 text-sm">
                    {p.periodStart ? `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` : '—'}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatCurrency(p.grossPay)}</td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold text-emerald">
                    {formatCurrency(p.netPay)}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button
                      onClick={() => window.open(`/api/payroll/paystub?paycheckId=${p.id}`, '_blank')}
                      className="text-electric hover:underline inline-flex items-center gap-1 text-sm"
                    >
                      <Download className="h-3.5 w-3.5" /> PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-4">
          <Badge tone="info">Read-only employee view</Badge>
        </div>
      </Card>
    </main>
  );
}
