#!/usr/bin/env node
/**
 * Artificial Analysis model leaderboard fetcher.
 *
 * Fetches https://artificialanalysis.ai/leaderboards/models (SSR Next.js HTML) and
 * extracts the embedded per-model data payload, which carries the composite indices
 * Artificial Analysis publishes for every tracked model:
 *
 *   - intelligenceIndex  (Artificial Analysis Intelligence Index v4.1)
 *   - codingIndex        (Coding Index — SWE-Bench Verified, LiveCodeBench, etc.)
 *   - agenticIndex       (Agentic Index — τ²-Bench / GDPval-AA, Terminal-Bench, etc.)
 *
 * plus median price (blended), output speed, time-to-first-token, and end-to-end
 * response time. No API key, no JS rendering, no dependencies (Node.js stdlib only).
 *
 * Output modes:
 *   --json         full JSON array
 *   --table        human-readable aligned table (default)
 *   --top N        limit to top N (after sort + filter)
 *   --sort FIELD   intelligence(default)|coding|agentic|speed|price|latency|name
 *   --creator X    filter by creator (substring, case-insensitive)
 *   --model X      filter by model name (substring, case-insensitive)
 *
 * Usage:
 *   aa-leaderboard.js --top 20
 *   aa-leaderboard.js --sort coding --top 10
 *   aa-leaderboard.js --sort agentic --creator anthropic --json
 */
const https = require('https');

const URL = 'https://artificialanalysis.ai/leaderboards/models';

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetch(new URL(res.headers.location, url).toString()));
      }
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

/**
 * Extract a field value from an escaped-JSON record fragment.
 *
 * The leaderboard page is a Next.js RSC payload; the per-model data is embedded as
 * JSON whose quotes are escaped as `\"` (backslash + double-quote). This helper reads
 * a field by its escaped key and parses the following scalar value.
 *
 * @param {string} rec - escaped record fragment
 * @param {string} key - plain (unescaped) field name
 * @returns {number|string|null|undefined}
 */
function field(rec, key) {
  const ek = '\\"' + key + '\\":';
  const i = rec.indexOf(ek);
  if (i < 0) return undefined; // field not present in this record
  let v = rec.slice(i + ek.length);
  if (v.startsWith('null')) return null;
  if (v.startsWith('true')) return true;
  if (v.startsWith('false')) return false;
  if (v.startsWith('\\"')) { // escaped string value: \"...\"
    const m = v.match(/^\\"([^\\]*)\\"/);
    return m ? m[1] : undefined;
  }
  const m = v.match(/^(-?[0-9]+\.?[0-9]*(?:[eE][-+]?[0-9]+)?)/);
  return m ? parseFloat(m[1]) : undefined;
}

/**
 * Parse the embedded models payload out of the SSR HTML.
 *
 * Each rich record carries modelCreatorName + intelligenceIndex + codingIndex +
 * agenticIndex + pricing/performance fields. We split on the model's own `\"id\":\"`
 * (the rich objects use flat modelCreatorId rather than a nested creator object, so
 * `id` is unique per record) and keep only fragments that carry the index fields.
 * Records are de-duplicated by slug, preferring the copy with the most non-null data.
 */
