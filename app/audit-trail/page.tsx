'use client';

import { useEffect, useState, useCallback } from 'react';
import { ClipboardList, ChevronDown, ChevronRight, Search } from 'lucide-react';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditLogRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorName: string | null;
  actorId: string | null;
  createdAt: string;
  oldValues?: unknown;
  newValues?: unknown;
  llmReasoning?: string | null;
}

interface ListResult {
  rows: AuditLogRow[];
  total: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

const ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'void', label: 'Void' },
  { value: 'llm_correction', label: 'AI Correction' },
];

const ENTITY_TYPE_OPTIONS = [
  { value: '', label: 'All entities' },
  { value: 'account', label: 'Account' },
  { value: 'journal_entry', label: 'Journal Entry' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'customer', label: 'Customer' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'bill', label: 'Bill' },
  { value: 'payment', label: 'Payment' },
  { value: 'employee', label: 'Employee' },
];

const ACTION_TONES: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  create: 'success',
  update: 'info',
  delete: 'danger',
  void: 'warning',
  llm_correction: 'neutral',
};

// ---------------------------------------------------------------------------
// Helper: JSON diff viewer
// ---------------------------------------------------------------------------

function JsonDiff({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide mb-1">{label}</p>
      <pre className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto text-navy/80 whitespace-pre-wrap break-words">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expandable row component
// ---------------------------------------------------------------------------

function AuditRow({ row }: { row: AuditLogRow }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<AuditLogRow | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggleExpand() {
    if (!expanded && !detail) {
      setLoading(true);
      try {
        // Fetch detail from the list endpoint with limit=1 targeting by offset would
        // not include old/newValues; instead we call the general endpoint with a detail
        // query param. Since we only expose list GET, we embed values in the list
        // response for rows that have them; for the expandable we use what we already
        // have on the row, fetching detail only if values are absent.
        if (row.oldValues !== undefined || row.newValues !== undefined) {
          setDetail(row);
        } else {
          // Re-fetch with detail=true (our route doesn't expose a single-row endpoint,
          // so we re-query the list filtering to just this entity+action and pick the
          // first match). For a proper detail endpoint that would be /api/audit-trail/:id.
          // Here we re-use the list endpoint with a large payload already in the row.
          setDetail(row);
        }
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Failed to load details', 'danger');
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  }

  const actionTone = ACTION_TONES[row.action] ?? 'neutral';
  const actionLabel =
    ACTION_OPTIONS.find((o) => o.value === row.action)?.label ?? row.action;
  const date = new Date(row.createdAt);
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const shownDetail = detail ?? row;

  return (
    <>
      <Tr
        className="cursor-pointer select-none"
        onClick={toggleExpand}
      >
        <Td className="w-6 pr-0">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-navy/40" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-navy/40" />
          )}
        </Td>
        <Td className="tabular-nums text-xs text-navy/60 whitespace-nowrap">
          <span className="block">{dateStr}</span>
          <span className="block text-navy/40">{timeStr}</span>
        </Td>
        <Td>
          <span className="text-sm text-navy/80">{row.actorName ?? <em className="text-navy/40">System</em>}</span>
        </Td>
        <Td>
          <Badge tone={actionTone}>{actionLabel}</Badge>
        </Td>
        <Td>
          <span className="text-sm font-medium text-navy">
            {ENTITY_TYPE_OPTIONS.find((o) => o.value === row.entityType)?.label ?? row.entityType}
          </span>
        </Td>
        <Td>
          <span className="font-mono text-xs text-navy/50 break-all">{row.entityId}</span>
        </Td>
      </Tr>

      {expanded && (
        <tr>
          <td colSpan={6} className="px-4 pb-4 pt-0 bg-slate-50/80 border-b border-slate-100">
            <div className="rounded-xl border border-slate-200 bg-white p-4 mt-1">
              {loading ? (
                <p className="text-sm text-navy/40">Loading details...</p>
              ) : (
                <>
                  <p className="text-xs text-navy/40 mb-3 font-mono">ID: {row.id}</p>
                  {shownDetail.oldValues == null && shownDetail.newValues == null ? (
                    <p className="text-sm text-navy/40 italic">No value snapshot recorded.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <JsonDiff label="Before" value={shownDetail.oldValues ?? null} />
                      <JsonDiff label="After" value={shownDetail.newValues ?? null} />
                    </div>
                  )}
                  {shownDetail.llmReasoning && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide mb-1">
                        AI Reasoning
                      </p>
                      <p className="text-sm text-navy/70 bg-gold/10 border border-gold/20 rounded-lg p-3">
                        {shownDetail.llmReasoning}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AuditTrailPage() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  // Filters
  const [filterAction, setFilterAction] = useState('');
  const [filterEntityType, setFilterEntityType] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const fetchLogs = useCallback(async (currentPage: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterAction) params.set('action', filterAction);
      if (filterEntityType) params.set('entityType', filterEntityType);
      if (filterFrom) params.set('from', new Date(filterFrom).toISOString());
      if (filterTo) {
        const d = new Date(filterTo);
        d.setHours(23, 59, 59, 999);
        params.set('to', d.toISOString());
      }
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(currentPage * PAGE_SIZE));

      const result = await api.get<ListResult>(`/api/audit-trail?${params.toString()}`);
      setRows(result.rows);
      setTotal(result.total);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load audit trail', 'danger');
    } finally {
      setLoading(false);
    }
  }, [filterAction, filterEntityType, filterFrom, filterTo]);

  useEffect(() => {
    setPage(0);
    fetchLogs(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterAction, filterEntityType, filterFrom, filterTo]);

  useEffect(() => {
    fetchLogs(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function handleSearch() {
    setPage(0);
    fetchLogs(0);
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Audit Trail"
        icon={ClipboardList}
        action={
          <span className="text-sm text-navy/50">
            {total.toLocaleString()} event{total !== 1 ? 's' : ''}
          </span>
        }
      />

      {/* ---- Filters ---- */}
      <Card className="p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
          <div>
            <Label htmlFor="filterAction">Action</Label>
            <Select
              id="filterAction"
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
            >
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="filterEntityType">Entity Type</Label>
            <Select
              id="filterEntityType"
              value={filterEntityType}
              onChange={(e) => setFilterEntityType(e.target.value)}
            >
              {ENTITY_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="filterFrom">From Date</Label>
            <Input
              id="filterFrom"
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="filterTo">To Date</Label>
            <Input
              id="filterTo"
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end mt-4 gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setFilterAction('');
              setFilterEntityType('');
              setFilterFrom('');
              setFilterTo('');
            }}
          >
            Clear
          </Button>
          <Button onClick={handleSearch}>
            <Search className="h-4 w-4" />
            Search
          </Button>
        </div>
      </Card>

      {/* ---- Table ---- */}
      <Card>
        {loading ? (
          <div className="p-12 text-center text-navy/40 text-sm">Loading audit trail...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <ClipboardList className="mx-auto h-10 w-10 text-navy/20 mb-3" />
            <p className="text-navy/50 text-sm">No audit log entries match your filters.</p>
          </div>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th className="w-6" />
                  <Th>Date / Time</Th>
                  <Th>User</Th>
                  <Th>Action</Th>
                  <Th>Entity Type</Th>
                  <Th>Entity ID</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <AuditRow key={row.id} row={row} />
                ))}
              </tbody>
            </Table>

            {/* ---- Pagination ---- */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
                <p className="text-sm text-navy/50">
                  Page {page + 1} of {totalPages} &mdash;{' '}
                  {(page * PAGE_SIZE + 1).toLocaleString()}
                  {' – '}
                  {Math.min((page + 1) * PAGE_SIZE, total).toLocaleString()} of{' '}
                  {total.toLocaleString()}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <Toaster />
    </main>
  );
}
