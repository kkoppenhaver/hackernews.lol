/**
 * Fetch the full nested comment tree for every pair in data/eval-pairs.jsonl
 * using the HN Firebase API. One file per thread written to data/eval-real/<hn_id>.json,
 * containing { pair, story, comments: [recursive tree] }.
 *
 * Usage: node scripts/fetch-eval-threads.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";

const FB = "https://hacker-news.firebaseio.com/v0";
const IN = "data/eval-pairs.jsonl";
const OUT_DIR = "data/eval-real";

const ENTITIES = [
  ["&#x27;", "'"], ["&#x2F;", "/"], ["&quot;", '"'],
  ["&amp;", "&"], ["&gt;", ">"], ["&lt;", "<"], ["&nbsp;", " "],
];
const stripHtml = (s) => {
  if (!s) return "";
  s = s.replace(/<p>/g, "\n\n").replace(/<[^>]+>/g, "");
  for (const [k, v] of ENTITIES) s = s.split(k).join(v);
  return s.trim();
};

async function fbItem(id) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${FB}/item/${id}.json`, { signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.json();
    } catch {}
    await new Promise(r => setTimeout(r, 500 * (i + 1)));
  }
  return null;
}

// Recursively fetch a comment subtree with bounded concurrency at each level.
async function fetchSubtree(id) {
  const item = await fbItem(id);
  if (!item) return null;
  if (item.type !== "comment") return null;
  if (item.dead || item.deleted) {
    return { id, deleted: true, kids: [] };
  }
  const kidIds = item.kids || [];
  const kids = kidIds.length
    ? (await Promise.all(kidIds.map(fetchSubtree))).filter(Boolean)
    : [];
  return {
    id: item.id,
    by: item.by,
    time: item.time,
    parent: item.parent,
    text: stripHtml(item.text || ""),
    kids,
  };
}

function countComments(nodes) {
  let n = 0;
  const walk = (arr) => {
    for (const c of arr || []) { if (!c.deleted) n++; walk(c.kids); }
  };
  walk(nodes);
  return n;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const text = await readFile(IN, "utf8");
  const pairs = text.split("\n").filter(Boolean).map(l => JSON.parse(l));

  console.log(`Fetching ${pairs.length} threads...\n`);
  let idx = 0;
  for (const pair of pairs) {
    idx++;
    const story = await fbItem(pair.hn_id);
    if (!story) {
      console.log(`  [${idx}/${pairs.length}] MISS id=${pair.hn_id}`);
      continue;
    }
    const rootKids = story.kids || [];
    const comments = (await Promise.all(rootKids.map(fetchSubtree))).filter(Boolean);
    const n = countComments(comments);

    const out = {
      pair,
      story: {
        id: story.id,
        title: story.title,
        url: story.url || null,
        by: story.by,
        score: story.score,
        time: story.time,
        descendants: story.descendants || 0,
        text: stripHtml(story.text || ""),
      },
      comments,
    };
    await writeFile(`${OUT_DIR}/${pair.hn_id}.json`, JSON.stringify(out, null, 2));
    console.log(`  [${idx}/${pairs.length}] ${pair.hn_id} · ${n.toString().padStart(4)} comments · ${pair.title.slice(0, 60)}`);
  }
  console.log(`\nDone. Files in ${OUT_DIR}/`);
}

main().catch(e => { console.error(e); process.exit(1); });
