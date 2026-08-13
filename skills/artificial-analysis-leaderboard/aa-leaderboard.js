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
 *   --model X      filter by model name or slug (substring, case-insensitive)
 *   --deep         full single-model profile (use with --model X): identity, indices,
 *                  every benchmark, full price breakdown, and the speed/latency
 *                  percentile distribution. Pair with --json for the raw 90+-field payload.
 *
 * Usage:
 *   aa-leaderboard.js --top 20
 *   aa-leaderboard.js --sort coding --top 10
 *   aa-leaderboard.js --sort agentic --creator anthropic --json
 *   aa-leaderboard.js --deep --model 'Claude Opus 5 (max)'
 *   aa-leaderboard.js --deep --model claude-opus-5 --json
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

// ── deep single-model profile ─────────────────────────────────────────────

/**
 * Walk an escaped-JSON object from its opening '{' to its matching '}', treating
 * `\"` (backslash + quote — how the embedded JSON encodes a real quote) as an
 * in-string toggle so braces that appear inside string values are not counted.
 * Returns the index just past the closing '}', or -1 if unbalanced.
 */
function braceMatch(html, start) {
  let depth = 0, instr = false, k = start;
  while (k < html.length) {
    const ch = html[k];
    if (ch === '\\' && html[k + 1] === '"') { instr = !instr; k += 2; continue; }
    if (ch === '"') { instr = !instr; k++; continue; }
    if (!instr) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return k + 1; }
    }
    k++;
  }
  return -1;
}

/** Recursively replace RSC `$undefined` sentinels with null. */
function scrub$undef(o) {
  if (Array.isArray(o)) return o.map(scrub$undef);
  if (o && typeof o === 'object') {
    for (const k in o) o[k] = o[k] === '$undefined' ? null : scrub$undef(o[k]);
    return o;
  }
  return o;
}

/**
 * Find the richest embedded record matching `query` (matched against name,
 * shortName, and slug, case-insensitive substring; an exact shortName/slug/name
 * wins ties) and return its fully decoded object (90+ fields). Each record is
 * decoded by brace-matching its opening brace and double-parsing the slice: the
 * RSC payload embeds the model object as a JSON string, so parse once to unescape
 * and once to materialise the object.
 */
function deepExtract(html, query) {
  const q = String(query).toLowerCase();
  const ID = '\\"id\\":\\"';
  const RICH_KEYS = ['gpqa', 'mmmuPro', 'hle', 'codingIndex', 'agenticIndex', 'gdpvalNormalized', 'omniscienceAccuracy', 'terminalbenchV21', 'scicode', 'lcr', 'tauBanking'];
  let best = null;
  let p = html.indexOf(ID);
  while (p !== -1) {
    const objStart = p - 1; // the '{' sits just before '"id":"'
    const win = html.slice(objStart, objStart + 9000);
    if (win.includes('\\"intelligenceIndex\\"') && win.includes('\\"modelCreatorName\\"')) {
      const name = field(win, 'name') || '';
      const short = field(win, 'shortName') || '';
      const slug = field(win, 'slug') || '';
      if ([name, short, slug].some((s) => s.toLowerCase().includes(q))) {
        const exact = short.toLowerCase() === q || slug.toLowerCase() === q || name.toLowerCase() === q;
        const intel = field(win, 'intelligenceIndex');
        const rich = RICH_KEYS.reduce((a, k) => a + (field(win, k) != null ? 1 : 0), 0);
        const better = !best
          || (exact && !best.exact)
          || (exact === best.exact && rich > best.rich)
          || (exact === best.exact && rich === best.rich && (intel || -1) > (best.intel || -1));
        if (better) {
          const end = braceMatch(html, objStart);
          let full = null;
          if (end > 0) {
            try { full = scrub$undef(JSON.parse(JSON.parse('"' + html.slice(objStart, end) + '"'))); }
            catch (e) { full = null; }
          }
          if (full) best = { full, exact, rich, intel, name, short, slug };
        }
      }
    }
    p = html.indexOf(ID, p + 1);
  }
  return best;
}

