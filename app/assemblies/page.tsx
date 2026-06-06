'use client';

import { useEffect, useState, useCallback } from 'react';
import { Layers, Plus, Trash2, Hammer } from 'lucide-react';
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
  PageHeader,
  toast,
  Toaster,
} from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Item {
  id: string;
  name: string;
  sku: string | null;
  type: string;
  quantityOnHand: string | null;
  averageCost: string | null;
  isActive: boolean;
}

interface BomRow {
  id: string;
  componentItemId: string;
  componentName: string;
  componentSku: string | null;
  quantity: string;
}

interface DraftBomRow {
  componentItemId: string;
  quantity: string;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AssembliesPage() {
  // All items list (for dropdowns)
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);

  // Selected assembly
  const [selectedAssemblyId, setSelectedAssemblyId] = useState<string>('');
  const [selectedAssembly, setSelectedAssembly] = useState<Item | null>(null);

  // BOM state
  const [bom, setBom] = useState<BomRow[]>([]);
  const [loadingBom, setLoadingBom] = useState(false);

  // Draft BOM rows for editing
  const [draftRows, setDraftRows] = useState<DraftBomRow[]>([]);
  const [savingBom, setSavingBom] = useState(false);

  // Build/unbuild
  const [buildQty, setBuildQty] = useState('1');
  const [buildAction, setBuildAction] = useState<'build' | 'unbuild'>('build');
  const [building, setBuilding] = useState(false);

  // ── Data loading ───────────────────────────────────────────────────────────

  const fetchItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const data = await api.get<{ items: Item[] }>('/api/items');
      setAllItems(data.items.filter((i) => i.isActive));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load items.', 'danger');
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Reload a single item's data (after build/unbuild)
  const refreshAssemblyItem = useCallback(async (itemId: string) => {
    try {
      const data = await api.get<{ items: Item[] }>('/api/items');
      const updated = data.items.find((i) => i.id === itemId);
      if (updated) {
        setSelectedAssembly(updated);
        setAllItems(data.items.filter((i) => i.isActive));
      }
    } catch {
      // non-critical refresh
    }
  }, []);

  const fetchBom = useCallback(async (assemblyItemId: string) => {
    setLoadingBom(true);
    try {
      const data = await api.get<{ assemblyItemId: string; components: BomRow[] }>(
        `/api/assemblies?assemblyItemId=${assemblyItemId}`,
      );
      setBom(data.components);
      setDraftRows(
        data.components.map((c) => ({
          componentItemId: c.componentItemId,
          quantity: c.quantity,
        })),
      );
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load BOM.', 'danger');
    } finally {
      setLoadingBom(false);
    }
  }, []);

  // ── Assembly selection ─────────────────────────────────────────────────────

  function handleSelectAssembly(id: string) {
    setSelectedAssemblyId(id);
    setBom([]);
    setDraftRows([]);
    setBuildQty('1');
    if (!id) {
      setSelectedAssembly(null);
      return;
    }
    const item = allItems.find((i) => i.id === id) ?? null;
    setSelectedAssembly(item);
    fetchBom(id);
  }

  // ── Draft BOM editing ──────────────────────────────────────────────────────

  function addDraftRow() {
    setDraftRows((prev) => [...prev, { componentItemId: '', quantity: '1' }]);
  }

