'use client';
/**
 * EntryDetailModal — QuickZoom journal-entry detail view.
 *
 * Given a journalEntryId, fetches GET /api/journal-entries/<id> and shows the
 * entry header (number, date, status, reference, description), its lines
 * (account, memo, debit, credit) with totals, the void status, and — when the
 * entry's sourceRef maps to a known document type — a link to the source page.
 *
 * Also exports `sourceRefLink`, the shared sourceRef → route mapping used by
 * register/report rows to decide between "open source document" and "open this
 * modal".
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Badge, Button, Modal, Table, Th, Td, Tr } from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';

// ---------------------------------------------------------------------------
// sourceRef → route mapping (QuickZoom to the source document)
// ---------------------------------------------------------------------------

const SOURCE_ROUTES: Record<string, { href: string; label: string }> = {
  invoice: { href: '/invoices', label: 'Invoice' },
  bill: { href: '/bills', label: 'Bill' },
  deposit: { href: '/deposits', label: 'Deposit' },
  expense: { href: '/expense-reports', label: 'Expense' },
  expense_report: { href: '/expense-reports', label: 'Expense Report' },
  credit_memo: { href: '/credit-memos', label: 'Credit Memo' },
  vendor_credit: { href: '/vendor-credits', label: 'Vendor Credit' },
  salesreceipt: { href: '/sales-receipts', label: 'Sales Receipt' },
  sales_receipt: { href: '/sales-receipts', label: 'Sales Receipt' },
  paycheck: { href: '/pay-stubs', label: 'Paycheck' },
  bank_transaction: { href: '/bank-review', label: 'Bank Transaction' },
  item: { href: '/items', label: 'Item Adjustment' },
  fixed_asset: { href: '/fixed-assets', label: 'Fixed Asset' },
  customer: { href: '/payments', label: 'Payment Received' },
  vendor: { href: '/bills', label: 'Bill Payment' },
  account: { href: '/accounts', label: 'Account Opening Balance' },
  transfer: { href: '/transfers', label: 'Transfer' },
};

/**
 * Map a journal entry sourceRef (e.g. "invoice:<id>") to the page that hosts the
 * source document. Returns null for manual/unknown refs — callers should open
 * the journal-entry detail modal instead.
 */
export function sourceRefLink(
  sourceRef: string | null | undefined,
): { href: string; label: string } | null {
  if (!sourceRef || sourceRef === 'manual') return null;
  const prefix = sourceRef.split(':')[0];
  return SOURCE_ROUTES[prefix] ?? null;
}

// ---------------------------------------------------------------------------
// Types (mirror GET /api/journal-entries/[id])
// ---------------------------------------------------------------------------

interface EntryLine {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: string | null;
  credit: string | null;
  memo: string | null;
  classId: string | null;
  className: string | null;
}

interface EntryDetail {
  id: string;
  entryNumber: number;
  date: string;
  description: string;
  reference: string | null;
  status: string;
  sourceRef: string | null;
  createdAt: string;
  voidedAt: string | null;
  lines: EntryLine[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function statusTone(status: string): 'success' | 'void' | 'neutral' {
  if (status === 'posted') return 'success';
  if (status === 'void') return 'void';
  return 'neutral';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export interface EntryDetailModalProps {
  /** Journal entry to show; null hides the modal. */
  entryId: string | null;
  onClose: () => void;
}

export default function EntryDetailModal({ entryId, onClose }: EntryDetailModalProps) {
  const [entry, setEntry] = useState<EntryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entryId) {
      setEntry(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntry(null);
    api
      .get<{ entry: EntryDetail }>(`/api/journal-entries/${entryId}`)
      .then((data) => {
        if (!cancelled) setEntry(data.entry);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load journal entry.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const totalDebit = (entry?.lines ?? []).reduce((acc, l) => acc + Number(l.debit ?? 0), 0);
  const totalCredit = (entry?.lines ?? []).reduce((acc, l) => acc + Number(l.credit ?? 0), 0);
  const source = sourceRefLink(entry?.sourceRef);

  return (
    <Modal
      open={!!entryId}
      onClose={onClose}
      size="lg"
      title={entry ? `Journal Entry #${entry.entryNumber}` : 'Journal Entry'}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {loading && <div className="py-10 text-center text-navy/40 text-sm">Loading entry…</div>}

      {error && !loading && (
        <div className="py-10 text-center text-red-500 text-sm">{error}</div>
      )}

      {entry && !loading && (
        <>
          {/* Header */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-5 text-sm">
            <div>
              <div className="text-xs font-semibold text-navy/50 uppercase tracking-wide">Date</div>
              <div className="text-navy">{formatDate(entry.date)}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-navy/50 uppercase tracking-wide">Status</div>
              <div className="flex items-center gap-2">
                <Badge tone={statusTone(entry.status)}>
                  {entry.status === 'void' ? 'Voided' : entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                </Badge>
                {entry.voidedAt && (
                  <span className="text-xs text-navy/40">on {formatDate(entry.voidedAt)}</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-navy/50 uppercase tracking-wide">Reference</div>
              <div className="text-navy">{entry.reference ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-navy/50 uppercase tracking-wide">Source</div>
              {source ? (
                <Link
                  href={source.href}
                  className="inline-flex items-center gap-1 text-electric font-medium hover:underline"
                >
                  {source.label}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              ) : (
                <span className="text-navy/60">
                  {entry.sourceRef === 'manual' || !entry.sourceRef ? 'Manual entry' : entry.sourceRef}
                </span>
              )}
            </div>
            <div className="col-span-2">
              <div className="text-xs font-semibold text-navy/50 uppercase tracking-wide">Description</div>
              <div className="text-navy">{entry.description}</div>
            </div>
          </div>

          {/* Lines */}
          <Table>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th>Memo</Th>
                <Th>Class</Th>
                <Th numeric>Debit</Th>
                <Th numeric>Credit</Th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((l) => (
                <Tr key={l.id}>
                  <Td className="text-sm">
                    <span className="font-mono text-xs text-navy/50 mr-1.5">{l.accountCode}</span>
                    {l.accountName}
                  </Td>
                  <Td className="text-sm text-navy/60">{l.memo ?? ''}</Td>
                  <Td className="text-sm text-navy/60">{l.className ?? ''}</Td>
                  <Td numeric className="text-sm">
                    {l.debit ? formatCurrency(l.debit) : ''}
                  </Td>
                  <Td numeric className="text-sm">
                    {l.credit ? formatCurrency(l.credit) : ''}
                  </Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-navy/20">
                <td className="py-2 px-4 font-bold text-navy text-sm" colSpan={3}>
                  Totals
                </td>
                <td className="py-2 px-4 text-right tabular-nums font-bold text-navy text-sm">
                  {formatCurrency(totalDebit)}
                </td>
                <td className="py-2 px-4 text-right tabular-nums font-bold text-navy text-sm">
                  {formatCurrency(totalCredit)}
                </td>
              </tr>
            </tfoot>
          </Table>
        </>
      )}
    </Modal>
  );
}
