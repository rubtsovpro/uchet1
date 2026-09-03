/**
 * Общий доступ к Google SA (Drive / Docs).
 * JSON: GOOGLE_SA_JSON или пути bank / локальный дев.
 */
import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const GOOGLE_SA_EMAIL = 'pnevmopodveska1-bank@pnevmopodveska1.iam.gserviceaccount.com';

type SaJson = { client_email: string; private_key: string };

function saJsonPath(): string {
  const candidates = [
    process.env.GOOGLE_SA_JSON || '',
    '/root/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json',
    '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0] || '';
}

function loadSa(): SaJson {
  const p = saJsonPath();
  if (!existsSync(p)) throw new Error(`Нет GOOGLE_SA_JSON: ${p}`);
  const j = JSON.parse(readFileSync(p, 'utf8')) as SaJson;
  if (!j.client_email || !j.private_key) throw new Error('Битый SA JSON');
  return j;
}

const cache = new Map<string, { token: string; exp: number }>();

/** JWT → access_token. scopes через пробел. */
export async function googleAccessToken(
  scopes = 'https://www.googleapis.com/auth/drive.readonly'
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const hit = cache.get(scopes);
  if (hit && hit.exp > now + 60) return hit.token;
  const sa = loadSa();
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: scopes,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  ).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${sign.sign(sa.private_key, 'base64url')}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Google token: ${data.error || res.status}`);
  }
  const entry = {
    token: data.access_token,
    exp: now + (Number(data.expires_in) || 3600),
  };
  cache.set(scopes, entry);
  return entry.token;
}

/** Export Google Doc → plain text. */
export async function exportGoogleDocPlainText(docId: string): Promise<string> {
  return exportDriveFilePlainText(docId);
}

/** Метаданные файла Drive. */
export async function getDriveFileMeta(fileId: string): Promise<{
  id: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
}> {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('file id required');
  const token = await googleAccessToken('https://www.googleapis.com/auth/drive.readonly');
  const u = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  u.searchParams.set('fields', 'id,name,mimeType,webViewLink');
  u.searchParams.set('supportsAllDrives', 'true');
  const res = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const data = (await res.json()) as {
    id?: string;
    name?: string;
    mimeType?: string;
    webViewLink?: string;
    error?: { message?: string };
  };
  if (!res.ok || !data.id) {
    throw new Error(
      data.error?.message ||
        `Drive meta ${res.status}. Расшарьте на ${GOOGLE_SA_EMAIL} хотя бы «Читатель».`
    );
  }
  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType,
    webViewLink: data.webViewLink,
  };
}

/** Google Doc или DOCX из Drive → plain text. */
export async function exportDriveFilePlainText(fileId: string): Promise<string> {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('google_doc_id required');
  const meta = await getDriveFileMeta(id);
  const mime = String(meta.mimeType || '');
  const token = await googleAccessToken(
    'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/documents.readonly'
  );

  if (mime === 'application/vnd.google-apps.document') {
    const url =
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}` +
      `/export?mimeType=${encodeURIComponent('text/plain')}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(
        `Не удалось прочитать Google Doc (${res.status}). Расшарьте на ${GOOGLE_SA_EMAIL} хотя бы «Читатель». ${t.slice(0, 160)}`
      );
    }
    return await res.text();
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword' ||
    /\.docx$/i.test(String(meta.name || ''))
  ) {
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Не удалось скачать DOCX (${res.status}). ${t.slice(0, 160)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return docxBufferToPlainText(buf);
  }

  throw new Error(
    `Файл «${meta.name || id}» тип ${mime || '?'}: нужен Google Doc или DOCX.`
  );
}

function docxBufferToPlainText(buf: Buffer): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'wms-docx-'));
  const file = path.join(dir, 'f.docx');
  try {
    writeFileSync(file, buf);
    const xml = execFileSync('unzip', ['-p', file, 'word/document.xml'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab[^/]*\/>/g, '\t')
      .replace(/<w:br[^/]*\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export type DriveListFile = {
  id: string;
  name: string;
  mimeType?: string;
  webViewLink?: string;
  modifiedTime?: string;
};

export async function listDriveFolderFiles(folderId: string): Promise<DriveListFile[]> {
  const fid = String(folderId || '').trim();
  if (!fid) return [];
  const token = await googleAccessToken('https://www.googleapis.com/auth/drive.readonly');
  const q = `'${fid.replace(/'/g, "\\'")}' in parents and trashed = false`;
  const u = new URL('https://www.googleapis.com/drive/v3/files');
  u.searchParams.set('q', q);
  u.searchParams.set('pageSize', '100');
  u.searchParams.set('orderBy', 'folder,name');
  u.searchParams.set('fields', 'files(id,name,mimeType,webViewLink,modifiedTime)');
  u.searchParams.set('supportsAllDrives', 'true');
  u.searchParams.set('includeItemsFromAllDrives', 'true');
  const res = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const data = (await res.json()) as { files?: DriveListFile[]; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(data.error?.message || `Drive list ${res.status}`);
  }
  return data.files || [];
}