// formatters
const pct = (v) => (v == null ? '--' : (v * 100).toFixed(1) + '%');
const money = (v) => (v == null ? '--' : '$' + Number(v).toFixed(2));
const num1 = (v) => (v == null ? '--' : Number(v).toFixed(1));
const sec = (v) => (v == null ? '--' : Number(v).toFixed(1) + 's');
const spd = (v) => (v == null ? '--' : Number(v).toFixed(1) + ' t/s');
const yn = (v) => (v == null ? '--' : (v ? 'yes' : 'no'));
function tokens(v) {
  if (v == null) return '--';
  v = Number(v);
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return String(Math.round(v));
}
const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

function printDeep(o, exact) {
  const W = 20;
  const kv = (label, val) => console.log(`  ${label.padEnd(W)} ${val}`);
  const bar = (t) => console.log('\n▸ ' + t);

  console.log('════════════════════════════════════════════════════');
  console.log('  ' + (o.shortName || o.name));
  if (!exact) console.log('  (best substring match — pass a more specific --model to be sure)');
  console.log('════════════════════════════════════════════════════');

  bar('Identity');
  kv('Name', o.name || '--');
  kv('Slug', o.slug || '--');
  kv('Creator', [o.modelCreatorName, o.modelCreatorCountry && o.modelCreatorCountry.toUpperCase()].filter(Boolean).join(' · '));
  kv('Released', o.releaseDate || '--');
  kv('Context', tokens(o.contextWindowTokens));
  kv('Size / price tier', [o.sizeClass, o.priceClass].filter((x) => x != null).join(' / ') || '--');
  kv('Reasoning', yn(o.isReasoning));
  kv('Open weights', yn(o.isOpenWeights));
  kv('Status', o.deprecated ? 'deprecated' : 'live');
  const inM = [['Text', 'inputModalityText'], ['Image', 'inputModalityImage'], ['Audio', 'inputModalitySpeech'], ['Video', 'inputModalityVideo']].filter(([, k]) => o[k]).map(([l]) => l);
  const outM = [['Text', 'outputModalityText'], ['Image', 'outputModalityImage'], ['Audio', 'outputModalitySpeech'], ['Video', 'outputModalityVideo']].filter(([, k]) => o[k]).map(([l]) => l);
  kv('Modalities', `in ${inM.join('/') || '--'} · out ${outM.join('/') || '--'}`);
  if (o.openrouterApiId) kv('OpenRouter', o.openrouterApiId);

  bar('Composite Indices (0–100, higher = better)');
  kv('Intelligence', o.intelligenceIndex == null ? '--' : num1(o.intelligenceIndex) + (o.intelligenceIndexIsEstimated ? '  (est.)' : ''));
  kv('Coding', num1(o.codingIndex));
  kv('Agentic', num1(o.agenticIndex));

  bar('Benchmarks');
  kv('GPQA Diamond', pct(o.gpqa));
  kv('MMMU-Pro', pct(o.mmmuPro));
  kv("Humanity's Last Exam", pct(o.hle));
  kv('Terminal-Bench v2.1', pct(o.terminalbenchV21));
  kv('Terminal-Bench (hard)', pct(o.terminalbenchHard));
  kv('SciCode', pct(o.scicode));
  kv('τ²-Bench (Banking)', pct(o.tauBanking));
  kv('τ²-Bench', pct(o.tau2));
  kv('Long-Context Reasoning', pct(o.lcr));
  kv('GDPval (normalized)', pct(o.gdpvalNormalized));
  const g = o.gdpvalBreakdown;
  if (g) kv('GDPval Elo', `${num1(g.elo)}  (${num1(g.lower95ci)}–${num1(g.upper95ci)} 95% CI · ${num1(g.avgTurns)} turns)`);
  kv('Critical Point', pct(o.critpt));
  kv('Analyst Agent', pct(o.analystAgent));
  kv('IT-Bench (SRE)', pct(o.itbenchSre));
  kv('IF-Bench', pct(o.ifbench));
  if (o.omniscienceAccuracy != null || o.omniscienceNonHallucination != null) {
    kv('Omniscience', `${pct(o.omniscienceAccuracy)} acc · ${pct(o.omniscienceNonHallucination)} non-halluc · ${num1(o.omniscience)} score`);
  }

  bar('Pricing (per 1M tokens)');
  kv('Input', money(o.price1mInputTokens));
  kv('Output', money(o.price1mOutputTokens));
  kv('Cache read', o.cacheHitPrice == null ? '--' : `${money(o.cacheHitPrice)} (${Math.round((o.cacheHitDiscountPercent || 0) * 100)}% off)`);
  kv('Cache write', money(o.cacheWritePrice));
  kv('Blended 7:2:1', money(o.price1mBlended7To2To1) + '  (leaderboard headline)');
  kv('Blended 0:3:1', money(o.price1mBlended0To3To1));
  kv('Blended 0:1:1', money(o.price1mBlended0To1To1));

  bar('Speed & latency distribution');
  const cols = ['p5', 'p25', 'p50', 'p75', 'p95'];
  const cw = [10, 10, 10, 10, 10];
  const dist = [
    ['Throughput', ['percentile05OutputTokensPerSecond', 'quartile25OutputTokensPerSecond', 'medianOutputTokensPerSecond', 'quartile75OutputTokensPerSecond', 'percentile95OutputTokensPerSecond'], (v) => num1(v) + ' t/s'],
    ['First token', ['percentile05TimeToFirstTokenSeconds', 'quartile25TimeToFirstTokenSeconds', 'medianTimeToFirstTokenSeconds', 'quartile75TimeToFirstTokenSeconds', 'percentile95TimeToFirstTokenSeconds'], (v) => sec(v)],
  ];
  console.log('  ' + 'metric'.padEnd(W) + '  ' + cols.map((c, i) => c.padEnd(cw[i])).join('  '));
  for (const [label, keys, fmt] of dist) {
    const cells = keys.map((k, i) => String(fmt(getPath(o, k))).padEnd(cw[i]));
    console.log('  ' + label.padEnd(W) + '  ' + cells.join('  '));
  }
  kv('End-to-end (median)', sec(o.medianEndToEndResponseTimeSeconds));
  kv('Reasoning time (median)', sec(o.medianReasoningTimeSeconds));
  kv('Answer speed (median)', spd(o.medianCanonicalAnswerOutputSpeed));

  bar('Intelligence Index internals (per task)');
  const cpt = getPath(o, 'intelligenceIndexCostPerTask.cost');
  if (cpt) kv('Cost / task', money(cpt.total));
  kv('Time / task', o.intelligenceIndexTimePerTask == null ? '--' : sec(o.intelligenceIndexTimePerTask));
  const opt = o.intelligenceIndexOutputTokensPerTask;
  if (opt) kv('Tokens / task', `reasoning ${tokens(opt.reasoning)} · answer ${tokens(opt.answer)} · out ${tokens(opt.output)}`);

  console.log('\n  source: ' + URL + '   fetched: ' + new Date().toISOString());
  console.log('  raw payload: ' + Object.keys(o).length + ' fields — add --json for the full object\n');
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
    if (has('deep')) {
      const mq = get('model');
      if (!mq) {
        console.error('--deep requires --model X (model name or slug; substring OK).');
        console.error('List models first:  node aa-leaderboard.js --top 30');
        process.exit(1);
      }
      const found = deepExtract(html, mq);
      if (!found) {
        console.error('No model matching ' + JSON.stringify(mq) + '.');
        console.error('Browse:  node aa-leaderboard.js --top 30');
        process.exit(1);
      }
      if (asJson) console.log(JSON.stringify(found.full, null, 2));
      else printDeep(found.full, found.exact);
      return;
    }

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
