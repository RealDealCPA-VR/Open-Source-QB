'use client';

/**
 * Print Checks page — QB-style "Print Checks"
 *
 * Two sections:
 *  1. Print Queue — checks written on the Write Checks / Expenses screen with
 *     "Print later" checked. Printing a queued check renders its PDF AND records
 *     the assigned check number back onto the transaction (toPrint=false), so
 *     printing is fully connected to the GL-posted expense.
 *  2. Quick Check — the original ad-hoc check generator (fill in payee, amount,
 *     date, memo, number) for one-off checks that are not recorded transactions.
 */

import { useState, useEffect, useCallback } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Spinner,
  Table,
  Th,
  Td,
  Tr,
  toast,
} from '@/components/ui';
import { numberToWords } from '@/lib/pdf/check';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';
import { formatDate } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueuedCheck {
  id: string;
  vendorName: string | null;
  payeeName: string | null;
  date: string;
  paymentAccountName: string | null;
  total: string;
  memo: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render a check PDF via the API and open it in a new tab. */
async function openCheckPdf(args: {
  expenseId?: string;
  payee?: string;
  amount?: string;
  date?: string;
  memo?: string;
  checkNumber?: string;
}) {
  const res = await fetch('/api/checks/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Server error ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PrintChecksPage() {
  // ── Print queue state ─────────────────────────────────────────────────────
  const [queue, setQueue] = useState<QueuedCheck[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [nextNumber, setNextNumber] = useState('');
  const [printingId, setPrintingId] = useState<string | null>(null);

  // ── Quick-check form state ────────────────────────────────────────────────
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [generating, setGenerating] = useState(false);
  const [amountWords, setAmountWords] = useState('');

  // ── Queue loading ─────────────────────────────────────────────────────────

  const refreshQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const [queueData, nextData] = await Promise.all([
        api.get<{ expenses: QueuedCheck[] }>('/api/expenses?toPrint=true'),
        api.get<{ next: string }>('/api/check-numbers/next'),
      ]);
      setQueue(queueData.expenses);
      setNextNumber((prev) => prev || nextData.next);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load the print queue.', 'danger');
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshQueue();
  }, [refreshQueue]);

  useEffect(() => {
    const n = parseFloat(amount);
    if (!amount || isNaN(n) || n < 0) {
      setAmountWords('');
    } else {
      setAmountWords(numberToWords(amount));
    }
  }, [amount]);

  // ── Print a queued check ──────────────────────────────────────────────────

  async function handlePrintQueued(check: QueuedCheck) {
    const num = nextNumber.trim();
    if (!num) {
      toast('Enter a starting check number.', 'danger');
      return;
    }
    setPrintingId(check.id);
    try {
      // 1. Render + open the PDF (with voucher stub) from the recorded expense
      await openCheckPdf({ expenseId: check.id, checkNumber: num });

      // 2. Record the number on the transaction (toPrint=false + reference)
      await api.post(`/api/expenses/${check.id}/print`, { checkNumber: num });

      toast(`Check #${num} printed and recorded.`, 'success');

      // Advance the number for the next check in the run
      const parsed = parseInt(num, 10);
      if (!isNaN(parsed)) setNextNumber(String(parsed + 1));

      setQueue((prev) => prev.filter((q) => q.id !== check.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to print check.';
      toast(msg, 'danger');
    } finally {
      setPrintingId(null);
    }
  }

  // ── Quick-check generator (ad-hoc, not recorded) ──────────────────────────

  async function handleGenerate() {
    if (!payee.trim()) {
      toast('Payee name is required.', 'danger');
      return;
    }
    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      toast('Amount must be a positive number.', 'danger');
      return;
    }
    if (!date) {
      toast('Date is required.', 'danger');
      return;
    }

    setGenerating(true);
    try {
      await openCheckPdf({
        payee: payee.trim(),
        amount: amountNum.toFixed(2),
        date,
        memo: memo.trim() || undefined,
        checkNumber: checkNumber.trim() || undefined,
      });
      toast('Check PDF opened in a new tab.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate check PDF.';
      toast(msg, 'danger');
    } finally {
      setGenerating(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        <PageHeader title="Print Checks" icon={Printer} />
        {/* ----------------------------------------------------------------- */}
        {/* Print queue (checks marked "Print later" on Write Checks)          */}
        {/* ----------------------------------------------------------------- */}
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-navy">Checks to Print</h2>
              <p className="text-sm text-navy/50">
                Checks saved with &quot;Print later&quot; on the Write Checks screen. Printing
                assigns the check number to the recorded transaction.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={refreshQueue} disabled={queueLoading}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>

          <div className="flex items-end gap-3">
            <div className="w-44">
              <Label htmlFor="next-number">Next Check Number</Label>
              <Input
                id="next-number"
                placeholder="e.g. 1001"
                value={nextNumber}
                onChange={(e) => setNextNumber(e.target.value)}
              />
            </div>
            {queue.length > 0 && (
              <Badge tone="warning">{queue.length} check{queue.length === 1 ? '' : 's'} queued</Badge>
            )}
          </div>

          {queueLoading ? (
            <div className="p-8 flex items-center justify-center gap-2 text-navy/40 text-sm">
              <Spinner className="h-4 w-4" /> Loading queue…
            </div>
          ) : queue.length === 0 ? (
            <EmptyState
              icon={Printer}
              title="No checks waiting to print"
              message='Write a check with "Print later" on the Write Checks screen to queue one.'
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Payee</Th>
                  <Th>Bank Account</Th>
                  <Th>Memo</Th>
                  <Th numeric>Amount</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {queue.map((q) => (
                  <Tr key={q.id}>
                    <Td>{q.date ? formatDate(q.date, 'MMM d, yyyy') : '—'}</Td>
                    <Td className="font-medium">{q.vendorName ?? q.payeeName ?? '—'}</Td>
                    <Td>{q.paymentAccountName ?? '—'}</Td>
                    <Td className="text-navy/60">{q.memo ?? '—'}</Td>
                    <Td numeric className="font-semibold">
                      {formatCurrency(q.total)}
                    </Td>
                    <Td className="text-right">
                      <Button
                        size="sm"
                        loading={printingId === q.id}
                        onClick={() => handlePrintQueued(q)}
                      >
                        <Printer className="h-4 w-4" />
                        Print &amp; Record
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {/* ----------------------------------------------------------------- */}
        {/* Quick check (ad-hoc PDF, not recorded)                              */}
        {/* ----------------------------------------------------------------- */}
        <Card className="p-6 space-y-5">
          <div>
            <h2 className="text-lg font-bold text-navy">Quick Check</h2>
            <p className="text-sm text-navy/50">
              Generate a one-off check PDF without recording a transaction. To record spend on the
              books, use Write Checks / Expenses instead.
            </p>
          </div>

          {/* Payee */}
          <div>
            <Label htmlFor="chk-payee">Pay to the Order of *</Label>
            <Input
              id="chk-payee"
              placeholder="Vendor or individual name"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
            />
          </div>

          {/* Amount + Date side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="chk-amount">Amount ($) *</Label>
              <Input
                id="chk-amount"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="chk-date">Date *</Label>
              <Input
                id="chk-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          {/* Live words preview */}
          {amountWords && (
            <div className="rounded-lg border border-electric/30 bg-electric/5 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-navy/50 mb-0.5">
                Amount in words
              </p>
              <p className="text-sm font-medium text-navy italic leading-snug">
                {amountWords} DOLLARS
              </p>
              <p className="text-xs text-navy/40 mt-1 tabular-nums">{formatCurrency(amount)}</p>
            </div>
          )}

          {/* Check number + Memo */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="chk-number">Check Number</Label>
              <Input
                id="chk-number"
                placeholder="e.g. 1001"
                value={checkNumber}
                onChange={(e) => setCheckNumber(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="chk-memo">Memo</Label>
              <Input
                id="chk-memo"
                placeholder="Optional note"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          </div>

          {/* Action */}
          <div className="flex justify-end pt-2">
            <Button onClick={handleGenerate} loading={generating}>
              <Printer className="h-4 w-4" />
              Generate Check PDF
            </Button>
          </div>
        </Card>

        {/* ----------------------------------------------------------------- */}
        {/* Helpful notes                                                       */}
        {/* ----------------------------------------------------------------- */}
        <Card className="p-5 bg-navy/5 border-navy/10">
          <h3 className="text-sm font-semibold text-navy mb-2">Tips</h3>
          <ul className="text-sm text-navy/60 space-y-1 list-disc list-inside">
            <li>The PDF opens in a new tab — use your browser&apos;s print dialog to send it to your printer.</li>
            <li>Load blank check stock into your printer before printing.</li>
            <li>Printing a queued check stamps its number onto the recorded transaction and journal entry.</li>
          </ul>
        </Card>
      </div>
    </main>
  );
}
