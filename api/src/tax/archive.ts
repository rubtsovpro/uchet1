/**
 * Архив эталонов налоговых форм (PDF/XLS) для сверки по org.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { all, get, run } from '../db.js';
import { newGuid } from '../ids.js';
import { resolveOrganizationId } from '../organizations.js';
import { ensureTaxSchema, orgTaxDir } from './schema.js';

export type ArchiveRow = {
  id: string;
  organization_id: string;
  title: string;
  kind: string;
  period_label: string;
  filename: string;
  mime: string;
  size_bytes: number;
  notes: string;
  uploaded_by: string;
  created_at: string;
};

export async function listArchive(organizationId: string | null | undefined, kind?: string): Promise<ArchiveRow[]> {
  await ensureTaxSchema();
  const oid = await resolveOrganizationId(organizationId);
  if (kind) {
    return await all<ArchiveRow>(
      `SELECT id, organization_id, title, kind, period_label, filename, mime, size_bytes, notes, uploaded_by, created_at
       FROM tax_archive WHERE organization_id=? AND kind=? ORDER BY created_at DESC LIMIT 200`,
      [oid, kind]
    );
  }
  return await all<ArchiveRow>(
    `SELECT id, organization_id, title, kind, period_label, filename, mime, size_bytes, notes, uploaded_by, created_at
     FROM tax_archive WHERE organization_id=? ORDER BY created_at DESC LIMIT 200`,
    [oid]
  );
}

export async function getArchiveMeta(id: string) {
  await ensureTaxSchema();
  return await get<{
    id: string;
    organization_id: string;
    title: string;
    kind: string;
    filename: string;
    mime: string;
    stored_path: string;
  }>(
    `SELECT id, organization_id, title, kind, filename, mime, stored_path FROM tax_archive WHERE id=?`,
    [id]
  );
}

export async function readArchiveBytes(id: string): Promise<{ meta: NonNullable<Awaited<ReturnType<typeof getArchiveMeta>>>; buf: Buffer } | null> {
  const meta = await getArchiveMeta(id);
  if (!meta?.stored_path || !existsSync(meta.stored_path)) return null;
  return { meta, buf: readFileSync(meta.stored_path) };
}

export async function saveArchiveUpload(opts: {
  organizationId: string | null | undefined;
  kind: string;
  title?: string;
  periodLabel?: string;
  notes?: string;
  originalName: string;
  mime: string;
  buffer: Buffer;
  uploadedBy?: string;
}): Promise<{ id: string }> {
  await ensureTaxSchema();
  const oid = await resolveOrganizationId(opts.organizationId);
  const kind = String(opts.kind || 'other').slice(0, 64);
  const dir = path.join(orgTaxDir(oid, 'archive'), kind);
  mkdirSync(dir, { recursive: true });
  const id = newGuid();
  const safe = String(opts.originalName || 'file')
    .replace(/[^\w.\-а-яА-ЯёЁ]+/gi, '_')
    .slice(0, 120);
  const filePath = path.join(dir, `${id}_${safe}`);
  writeFileSync(filePath, opts.buffer);
  await run(
    `INSERT INTO tax_archive (
       id, organization_id, title, kind, period_label, filename, mime, size_bytes, stored_path, notes, uploaded_by
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      oid,
      opts.title || opts.originalName,
      kind,
      opts.periodLabel || '',
      opts.originalName,
      opts.mime || 'application/octet-stream',
      opts.buffer.length,
      filePath,
      opts.notes || '',
      opts.uploadedBy || '',
    ]
  );
  return { id };
}

export async function deleteArchive(id: string): Promise<boolean> {
  await ensureTaxSchema();
  const row = await getArchiveMeta(id);
  if (!row) return false;
  await run(`DELETE FROM tax_archive WHERE id=?`, [id]);
  return true;
}
