/**
 * Quick actions for the command palette (components/CommandPalette.tsx), grouped under
 * "Actions". Each entry deep-links to a page with `?new=1` so the page opens its
 * create modal on mount (pages adopt the param progressively; until then the link
 * simply lands on the page).
 *
 * Kept separate from lib/nav.ts (sidebar destinations) because actions are verbs,
 * not places — the palette merges both.
 */

export interface NavAction {
  label: string;
  href: string;
  /** Extra match terms so e.g. "check" finds Write Check. */
  keywords?: string;
}

export const navActions: NavAction[] = [
  { label: 'New Invoice', href: '/invoices?new=1', keywords: 'create invoice bill customer' },
  { label: 'Write Check', href: '/expenses?new=1', keywords: 'new check expense pay' },
  { label: 'Receive Payment', href: '/payments?new=1', keywords: 'customer payment receive' },
  { label: 'Make Deposit', href: '/deposits?new=1', keywords: 'bank deposit funds' },
  { label: 'New Journal Entry', href: '/journal?new=1', keywords: 'general journal adjust gl' },
  { label: 'Reconcile', href: '/reconcile', keywords: 'bank reconciliation statement' },
  { label: 'Run Payroll', href: '/employees?new=1', keywords: 'pay run paycheck payroll' },
];

/** Case-insensitive filter over label + keywords; empty query returns all actions. */
export function filterNavActions(query: string): NavAction[] {
  const q = query.trim().toLowerCase();
  if (!q) return navActions;
  return navActions.filter(
    (a) => a.label.toLowerCase().includes(q) || (a.keywords ?? '').toLowerCase().includes(q),
  );
}
