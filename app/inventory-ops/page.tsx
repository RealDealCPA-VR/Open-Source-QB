'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Package, PackageSearch, RefreshCw, ClipboardCheck } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Select,
  Label,
  Badge,
  Table,
  Th,
  Td,
  Tr,
  Modal,
  PageHeader,
  EmptyState,
  Spinner,
  toast,
} from '@/components/ui';
import { api } from '@/lib/client';
import { formatCurrency, Money } from '@/lib/money';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReorderRow {
  id: string;
  name: string;
  sku: string | null;
  quantityOnHand: string;
  reorderPoint: string;
  averageCost: string;
  suggestedReorderQty: string;
}

interface ReorderReport {
  rows: ReorderRow[];
  count: number;
}

interface Item {
  id: string;
  name: string;
  sku: string | null;
  type: string;
  quantityOnHand: string | null;
  averageCost: string | null;
}

interface PhysicalCountResult {
  itemId: string;
  previousQty: string;
  countedQty: string;
  delta: string;
  glAmount: string;
  journalEntryId: string | null;
  adjustmentAccountId: string | null;
  updatedQty: string;
}

// ---------------------------------------------------------------------------
// Physical Count Modal
// ---------------------------------------------------------------------------

interface PhysicalCountModalProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

function PhysicalCountModal({ open, onClose, onDone }: PhysicalCountModalProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemId, setItemId] = useState('');
  const [countedQty, setCountedQty] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<PhysicalCountResult | null>(null);

  // Load items when modal opens
  useEffect(() => {
    if (!open) {
      setItemId('');
      setCountedQty('');
      setDate(new Date().toISOString().slice(0, 10));
      setResult(null);
      return;
    }
    setLoadingItems(true);
    api
      .get<{ items: Item[] }>('/api/items?type=inventory')
      .then((data) => setItems(data.items ?? []))
      .catch(() => toast('Failed to load items.', 'danger'))
      .finally(() => setLoadingItems(false));
  }, [open]);

  const selectedItem = items.find((i) => i.id === itemId);

  async function handleSubmit() {
    if (!itemId) {
      toast('Please select an item.', 'danger');
      return;
    }
    const qty = parseFloat(countedQty);
    if (countedQty === '' || isNaN(qty) || qty < 0) {
      toast('Please enter a valid counted quantity (>= 0).', 'danger');
      return;
    }
    if (!date) {
      toast('Please enter a count date.', 'danger');
      return;
    }

    setSaving(true);
    try {
      const data = await api.post<PhysicalCountResult>('/api/inventory/physical-count', {
        itemId,
        countedQty: countedQty,
        date,
      });
      setResult(data);
      toast('Physical count recorded.', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to record physical count.';
      toast(msg, 'danger');
    } finally {
      setSaving(false);
    }
  }

  function handleDone() {
    setResult(null);
    onDone();
    onClose();
  }

  const deltaNum = result ? parseFloat(result.delta) : 0;

  return (
    <Modal
      open={open}
      onClose={result ? handleDone : onClose}
      title="Physical Inventory Count"
      footer={
        result ? (
          <Button onClick={handleDone}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="physical-count-form" loading={saving} disabled={loadingItems}>
              Record Count
            </Button>
          </>
        )
      }
    >
      {result ? (
        // Results view
        <div className="space-y-4">
          <div className="rounded-xl bg-navy/5 p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-navy/60">Item</span>
              <span className="font-semibold text-navy">
                {items.find((i) => i.id === result.itemId)?.name ?? result.itemId}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-navy/60">Previous Qty</span>
              <span className="font-medium text-navy tabular-nums">{result.previousQty}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-navy/60">Counted Qty</span>
              <span className="font-medium text-navy tabular-nums">{result.countedQty}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-navy/60">Delta</span>
              <span
                className={`font-semibold tabular-nums ${
                  deltaNum < 0 ? 'text-red-600' : deltaNum > 0 ? 'text-emerald' : 'text-navy/50'
                }`}
              >
                {deltaNum > 0 ? '+' : ''}{result.delta}
              </span>
            </div>
            <div className="flex justify-between text-sm border-t border-navy/10 pt-3">
              <span className="text-navy/60">GL Adjustment</span>
              <span className="font-bold text-navy tabular-nums">
                {formatCurrency(result.glAmount)}
              </span>
            </div>
            {result.journalEntryId ? (
              <div className="flex justify-between text-xs">
                <span className="text-navy/40">Journal Entry</span>
                <Link
                  href={`/journal?focus=${result.journalEntryId}`}
                  className="text-electric font-semibold hover:underline"
                >
                  View entry
                </Link>
              </div>
            ) : (
              <p className="text-xs text-navy/40 italic">No GL entry needed (delta = 0).</p>
            )}
          </div>
          {deltaNum !== 0 && (
            <div
              className={`rounded-lg px-4 py-3 text-sm font-medium ${
                deltaNum < 0
                  ? 'bg-red-50 text-red-700'
                  : 'bg-emerald/10 text-emerald'
              }`}
            >
              {deltaNum < 0
                ? `Shrinkage of ${Math.abs(deltaNum).toFixed(4)} units recorded. Dr Inventory Shrinkage, Cr Inventory Asset.`
                : `Overage of ${deltaNum.toFixed(4)} units recorded. Dr Inventory Asset, Cr Inventory Shrinkage.`}
            </div>
          )}
        </div>
      ) : (
        // Entry form
        <form
          id="physical-count-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="pc-item">Item *</Label>
            {loadingItems ? (
              <div className="flex items-center gap-2 text-sm text-navy/40 py-2">
                <Spinner className="h-4 w-4" /> Loading items…
              </div>
            ) : (
              <Select
                id="pc-item"
                autoFocus
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
              >
                <option value="">Select an inventory item…</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.sku ? ` (${item.sku})` : ''}
                  </option>
                ))}
              </Select>
            )}
          </div>

          {selectedItem && (
            <div className="rounded-lg bg-navy/5 px-4 py-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-navy/60">Current Qty on Hand</span>
                <span className="font-semibold text-navy tabular-nums">
                  {selectedItem.quantityOnHand ?? '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-navy/60">Average Cost</span>
                <span className="font-medium text-navy tabular-nums">
                  {selectedItem.averageCost
                    ? formatCurrency(selectedItem.averageCost)
                    : '—'}
                </span>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="pc-qty">Counted Quantity *</Label>
            <Input
              id="pc-qty"
              type="number"
              min="0"
              step="any"
              placeholder="0"
              value={countedQty}
              onChange={(e) => setCountedQty(e.target.value)}
            />
            {selectedItem && countedQty !== '' && (
              <p className="mt-1 text-xs text-navy/50">
                Delta:{' '}
                <span
                  className={
                    parseFloat(countedQty) - parseFloat(selectedItem.quantityOnHand ?? '0') < 0
                      ? 'text-red-500 font-semibold'
                      : parseFloat(countedQty) - parseFloat(selectedItem.quantityOnHand ?? '0') > 0
                      ? 'text-emerald font-semibold'
                      : 'text-navy/40'
                  }
                >
                  {(
                    parseFloat(countedQty || '0') -
                    parseFloat(selectedItem.quantityOnHand ?? '0')
                  ).toFixed(4)}
                </span>
                {selectedItem.averageCost && countedQty !== '' && (
                  <span className="ml-2 text-navy/40">
                    ≈{' '}
                    {formatCurrency(
                      Money.mul(
                        Money.sub(countedQty || '0', selectedItem.quantityOnHand ?? '0'),
                        selectedItem.averageCost,
                      ).abs(),
                    )}{' '}
                    GL impact
                  </span>
                )}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="pc-date">Count Date *</Label>
            <Input
              id="pc-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function InventoryOpsPage() {
  const [report, setReport] = useState<ReorderReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPhysicalCount, setShowPhysicalCount] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ReorderReport>('/api/inventory/reorder');
      setReport(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load reorder report.';
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Inventory Operations"
        icon={PackageSearch}
        action={
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={fetchReport} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button onClick={() => setShowPhysicalCount(true)}>
              <ClipboardCheck className="h-4 w-4" />
              Physical Count
            </Button>
          </div>
        }
      />

      {/* Reorder Report */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-navy">Reorder Report</h2>
          <p className="text-sm text-navy/50 mt-0.5">
            Items where quantity on hand is at or below the reorder point.
          </p>
        </div>
        {report && (
          <Badge tone={report.count > 0 ? 'danger' : 'success'}>
            {report.count === 0
              ? 'All items stocked'
              : `${report.count} item${report.count !== 1 ? 's' : ''} need reorder`}
          </Badge>
        )}
      </div>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-navy/40 text-sm">
            <Spinner className="h-4 w-4" /> Loading reorder report…
          </div>
        ) : !report || report.rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No items need reordering right now"
            message="Items appear here when their quantity on hand falls to or below their reorder point."
          />
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Item</Th>
                <Th>SKU</Th>
                <Th numeric>On Hand</Th>
                <Th numeric>Reorder Point</Th>
                <Th numeric>Avg Cost</Th>
                <Th numeric>Suggested Order</Th>
                <Th numeric>Est. Cost</Th>
              </Tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const belowZero =
                  parseFloat(row.quantityOnHand) <= 0;
                const estCost = Money.mul(row.suggestedReorderQty, row.averageCost);

                return (
                  <Tr key={row.id}>
                    <Td className="font-semibold text-navy">{row.name}</Td>
                    <Td className="text-navy/50 text-xs">
                      {row.sku ?? '—'}
                    </Td>
                    <Td numeric>
                      <span
                        className={
                          belowZero
                            ? 'text-red-600 font-bold'
                            : 'text-gold font-semibold'
                        }
                      >
                        {parseFloat(row.quantityOnHand).toFixed(2)}
                      </span>
                    </Td>
                    <Td numeric className="text-navy/70">
                      {parseFloat(row.reorderPoint).toFixed(2)}
                    </Td>
                    <Td numeric className="text-navy/70">
                      {formatCurrency(row.averageCost)}
                    </Td>
                    <Td numeric className="font-semibold text-electric">
                      {parseFloat(row.suggestedReorderQty).toFixed(2)}
                    </Td>
                    <Td numeric className="text-navy/70">
                      {formatCurrency(estCost)}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {report && report.rows.length > 0 && (
        <div className="mt-4 flex gap-6 text-sm text-navy/50">
          <span>
            {report.count} item{report.count !== 1 ? 's' : ''} below reorder point
          </span>
          <span>
            Total estimated reorder cost:{' '}
            <span className="font-semibold text-navy/70">
              {formatCurrency(
                report.rows.reduce(
                  (sum, r) => sum.plus(Money.mul(r.suggestedReorderQty, r.averageCost)),
                  Money.zero(),
                ),
              )}
            </span>
          </span>
        </div>
      )}

      <PhysicalCountModal
        open={showPhysicalCount}
        onClose={() => setShowPhysicalCount(false)}
        onDone={fetchReport}
      />
    </main>
  );
}
