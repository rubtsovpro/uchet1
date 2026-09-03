import { get, run } from './db.js';

const META_KEY = 'help_lc_marks';

export const HELP_LC_MARK_COLORS = [
  'teal',
  'amber',
  'rose',
  'violet',
  'sky',
  'lime',
] as const;

export type HelpLcMarkColor = (typeof HELP_LC_MARK_COLORS)[number];

type Stored = {
  marks: Record<string, HelpLcMarkColor>;
  updated_at: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
};

const COLOR_SET = new Set<string>(HELP_LC_MARK_COLORS);

function sanitizeMarks(raw: unknown): Record<string, HelpLcMarkColor> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, HelpLcMarkColor> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(k || '').trim();
    const color = String(v || '').trim();
    if (!id || id.length > 64) continue;
    if (!COLOR_SET.has(color)) continue;
    out[id] = color as HelpLcMarkColor;
  }
  return out;
}

function readStored(): Stored {
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [META_KEY]);
  if (!row?.value) {
    return { marks: {}, updated_at: null, updated_by: null, updated_by_name: null };
  }
  try {
    const parsed = JSON.parse(row.value) as Partial<Stored> & Record<string, unknown>;
    // Старый формат: просто { nodeId: color }
    if (parsed && typeof parsed === 'object' && !('marks' in parsed)) {
      return {
        marks: sanitizeMarks(parsed),
        updated_at: null,
        updated_by: null,
        updated_by_name: null,
      };
    }
    return {
      marks: sanitizeMarks(parsed.marks),
      updated_at: parsed.updated_at ? String(parsed.updated_at) : null,
      updated_by: parsed.updated_by ? String(parsed.updated_by) : null,
      updated_by_name: parsed.updated_by_name ? String(parsed.updated_by_name) : null,
    };
  } catch {
    return { marks: {}, updated_at: null, updated_by: null, updated_by_name: null };
  }
}

function writeStored(next: Stored): void {
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [META_KEY, JSON.stringify(next)]);
}

export function getHelpLcMarks(): Stored {
  return readStored();
}

export function putHelpLcMarks(
  marksRaw: unknown,
  actor: { id: string; name: string } | null
): Stored {
  const next: Stored = {
    marks: sanitizeMarks(marksRaw),
    updated_at: new Date().toISOString(),
    updated_by: actor?.id || null,
    updated_by_name: actor?.name || null,
  };
  writeStored(next);
  return next;
}
