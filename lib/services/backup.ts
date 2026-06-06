/**
 * Backup/restore service for a company data directory.
 *
 * A BookKeeper backup (.bka) is simply a zip archive of the PGlite data
 * directory. No DB connection is required — we operate directly on the
 * filesystem, so this module is intentionally independent of the DB layer
 * and ServiceContext (no companyId scoping needed; the whole dir is the
 * company file).
 *
 * adm-zip operates entirely in memory, keeping the backup path simple and
 * portable across Electron / Next dev / CI.
 */
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { resolveDataDir } from '@/lib/db';

// ---------------------------------------------------------------------------
// createBackup
// ---------------------------------------------------------------------------

export interface BackupResult {
  buffer: Buffer;
  filename: string;
}

/**
 * Zip the entire company data directory into an in-memory Buffer.
 *
 * @param companyName  Optional name embedded in the filename for clarity.
 * @param dataDir      Optional path override; defaults to the active company
 *                     data dir via resolveDataDir().
 * @returns { buffer, filename } — filename is 'bookkeeper-backup-<slug>.bka'.
 */
export function createBackup(companyName?: string, dataDir?: string): BackupResult {
  const dir = resolveDataDir(dataDir);

  if (!fs.existsSync(dir)) {
    throw new Error(`Data directory not found: ${dir}`);
  }

  const zip = new AdmZip();
  // addLocalFolder adds all files/dirs recursively under dir into the root of
  // the zip, preserving the internal directory tree.
  zip.addLocalFolder(dir);

  const buffer = zip.toBuffer();

  // Build a safe filename slug from the company name (if provided).
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // e.g. 2026-06-06T12-00-00
  const slug = companyName
    ? `-${companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    : '';
  const filename = `bookkeeper-backup${slug}-${ts}.bka`;

  return { buffer, filename };
}

// ---------------------------------------------------------------------------
// restoreBackup
// ---------------------------------------------------------------------------

export interface RestoreResult {
  restored: true;
}

/**
 * Extract a .bka zip buffer into the target data directory, overwriting any
 * existing files.
 *
 * NOTE: After restoring, the running PGlite instance still holds the old data
 * in memory. A process restart (or closeDb + openDb) is required before the
 * restored data becomes visible to the application.
 *
 * @param buffer     The raw bytes of a .bka backup file.
 * @param targetDir  Optional path override; defaults to resolveDataDir().
 */
export function restoreBackup(buffer: Buffer, targetDir?: string): RestoreResult {
  const dir = resolveDataDir(targetDir);

  // Ensure the target directory exists before extracting.
  fs.mkdirSync(dir, { recursive: true });

  const zip = new AdmZip(buffer);
  // extractAllTo(target, overwrite=true) replaces existing files.
  zip.extractAllTo(dir, /* overwrite */ true);

  return { restored: true };
}
