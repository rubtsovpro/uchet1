/** Safe hotspot fixes after async cutover prep. */
import fs from 'node:fs';

function patch(file, fn) {
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    console.log('patched', file);
  }
}

patch('src/amo-settings.ts', (t) => {
  t = t.replace(
    /const unmappedUsers = \(async \(\) => \{/,
    'const unmappedUsers = await (async () => {'
  );
  t = t.replace(
    /export async function applyPipelineCompanyToDeals\(\s*map: Record<string, string> = undefined\s*\): Promise<\{ updated: number \}> \{\s*await ensureDealOrgCompanyColumn\(\);/,
    `export async function applyPipelineCompanyToDeals(
  map?: Record<string, string>
): Promise<{ updated: number }> {
  if (!map) map = (await getAmoIntegrationSettings()).pipeline_company;
  await ensureDealOrgCompanyColumn();`
  );
  t = t.replace(
    /export async function applyBranchCompanyToDeals\(\s*map: Record<string, string> = undefined\s*\): Promise<\{ updated: number \}> \{\s*await ensureDealOrgCompanyColumn\(\);/,
    `export async function applyBranchCompanyToDeals(
  map?: Record<string, string>
): Promise<{ updated: number }> {
  if (!map) map = (await getAmoIntegrationSettings()).branch_company;
  await ensureDealOrgCompanyColumn();`
  );
  return t;
});

patch('src/integration-settings.ts', (t) => {
  t = t.replace(
    /return await Promise\.all\(Object\.keys\(profiles\)\s*\.sort\(\)\s*\.map\(async \(id\) => \(await getYandexPaySettingsForOrg\(id\)\)!\)\)\s*\.filter\(Boolean\);/,
    `return (await Promise.all(Object.keys(profiles)
    .sort()
    .map(async (id) => (await getYandexPaySettingsForOrg(id))!))
  ).filter(Boolean);`
  );
  if (!t.includes('const cur = s ?? (await getAtolSettings())')) {
    t = t.replace(
      /export async function atolSettingsPublic\(s\?: AtolSettings\) \{\n  const store = await readAtolStore\(\);/,
      `export async function atolSettingsPublic(s?: AtolSettings) {\n  const cur = s ?? (await getAtolSettings());\n  const store = await readAtolStore();`
    );
    t = t.replace(/\.\.\.atolProfilePublic\('rp', s\)/, "...atolProfilePublic('rp', cur)");
  }
  t = t.replace(
    /export async function tochkaBridgePublic\(s\?: TochkaBridgeSettings\) \{\n  const stored = await readMeta<TochkaBridgeSettings>\(META_TOCHKA\);\n  return \{\n    configured: Boolean\(s\.bank_sbp_key\),\n    bank_sbp_key: '',\n    bank_sbp_key_set: Boolean\(s\.bank_sbp_key\),\n    bank_sbp_key_hint: maskHint\(s\.bank_sbp_key\),\n    overview_url: s\.overview_url,\n    sbp_create_url: s\.sbp_create_url,\n    sbp_status_url: s\.sbp_status_url,/,
    `export async function tochkaBridgePublic(s?: TochkaBridgeSettings) {
  const cur = s ?? (await getTochkaBridgeSettings());
  const stored = await readMeta<TochkaBridgeSettings>(META_TOCHKA);
  return {
    configured: Boolean(cur.bank_sbp_key),
    bank_sbp_key: '',
    bank_sbp_key_set: Boolean(cur.bank_sbp_key),
    bank_sbp_key_hint: maskHint(cur.bank_sbp_key),
    overview_url: cur.overview_url,
    sbp_create_url: cur.sbp_create_url,
    sbp_status_url: cur.sbp_status_url,`
  );
  t = t.replace(
    /export async function cdekBridgePublic\(s\?: CdekBridgeSettings\) \{\n  const stored = await readMeta<CdekBridgeSettings>\(META_CDEK\);\n  return \{\n    configured: Boolean\(s\.wms_key\),\n    wms_key: '',\n    wms_key_set: Boolean\(s\.wms_key\),\n    wms_key_hint: maskHint\(s\.wms_key\),\n    wms_url: s\.wms_url,\n    widget_url: s\.widget_url,/,
    `export async function cdekBridgePublic(s?: CdekBridgeSettings) {
  const cur = s ?? (await getCdekBridgeSettings());
  const stored = await readMeta<CdekBridgeSettings>(META_CDEK);
  return {
    configured: Boolean(cur.wms_key),
    wms_key: '',
    wms_key_set: Boolean(cur.wms_key),
    wms_key_hint: maskHint(cur.wms_key),
    wms_url: cur.wms_url,
    widget_url: cur.widget_url,`
  );
  t = t.replace(
    /export async function dadataPublic\(s\?: DadataSettings\) \{\n  const stored = await readMeta<DadataSettings>\(META_DADATA\);\n  return \{\n    configured: Boolean\(s\.api_key\),\n    api_key: '',\n    api_key_set: Boolean\(s\.api_key\),\n    api_key_hint: maskHint\(s\.api_key\),\n    secret: '',\n    secret_set: Boolean\(s\.secret\),\n    secret_hint: maskHint\(s\.secret\),/,
    `export async function dadataPublic(s?: DadataSettings) {
  const cur = s ?? (await getDadataSettings());
  const stored = await readMeta<DadataSettings>(META_DADATA);
  return {
    configured: Boolean(cur.api_key),
    api_key: '',
    api_key_set: Boolean(cur.api_key),
    api_key_hint: maskHint(cur.api_key),
    secret: '',
    secret_set: Boolean(cur.secret),
    secret_hint: maskHint(cur.secret),`
  );
  return t;
});

patch('src/atol.ts', (t) => {
  t = t.replace(
    /export async function atolConfigured\(cfg\?: AtolSettings\): Promise<boolean> \{\n  return Boolean\(cfg\.login && cfg\.pass && cfg\.group_code\);\n\}/,
    `export async function atolConfigured(cfg?: AtolSettings): Promise<boolean> {
  const c = cfg ?? (await getAtolSettings());
  return Boolean(c.login && c.pass && c.group_code);
}`
  );
  t = t.replace(
    `async function atolGetToken(cfg?: AtolSettings): Promise<string> {
  const base = cfg.api_url.replace(/\\/$/, '');
  const res = await fetch(\`\${base}/getToken\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login: cfg.login,
      pass: cfg.pass,
    }),
  });`,
    `async function atolGetToken(cfg?: AtolSettings): Promise<string> {
  const c = cfg ?? (await getAtolSettings());
  const base = c.api_url.replace(/\\/$/, '');
  const res = await fetch(\`\${base}/getToken\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login: c.login,
      pass: c.pass,
    }),
  });`
  );
  t = t.replace(
    `async function atolSendDocument(
  path: 'sell' | 'sell_refund' | AtolCorrectionOperation,
  payload: Record<string, unknown>,
  cfg?: AtolSettings
): Promise<Record<string, unknown>> {
  const base = cfg.api_url.replace(/\\/$/, '');
  const group = cfg.group_code;
  const token = await atolGetToken(cfg);`,
    `async function atolSendDocument(
  path: 'sell' | 'sell_refund' | AtolCorrectionOperation,
  payload: Record<string, unknown>,
  cfg?: AtolSettings
): Promise<Record<string, unknown>> {
  const c = cfg ?? (await getAtolSettings());
  const base = c.api_url.replace(/\\/$/, '');
  const group = c.group_code;
  const token = await atolGetToken(c);`
  );
  t = t.replace(/(?<!await )(?<!\.)\bgetOrgProfile\s*\(/g, 'await getOrgProfile(');
  t = t.replace(/await await /g, 'await ');
  return t;
});

patch('src/server.ts', (t) => {
  t = t.replace(
    /sendNote: \(item\) => await sendAmoLeadNoteOnce/,
    'sendNote: async (item) => await sendAmoLeadNoteOnce'
  );
  t = t.replace(
    /sendTask: \(item\) => await sendAmoLeadTaskOnce/,
    'sendTask: async (item) => await sendAmoLeadTaskOnce'
  );
  return t;
});

patch('src/api.ts', (t) => {
  t = t.replace(
    /api\.get\('\/org-profile', \(c\) => \{\n  const profile = getOrgProfile\(\);/,
    `api.get('/org-profile', async (c) => {\n  const profile = await getOrgProfile();`
  );
  t = t.replace(
    /api\.get\('\/org-profile', async \(c\) => \{\n  const profile = getOrgProfile\(\);/,
    `api.get('/org-profile', async (c) => {\n  const profile = await getOrgProfile();`
  );
  t = t.replace(/(?<!await )(?<!\.)\bgetOrgProfile\s*\(/g, 'await getOrgProfile(');
  t = t.replace(/(?<!await )(?<!\.)\bsaveOrgProfile\s*\(/g, 'await saveOrgProfile(');
  t = t.replace(/await await /g, 'await ');
  return t;
});

patch('src/deal-stock-flow.ts', (t) => {
  t = t.replace(
    /export function listPendingStockReturns\(limit = 60\): Array<Record<string, unknown>> \{\n  \/\/ Кэш movedLines[\s\S]*?\n  return runWithDealFlowCache\(async \(\) => \{/,
    `export async function listPendingStockReturns(limit = 60): Promise<Array<Record<string, unknown>>> {
  // Кэш movedLines / остатков — иначе каждый auto-refresh /pick (12с) бьёт SQLite пачкой JOIN.
  return await runWithDealFlowCache(async () => {`
  );
  // fix deltaLines filter paren if present as await Promise.all(...).filter
  t = t.replace(
    /const deltaLines = hasSnapshot\n    \? await Promise\.all\(allProductLines\n([\s\S]*?)\)\n        \.filter\(\(l\): l is NonNullable<typeof l> => !!l\)\n    : allProductLines;/,
    `const deltaLines = hasSnapshot
    ? (await Promise.all(allProductLines
$1)
      ).filter((l): l is NonNullable<typeof l> => !!l)
    : allProductLines;`
  );
  return t;
});

console.log('done');
