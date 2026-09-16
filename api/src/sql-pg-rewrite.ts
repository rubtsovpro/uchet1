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
  s = s.replace(/datetime\s*\(\s*['"]now['"]\s*\)/gi, 'NOW()');
  s = s.replace(/date\s*\(\s*['"]now['"]\s*\)/gi, 'CURRENT_DATE');
  // datetime(expr) → cast (sqlite affinity helper)
  s = s.replace(/\bdatetime\s*\(/gi, '(');
  // leftover: was datetime(x) → (x)  — ok for text compare; for < NOW() often enough
  // Prefer timestamptz when comparing to NOW — wrap common pattern expires_at < datetime('now') already NOW()
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
  const rewritten = rewriteSqlForPg(sqliteSql);
  return qmarksToOrdinal(rewritten).sql;
}

/** SQLite-only statements that must not hit Postgres. */
export function isSqliteOnlySql(sql: string): boolean {
  return /^\s*PRAGMA\b/i.test(sql);
}

