/**
 * Comparison harness: real HN threads (data/eval-real) vs our generated
 * threads (data/eval-ours), pair-by-pair plus aggregate. Outputs a
 * markdown calibration report at data/eval-report.md.
 *
 * Metrics (all derivable from text alone — no embedding required):
 *   - Comment count, top-level count, max depth
 *   - Length distribution (mean, median, p10, p90)
 *   - Depth distribution
 *   - Quote-prefix rate ("> ..." starting comment)
 *   - Code-block rate
 *   - URL rate (per comment)
 *   - Hedge-tic density per 1000 words ("I think", "FWIW", "IIRC", etc.)
 *   - Em-dash rate
 *   - Top-K vote share (when scores available)
 *
 * Usage: node scripts/compare-eval.mjs
 */

import { readFile, readdir, writeFile } from "node:fs/promises";

const REAL = "data/eval-real";
const OURS = "data/eval-ours";
const OUT = "data/eval-report.md";

const HEDGES = [
  /\bI think\b/gi, /\bI'd guess\b/gi, /\bI suspect\b/gi, /\bI feel\b/gi,
  /\bin my experience\b/gi, /\bfrom what I\b/gi, /\bIIRC\b/g, /\bIMO\b/g,
  /\bFWIW\b/g, /\bAFAIK\b/g, /\bIANAL\b/g, /\bymmv\b/gi,
  /\bnot sure\b/gi, /\bmaybe\b/gi, /\bprobably\b/gi, /\bseems like\b/gi,
];

const URL_RE = /\bhttps?:\/\/\S+/gi;
const CODE_RE = /(?:```|^    \w|`[^`\n]{2,}`)/m;
const EM_DASH = /—/g;

// ---- Loading ----

async function loadDir(dir) {
  const files = await readdir(dir);
  const out = {};
  for (const f of files.filter(f => f.endsWith(".json"))) {
    const id = f.replace(/\.json$/, "");
    out[id] = JSON.parse(await readFile(`${dir}/${f}`, "utf8"));
  }
  return out;
}

// ---- Comment iteration ----

function* walk(nodes, depth = 0, parentText = null) {
  for (const c of nodes || []) {
    if (c.deleted) continue;
    const kids = c.kids || c.children || [];
    yield { c, depth, parentText, kids };
    yield* walk(kids, depth + 1, c.text);
  }
}

function flatten(nodes) {
  const out = [];
  for (const node of walk(nodes)) out.push(node);
  return out;
}

// ---- Per-thread metrics ----

function computeMetrics(threadJson) {
  const comments = threadJson.comments || [];
  const flat = flatten(comments);
  const top = flat.filter(n => n.depth === 0);

  let totalChars = 0;
  let totalWords = 0;
  let hedges = 0;
  let urls = 0;
  let codes = 0;
  let emDashes = 0;
  let quotePrefix = 0;

  const lengths = [];
  const topLengths = [];
  const replyLengths = [];
  const depths = {};

  for (const node of flat) {
    const text = node.c.text || "";
    const len = text.length;
    const words = text.split(/\s+/).filter(Boolean).length;
    lengths.push(len);
    if (node.depth === 0) topLengths.push(len);
    else replyLengths.push(len);
    depths[node.depth] = (depths[node.depth] || 0) + 1;

    totalChars += len;
    totalWords += words;
    for (const h of HEDGES) hedges += (text.match(h) || []).length;
    urls += (text.match(URL_RE) || []).length;
    if (CODE_RE.test(text)) codes++;
    emDashes += (text.match(EM_DASH) || []).length;
    if (/^>\s/.test(text.trimStart())) quotePrefix++;
  }

  return {
    n: flat.length,
    nTop: top.length,
    maxDepth: Math.max(0, ...flat.map(n => n.depth)),
    avgRepliesPerTop: top.length ? (flat.length - top.length) / top.length : 0,
    lengthMean: mean(lengths),
    lengthMedian: median(lengths),
    lengthP10: quantile(lengths, 0.1),
    lengthP90: quantile(lengths, 0.9),
    lengthStd: stddev(lengths),
    topLengthMedian: median(topLengths),
    topLengthP90: quantile(topLengths, 0.9),
    replyLengthMedian: median(replyLengths),
    quotePrefixRate: flat.length ? quotePrefix / flat.length : 0,
    codeRate: flat.length ? codes / flat.length : 0,
    urlsPerComment: flat.length ? urls / flat.length : 0,
    hedgesPer1KWords: totalWords ? (hedges / totalWords) * 1000 : 0,
    emDashRate: flat.length ? emDashes / flat.length : 0,
    depths,
    totalChars,
    totalWords,
  };
}

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const median = (xs) => quantile(xs, 0.5);
function quantile(xs, q) {
  if (!xs.length) return 0;
  const sorted = xs.slice().sort((a, b) => a - b);
  const i = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * q)));
  return sorted[i];
}
function stddev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
}

