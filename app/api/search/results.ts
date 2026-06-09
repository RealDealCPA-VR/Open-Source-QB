/**
 * Pure mapping from raw search hits to palette results. Each href carries the matched
 * record's id (?focus=<id>) so the destination page can open/highlight the actual record
 * instead of landing on an unfiltered list. Kept separate from route.ts so it can be
 * unit-tested (route files may only export HTTP handlers).
 */
export interface SearchResultItem {
  type: string;
  label: string;
  href: string;
  id: string;
}

export function buildResults(hits: {
  cust: { id: string; label: string }[];
  vend: { id: string; label: string }[];
  itm: { id: string; label: string }[];
  inv: { id: string; num: number | string | null }[];
}): SearchResultItem[] {
  return [
    ...hits.cust.map((c) => ({ type: 'Customer', label: c.label, href: `/customers?focus=${c.id}`, id: c.id })),
    ...hits.vend.map((v) => ({ type: 'Vendor', label: v.label, href: `/vendors?focus=${v.id}`, id: v.id })),
    ...hits.itm.map((i) => ({ type: 'Item', label: i.label, href: `/items?focus=${i.id}`, id: i.id })),
    ...hits.inv.map((i) => ({ type: 'Invoice', label: `Invoice #${i.num}`, href: `/invoices?focus=${i.id}`, id: i.id })),
  ];
}
