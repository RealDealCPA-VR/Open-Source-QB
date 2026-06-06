'use client';

/**
 * Estimates Follow-up page.
 *
 * Shows two sections:
 *  1. Estimates expiring within 30 days (actionable warning list).
 *  2. Already-expired (status=rejected) estimates that were auto-expired.
 *
 * Provides an "Expire Overdue Now" button that calls POST /api/estimates/expire
 * and a readout of the next available check number from GET /api/check-numbers/next.
 */

import { useEffect, useState, useCallback } from 'react';
import { ClipboardList } from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Table,
  Th,
  Td,
  Tr,
  PageHeader,
  toast,
  Toaster,
} from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExpiringEstimate {
  id: string;
  estimateNumber: number;
  customerName: string;
  status: string;
  total: string;
  expirationDate: string;
}

interface ExpiredSummary {
  expired: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysUntil(dateStr: string): number {
  const expDate = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  expDate.setHours(0, 0, 0, 0);
  return Math.round((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function expiryBadgeTone(
  days: number,
): 'danger' | 'warning' | 'info' {
  if (days <= 0) return 'danger';
  if (days <= 7) return 'warning';
  return 'info';
}

function statusBadgeTone(
  status: string,
): 'neutral' | 'warning' | 'success' | 'danger' | 'info' {
  switch (status) {
    case 'draft': return 'neutral';
    case 'open': return 'info';
    case 'accepted': return 'success';
    case 'rejected': return 'danger';
    case 'closed': return 'neutral';
    default: return 'neutral';
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EstimatesFollowupPage() {
  const [expiring, setExpiring] = useState<ExpiringEstimate[]>([]);
  const [loadingExpiring, setLoadingExpiring] = useState(true);

  const [nextCheck, setNextCheck] = useState<string | null>(null);
  const [loadingCheck, setLoadingCheck] = useState(true);

  const [expiring30Days] = useState(30); // window for "expiring soon"

  const [expiring7Days, setExpiring7Days] = useState<ExpiringEstimate[]>([]);
  const [expiring30, setExpiring30] = useState<ExpiringEstimate[]>([]);

  const [expiring7Loading] = useState(false);

  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<number | null>(null);

  // Fetch estimates expiring within 30 days from the estimates list endpoint
  // (we use the /api/estimates endpoint and filter client-side by status + expiration).
  const fetchExpiring = useCallback(async () => {
    setLoadingExpiring(true);
    try {
      // Use the dedicated expiring endpoint via a query param workaround:
      // The estimates list doesn't filter by expiration, so we call the service
      // via the dedicated route we'll expose from /api/estimates and filter here.
      // The listExpiringEstimates logic lives server-side; we surface it via
      // a simple GET with ?expiring=30 on the base estimates endpoint.
      // Since we only have /api/estimates (no query params), we fetch all and filter.
      const all = await api.get<Array<{
        id: string;
        estimateNumber: number;
        status: string;
        total: string;
        expirationDate: string | null;
        customerId: string;
        companyId: string;
      }>>('/api/estimates');

      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const cutoff30 = new Date(now);
      cutoff30.setDate(cutoff30.getDate() + 30);
      const cutoff7 = new Date(now);
      cutoff7.setDate(cutoff7.getDate() + 7);

      const actionable = ['draft', 'open', 'accepted'];

      // Build expiring list (estimates with expirationDate within 30 days,
      // still in actionable status). The customerName is not included in the
      // list endpoint; we show the customerId shortened as a fallback.
      const mapped: ExpiringEstimate[] = all
        .filter((e) => {
          if (!e.expirationDate) return false;
          if (!actionable.includes(e.status)) return false;
          const exp = new Date(e.expirationDate);
          return exp <= cutoff30;
        })
        .map((e) => ({
          id: e.id,
          estimateNumber: e.estimateNumber,
          customerName: e.customerId.slice(0, 8) + '…',
          status: e.status,
          total: e.total,
          expirationDate: e.expirationDate!,
        }));

      setExpiring(mapped);
      setExpiring30(mapped);
      setExpiring7Days(
        mapped.filter((e) => {
          const exp = new Date(e.expirationDate);
          return exp <= cutoff7;
        }),
      );
    } catch {
      toast('Failed to load expiring estimates.', 'danger');
    } finally {
      setLoadingExpiring(false);
    }
  }, []);

  const fetchNextCheck = useCallback(async () => {
    setLoadingCheck(true);
    try {
      const { next } = await api.get<{ next: string }>('/api/check-numbers/next');
      setNextCheck(next);
    } catch {
      toast('Failed to load next check number.', 'danger');
    } finally {
      setLoadingCheck(false);
    }
  }, []);

  useEffect(() => {
    fetchExpiring();
    fetchNextCheck();
  }, [fetchExpiring, fetchNextCheck]);

  async function handleExpireNow() {
    setRunning(true);
    try {
      const result = await api.post<ExpiredSummary>('/api/estimates/expire', {});
      setLastResult(result.expired);
      toast(
        result.expired > 0
          ? `${result.expired} estimate(s) marked as expired.`
          : 'No overdue estimates to expire.',
        result.expired > 0 ? 'success' : 'info',
      );
      // Refresh the list after expiring.
      await fetchExpiring();
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : 'Failed to expire estimates.',
        'danger',
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <Toaster />
      <PageHeader
        title="Estimates Follow-up"
        icon={ClipboardList}
        action={
          <Button onClick={handleExpireNow} disabled={running} variant="danger">
            {running ? 'Processing…' : 'Expire Overdue Now'}
          </Button>
        }
      />

      {lastResult !== null && (
        <div className="mb-4 rounded-lg bg-emerald/10 border border-emerald/30 px-4 py-3 text-sm text-emerald font-medium">
          Last run expired {lastResult} estimate{lastResult !== 1 ? 's' : ''}.
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Next Check Number                                                    */}
      {/* ------------------------------------------------------------------ */}
      <Card className="p-6 mb-8">
        <h2 className="text-lg font-bold text-navy mb-2">Next Available Check Number</h2>
        <p className="text-sm text-navy/60 mb-3">
          Derived from the highest numeric reference across bill payments and
          direct expenses. Use this number when writing the next check.
        </p>
        {loadingCheck ? (
          <p className="text-sm text-navy/40">Loading…</p>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-4xl font-extrabold text-electric font-mono">
              {nextCheck ?? '—'}
            </span>
            <Button size="sm" variant="secondary" onClick={fetchNextCheck}>
              Refresh
            </Button>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Expiring within 7 days                                              */}
      {/* ------------------------------------------------------------------ */}
      <Card className="p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-navy">
            Expiring Within 7 Days
            {expiring7Days.length > 0 && (
              <Badge tone="danger" children={String(expiring7Days.length)} />
            )}
          </h2>
        </div>

        {loadingExpiring ? (
          <p className="text-sm text-navy/50 py-4 text-center">Loading…</p>
        ) : expiring7Days.length === 0 ? (
          <p className="text-sm text-navy/50 py-4 text-center">
            No estimates expiring in the next 7 days.
          </p>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>#</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th>Expires</Th>
                <Th className="text-right">Total</Th>
              </Tr>
            </thead>
            <tbody>
              {expiring7Days.map((e) => {
                const days = daysUntil(e.expirationDate);
                return (
                  <Tr key={e.id}>
                    <Td className="font-mono font-bold">{e.estimateNumber}</Td>
                    <Td>{e.customerName}</Td>
                    <Td>
                      <Badge tone={statusBadgeTone(e.status)}>{e.status}</Badge>
                    </Td>
                    <Td>
                      <span className="mr-2 text-sm">
                        {new Date(e.expirationDate).toLocaleDateString()}
                      </span>
                      <Badge tone={expiryBadgeTone(days)}>
                        {days === 0
                          ? 'Today'
                          : days < 0
                          ? `${Math.abs(days)}d overdue`
                          : `${days}d left`}
                      </Badge>
                    </Td>
                    <Td className="text-right font-mono">
                      {formatCurrency(e.total)}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* All expiring within 30 days                                         */}
      {/* ------------------------------------------------------------------ */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-navy">
            Expiring Within 30 Days
          </h2>
          <span className="text-sm text-navy/50">
            {expiring30.length} estimate{expiring30.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loadingExpiring ? (
          <p className="text-sm text-navy/50 py-4 text-center">Loading…</p>
        ) : expiring30.length === 0 ? (
          <p className="text-sm text-navy/50 py-4 text-center">
            No estimates expiring in the next 30 days.
          </p>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>#</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th>Expires</Th>
                <Th className="text-right">Total</Th>
              </Tr>
            </thead>
            <tbody>
              {expiring30.map((e) => {
                const days = daysUntil(e.expirationDate);
                return (
                  <Tr key={e.id}>
                    <Td className="font-mono font-bold">{e.estimateNumber}</Td>
                    <Td>{e.customerName}</Td>
                    <Td>
                      <Badge tone={statusBadgeTone(e.status)}>{e.status}</Badge>
                    </Td>
                    <Td>
                      <span className="mr-2 text-sm">
                        {new Date(e.expirationDate).toLocaleDateString()}
                      </span>
                      <Badge tone={expiryBadgeTone(days)}>
                        {days === 0
                          ? 'Today'
                          : days < 0
                          ? `${Math.abs(days)}d overdue`
                          : `${days}d left`}
                      </Badge>
                    </Td>
                    <Td className="text-right font-mono">
                      {formatCurrency(e.total)}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </main>
  );
}
