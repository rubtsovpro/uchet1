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

function hsGet(path) {
  const full = new URL(base + path.replace(/^\//, ''));
  const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  return new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: full.protocol,
        hostname: full.hostname,
        port: full.port || 443,
        path: full.pathname + full.search,
        method: 'GET',
        headers: { Authorization: auth, Accept: 'application/json', 'Content-Length': '0' },
        timeout: 120_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error('bad json: ' + text.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const raw = await hsGet('Get/Stores');
if (!Array.isArray(raw)) {
  console.log(JSON.stringify({ error: 'not array', sample: raw }, null, 2));
  process.exit(1);
}

const stores = raw.map((row) => ({
  guid: String(row.guid || '').trim(),
  code: String(row.code || '').trim(),
  name: String(row.name || '').trim(),
}));

console.log(JSON.stringify({
  source: 'pnevmopodveska_2025',
  base_url_host: new URL(base).hostname,
  count: stores.length,
  stores,
}, null, 2));