// ---- Pairwise + aggregate ----

function compareOne(real, ours) {
  const r = computeMetrics(real);
  const o = computeMetrics(ours);
  return { real: r, ours: o, ratio: ratiosOf(r, o) };
}

function ratiosOf(r, o) {
  const safe = (a, b) => (b === 0 ? null : a / b);
  return {
    n: safe(o.n, r.n),
    nTop: safe(o.nTop, r.nTop),
    lengthMedian: safe(o.lengthMedian, r.lengthMedian),
    lengthP90: safe(o.lengthP90, r.lengthP90),
    lengthStd: safe(o.lengthStd, r.lengthStd),
    quotePrefixRate: safe(o.quotePrefixRate, r.quotePrefixRate),
    codeRate: safe(o.codeRate, r.codeRate),
    urlsPerComment: safe(o.urlsPerComment, r.urlsPerComment),
    hedgesPer1KWords: safe(o.hedgesPer1KWords, r.hedgesPer1KWords),
    emDashRate: safe(o.emDashRate, r.emDashRate),
  };
}

// ---- Aggregate metrics across all pairs ----

function aggregate(items) {
  // For each metric, aggregate by pooling raw data across all threads.
  const realPool = { lengths: [], topLens: [], hedges: 0, urls: 0, codes: 0, emDashes: 0, n: 0, words: 0, quotes: 0 };
  const ourPool = { lengths: [], topLens: [], hedges: 0, urls: 0, codes: 0, emDashes: 0, n: 0, words: 0, quotes: 0 };

  for (const { real, ours } of items) {
    poolFrom(real, realPool);
    poolFrom(ours, ourPool);
  }

  const summary = (p) => ({
    n: p.n,
    lengthMedian: median(p.lengths),
    lengthP10: quantile(p.lengths, 0.1),
    lengthP90: quantile(p.lengths, 0.9),
    lengthStd: stddev(p.lengths),
    topLenMedian: median(p.topLens),
    topLenP90: quantile(p.topLens, 0.9),
    quotePrefixRate: p.n ? p.quotes / p.n : 0,
    codeRate: p.n ? p.codes / p.n : 0,
    urlsPerComment: p.n ? p.urls / p.n : 0,
    hedgesPer1KWords: p.words ? (p.hedges / p.words) * 1000 : 0,
    emDashRate: p.n ? p.emDashes / p.n : 0,
  });
  return { real: summary(realPool), ours: summary(ourPool) };
}

function poolFrom(thread, pool) {
  for (const node of walk(thread.comments || [])) {
    const text = node.c.text || "";
    pool.lengths.push(text.length);
    if (node.depth === 0) pool.topLens.push(text.length);
    pool.n++;
    pool.words += text.split(/\s+/).filter(Boolean).length;
    for (const h of HEDGES) pool.hedges += (text.match(h) || []).length;
    pool.urls += (text.match(URL_RE) || []).length;
    if (CODE_RE.test(text)) pool.codes++;
    pool.emDashes += (text.match(EM_DASH) || []).length;
    if (/^>\s/.test(text.trimStart())) pool.quotes++;
  }
}

