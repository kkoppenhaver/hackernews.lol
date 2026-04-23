/**
 * Compact summary of one eval reference thread: top 3 branches by subtree size,
 * first ~350 chars of each top-level comment + first 2 replies.
 */

import { readFile } from "node:fs/promises";

const id = process.argv[2];
if (!id) { console.error("usage: thread-brief.mjs <hn_id>"); process.exit(1); }

const d = JSON.parse(await readFile(`data/eval-real/${id}.json`, "utf8"));
const { story, comments } = d;

const bar = "─".repeat(78);
console.log(bar);
console.log(story.title);
console.log(`  ${story.score}pts · ${story.descendants} comments · by ${story.by}`);
console.log(bar);

const size = (n) => n.deleted ? 0 : 1 + (n.kids || []).reduce((s, k) => s + size(k), 0);
const tops = [...comments].sort((a, b) => size(b) - size(a)).slice(0, 3);

const clip = (t, n) => {
  t = (t || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

for (const t of tops) {
  if (t.deleted) continue;
  const n = (t.kids || []).length;
  console.log(`▸ ${t.by} (${n} replies, ${size(t) - 1} descendants):`);
  console.log(`  ${clip(t.text, 500)}`);
  for (const k of (t.kids || []).slice(0, 2)) {
    if (k.deleted) continue;
    console.log(`    ↳ ${k.by}: ${clip(k.text, 350)}`);
  }
  console.log();
}
