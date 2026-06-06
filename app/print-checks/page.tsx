'use client';

/**
 * Print Checks page — QB-style "Print Checks"
 *
 * Allows the user to fill in payee, amount, date, memo, and check number,
 * preview the amount spelled out in words, and generate a printable check PDF
 * that opens in a new browser tab.
 */

import { useState, useEffect } from 'react';
import { Printer } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Label,
  PageHeader,
  toast,
  Toaster,
} from '@/components/ui';
import { numberToWords } from '@/lib/pdf/check';

// ---------------------------------------------------------------------------
// Helper — format a numeric string as USD for the live preview label
// ---------------------------------------------------------------------------

function fmtUSD(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n)) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PrintChecksPage() {
  const [payee, setPayee]               = useState('');
  const [amount, setAmount]             = useState('');
  const [date, setDate]                 = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo]                 = useState('');
  const [checkNumber, setCheckNumber]   = useState('');
  const [generating, setGenerating]     = useState(false);

  // Live amount-in-words derived from the amount field
  const [amountWords, setAmountWords] = useState('');

  useEffect(() => {
    const n = parseFloat(amount);
    if (!amount || isNaN(n) || n < 0) {
      setAmountWords('');
    } else {
      setAmountWords(numberToWords(amount));
    }
  }, [amount]);

  async function handleGenerate() {
    // --- Client-side validation ---
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
      const res = await fetch('/api/checks/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payee: payee.trim(),
          amount: amountNum.toFixed(2),
          date,
          memo: memo.trim() || undefined,
          checkNumber: checkNumber.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Server error ${res.status}`);
      }

      // Blob -> object URL -> open in new tab
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Revoke after a short delay to free memory once the tab has loaded
      setTimeout(() => URL.revokeObjectURL(url), 60_000);

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
      <PageHeader title="Print Checks" icon={Printer} />

      <div className="max-w-2xl mx-auto space-y-6">

        {/* ----------------------------------------------------------------- */}
        {/* Check form                                                          */}
        {/* ----------------------------------------------------------------- */}
        <Card className="p-6 space-y-5">
          <h2 className="text-lg font-bold text-navy">Check Details</h2>

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
              {fmtUSD(amount) && (
                <p className="text-xs text-navy/40 mt-1 tabular-nums">{fmtUSD(amount)}</p>
              )}
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
            <Button onClick={handleGenerate} disabled={generating}>
              <Printer className="h-4 w-4" />
              {generating ? 'Generating…' : 'Generate Check PDF'}
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
            <li>Check number, memo, and company name are printed from your active company profile.</li>
          </ul>
        </Card>

      </div>

      <Toaster />
    </main>
  );
}