function parse(html) {
  const pieces = html.split('\\"id\\":\\"');
  const bySlug = new Map();

  for (let k = 1; k < pieces.length; k++) {
    const rec = pieces[k];
    if (!rec.includes('\\"intelligenceIndex\\"') || !rec.includes('\\"modelCreatorName\\"')) continue;

    const slug = field(rec, 'slug') || '';
    const name = field(rec, 'name') || '';
    const intelligence = (x => typeof x === 'number' ? x : null)(field(rec, 'intelligenceIndex'));
    const coding = (x => typeof x === 'number' ? x : null)(field(rec, 'codingIndex'));
    const agentic = (x => typeof x === 'number' ? x : null)(field(rec, 'agenticIndex'));
    const n = (x) => (typeof x === 'number' ? x : null);
    const blended = n(field(rec, 'price1mBlended7To2To1'));
    const speed = n(field(rec, 'medianOutputTokensPerSecond'));
    const latency = n(field(rec, 'medianTimeToFirstTokenSeconds'));
    const total = n(field(rec, 'medianEndToEndResponseTimeSeconds'));
    const creator = field(rec, 'modelCreatorName') || '';
    const isReasoning = field(rec, 'isReasoning');
    const estimated = field(rec, 'intelligenceIndexIsEstimated');

    const row = {
      slug, name, creator,
      intelligence: intelligence == null ? '--' : (estimated ? intelligence.toFixed(0) + '*' : intelligence.toFixed(0)),
      coding: coding == null ? '--' : coding.toFixed(1),
      agentic: agentic == null ? '--' : agentic.toFixed(1),
      blendedUSD: blended == null ? '--' : '$' + Number(blended).toFixed(2),
      speedTokPerSec: speed == null ? '--' : Math.round(speed).toString(),
      latencyFirstChunk: latency == null ? '--' : latency.toFixed(2),
      totalResponse: total == null ? '--' : total.toFixed(2),
      isReasoning: isReasoning === true,
    };

    // de-dupe by slug, keep the richer record
    const prev = bySlug.get(slug);
    const score = (r) => [r.intelligence, r.coding, r.agentic, r.blendedUSD, r.speedTokPerSec].filter((x) => x !== '--').length;
    if (!prev || score(row) >= score(prev)) bySlug.set(slug, row);
  }

  let data = [...bySlug.values()];
  // assign a stable rank by intelligence (matches the site's default ordering)
  data.sort((a, b) => num(a.intelligence) - num(b.intelligence));
  data.forEach((d, i) => (d.rank = data.length - i));
  data.sort((a, b) => a.rank - b.rank);
  return data;
}

function num(v) {
  if (v == null || v === '--') return null;
  const m = String(v).replace(/[$,]/g, '').replace(/\*$/, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function main() {
  const args = process.argv.slice(2);
  const get = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
  const has = (k) => args.includes('--' + k);
  const sortField = get('sort') || 'intelligence';
  const topN = get('top') ? parseInt(get('top'), 10) : null;
  const creatorF = (get('creator') || '').toLowerCase();
  const modelF = (get('model') || '').toLowerCase();
  const asJson = has('json');
  const asTable = has('table') || (!asJson);

  fetch(URL).then((html) => {
    let data = parse(html);

    if (creatorF) data = data.filter((d) => d.creator.toLowerCase().includes(creatorF));
    if (modelF) data = data.filter((d) => d.name.toLowerCase().includes(modelF));

    const sortKey = {
      intelligence: 'intelligence', coding: 'coding', agentic: 'agentic',
      speed: 'speedTokPerSec', price: 'blendedUSD', latency: 'latencyFirstChunk', name: 'name',
    }[sortField] || 'intelligence';

    data.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      const av = num(a[sortKey]), bv = num(b[sortKey]);
      if (av === null) return 1;
      if (bv === null) return -1;
      // price & latency: lower is better; others: higher is better
      const lowerBetter = sortKey === 'blendedUSD' || sortKey === 'latencyFirstChunk';
      return lowerBetter ? av - bv : bv - av;
    });

    if (topN) data = data.slice(0, topN);

    if (asJson) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      const meta = `source: ${URL}\nfetched: ${new Date().toISOString()}\ncount: ${data.length}  sort: ${sortField}${creatorF ? '  creator~=' + creatorF : ''}${modelF ? '  model~=' + modelF : ''}`;
      console.log(meta);
      console.log('-'.repeat(Math.max(meta.length, 116)));
      const hdr = ['#', 'INTELL', 'CODING', 'AGENTIC', 'SPEED', 'PRICE', 'CREATOR', 'MODEL'];
      const rows = data.map((d, i) => [
        String(i + 1),
        d.intelligence,
        d.coding,
        d.agentic,
        d.speedTokPerSec,
        d.blendedUSD,
        d.creator,
        d.name + (d.isReasoning ? ' 💡' : ''),
      ]);
      const widths = hdr.map((_, c) => Math.max(...[hdr[c], ...rows.map((r) => r[c])].map((s) => String(s).length)));
      const fmt = (r) => r.map((c, i) => (i === r.length - 1 ? c : String(c).padEnd(widths[i]))).join('  ');
      console.log(fmt(hdr));
      console.log(widths.map((w) => '-'.repeat(w)).join('  '));
      rows.forEach((r) => console.log(fmt(r)));
    }
  }).catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}

main();