// ---- Verdict ----

function verdict(realVal, ourVal, tolerance = 0.4) {
  if (realVal === 0 && ourVal === 0) return "✓";
  if (realVal === 0) return "✗"; // we generated nothing matching
  const ratio = ourVal / realVal;
  if (ratio >= 1 - tolerance && ratio <= 1 + tolerance) return "✓";
  if (ratio >= 1 - tolerance * 2 && ratio <= 1 + tolerance * 2) return "⚠";
  return "✗";
}

function fmt(x, digits = 1) {
  if (x === null || x === undefined) return "—";
  if (typeof x !== "number") return String(x);
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}

// ---- Markdown report ----

function buildReport(items, agg) {
  const lines = [];
  const now = new Date().toISOString();
  lines.push(`# hackernews.lol — calibration report`);
  lines.push("");
  lines.push(`Generated ${now}. Compared ${items.length} pairs across distributional and stylistic metrics derivable from text alone.`);
  lines.push("");

  lines.push(`## Aggregate (pooled across all comments)`);
  lines.push("");
  lines.push(`| metric | real HN | hackernews.lol | ratio | verdict |`);
  lines.push(`|---|---:|---:|---:|:---:|`);
  const rowAgg = (label, r, o, digits = 2) => {
    const ratio = r === 0 ? "—" : fmt(o / r, 2);
    const v = verdict(r, o);
    lines.push(`| ${label} | ${fmt(r, digits)} | ${fmt(o, digits)} | ${ratio} | ${v} |`);
  };
  rowAgg("comments (count)", agg.real.n, agg.ours.n, 0);
  rowAgg("comment length — median chars", agg.real.lengthMedian, agg.ours.lengthMedian, 0);
  rowAgg("comment length — p10", agg.real.lengthP10, agg.ours.lengthP10, 0);
  rowAgg("comment length — p90", agg.real.lengthP90, agg.ours.lengthP90, 0);
  rowAgg("comment length — stddev", agg.real.lengthStd, agg.ours.lengthStd, 0);
  rowAgg("top-comment length — median", agg.real.topLenMedian, agg.ours.topLenMedian, 0);
  rowAgg("top-comment length — p90", agg.real.topLenP90, agg.ours.topLenP90, 0);
  rowAgg("quote-prefix rate", agg.real.quotePrefixRate, agg.ours.quotePrefixRate, 3);
  rowAgg("code-block rate", agg.real.codeRate, agg.ours.codeRate, 3);
  rowAgg("URLs per comment", agg.real.urlsPerComment, agg.ours.urlsPerComment, 3);
  rowAgg("hedges per 1000 words", agg.real.hedgesPer1KWords, agg.ours.hedgesPer1KWords, 2);
  rowAgg("em-dashes per comment", agg.real.emDashRate, agg.ours.emDashRate, 3);
  lines.push("");

  lines.push(`## Per-thread comparison`);
  lines.push("");
  lines.push(`Verdict legend: ✓ within ±40% · ⚠ within ±80% · ✗ off by more`);
  lines.push("");
  lines.push(`| hn_id | story_type | real n / top / depth | ours n / top / depth | real top-len p50/p90 | ours top-len p50/p90 | hedges r/o | quote% r/o |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);
  for (const it of items) {
    const r = it.real, o = it.ours;
    const stype = it.pair.story_type || "?";
    lines.push(
      `| ${it.id} | ${stype} | ${r.n}/${r.nTop}/${r.maxDepth} | ${o.n}/${o.nTop}/${o.maxDepth}` +
      ` | ${fmt(r.topLengthMedian, 0)}/${fmt(r.topLengthP90, 0)} | ${fmt(o.topLengthMedian, 0)}/${fmt(o.topLengthP90, 0)}` +
      ` | ${fmt(r.hedgesPer1KWords, 1)}/${fmt(o.hedgesPer1KWords, 1)} | ${fmt(r.quotePrefixRate, 2)}/${fmt(o.quotePrefixRate, 2)} |`
    );
  }
  lines.push("");

  // Top-line gaps surfaced as bullet recommendations
  lines.push(`## Worst-gap metrics`);
  lines.push("");
  const gaps = [
    ["comment-count ratio", agg.real.n, agg.ours.n],
    ["comment-length stddev", agg.real.lengthStd, agg.ours.lengthStd],
    ["URLs per comment", agg.real.urlsPerComment, agg.ours.urlsPerComment],
    ["code-block rate", agg.real.codeRate, agg.ours.codeRate],
    ["hedges per 1K words", agg.real.hedgesPer1KWords, agg.ours.hedgesPer1KWords],
    ["em-dashes per comment", agg.real.emDashRate, agg.ours.emDashRate],
  ];
  gaps.sort((a, b) => {
    const ra = a[1] === 0 ? Infinity : Math.abs(Math.log(Math.max(1e-6, a[2] / a[1])));
    const rb = b[1] === 0 ? Infinity : Math.abs(Math.log(Math.max(1e-6, b[2] / b[1])));
    return rb - ra;
  });
  for (const [name, r, o] of gaps.slice(0, 5)) {
    const ratio = r === 0 ? "(real is 0)" : `${fmt(o / r, 2)}× real`;
    lines.push(`- **${name}** — real ${fmt(r, 3)}, ours ${fmt(o, 3)} (${ratio})`);
  }
  lines.push("");

  return lines.join("\n");
}

// ---- Main ----

async function main() {
  const real = await loadDir(REAL);
  const ours = await loadDir(OURS);
  const ids = Object.keys(real).filter(id => ours[id]);
  if (!ids.length) {
    console.error("No paired threads found. Run scripts/run-eval.mjs first.");
    process.exit(1);
  }

  console.log(`Comparing ${ids.length} paired threads...`);
  const items = ids.map(id => {
    const cmp = compareOne(real[id], ours[id]);
    return { id, pair: real[id].pair, ...cmp };
  });
  // Aggregate needs raw thread JSON, not the per-thread metrics objects
  const rawPairs = ids.map(id => ({ real: real[id], ours: ours[id] }));
  const agg = aggregate(rawPairs);
  const report = buildReport(items, agg);

  await writeFile(OUT, report);
  console.log(`Wrote ${OUT}`);

  // Console summary
  console.log("");
  console.log("AGGREGATE (real → ours):");
  const r = agg.real, o = agg.ours;
  console.log(`  comments              ${r.n} → ${o.n}`);
  console.log(`  median length         ${r.lengthMedian.toFixed(0)} → ${o.lengthMedian.toFixed(0)}`);
  console.log(`  length stddev         ${r.lengthStd.toFixed(0)} → ${o.lengthStd.toFixed(0)}`);
  console.log(`  top-comment p50/p90   ${r.topLenMedian.toFixed(0)}/${r.topLenP90.toFixed(0)} → ${o.topLenMedian.toFixed(0)}/${o.topLenP90.toFixed(0)}`);
  console.log(`  quote-prefix rate     ${r.quotePrefixRate.toFixed(3)} → ${o.quotePrefixRate.toFixed(3)}`);
  console.log(`  code-block rate       ${r.codeRate.toFixed(3)} → ${o.codeRate.toFixed(3)}`);
  console.log(`  URLs per comment      ${r.urlsPerComment.toFixed(3)} → ${o.urlsPerComment.toFixed(3)}`);
  console.log(`  hedges per 1K words   ${r.hedgesPer1KWords.toFixed(2)} → ${o.hedgesPer1KWords.toFixed(2)}`);
  console.log(`  em-dashes per comment ${r.emDashRate.toFixed(3)} → ${o.emDashRate.toFixed(3)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
