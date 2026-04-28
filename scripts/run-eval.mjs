/**
 * Run our pipeline on every URL in data/eval-pairs.jsonl. Writes one file
 * per pair to data/eval-ours/<hn_id>.json with the SAME schema as
 * data/eval-real/<hn_id>.json so the comparison harness can diff them
 * side-by-side.
 *
 * Skips pairs whose output already exists (delete files in data/eval-ours/
 * to force regeneration).
 *
 * Usage: node scripts/run-eval.mjs [--force]
 *
 * Cost: ~$0.05 × 20 = ~$1 if all 20 are regenerated cold.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const PAIRS = "data/eval-pairs.jsonl";
const OUT_DIR = "data/eval-ours";
const ENDPOINT = process.env.HNL_ENDPOINT || "http://localhost:3000/api/simulate";
const FORCE = process.argv.includes("--force");
const PER_REQUEST_TIMEOUT_MS = 180_000;

async function loadPairs() {
  const text = await readFile(PAIRS, "utf8");
  return text.split("\n").filter(Boolean).map(l => JSON.parse(l));
}

async function callPipeline(url) {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

// Convert our Thread (flat children: Comment[]) into the eval-real shape
// (flat top-level array of comments with nested kids), so metrics align.
function toRealShape(pair, thread) {
  const toNode = (c) => ({
    id: c.id,
    by: c.by,
    time: null,            // we don't track real timestamps
    parent: null,
    text: c.text,
    age: c.age,
    points: c.points ?? null,
    kids: (c.children || []).map(toNode),
  });

  return {
    pair,
    story: {
      id: pair.hn_id,
      title: thread.title,
      url: thread.url,
      by: thread.by,
      score: thread.points,
      time: null,
      descendants: countNodes(thread.comments),
      text: "",
    },
    comments: (thread.comments || []).map(toNode),
    _generated_at: new Date().toISOString(),
  };
}

function countNodes(nodes) {
  let n = 0;
  const walk = (arr) => {
    for (const c of arr || []) {
      n++;
      walk(c.children || c.kids);
    }
  };
  walk(nodes);
  return n;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const pairs = await loadPairs();

  console.log(`Generating threads for ${pairs.length} eval URLs against ${ENDPOINT}\n`);

  let succeeded = 0, skipped = 0, failed = 0;
  const startedAt = Date.now();

  for (const [i, pair] of pairs.entries()) {
    const outPath = `${OUT_DIR}/${pair.hn_id}.json`;
    if (!FORCE && existsSync(outPath)) {
      console.log(`  [${i + 1}/${pairs.length}] SKIP ${pair.hn_id} (already exists)`);
      skipped++;
      continue;
    }
    const t0 = Date.now();
    try {
      const thread = await callPipeline(pair.article_url);
      const out = toRealShape(pair, thread);
      await writeFile(outPath, JSON.stringify(out, null, 2));
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const cN = countNodes(out.comments);
      console.log(`  [${i + 1}/${pairs.length}] OK   ${pair.hn_id} · ${cN.toString().padStart(3)} comments · ${elapsed}s · ${pair.title.slice(0, 50)}`);
      succeeded++;
    } catch (e) {
      console.log(`  [${i + 1}/${pairs.length}] FAIL ${pair.hn_id} · ${e instanceof Error ? e.message : e}`);
      failed++;
    }
    // Small delay to avoid tripping rate limits on origin sites we're ingesting
    await new Promise(r => setTimeout(r, 1500));
  }

  const total = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\nDone in ${total}s. succeeded=${succeeded} skipped=${skipped} failed=${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
