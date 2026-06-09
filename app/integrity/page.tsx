'use client';

import { useEffect, useState } from 'react';
import { Hammer, RefreshCw, ShieldAlert, ShieldCheck, Wrench } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, PageHeader, Spinner, Table, Td, Th, Tr, toast } from '@/components/ui';
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

type RebuildAction =
  | 'account_balances'
  | 'document_balances'
  | 'item_quantities'
  | 'orphaned_audit_refs';

interface RebuildActionInfo {
  action: RebuildAction;
  title: string;
  description: string;
}

interface RebuildFix {
  id: string;
  label: string;
  current: string;
  expected: string;
}

interface RebuildPreview {
  action: RebuildAction;
  fixes: RebuildFix[];
  count: number;
}

interface RebuildResult {
  action: RebuildAction;
  fixed: number;
  fixes: RebuildFix[];
}

/** Which rebuild action repairs which failed check (best match). */
const CHECK_TO_ACTION: Record<string, RebuildAction> = {
  'Cached account balances match GL': 'account_balances',
  'A/R control account (1200) matches open invoices': 'document_balances',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IntegrityPage() {
  const [result, setResult] = useState<IntegrityResult | null>(null);
  const [loading, setLoading] = useState(true);

  // ---- Rebuild state ----
  const [actions, setActions] = useState<RebuildActionInfo[]>([]);
  const [previews, setPreviews] = useState<Partial<Record<RebuildAction, RebuildPreview>>>({});
  const [busyAction, setBusyAction] = useState<RebuildAction | null>(null);
  // Rebuild posts a data-mutating repair — always confirm first.
  const [pendingRebuild, setPendingRebuild] = useState<RebuildAction | null>(null);

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

  async function loadActions() {
    try {
      const data = await api.get<{ actions: RebuildActionInfo[] }>('/api/import/rebuild');
      setActions(data.actions);
    } catch {
      /* rebuild list is supplementary; checks still render */
    }
  }

  useEffect(() => {
    runChecks();
    loadActions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePreview(action: RebuildAction) {
    setBusyAction(action);
    try {
      const preview = await api.get<RebuildPreview>(`/api/import/rebuild?action=${action}`);
      setPreviews((prev) => ({ ...prev, [action]: preview }));
      if (preview.count === 0) toast('Nothing to rebuild — no drift found.', 'info');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Preview failed', 'danger');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRebuild(action: RebuildAction) {
    setBusyAction(action);
    try {
      const res = await api.post<RebuildResult>('/api/import/rebuild', { action });
      toast(
        res.fixed === 0
          ? 'Nothing to rebuild — data already consistent.'
          : `Rebuilt ${res.fixed} record${res.fixed === 1 ? '' : 's'}.`,
        'success',
      );
      // Refresh the preview (should now be empty) and re-run the checks.
      setPreviews((prev) => ({ ...prev, [action]: { action, fixes: [], count: 0 } }));
      setPendingRebuild(null);
      await runChecks();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Rebuild failed', 'danger');
      setPendingRebuild(null);
    } finally {
      setBusyAction(null);
    }
  }

  const pendingInfo = pendingRebuild ? actions.find((a) => a.action === pendingRebuild) : undefined;
  const pendingPreview = pendingRebuild ? previews[pendingRebuild] : undefined;

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
              } failed. Review the details below — most drifts can be repaired with Rebuild Data.`}
        </div>
      )}

      <Card className="divide-y divide-slate-100">
        {loading && (
          <div className="flex items-center justify-center gap-2 p-12 text-navy/40 text-sm">
            <Spinner className="h-4 w-4" /> Running integrity checks...
          </div>
        )}

        {!loading && result && result.checks.length === 0 && (
          <div className="p-12 text-center text-navy/40 text-sm">No checks returned.</div>
        )}

        {!loading &&
          result?.checks.map((check, i) => {
            const repairAction = !check.ok ? CHECK_TO_ACTION[check.name] : undefined;
            return (
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
                  {repairAction && (
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyAction !== null}
                        onClick={() => handlePreview(repairAction)}
                      >
                        <Wrench className="h-3.5 w-3.5" />
                        Preview Rebuild
                      </Button>
                      <Button
                        size="sm"
                        disabled={busyAction !== null}
                        onClick={() => setPendingRebuild(repairAction)}
                      >
                        <Hammer className="h-3.5 w-3.5" />
                        Rebuild
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
      </Card>

      {/* ---- Rebuild Data utility ---- */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-3">
          <Hammer className="h-5 w-5 text-navy/70" />
          <h2 className="text-lg font-bold text-navy">Rebuild Data</h2>
        </div>
        <p className="text-sm text-navy/60 mb-4 max-w-3xl">
          QuickBooks-style Verify/Rebuild: each repair recomputes a cached value from its source
          of truth. Preview shows exactly what would change (dry run); Rebuild applies it. Every
          repair is idempotent and recorded in the audit trail.
        </p>

        <div className="flex flex-col gap-4">
          {actions.map((a) => {
            const preview = previews[a.action];
            const busy = busyAction === a.action;
            return (
              <Card key={a.action} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-navy text-sm">{a.title}</span>
                      {preview && (
                        <Badge tone={preview.count === 0 ? 'success' : 'warning'}>
                          {preview.count === 0 ? 'No drift' : `${preview.count} to fix`}
                        </Badge>
                      )}
                    </div>
                    <p className="text-navy/60 text-sm mt-1">{a.description}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy}
                      disabled={busyAction !== null && !busy}
                      onClick={() => handlePreview(a.action)}
                    >
                      Preview
                    </Button>
                    <Button
                      size="sm"
                      disabled={busyAction !== null || (preview ? preview.count === 0 : false)}
                      onClick={() => setPendingRebuild(a.action)}
                    >
                      Rebuild
                    </Button>
                  </div>
                </div>

                {/* Dry-run preview table */}
                {preview && preview.count > 0 && (
                  <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-slate-100">
                    <Table>
                      <thead>
                        <tr>
                          <Th>Record</Th>
                          <Th>Current</Th>
                          <Th>After rebuild</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.fixes.map((f) => (
                          <Tr key={f.id}>
                            <Td className="font-medium">{f.label}</Td>
                            <Td className="font-mono text-xs text-red-600">{f.current}</Td>
                            <Td className="font-mono text-xs text-emerald">{f.expected}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* Rebuild confirmation */}
      <ConfirmDialog
        open={!!pendingRebuild}
        title={pendingInfo ? `${pendingInfo.title}?` : 'Rebuild data?'}
        message={
          pendingPreview && pendingPreview.count > 0
            ? `This recomputes ${pendingPreview.count} record${pendingPreview.count === 1 ? '' : 's'} from the source of truth and is recorded in the audit trail.`
            : 'This recomputes the affected records from the source of truth and is recorded in the audit trail. Tip: run Preview first to see exactly what would change.'
        }
        confirmLabel="Rebuild"
        loading={!!pendingRebuild && busyAction === pendingRebuild}
        onConfirm={() => pendingRebuild && handleRebuild(pendingRebuild)}
        onClose={() => setPendingRebuild(null)}
      />
    </main>
  );
}