  function removeDraftRow(index: number) {
    setDraftRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateDraftRow(index: number, field: keyof DraftBomRow, value: string) {
    setDraftRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  }

  async function saveBom() {
    if (!selectedAssemblyId) return;

    const validRows = draftRows.filter((r) => r.componentItemId && r.quantity);
    setSavingBom(true);
    try {
      await api.patch('/api/assemblies', {
        assemblyItemId: selectedAssemblyId,
        components: validRows,
      });
      // Re-fetch
      await fetchBom(selectedAssemblyId);
      toast('Bill of materials saved.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to save BOM.', 'danger');
    } finally {
      setSavingBom(false);
    }
  }

  // ── Build / Unbuild ────────────────────────────────────────────────────────

  async function handleBuildAction() {
    if (!selectedAssemblyId) return;
    const qty = parseFloat(buildQty);
    if (!qty || qty <= 0) {
      toast('Quantity must be greater than zero.', 'danger');
      return;
    }

    setBuilding(true);
    try {
      await api.post('/api/assemblies/build', {
        assemblyItemId: selectedAssemblyId,
        quantity: buildQty,
        action: buildAction,
      });
      const verb = buildAction === 'build' ? 'Built' : 'Unbuilt';
      toast(`${verb} ${buildQty} unit(s) of ${selectedAssembly?.name ?? 'assembly'}.`, 'success');
      await refreshAssemblyItem(selectedAssemblyId);
      // Also refresh component quantities shown in BOM table
      await fetchBom(selectedAssemblyId);
      setBuildQty('1');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : `${buildAction} failed.`, 'danger');
    } finally {
      setBuilding(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Items available as components (not the assembly itself)
  const componentCandidates = allItems.filter((i) => i.id !== selectedAssemblyId);

  // BOM cost estimate
  const estimatedCost = draftRows.reduce((sum, row) => {
    const comp = allItems.find((i) => i.id === row.componentItemId);
    if (!comp || !comp.averageCost) return sum;
    return sum + parseFloat(comp.averageCost) * parseFloat(row.quantity || '0');
  }, 0);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <Toaster />

      <PageHeader title="Inventory Assemblies" icon={Layers} />

      {/* Assembly selector */}
      <Card className="p-6 mb-6">
        <div className="max-w-md">
          <Label htmlFor="asm-select">Select Assembly Item</Label>
          {loadingItems ? (
            <div className="text-navy/40 text-sm py-2">Loading items…</div>
          ) : (
            <Select
              id="asm-select"
              value={selectedAssemblyId}
              onChange={(e) => handleSelectAssembly(e.target.value)}
            >
              <option value="">— Pick an item —</option>
              {allItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.sku ? ` (${item.sku})` : ''}
                  {' — '}
                  {item.type}
                </option>
              ))}
            </Select>
          )}
          {selectedAssembly && (
            <div className="mt-3 flex items-center gap-4 text-sm text-navy/60">
              <span>
                On hand:{' '}
                <span className="font-semibold text-navy">
                  {parseFloat(selectedAssembly.quantityOnHand ?? '0').toFixed(4)}
                </span>
              </span>
              <span>
                Avg cost:{' '}
                <span className="font-semibold text-navy">
                  {selectedAssembly.averageCost
                    ? formatCurrency(selectedAssembly.averageCost)
                    : '—'}
                </span>
              </span>
              <Badge tone="info">{selectedAssembly.type}</Badge>
            </div>
          )}
        </div>
      </Card>

