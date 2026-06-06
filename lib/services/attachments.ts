/**
 * Document attachments service.
 *
 * Stores uploaded files under <dataDir>/attachments/ and tracks metadata in the
 * `attachments` table. Files are named <uuid>-<original-filename> on disk, but
 * the DB row stores only the relative `storagePath` so the records remain portable
 * if the data directory is moved.
 *
 * Conventions: every public function is scoped to ctx.companyId — callers can
 * never touch another company's attachments.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { resolveDataDir } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { type ServiceContext, notFound, validation, writeAudit } from './_base';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Absolute path to the attachments storage folder for the active data directory. */
function attachmentsDir(): string {
  const dataDir = resolveDataDir();
  return path.join(dataDir, 'attachments');
}

/** Ensure the storage folder exists (idempotent). */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttachmentRow {
  id: string;
  companyId: string;
  entityType: string;
  entityId: string;
  filename: string;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: Date;
}

export interface SaveAttachmentParams {
  entityType: string;
  entityId: string;
  filename: string;
  mimeType: string;
  /** Base64-encoded file contents. */
  base64: string;
}

// ---------------------------------------------------------------------------
// saveAttachment
// ---------------------------------------------------------------------------

/**
 * Decode a base64 payload, write the file to disk, insert an `attachments` row,
 * and return the new row. The `storagePath` stored in the DB is relative to the
 * data directory so it survives directory moves.
 */
export async function saveAttachment(
  ctx: ServiceContext,
  params: SaveAttachmentParams,
): Promise<AttachmentRow> {
  const { entityType, entityId, filename, mimeType, base64 } = params;

  if (!entityType) throw validation('entityType is required');
  if (!entityId) throw validation('entityId is required');
  if (!filename) throw validation('filename is required');
  if (!base64) throw validation('base64 content is required');

  // Decode
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw validation('base64 content is invalid');
  }

  const dir = attachmentsDir();
  ensureDir(dir);

  // Build a safe on-disk name: <uuid>-<sanitized-filename>
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const diskName = `${randomUUID()}-${safe}`;
  const absolutePath = path.join(dir, diskName);

  // Write file synchronously so any OS error is caught before the DB insert.
  fs.writeFileSync(absolutePath, buffer);

  // Store a relative path so the record doesn't break if BKA_DATA_DIR changes.
  const storagePath = path.join('attachments', diskName);

  const [row] = await ctx.db
    .insert(attachments)
    .values({
      companyId: ctx.companyId,
      entityType,
      entityId,
      filename,
      storagePath,
      mimeType: mimeType || null,
      sizeBytes: buffer.length,
    })
    .returning();

  await writeAudit(ctx, {
    action: 'create',
    entityType: 'attachment',
    entityId: row.id,
    newValues: { entityType, entityId, filename, sizeBytes: buffer.length },
  });

  return row as AttachmentRow;
}

// ---------------------------------------------------------------------------
// listAttachments
// ---------------------------------------------------------------------------

export interface ListAttachmentsParams {
  entityType: string;
  entityId: string;
}

/** Return all attachments for a given entity, scoped to the company. */
export async function listAttachments(
  ctx: ServiceContext,
  params: ListAttachmentsParams,
): Promise<AttachmentRow[]> {
  const rows = await ctx.db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.companyId, ctx.companyId),
        eq(attachments.entityType, params.entityType),
        eq(attachments.entityId, params.entityId),
      ),
    );
  return rows as AttachmentRow[];
}

// ---------------------------------------------------------------------------
// getAttachmentFile
// ---------------------------------------------------------------------------

export interface AttachmentFile {
  filename: string;
  mimeType: string | null;
  buffer: Buffer;
}

/**
 * Look up an attachment by id (verifying company ownership), read the file from
 * disk, and return its contents as a Buffer together with metadata.
 */
export async function getAttachmentFile(
  ctx: ServiceContext,
  id: string,
): Promise<AttachmentFile> {
  const [row] = await ctx.db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.companyId, ctx.companyId)));

  if (!row) throw notFound('Attachment');

  const dataDir = resolveDataDir();
  const absolutePath = path.join(dataDir, row.storagePath);

  if (!fs.existsSync(absolutePath)) {
    throw notFound('Attachment file on disk');
  }

  const buffer = fs.readFileSync(absolutePath);
  return { filename: row.filename, mimeType: row.mimeType ?? null, buffer };
}

// ---------------------------------------------------------------------------
// deleteAttachment
// ---------------------------------------------------------------------------

/**
 * Remove the DB row and the on-disk file.  Best-effort file deletion: if the
 * file is already gone we still succeed (idempotent cleanup).
 */
export async function deleteAttachment(ctx: ServiceContext, id: string): Promise<void> {
  const [row] = await ctx.db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.companyId, ctx.companyId)));

  if (!row) throw notFound('Attachment');

  // Remove DB row first; if the file delete fails we still keep the DB clean.
  await ctx.db
    .delete(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.companyId, ctx.companyId)));

  await writeAudit(ctx, {
    action: 'delete',
    entityType: 'attachment',
    entityId: id,
    oldValues: { entityType: row.entityType, entityId: row.entityId, filename: row.filename },
  });

  // Best-effort file removal.
  try {
    const dataDir = resolveDataDir();
    const absolutePath = path.join(dataDir, row.storagePath);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch {
    // Non-fatal: log but don't throw.
    console.warn(`[attachments] could not delete file for attachment ${id}`);
  }
}
