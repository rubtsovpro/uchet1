/**
 * SQL dialect bridge: SQLite → Postgres (best-effort, runtime).
 * Placeholders: ? → $1,$2,…
 */
export function rewriteSqlForPg(sql: string): string {
  let s = String(sql || '');

  s = s.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
  // datetime('now', '+1 day') / datetime('now', '-7 days')
  s = s.replace(
    /\bdatetime\s*\(\s*['"]now['"]\s*,\s*['"]([+-]?\d+)\s+(day|days|hour|hours|minute|minutes|second|seconds)['"]\s*\)/gi,
    (_m, n, unit) => {
      const u = String(unit).toLowerCase().replace(/s$/, '') + 's';
      return `(NOW() + INTERVAL '${n} ${u}')`;
    }
  );
  // datetime('now', ?) — параметр вида '-120 seconds' / '+1 day'
  s = s.replace(
    /\bdatetime\s*\(\s*['"]now['"]\s*,\s*\?\s*\)/gi,
    `(NOW() + (?::text)::interval)`
  );
  // datetime(col, '+N unit') / datetime(col, ?)
  s = s.replace(
    /\bdatetime\s*\(\s*([^,?]+?)\s*,\s*['"]([+-]?\d+)\s+(day|days|hour|hours|minute|minutes|second|seconds)['"]\s*\)/gi,
    (_m, expr, n, unit) => {
      const u = String(unit).toLowerCase().replace(/s$/, '') + 's';
      return `((${expr})::timestamptz + INTERVAL '${n} ${u}')`;
    }
  );
  s = s.replace(
    /\bdatetime\s*\(\s*([^,?]+?)\s*,\s*\?\s*\)/gi,
    `(($1)::timestamptz + (?::text)::interval)`
  );
  s = s.replace(/datetime\s*\(\s*['"]now['"]\s*\)/gi, 'NOW()');
  s = s.replace(/date\s*\(\s*['"]now['"]\s*\)/gi, 'CURRENT_DATE');
  // datetime(single_expr) — после двухаргументных; cast: в дампе часто text
  s = s.replace(/\bdatetime\s*\(\s*([^,)]+)\s*\)/gi, '(($1)::timestamptz)');
  s = s.replace(/\bdate\s*\(\s*['"]now['"]\s*,\s*['"]([+-]?\d+)\s+(day|days)['"]\s*\)/gi, (_m, n) => {
    return `(CURRENT_DATE + INTERVAL '${n} days')`;
  });


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

