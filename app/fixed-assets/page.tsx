'use client';

import { useEffect, useState, useCallback } from 'react';
import { Building2, Plus, TrendingDown, Calendar } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Label,
  Table,
  Th,
  Td,
  Tr,
  Modal,
  PageHeader,
  toast,
  Toaster,
} from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FixedAsset {
  id: string;
  name: string;
  cost: string;
  salvageValue: string;
  usefulLifeMonths: number;
  placedInService: string;
  accumulatedDepreciation: string;
  method: string;
  isActive: boolean;
  createdAt: string;
}

interface DepreciationEntry {
  id: string;
  date: string;
  amount: string;
  postedEntryId: string | null;
}

interface ScheduleItem {
  period: number;
  date: string;
  amount: string;
  accumulated: string;
  netBookValue: string;
}

interface AssetDetail extends FixedAsset {
  depreciationEntries: DepreciationEntry[];
  schedule: ScheduleItem[];
}

interface AssetForm {
  name: string;
  cost: string;
  salvageValue: string;
  usefulLifeMonths: string;
  placedInService: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM: AssetForm = {
  name: '',
  cost: '',
  salvageValue: '0',
  usefulLifeMonths: '60',
  placedInService: today(),
};

function netBookValue(asset: FixedAsset): number {
  return parseFloat(asset.cost) - parseFloat(asset.accumulatedDepreciation);
}

// ---------------------------------------------------------------------------
// Add Asset Modal
// ---------------------------------------------------------------------------

function AddAssetModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (asset: FixedAsset) => void;
}) {
  const [form, setForm] = useState<AssetForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function set(field: keyof AssetForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const asset = await api.post<FixedAsset>('/api/fixed-assets', {
        name: form.name.trim(),
        cost: form.cost,
        salvageValue: form.salvageValue || '0',
        usefulLifeMonths: parseInt(form.usefulLifeMonths, 10),
        placedInService: form.placedInService,
      });
      toast('Asset created', 'success');
      onCreated(asset);
      setForm(EMPTY_FORM);
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to create asset', 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Fixed Asset"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button form="add-asset-form" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Add Asset'}
          </Button>
        </>
      }
    >
      <form id="add-asset-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="fa-name">Asset Name</Label>
          <Input
            id="fa-name"
            required
            placeholder="e.g. Office Server, Company Vehicle"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="fa-cost">Cost ($)</Label>
            <Input
              id="fa-cost"
              type="number"
              min="0.01"
              step="0.01"
              required
              placeholder="12000.00"
              value={form.cost}
              onChange={(e) => set('cost', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="fa-salvage">Salvage Value ($)</Label>
            <Input
              id="fa-salvage"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.salvageValue}
              onChange={(e) => set('salvageValue', e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="fa-life">Useful Life (months)</Label>
            <Input
              id="fa-life"
              type="number"
              min="1"
              step="1"
              required
              placeholder="60"
              value={form.usefulLifeMonths}
              onChange={(e) => set('usefulLifeMonths', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="fa-placed">Placed in Service</Label>
            <Input
              id="fa-placed"
              type="date"
              required
              value={form.placedInService}
              onChange={(e) => set('placedInService', e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-navy/50">
          Method: Straight-Line. Monthly depreciation = (Cost - Salvage) / Useful Life.
        </p>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Record Depreciation Modal
// ---------------------------------------------------------------------------

function RecordDepreciationModal({
  asset,
  open,
  onClose,
  onPosted,
}: {
  asset: FixedAsset | null;
  open: boolean;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDate(today());
  }, [open]);

  if (!asset) return null;

  const depBase = parseFloat(asset.cost) - parseFloat(asset.salvageValue);
  const monthly = (depBase / asset.usefulLifeMonths).toFixed(2);
  const remaining = (depBase - parseFloat(asset.accumulatedDepreciation)).toFixed(2);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/api/fixed-assets/${asset!.id}`, { action: 'depreciate', date });
      toast('Depreciation posted', 'success');
      onPosted();
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to post depreciation', 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Record Depreciation — ${asset.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button form="dep-form" type="submit" disabled={saving}>
            {saving ? 'Posting...' : 'Post Depreciation'}
          </Button>
        </>
      }
    >
      <form id="dep-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-navy/60">Monthly Amount</span>
            <span className="font-semibold">{formatCurrency(monthly)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-navy/60">Accumulated to Date</span>
            <span className="font-semibold">{formatCurrency(asset.accumulatedDepreciation)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-navy/60">Remaining Depreciable</span>
            <span className="font-semibold text-electric">{formatCurrency(remaining)}</span>
          </div>
        </div>
        <div>
          <Label htmlFor="dep-date">Depreciation Date</Label>
          <Input
            id="dep-date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <p className="text-xs text-navy/50">
          Posts: Dr Depreciation Expense (6800) / Cr Accumulated Depreciation (1590).
          Amount will be clamped to the remaining depreciable balance.
        </p>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Schedule Modal
// ---------------------------------------------------------------------------

function ScheduleModal({
  assetId,
  open,
  onClose,
}: {
  assetId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !assetId) return;
    setLoading(true);
    api
      .get<AssetDetail>(`/api/fixed-assets/${assetId}`)
      .then(setDetail)
      .catch(() => toast('Failed to load schedule', 'danger'))
      .finally(() => setLoading(false));
  }, [open, assetId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={detail ? `Depreciation Schedule — ${detail.name}` : 'Depreciation Schedule'}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {loading && <p className="text-navy/50 text-sm">Loading...</p>}
      {detail && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-lg bg-slate-50 p-2 text-center">
              <div className="text-navy/50 text-xs">Cost</div>
              <div className="font-bold">{formatCurrency(detail.cost)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2 text-center">
              <div className="text-navy/50 text-xs">Accumulated</div>
              <div className="font-bold">{formatCurrency(detail.accumulatedDepreciation)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2 text-center">
              <div className="text-navy/50 text-xs">Net Book Value</div>
              <div className="font-bold text-electric">
                {formatCurrency(
                  (parseFloat(detail.cost) - parseFloat(detail.accumulatedDepreciation)).toFixed(2),
                )}
              </div>
            </div>
          </div>

          <div className="overflow-y-auto max-h-64">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-navy/10">
                  <th className="py-1.5 px-2 text-left text-navy/60 font-semibold">Period</th>
                  <th className="py-1.5 px-2 text-left text-navy/60 font-semibold">Date</th>
                  <th className="py-1.5 px-2 text-right text-navy/60 font-semibold">Amount</th>
                  <th className="py-1.5 px-2 text-right text-navy/60 font-semibold">Accumulated</th>
                  <th className="py-1.5 px-2 text-right text-navy/60 font-semibold">NBV</th>
                  <th className="py-1.5 px-2 text-center text-navy/60 font-semibold">Posted</th>
                </tr>
              </thead>
              <tbody>
                {detail.schedule.map((row) => {
                  const entry = detail.depreciationEntries.find((e) => {
                    const eDate = new Date(e.date).toISOString().slice(0, 7);
                    const sDate = new Date(row.date).toISOString().slice(0, 7);
                    return eDate === sDate;
                  });
                  return (
                    <tr key={row.period} className="border-b border-slate-50 hover:bg-electric/5">
                      <td className="py-1 px-2 text-navy/70">{row.period}</td>
                      <td className="py-1 px-2 text-navy/70">
                        {new Date(row.date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                        })}
                      </td>
                      <td className="py-1 px-2 text-right">{formatCurrency(row.amount)}</td>
                      <td className="py-1 px-2 text-right">{formatCurrency(row.accumulated)}</td>
                      <td className="py-1 px-2 text-right font-medium">{formatCurrency(row.netBookValue)}</td>
                      <td className="py-1 px-2 text-center">
                        {entry ? (
                          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" title="Posted" />
                        ) : (
                          <span className="inline-block w-2 h-2 rounded-full bg-slate-200" title="Not yet posted" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-navy/40">
            Green dot = depreciation posted for that period.
          </p>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function FixedAssetsPage() {
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [depAsset, setDepAsset] = useState<FixedAsset | null>(null);
  const [scheduleAssetId, setScheduleAssetId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<FixedAsset[]>('/api/fixed-assets');
      setAssets(data);
    } catch {
      toast('Failed to load fixed assets', 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalCost = assets.reduce((s, a) => s + parseFloat(a.cost), 0);
  const totalAccumulated = assets.reduce(
    (s, a) => s + parseFloat(a.accumulatedDepreciation),
    0,
  );
  const totalNBV = totalCost - totalAccumulated;

  return (
    <main className="p-6 max-w-6xl mx-auto space-y-6">
      <Toaster />

      <PageHeader
        title="Fixed Assets"
        icon={Building2}
        action={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Asset
          </Button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4 text-center">
          <p className="text-xs text-navy/50 mb-1">Total Cost</p>
          <p className="text-2xl font-extrabold text-navy">{formatCurrency(totalCost)}</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-xs text-navy/50 mb-1">Accumulated Depreciation</p>
          <p className="text-2xl font-extrabold text-red-500">{formatCurrency(totalAccumulated)}</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-xs text-navy/50 mb-1">Net Book Value</p>
          <p className="text-2xl font-extrabold text-electric">{formatCurrency(totalNBV)}</p>
        </Card>
      </div>

      {/* Assets table */}
      <Card className="p-0 overflow-hidden">
        {loading ? (
          <p className="p-6 text-navy/50 text-sm">Loading...</p>
        ) : assets.length === 0 ? (
          <div className="p-12 text-center">
            <Building2 className="h-12 w-12 text-navy/20 mx-auto mb-3" />
            <p className="text-navy/40 text-sm">No fixed assets yet.</p>
            <Button className="mt-4" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add First Asset
            </Button>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Asset Name</Th>
                <Th>Placed in Service</Th>
                <Th>Useful Life</Th>
                <Th className="text-right">Cost</Th>
                <Th className="text-right">Accumulated Dep.</Th>
                <Th className="text-right">Net Book Value</Th>
                <Th className="text-center">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => {
                const nbv = netBookValue(asset);
                const fullyDep =
                  parseFloat(asset.accumulatedDepreciation) >=
                  parseFloat(asset.cost) - parseFloat(asset.salvageValue);
                return (
                  <Tr key={asset.id}>
                    <Td className="font-medium">{asset.name}</Td>
                    <Td className="text-navy/60 text-sm">
                      {new Date(asset.placedInService).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Td>
                    <Td className="text-navy/60 text-sm">{asset.usefulLifeMonths} mo</Td>
                    <Td className="text-right font-mono text-sm">
                      {formatCurrency(asset.cost)}
                    </Td>
                    <Td className="text-right font-mono text-sm text-red-500">
                      {formatCurrency(asset.accumulatedDepreciation)}
                    </Td>
                    <Td className="text-right font-mono text-sm font-semibold text-electric">
                      {formatCurrency(nbv.toFixed(2))}
                    </Td>
                    <Td className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setScheduleAssetId(asset.id)}
                          title="View depreciation schedule"
                        >
                          <Calendar className="h-3.5 w-3.5" />
                          Schedule
                        </Button>
                        {!fullyDep && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setDepAsset(asset)}
                            title="Record one period of depreciation"
                          >
                            <TrendingDown className="h-3.5 w-3.5" />
                            Depreciate
                          </Button>
                        )}
                        {fullyDep && (
                          <span className="text-xs text-navy/40 italic">Fully depreciated</span>
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Modals */}
      <AddAssetModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(asset) => setAssets((prev) => [...prev, asset])}
      />

      <RecordDepreciationModal
        asset={depAsset}
        open={depAsset !== null}
        onClose={() => setDepAsset(null)}
        onPosted={load}
      />

      <ScheduleModal
        assetId={scheduleAssetId}
        open={scheduleAssetId !== null}
        onClose={() => setScheduleAssetId(null)}
      />
    </main>
  );
}
