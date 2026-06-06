'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, RefreshCw } from 'lucide-react';
import { Button, Card, Badge, PageHeader, Toaster, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IntegrityCheck {
  name: string;
  ok: boolean;
  detail: string;
}

interface IntegrityResult {
  checks: IntegrityCheck[];
  allOk: boolean;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IntegrityPage() {
  const [result, setResult] = useState<IntegrityResult | null>(null);
  const [loading, setLoading] = useState(true);

  async function runChecks() {
    setLoading(true);
    try {
      const data = await api.get<IntegrityResult>('/api/integrity');
      setResult(data);
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : 'Failed to run integrity checks',
        'danger',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allOk = result?.allOk ?? false;

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Data Integrity"
        icon={allOk ? ShieldCheck : ShieldAlert}
        action={
          <Button onClick={runChecks} disabled={loading} variant="secondary">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Running...' : 'Re-run Checks'}
          </Button>
        }
      />

      {/* Overall status banner */}
      {!loading && result && (
        <div
          className={`mb-6 rounded-xl px-5 py-4 flex items-center gap-3 font-semibold text-sm ${
            allOk
              ? 'bg-emerald/10 text-emerald border border-emerald/20'
              : 'bg-red-50 text-red-600 border border-red-200'
          }`}
        >
          {allOk ? (
            <ShieldCheck className="h-5 w-5 flex-shrink-0" />
          ) : (
            <ShieldAlert className="h-5 w-5 flex-shrink-0" />
          )}
          {allOk
            ? 'All integrity checks passed. Your books are consistent.'
            : `${result.checks.filter((c) => !c.ok).length} check${
                result.checks.filter((c) => !c.ok).length === 1 ? '' : 's'
              } failed. Review the details below.`}
        </div>
      )}

      <Card className="divide-y divide-slate-100">
        {loading && (
          <div className="p-12 text-center text-navy/40 text-sm">Running integrity checks...</div>
        )}

        {!loading && result && result.checks.length === 0 && (
          <div className="p-12 text-center text-navy/40 text-sm">No checks returned.</div>
        )}

        {!loading &&
          result?.checks.map((check, i) => (
            <div key={i} className="flex items-start gap-4 p-5">
              {/* Status icon */}
              <div className="mt-0.5 flex-shrink-0">
                {check.ok ? (
                  <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-emerald/15">
                    <ShieldCheck className="h-4 w-4 text-emerald" />
                  </span>
                ) : (
                  <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-red-100">
                    <ShieldAlert className="h-4 w-4 text-red-500" />
                  </span>
                )}
              </div>

              {/* Check details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-navy text-sm">{check.name}</span>
                  {check.ok ? (
                    <Badge tone="success">Pass</Badge>
                  ) : (
                    <Badge tone="danger">Fail</Badge>
                  )}
                </div>
                <p className="text-navy/60 text-sm leading-relaxed">{check.detail}</p>
              </div>
            </div>
          ))}
      </Card>

      <Toaster />
    </main>
  );
}