      {selectedAssemblyId && (
        <>
          {/* BOM Editor */}
          <Card className="p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-navy">Bill of Materials</h2>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={addDraftRow}>
                  <Plus className="h-4 w-4" /> Add Component
                </Button>
                <Button
                  size="sm"
                  onClick={saveBom}
                  disabled={savingBom}
                >
                  {savingBom ? 'Saving…' : 'Save BOM'}
                </Button>
              </div>
            </div>

            {loadingBom ? (
              <div className="text-center text-navy/40 text-sm py-8">Loading BOM…</div>
            ) : draftRows.length === 0 ? (
              <div className="text-center py-8">
                <Layers className="mx-auto h-8 w-8 text-navy/20 mb-2" />
                <p className="text-navy/40 text-sm">
                  No components. Click &quot;Add Component&quot; to define the bill of materials.
                </p>
              </div>
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>Component Item</Th>
                      <Th className="w-36">Qty per Assembly</Th>
                      <Th className="text-right">Unit Cost</Th>
                      <Th className="text-right">On Hand</Th>
                      <Th className="w-12"></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftRows.map((row, idx) => {
                      const comp = allItems.find((i) => i.id === row.componentItemId);
                      return (
                        <Tr key={idx}>
                          <Td>
                            <Select
                              value={row.componentItemId}
                              onChange={(e) => updateDraftRow(idx, 'componentItemId', e.target.value)}
                            >
                              <option value="">— Select item —</option>
                              {componentCandidates.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                  {item.sku ? ` (${item.sku})` : ''}
                                </option>
                              ))}
                            </Select>
                          </Td>
                          <Td>
                            <Input
                              type="number"
                              min="0.0001"
                              step="0.0001"
                              value={row.quantity}
                              onChange={(e) => updateDraftRow(idx, 'quantity', e.target.value)}
                            />
                          </Td>
                          <Td className="text-right tabular-nums text-sm">
                            {comp?.averageCost ? formatCurrency(comp.averageCost) : '—'}
                          </Td>
                          <Td className="text-right tabular-nums text-sm">
                            {comp?.quantityOnHand
                              ? parseFloat(comp.quantityOnHand).toFixed(4)
                              : '—'}
                          </Td>
                          <Td>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeDraftRow(idx)}
                              className="text-red-400 hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
                <div className="mt-4 flex items-center justify-end gap-2 text-sm text-navy/60">
                  <span>Estimated cost per assembly:</span>
                  <span className="font-bold text-navy tabular-nums">
                    {formatCurrency(estimatedCost)}
                  </span>
                </div>
              </>
            )}
          </Card>

          {/* Build / Unbuild Panel */}
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Hammer className="h-5 w-5 text-electric" />
              <h2 className="text-lg font-bold text-navy">Build / Unbuild</h2>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="w-40">
                <Label htmlFor="build-action">Action</Label>
                <Select
                  id="build-action"
                  value={buildAction}
                  onChange={(e) => setBuildAction(e.target.value as 'build' | 'unbuild')}
                >
                  <option value="build">Build</option>
                  <option value="unbuild">Unbuild</option>
                </Select>
              </div>

              <div className="w-40">
                <Label htmlFor="build-qty">Quantity</Label>
                <Input
                  id="build-qty"
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={buildQty}
                  onChange={(e) => setBuildQty(e.target.value)}
                />
              </div>

              <Button onClick={handleBuildAction} disabled={building || bom.length === 0}>
                <Hammer className="h-4 w-4" />
                {building
                  ? buildAction === 'build'
                    ? 'Building…'
                    : 'Unbuilding…'
                  : buildAction === 'build'
                  ? 'Build Assembly'
                  : 'Unbuild Assembly'}
              </Button>
            </div>

            {bom.length === 0 && (
              <p className="mt-3 text-sm text-navy/40">
                Save a bill of materials above before building.
              </p>
            )}

            {bom.length > 0 && buildAction === 'build' && (
              <div className="mt-4 rounded-lg bg-navy/5 p-4 text-sm text-navy/70">
                <p className="font-semibold text-navy mb-2">What will happen:</p>
                <ul className="space-y-1">
                  {bom.map((row) => {
                    const consumed = parseFloat(row.quantity) * parseFloat(buildQty || '0');
                    return (
                      <li key={row.id}>
                        Consume{' '}
                        <span className="font-semibold text-navy">{consumed.toFixed(4)}</span>{' '}
                        unit(s) of{' '}
                        <span className="font-semibold text-navy">{row.componentName}</span>
                      </li>
                    );
                  })}
                  <li className="pt-1 border-t border-navy/10 mt-1">
                    Produce{' '}
                    <span className="font-semibold text-navy">{parseFloat(buildQty || '0').toFixed(4)}</span>{' '}
                    unit(s) of{' '}
                    <span className="font-semibold text-navy">{selectedAssembly?.name}</span>
                  </li>
                </ul>
                <p className="mt-3 text-xs text-navy/40">
                  No GL journal entry is posted — both sides are account 1300 (net $0).
                  Quantities and average cost are updated directly on the item records.
                </p>
              </div>
            )}
          </Card>
        </>
      )}
    </main>
  );
}
