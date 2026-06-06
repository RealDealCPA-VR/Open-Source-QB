'use client';

/**
 * Attachments page — attach receipts and files to any entity (invoice, bill, expense, etc.).
 *
 * UX:
 *  1. User picks an entity type from a dropdown and enters the entity UUID.
 *  2. The page lists all existing attachments for that entity.
 *  3. A file <input> lets the user pick a local file. On "Upload" the file is read
 *     as base64 and POSTed to /api/attachments.
 *  4. Each listed row has a Download link and a Delete button.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Upload, Trash2, Download } from 'lucide-react';
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

interface Attachment {
  id: string;
  entityType: string;
  entityId: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  storagePath: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTITY_TYPES = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'bill', label: 'Bill' },
  { value: 'expense', label: 'Expense' },
  { value: 'journal_entry', label: 'Journal Entry' },
  { value: 'customer', label: 'Customer' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'employee', label: 'Employee' },
  { value: 'paycheck', label: 'Paycheck' },
  { value: 'other', label: 'Other' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(n: number | null): string {
  if (n === null || n === undefined) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:<mime>;base64,<data>" — strip the prefix
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AttachmentsPage() {
  // Entity picker state
  const [entityType, setEntityType] = useState<string>(ENTITY_TYPES[0].value);
  const [entityId, setEntityId] = useState<string>('');

  // Attachments list
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Deleting state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch attachments for entity
  // ---------------------------------------------------------------------------

  const fetchAttachments = useCallback(async () => {
    if (!entityId.trim()) {
      toast('Enter an entity ID first', 'danger');
      return;
    }
    setListLoading(true);
    setHasSearched(true);
    try {
      const list = await api.get<Attachment[]>(
        `/api/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId.trim())}`,
      );
      setAttachments(list);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load attachments', 'danger');
    } finally {
      setListLoading(false);
    }
  }, [entityType, entityId]);

  // Re-fetch whenever the user clicks Load (not on every keystroke)
  // But auto-fetch when entityId is cleared
  useEffect(() => {
    if (!entityId.trim()) {
      setAttachments([]);
      setHasSearched(false);
    }
  }, [entityId]);

  // ---------------------------------------------------------------------------
  // Upload handler
  // ---------------------------------------------------------------------------

  async function handleUpload() {
    if (!selectedFile) {
      toast('Select a file first', 'danger');
      return;
    }
    if (!entityId.trim()) {
      toast('Enter an entity ID first', 'danger');
      return;
    }

    setUploading(true);
    try {
      const base64 = await readFileAsBase64(selectedFile);
      await api.post('/api/attachments', {
        entityType,
        entityId: entityId.trim(),
        filename: selectedFile.name,
        mimeType: selectedFile.type || 'application/octet-stream',
        base64,
      });
      toast(`"${selectedFile.name}" uploaded`, 'success');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await fetchAttachments();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Upload failed', 'danger');
    } finally {
      setUploading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete handler
  // ---------------------------------------------------------------------------

  async function handleDelete(att: Attachment) {
    if (!confirm(`Delete "${att.filename}"? This cannot be undone.`)) return;
    setDeletingId(att.id);
    try {
      await api.del(`/api/attachments/${att.id}`);
      toast(`"${att.filename}" deleted`, 'success');
      setAttachments((prev) => prev.filter((a) => a.id !== att.id));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Delete failed', 'danger');
    } finally {
      setDeletingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader title="Attachments" icon={Paperclip} />

      {/* ---- Entity picker ---- */}
      <Card className="p-6 mb-6 max-w-2xl">
        <h2 className="text-base font-bold text-navy mb-4">Find attachments for a record</h2>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="entityType">Entity Type</Label>
              <Select
                id="entityType"
                value={entityType}
                onChange={(e) => {
                  setEntityType(e.target.value);
                  setAttachments([]);
                  setHasSearched(false);
                }}
              >
                {ENTITY_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="entityId">Entity ID (UUID)</Label>
              <Input
                id="entityId"
                placeholder="e.g. 123e4567-e89b-12d3-..."
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchAttachments()}
              />
            </div>
          </div>
          <div>
            <Button variant="secondary" onClick={fetchAttachments} disabled={listLoading}>
              {listLoading ? 'Loading...' : 'Load Attachments'}
            </Button>
          </div>
        </div>
      </Card>

      {/* ---- Upload panel ---- */}
      {entityId.trim() && (
        <Card className="p-6 mb-6 max-w-2xl">
          <h2 className="text-base font-bold text-navy mb-4">
            Upload a file to{' '}
            <span className="text-electric">
              {ENTITY_TYPES.find((t) => t.value === entityType)?.label ?? entityType}
            </span>{' '}
            <span className="font-mono text-sm text-navy/60">{entityId.trim()}</span>
          </h2>
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <Label htmlFor="fileInput">Choose file</Label>
              <input
                id="fileInput"
                ref={fileInputRef}
                type="file"
                className="block w-full text-sm text-navy/70 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-electric/10 file:text-electric file:font-semibold hover:file:bg-electric/20 cursor-pointer"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Button onClick={handleUpload} disabled={uploading || !selectedFile}>
              <Upload className="h-4 w-4" />
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
          {selectedFile && (
            <p className="mt-2 text-xs text-navy/50">
              Selected: <span className="font-medium text-navy">{selectedFile.name}</span> (
              {formatBytes(selectedFile.size)})
            </p>
          )}
        </Card>
      )}

      {/* ---- Attachments list ---- */}
      {hasSearched && (
        <Card className="max-w-4xl">
          {listLoading ? (
            <div className="p-12 text-center text-navy/40 text-sm">Loading...</div>
          ) : attachments.length === 0 ? (
            <div className="p-12 text-center">
              <Paperclip className="mx-auto h-10 w-10 text-navy/20 mb-3" />
              <p className="text-navy/50 text-sm">No attachments found for this record.</p>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Filename</Th>
                  <Th>Type</Th>
                  <Th>Size</Th>
                  <Th>Uploaded</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {attachments.map((att) => (
                  <Tr key={att.id}>
                    <Td className="font-medium text-navy">{att.filename}</Td>
                    <Td>
                      {att.mimeType ? (
                        <Badge tone="info">{att.mimeType.split('/')[1] ?? att.mimeType}</Badge>
                      ) : (
                        <span className="text-navy/40">-</span>
                      )}
                    </Td>
                    <Td className="text-navy/70 tabular-nums">{formatBytes(att.sizeBytes)}</Td>
                    <Td className="text-navy/60 text-sm">
                      {new Date(att.createdAt).toLocaleString()}
                    </Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={`/api/attachments/${att.id}`}
                          download={att.filename}
                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-electric hover:bg-electric/10 transition-colors"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </a>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:bg-red-50"
                          disabled={deletingId === att.id}
                          onClick={() => handleDelete(att)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {deletingId === att.id ? 'Deleting...' : 'Delete'}
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <Toaster />
    </main>
  );
}
