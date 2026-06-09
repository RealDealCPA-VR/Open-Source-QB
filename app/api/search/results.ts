/**
 * Pure mapping from raw search hits to palette results. Where the destination page supports
 * deep-linking (?focus=<id> — invoices/customers/vendors/items, via lib/useFocusParam), the
 * href carries the matched record's id so the page opens/highlights the actual record.
 * Types without focus support link to their list page. Kept separate from route.ts so it can
 * be unit-tested (route files may only export HTTP handlers).
 *
 * Accepts Partial<SearchHits> so callers (and older tests) can pass just the groups they have.
 */
import { formatCurrency } from '@/lib/money';
import type { SearchHits } from './queries';

export interface SearchResultItem {
  type: string;
  label: string;
  href: string;
  id: string;
}

export function buildResults(hits: Partial<SearchHits>): SearchResultItem[] {
  const results: SearchResultItem[] = [
    ...(hits.cust ?? []).map((c) => ({
      type: 'Customer',
      label: c.label,
      href: `/customers?focus=${c.id}`,
      id: c.id,
    })),
    ...(hits.vend ?? []).map((v) => ({
      type: 'Vendor',
      label: v.label,
      href: `/vendors?focus=${v.id}`,
      id: v.id,
    })),
    ...(hits.itm ?? []).map((i) => ({
      type: 'Item',
      label: i.label,
      href: `/items?focus=${i.id}`,
      id: i.id,
    })),
    ...(hits.inv ?? []).map((i) => ({
      type: 'Invoice',
      label: `Invoice #${i.num}`,
      href: `/invoices?focus=${i.id}`,
      id: i.id,
    })),
    ...(hits.bill ?? []).map((b) => ({
      type: 'Bill',
      label: b.num ? `Bill ${b.num}` : 'Bill (no number)',
      href: '/bills',
      id: b.id,
    })),
    ...(hits.pay ?? []).map((p) => ({
      type: 'Payment',
      label: p.reference
        ? `Payment ref ${p.reference} — ${formatCurrency(p.amount)}`
        : `Payment — ${formatCurrency(p.amount)}`,
      href: '/payments',
      id: p.id,
    })),
    ...(hits.emp ?? []).map((e) => ({
      type: 'Employee',
      label: e.name,
      href: '/employees',
      id: e.id,
    })),
    ...(hits.acct ?? []).map((a) => ({
      type: 'Account',
      label: `${a.code} · ${a.name}`,
      href: '/accounts',
      id: a.id,
    })),
    ...(hits.je ?? []).map((j) => ({
      type: 'Journal Entry',
      label: `JE #${j.entryNumber} — ${j.description}`,
      href: '/journal',
      id: j.id,
    })),
    // Exact-amount hits (duplicates of number matches are removed below).
    ...(hits.amtInv ?? []).map((i) => ({
      type: 'Invoice',
      label: `Invoice #${i.num} — ${formatCurrency(i.total)}`,
      href: `/invoices?focus=${i.id}`,
      id: i.id,
    })),
    ...(hits.amtBill ?? []).map((b) => ({
      type: 'Bill',
      label: b.num ? `Bill ${b.num} — ${formatCurrency(b.total)}` : `Bill — ${formatCurrency(b.total)}`,
      href: '/bills',
      id: b.id,
    })),
    ...(hits.amtExp ?? []).map((e) => ({
      type: 'Expense',
      label: e.payee
        ? `Expense — ${e.payee} — ${formatCurrency(e.total)}`
        : `Expense — ${formatCurrency(e.total)}`,
      href: '/expenses',
      id: e.id,
    })),
  ];

  // A record can match by both number and amount — keep the first occurrence per type+id.
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
