import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { URL } from 'node:url';

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return env;
}

const env = loadEnv('/etc/warehouse-wms.env');
const base = String(env.HS_BASE_URL || '').replace(/\/?$/, '/');
const user = env.HS_USER || '';
const pass = env.HS_PASS || '';
if (!base || !user || !pass) {
  console.error('HS not configured');
  process.exit(1);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hsGet(path, body) {
  const full = new URL(base + path.replace(/^\//, ''));
  const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  const payload =
    body === '' || body == null
      ? Buffer.alloc(0)
      : Buffer.from(JSON.stringify(body), 'utf8');
  return new Promise((resolve, reject) => {
    const headers = {
      Authorization: auth,
      Accept: 'application/json',
      'Content-Length': String(payload.length),
    };
    if (payload.length) headers['Content-Type'] = 'application/json';
    const req = request(
      {
        protocol: full.protocol,
        hostname: full.hostname,
        port: full.port || 443,
        path: full.pathname + full.search,
        method: 'GET',
        headers,
        timeout: 300_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error('bad json from ' + path + ': ' + text.slice(0, 300)));
          }
        });
      }
    );
    req.on('error', reject);
    if (payload.length) req.write(payload);
    req.end();
  });
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function fetchRestsForStore(storeId, catIds) {
  let rows = [];
  try {
    const raw = await hsGet('Get/Rests', { stores: [storeId], categories: catIds });
    if (Array.isArray(raw)) rows = raw;
  } catch {
    for (const batch of chunk(catIds, 15)) {
      try {
        const raw = await hsGet('Get/Rests', { stores: [storeId], categories: batch });
        if (Array.isArray(raw)) rows.push(...raw);
      } catch {
        /* skip batch */
      }
    }
  }
  let skus = 0;
  let qtySum = 0;
  let qtyPositive = 0;
  const seen = new Set();
  for (const row of rows) {
    const product = String(row.product || '').trim();
    const qty = Number(row.quantity);
    if (!product || !Number.isFinite(qty)) continue;
    if (!seen.has(product)) {
      seen.add(product);
      skus += 1;
    }
    qtySum += qty;
    if (qty > 0) qtyPositive += qty;
  }
  const skusWithStock = rows.filter((r) => Number(r.quantity) > 0).length
    ? new Set(
        rows.filter((r) => Number(r.quantity) > 0).map((r) => String(r.product || '').trim())
      ).size
    : 0;
  return { rows: rows.length, skus, skus_with_stock: skusWithStock, qty_sum: qtySum, qty_positive: qtyPositive };
}

const storesRaw = await hsGet('Get/Stores', '');
if (!Array.isArray(storesRaw)) {
  console.log(JSON.stringify({ error: 'Get/Stores failed', body: storesRaw }, null, 2));
  process.exit(1);
}

const catsRaw = await hsGet('Get/Categories', '');
const catIds = Array.isArray(catsRaw)
  ? catsRaw
      .map((r) => String(r.guid || '').trim())
      .filter((id) => UUID_RE.test(id))
  : [];

const stores = storesRaw
  .map((row) => ({
    guid: String(row.guid || '').trim(),
    code: String(row.code || '').trim(),
    name: String(row.name || '').trim(),
  }))
  .filter((s) => UUID_RE.test(s.guid));

const results = [];
for (const s of stores) {
  process.stderr.write(`Rests ${s.code}…\n`);
  const rest = await fetchRestsForStore(s.guid, catIds);
  results.push({ ...s, ...rest });
}

console.log(
  JSON.stringify(
    {
      source: 'pnevmopodveska_2025',
      base_host: new URL(base).hostname,
      categories_in_request: catIds.length,
      stores: results,
    },
    null,
    2
  )
);
