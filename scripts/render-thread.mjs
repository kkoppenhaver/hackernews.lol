/**
 * Render one eval reference thread to stdout, top-level branches sorted by
 * subtree size, up to 5 branches, max depth 3, comments wrapped at 78 chars
 * and capped at ~8 lines each.
 *
 * Usage: node scripts/render-thread.mjs <hn_id> [max_tops] [max_depth]
 */

import { readFile } from "node:fs/promises";

const [,, rawId, rawTops, rawDepth] = process.argv;
if (!rawId) { console.error("usage: render-thread.mjs <hn_id>"); process.exit(1); }

const maxTops = rawTops ? parseInt(rawTops, 10) : 5;
const maxDepth = rawDepth ? parseInt(rawDepth, 10) : 3;

const d = JSON.parse(await readFile(`data/eval-real/${rawId}.json`, "utf8"));
const { story, comments } = d;

const bar = "─".repeat(78);
console.log(bar);
console.log(story.title);
console.log("  " + (story.url || ""));
console.log(`  ${story.score} points · ${story.descendants} comments · by ${story.by}`);
if (story.text) console.log("  self: " + story.text.replace(/\n+/g, " ").slice(0, 300) + (story.text.length > 300 ? "…" : ""));
console.log(bar);

const subtreeSize = (n) => n.deleted ? 0 : 1 + (n.kids || []).reduce((s, k) => s + subtreeSize(k), 0);
const tops = [...comments].sort((a, b) => subtreeSize(b) - subtreeSize(a)).slice(0, maxTops);

function wrapLines(text, width, indent) {
  const out = [];
  const words = text.replace(/\n+/g, " ").split(/\s+/);
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      out.push(indent + line.trim());
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) out.push(indent + line);
  return out;
}

function render(c, depth) {
  if (c.deleted) return;
  const pad = "  ".repeat(depth);
  console.log(`${pad}▸ ${c.by || "?"} · ${(c.kids || []).length} replies`);
  const lines = wrapLines(c.text || "", 76 - depth * 2, pad + "  ");
  const max = 8;
  for (const ln of lines.slice(0, max)) console.log(ln);
  if (lines.length > max) console.log(pad + "  …");
  console.log();
  if (depth + 1 < maxDepth) {
    // Show first 2 replies at each deeper level (keeps output tight)
    for (const k of (c.kids || []).slice(0, depth === 0 ? 3 : 2)) render(k, depth + 1);
  }
}

for (const t of tops) render(t, 0);
