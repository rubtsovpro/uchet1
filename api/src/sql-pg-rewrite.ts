/**
 * SQL dialect bridge: SQLite → Postgres (best-effort, runtime).
 * Placeholders: ? → $1,$2,…
 */

/** Rewrite datetime(expr) with nested parens (COALESCE/IFNULL args contain commas). */
function rewriteDatetimeCalls(sql: string): string {
  let s = String(sql || '');
  const re = /\bdatetime\s*\(/gi;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index;
    let i = start + m[0].length;
    let depth = 1;
    let inSq = false;
    let inDq = false;
    while (i < s.length && depth > 0) {
      const ch = s[i];
      if (ch === "'" && !inDq) {
        if (inSq && s[i + 1] === "'") {
          i += 2;
          continue;
        }
        inSq = !inSq;
        i += 1;
        continue;
      }
      if (ch === '"' && !inSq) {
        inDq = !inDq;
        i += 1;
        continue;
      }
      if (!inSq && !inDq) {
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
      }
      i += 1;
    }
    if (depth !== 0) break;
    const inner = s.slice(start + m[0].length, i - 1).trim();
    out += s.slice(last, start);
    const nowLit = /^['"]now['"]$/i.test(inner);
    if (nowLit) {
      out += 'NOW()';
    } else if (/^['"]now['"]\s*,\s*\?/i.test(inner)) {
      out += `(NOW() + (?::text)::interval)`;
    } else if (/^\?\s*,\s*\?$/.test(inner)) {
      out += `((?)::timestamptz + (?::text)::interval)`;
    } else if (/^([^,]+?)\s*,\s*\?$/.test(inner)) {
      const expr = inner.replace(/^([^,]+?)\s*,\s*\?$/, '$1').trim();
      out += `((${expr})::timestamptz + (?::text)::interval)`;
    } else if (/,/.test(inner) && /^['"]now['"]/i.test(inner)) {
      // already handled by earlier literal interval replaces; leave for safety
      out += s.slice(start, i);
    } else if (!/,/.test(inner) || /\(/.test(inner)) {
      // single expr OR nested COALESCE(...) — cast whole inner
      const topComma = (() => {
        let d = 0;
        let sq = false;
        let dq = false;
        for (let j = 0; j < inner.length; j++) {
          const c = inner[j];
          if (c === "'" && !dq) {
            if (sq && inner[j + 1] === "'") {
              j += 1;
              continue;
            }
            sq = !sq;
            continue;
          }
          if (c === '"' && !sq) {
            dq = !dq;
            continue;
          }
          if (!sq && !dq) {
            if (c === '(') d += 1;
            else if (c === ')') d -= 1;
            else if (c === ',' && d === 0) return true;
          }
        }
        return false;
      })();
      if (topComma) {
        // two-arg datetime not matched above — keep original (should be rare)
        out += s.slice(start, i);
      } else {
        out += `((${inner})::timestamptz)`;
      }
    } else {
      out += s.slice(start, i);
    }
    last = i;
    re.lastIndex = i;
  }
  out += s.slice(last);
  return out;
}

export function rewriteSqlForPg(sql: string): string {
  let s = String(sql || '');

  s = s.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
  // SQLite instr(haystack, needle) → PG strpos (тот же порядок аргументов, 1-based)
  s = s.replace(/\binstr\s*\(/gi, 'strpos(');
  // datetime('now', '+1 day') / datetime('now', '-7 days')
  s = s.replace(
    /\bdatetime\s*\(\s*['"]now['"]\s*,\s*['"]([+-]?\d+)\s+(day|days|hour|hours|minute|minutes|second|seconds)['"]\s*\)/gi,
    (_m, n, unit) => {
      const u = String(unit).toLowerCase().replace(/s$/, '') + 's';
      return `(NOW() + INTERVAL '${n} ${u}')`;
    }
  );
  // datetime(col, '+N unit')
  s = s.replace(
    /\bdatetime\s*\(\s*([^,?]+?)\s*,\s*['"]([+-]?\d+)\s+(day|days|hour|hours|minute|minutes|second|seconds)['"]\s*\)/gi,
    (_m, expr, n, unit) => {
      const u = String(unit).toLowerCase().replace(/s$/, '') + 's';
      return `((${expr})::timestamptz + INTERVAL '${n} ${u}')`;
    }
  );
  // Balanced datetime(...) incl. COALESCE / ?,? / now,?
  s = rewriteDatetimeCalls(s);
  s = s.replace(/date\s*\(\s*['"]now['"]\s*\)/gi, 'CURRENT_DATE');
  s = s.replace(/\bdate\s*\(\s*['"]now['"]\s*,\s*['"]([+-]?\d+)\s+(day|days)['"]\s*\)/gi, (_m, n) => {
    return `(CURRENT_DATE + INTERVAL '${n} days')`;
  });
  // julianday('now') / julianday(expr) — для разницы в секундах через * 86400
  s = s.replace(/\bjulianday\s*\(\s*['"]now['"]\s*\)/gi, '(EXTRACT(EPOCH FROM NOW()) / 86400.0)');
  s = s.replace(/\bjulianday\s*\(\s*([^)]+)\s*\)/gi, '(EXTRACT(EPOCH FROM (($1)::timestamptz)) / 86400.0)');
  // SQLite strftime → PG to_char (частые форматы из кода)
  s = s.replace(/\bstrftime\s*\(\s*['"]%Y['"]\s*,\s*['"]now['"]\s*\)/gi, "to_char(NOW(), 'YYYY')");
  s = s.replace(/\bstrftime\s*\(\s*['"]%Y-%m['"]\s*,\s*['"]now['"]\s*\)/gi, "to_char(NOW(), 'YYYY-MM')");
  s = s.replace(/\bstrftime\s*\(\s*['"]%Y-%m-%d['"]\s*,\s*['"]now['"]\s*\)/gi, "to_char(NOW(), 'YYYY-MM-DD')");
  s = s.replace(/\bstrftime\s*\(\s*['"]%Y['"]\s*,\s*([^)]+?)\s*\)/gi, "to_char(($1)::timestamptz, 'YYYY')");
  s = s.replace(/\bstrftime\s*\(\s*['"]%Y-%m['"]\s*,\s*([^)]+?)\s*\)/gi, "to_char(($1)::timestamptz, 'YYYY-MM')");
  s = s.replace(/\bstrftime\s*\(\s*['"]%Y-%m-%d['"]\s*,\s*([^)]+?)\s*\)/gi, "to_char(($1)::timestamptz, 'YYYY-MM-DD')");

  if (/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(s)) {
    s = s.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');
    if (/\bVALUES\s*\(/i.test(s) && !/\bON\s+CONFLICT\b/i.test(s)) {
      s = s.replace(/;?\s*$/, ' ON CONFLICT DO NOTHING');
    }
  }

  s = rewriteInsertOrReplace(s);
  s = s.replace(/\bGLOB\b/gi, 'LIKE');
  s = s.replace(/\bexcluded\./gi, 'EXCLUDED.');
  // SQLite group_concat → PG string_agg
  s = s.replace(/\bgroup_concat\s*\(\s*DISTINCT\s+([^,]+)\s*,\s*([^)]+)\)/gi, 'string_agg(DISTINCT ($1)::text, $2)');
  s = s.replace(/\bgroup_concat\s*\(\s*([^,]+)\s*,\s*([^)]+)\)/gi, 'string_agg(($1)::text, $2)');
  s = s.replace(/\bgroup_concat\s*\(\s*DISTINCT\s+([^)]+)\)/gi, "string_agg(DISTINCT ($1)::text, ',')");
  s = s.replace(/\bgroup_concat\s*\(\s*([^)]+)\)/gi, "string_agg(($1)::text, ',')");
  // SQLite COLLATE NOCASE / "NOCASE" → убрать (PG: citext нет по умолчанию)
  s = s.replace(/\bCOLLATE\s+(?:NOCASE|"NOCASE"|'NOCASE')\b/gi, '');
  // SQLite char(9) → PG chr(9); иначе PG читает char(9) как тип и падает на GET /counterparties
  s = s.replace(/(?<!:)\bchar\s*\(\s*(\d+)\s*\)/gi, 'chr($1)');
  // sqlite_master / sqlite_schema → PG catalogs
  s = s.replace(
    /\bFROM\s+(?:main\.)?(?:sqlite_master|sqlite_schema)\b/gi,
    "FROM (SELECT tablename AS name, 'table' AS type FROM pg_tables WHERE schemaname = 'public') AS sqlite_master"
  );
  return s;
}

function rewriteInsertOrReplace(sql: string): string {
  const m = sql.match(
    /^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+([^\s(]+)\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]+)\)\s*;?\s*$/i
  );
  if (!m) {
    return sql.replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi, 'INSERT INTO');
  }
  const table = m[1].trim();
  const cols = m[2].split(',').map((c) => c.trim()).filter(Boolean);
  const values = m[3];
  if (!cols.length) {
    return sql.replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi, 'INSERT INTO');
  }
  const pk = cols[0];
  const rest = cols.slice(1);
  const setsFixed = rest.length
    ? rest
        .map((c) => {
          const bare = c.replace(/"/g, '');
          return `${c} = EXCLUDED.${bare}`;
        })
        .join(', ')
    : `${pk} = EXCLUDED.${pk.replace(/"/g, '')}`;
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values}) ON CONFLICT (${pk}) DO UPDATE SET ${setsFixed}`;
}

export function qmarksToOrdinal(sql: string): { sql: string; count: number } {
  let out = '';
  let n = 0;
  let i = 0;
  let inSq = false;
  let inDq = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" && !inDq) {
      inSq = !inSq;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && !inSq) {
      inDq = !inDq;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '?' && !inSq && !inDq) {
      n += 1;
      out += `$${n}`;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return { sql: out, count: n };
}

export function toPgSql(sqliteSql: string): string {
  let rewritten = rewriteSqlForPg(sqliteSql);
  // Postgres 9.1+… actually IF NOT EXISTS for ADD COLUMN since PG 9.1? → PG 11+
  rewritten = rewritten.replace(
    /\bALTER\s+TABLE\s+(\S+)\s+ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/gi,
    'ALTER TABLE $1 ADD COLUMN IF NOT EXISTS '
  );
  return qmarksToOrdinal(rewritten).sql;
}

/** Parse PRAGMA table_info(name) → table name, or null. */
export function parsePragmaTableInfo(sql: string): string | null {
  const m = String(sql || '').match(/^\s*PRAGMA\s+table_info\s*\(\s*["`]?(\w+)["`]?\s*\)\s*;?\s*$/i);
  return m ? m[1] : null;
}

/** Other PRAGMA — ignore on Postgres. */
export function isSqliteOnlySql(sql: string): boolean {
  if (parsePragmaTableInfo(sql)) return false;
  return /^\s*PRAGMA\b/i.test(sql);
}

