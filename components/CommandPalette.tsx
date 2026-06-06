'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';

interface Dest { label: string; href: string; group: string }
interface SearchResult { type: string; label: string; href: string }

// Flat list of navigable destinations (kept in sync with the sidebar).
const DESTINATIONS: Dest[] = [
  ['Dashboard', '/dashboard'], ['Invoices', '/invoices'], ['Estimates', '/estimates'],
  ['Sales Orders', '/sales-orders'], ['Receive Payments', '/payments'], ['Credit Memos', '/credit-memos'],
  ['Customers', '/customers'], ['Items', '/items'], ['Bills', '/bills'], ['Vendor Credits', '/vendor-credits'],
  ['Print Checks', '/print-checks'], ['Vendors', '/vendors'], ['Purchase Orders', '/purchase-orders'],
  ['Banking', '/banking'], ['Bank Feeds', '/bank-feeds'], ['Bank Review', '/bank-review'], ['Deposits', '/deposits'],
  ['Reconcile', '/reconcile'], ['Transfers', '/transfers'], ['Journal', '/journal'], ['Chart of Accounts', '/accounts'],
  ['Pay Liabilities', '/pay-liabilities'], ['Payroll', '/employees'], ['Pay Stubs', '/pay-stubs'],
  ['Payroll Forms', '/payroll-forms'], ['Payroll Tax', '/payroll-tax'], ['Tracking', '/tracking'],
  ['Tax Components', '/sales-tax-components'], ['Recurring', '/recurring'], ['Currencies', '/currencies'],
  ['Year-End Close', '/year-end'], ['Reports', '/reports'], ['Report Builder', '/reports/builder'],
  ['P&L (Cash Basis)', '/reports/profit-loss-cash'], ['Consolidated', '/reports/consolidated'], ['AI Review', '/errors'],
  ['Jobs', '/jobs'], ['Time Tracking', '/time-tracking'], ['Fixed Assets', '/fixed-assets'], ['Assemblies', '/assemblies'],
  ['FIFO Inventory', '/fifo'], ['Customer Pricing', '/customer-pricing'], ['Expense Reports', '/expense-reports'],
  ['Audit Trail', '/audit-trail'], ['Attachments', '/attachments'], ['Data Integrity', '/integrity'],
  ['Merge Records', '/merge'], ['Companies', '/companies'], ['Security (2FA)', '/security'], ['Settings', '/settings'],
].map(([label, href]) => ({ label, href, group: 'Go to' }));

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else {
      setQ('');
      setResults([]);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`);
        if (!cancelled) setResults(r.results);
      } catch {
        /* ignore */
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const navMatches = DESTINATIONS.filter((d) => d.label.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  const combined = [
    ...navMatches.map((d) => ({ type: 'Go to', label: d.label, href: d.href })),
    ...results,
  ];

  function go(href: string) {
    setOpen(false);
    window.location.href = href;
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh] p-4">
      <div className="absolute inset-0 bg-navy/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative z-10 w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-100 overflow-hidden">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, combined.length - 1));
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
            else if (e.key === 'Enter' && combined[active]) go(combined[active].href);
          }}
          placeholder="Search or jump to… (customers, vendors, items, invoices, pages)"
          className="w-full px-5 py-4 text-navy outline-none border-b border-slate-100 text-base"
        />
        <div className="max-h-80 overflow-y-auto py-2">
          {combined.length === 0 && (
            <div className="px-5 py-6 text-center text-navy/40 text-sm">
              {q ? 'No matches' : 'Type to search across your books and pages'}
            </div>
          )}
          {combined.map((r, i) => (
            <button
              key={`${r.type}-${r.label}-${i}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r.href)}
              className={`w-full text-left px-5 py-2.5 flex items-center justify-between ${
                i === active ? 'bg-electric/10' : ''
              }`}
            >
              <span className="text-navy">{r.label}</span>
              <span className="text-xs font-semibold text-navy/40 uppercase tracking-wide">{r.type}</span>
            </button>
          ))}
        </div>
        <div className="px-5 py-2 border-t border-slate-100 text-xs text-navy/40 flex gap-4">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="ml-auto">⌘/Ctrl + K</span>
        </div>
      </div>
    </div>
  );
}
