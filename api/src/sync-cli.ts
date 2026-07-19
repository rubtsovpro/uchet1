import { migrate } from './db.js';
import { odataConfigFromEnv, syncCatalogsFromOdata } from './odata.js';
import { hsConfigured, syncApplicabilityAndProperties } from './hs.js';
import { syncMediaFrom1c } from './media.js';
import { s3ConfigFromEnv } from './s3.js';
import { syncDocsFromOdata } from './docs-sync.js';

migrate();

const onlyHs = process.argv.includes('--hs-only');
const onlyMedia = process.argv.includes('--media-only');
const onlyDocs = process.argv.includes('--docs-only');
const docsInOnly = process.argv.includes('--docs-in');
const skipHs = process.argv.includes('--skip-hs');
const skipMedia = process.argv.includes('--skip-media');

const mediaLimitArg = process.argv.find((a) => a.startsWith('--media-limit='));
const mediaLimit = mediaLimitArg ? Number(mediaLimitArg.split('=')[1]) : 500;

if (onlyMedia) {
  if (!hsConfigured() || !s3ConfigFromEnv()) {
    console.error('Need HS_* and S3_*');
    process.exit(1);
  }
  console.log('Media sync start… limit', mediaLimit);
  const r = await syncMediaFrom1c({
    limit: mediaLimit,
    onlyMissing: true,
  });
  console.log('Media sync done', r);
  process.exit(0);
}

if (onlyDocs) {
  const kinds = docsInOnly ? (['in'] as Array<'in' | 'out'>) : (['in', 'out'] as Array<'in' | 'out'>);
  console.log('Docs sync start…', kinds);
  const r = await syncDocsFromOdata(kinds);
  console.log('Docs sync done', r);
  process.exit(0);
}

if (!onlyHs) {
  const cfg = odataConfigFromEnv();
  if (!cfg) {
    console.error('Set ODATA_BASE_URL, ODATA_USER, ODATA_PASSWORD');
    process.exit(1);
  }
  console.log('OData sync start…', cfg.baseUrl);
  const result = await syncCatalogsFromOdata(cfg);
  console.log('OData sync done', result);
}

if (!skipHs) {
  if (!hsConfigured()) {
    console.warn('HS_* not set — skip applicability/properties');
  } else {
    console.log('HS sync start…');
    const hs = await syncApplicabilityAndProperties();
    console.log('HS sync done', hs);
  }
}

if (!skipMedia) {
  if (!hsConfigured() || !s3ConfigFromEnv()) {
    console.warn('HS/S3 not set — skip media');
  } else {
    console.log('Media sync start… limit', mediaLimit);
    const r = await syncMediaFrom1c({ limit: mediaLimit, onlyMissing: true });
    console.log('Media sync done', r);
  }
}
