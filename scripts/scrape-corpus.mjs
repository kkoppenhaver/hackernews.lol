/**
 * Stratified scrape of a representative Hacker News comment corpus.
 *
 * Sampling design (motivated by silicon-sampling / Argyle et al.):
 *   - Temporal spread: stories are drawn from N equal-width time buckets
 *     across the past DAYS_BACK days, not just today's front page.
 *   - Quality floor, not ceiling: stories must have MIN_POINTS and enough
 *     comments to sample from, but we don't restrict to only the very top —
 *     avoids virality bias.
 *   - Story-type stratification: we sample stories in proportions that
 *     approximate HN's natural front-page mix (TYPE_TARGETS), not uniform.
 *   - Within-thread stratification: each story's comment tree is flattened,
 *     then sampled across (depth_bin × engagement_tier) strata so we capture
 *     the tail (deep replies, low-reply comments) alongside top-of-thread voice.
 *   - Metadata preservation: story_type, depth, thread_rank, reply_count, points,
 *     num_comments are kept on every row so downstream weighting/conditioning
 *     can reproduce the empirical distribution.
 *
 * Run: node scripts/scrape-corpus.mjs
 * Out: data/corpus.jsonl
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const FB = "https://hacker-news.firebaseio.com/v0";
const ALGOLIA = "https://hn.algolia.com/api/v1";
const OUT = "data/corpus.jsonl";

// --- Sampling config ---
// v2 (2026-04-30): doubled corpus from 320 → 640 to widen voice variance
// the generator can pull from. Lowered MIN_LEN from 60 → 20 to capture the
// short punchy comments ("Sorry, but ick.", "This is dope.") that the
// generator was missing — those are a real HN voice we want represented.
const DAYS_BACK = 28;
const DAY_BUCKETS = 8;
const MIN_POINTS = 30;
const MIN_STORY_COMMENTS = 10;
const TARGET_STORIES = 75;
const TARGET_COMMENTS = 640;
const MIN_LEN = 20;
const MAX_LEN = 1400;
const MAX_DEPTH = 4;
const HITS_PER_BUCKET = 80;
const FB_BATCH = 16;

// Approx. HN front-page archetype mix. Sums to ~1.0. Tuned from eyeballing
// topstories over several days; adjust after reviewing the first corpus.
const TYPE_TARGETS = {
  news:           0.26,
  blog_technical: 0.26,
  show_hn:        0.12,
  github:         0.10,
  ask_hn:         0.08,
  research:       0.08,
  launch_hn:      0.02,
  tell_hn:        0.02,
  other:          0.06,
};

// --- Utils ---

function classifyStory(title, url) {
  const t = (title || "").toLowerCase();
  const u = url || "";
  if (t.startsWith("show hn:")) return "show_hn";
  if (t.startsWith("ask hn:")) return "ask_hn";
  if (t.startsWith("launch hn:")) return "launch_hn";
  if (t.startsWith("tell hn:")) return "tell_hn";
  if (/arxiv\.org|nature\.com|acm\.org|ieee\.org|\.edu\//.test(u) || u.endsWith(".pdf")) return "research";
  if (u.includes("github.com")) return "github";
  if (/techcrunch|theverge|wired|nytimes|bloomberg|reuters|ft\.com|wsj|arstechnica|theregister|economist/.test(u)) return "news";
  if (u) return "blog_technical";
  return "other";
}

const ENTITIES = [
  ["&#x27;", "'"], ["&#x2F;", "/"], ["&quot;", '"'],
  ["&amp;", "&"], ["&gt;", ">"], ["&lt;", "<"], ["&nbsp;", " "],
];

function stripHtml(s) {
  if (!s) return "";
  s = s.replace(/<p>/g, "\n\n").replace(/<[^>]+>/g, "");
  for (const [k, v] of ENTITIES) s = s.split(k).join(v);
  return s.trim();
}

async function getJson(url) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      await new Promise(res => setTimeout(res, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function fbItem(id) {
  try { return await getJson(`${FB}/item/${id}.json`); } catch { return null; }
}

function sampleWithoutReplacement(arr, n) {
  const copy = arr.slice();
  const out = [];
  while (copy.length && out.length < n) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

// --- Story selection (temporally + type stratified) ---

async function searchBucket(fromTs, toTs) {
  const nf = `points>=${MIN_POINTS},num_comments>=${MIN_STORY_COMMENTS},created_at_i>=${fromTs},created_at_i<${toTs}`;
  const url = `${ALGOLIA}/search?tags=story&numericFilters=${encodeURIComponent(nf)}&hitsPerPage=${HITS_PER_BUCKET}`;
  const r = await getJson(url);
  return r.hits || [];
}

async function selectStories() {
  const now = Math.floor(Date.now() / 1000);
  const window = DAYS_BACK * 86400;
  const bucketSize = Math.floor(window / DAY_BUCKETS);

  const hits = [];
  for (let b = 0; b < DAY_BUCKETS; b++) {
    const to = now - b * bucketSize;
    const from = to - bucketSize;
    const bucket = await searchBucket(from, to);
    hits.push(...bucket);
  }

  const seen = new Set();
  const unique = [];
  for (const h of hits) {
    if (!seen.has(h.objectID)) { seen.add(h.objectID); unique.push(h); }
  }

  const byType = {};
  for (const h of unique) {
    const type = classifyStory(h.title, h.url);
    (byType[type] ||= []).push(h);
  }

  console.log("Candidate stories by type:");
  for (const [t, xs] of Object.entries(byType).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${t.padEnd(16)} ${xs.length}`);
  }

  const picks = [];
  for (const [type, prop] of Object.entries(TYPE_TARGETS)) {
    const bucket = byType[type] || [];
    if (!bucket.length) continue;
    const n = Math.max(1, Math.round(prop * TARGET_STORIES));
    for (const h of sampleWithoutReplacement(bucket, n)) {
      picks.push({
        id: parseInt(h.objectID, 10),
        title: h.title || "",
        url: h.url || null,
        points: h.points || 0,
        num_comments: h.num_comments || 0,
        time: h.created_at_i,
        type,
      });
    }
  }
  return picks;
}

// --- Within-thread flattening + stratified sampling ---

async function flattenTree(storyId) {
  const story = await fbItem(storyId);
  if (!story || !story.kids) return [];

  const flat = [];
  const queue = story.kids.map((id, rank) => ({ id, depth: 1, threadRank: rank, parentText: null }));

  while (queue.length) {
    const batch = queue.splice(0, FB_BATCH);
    const items = await Promise.all(batch.map(q => fbItem(q.id)));
    for (let i = 0; i < batch.length; i++) {
      const q = batch[i];
      const item = items[i];
      if (!item || item.dead || item.deleted || item.type !== "comment") continue;
      const text = stripHtml(item.text || "");
      flat.push({
        id: item.id,
        depth: q.depth,
        threadRank: q.threadRank,
        parentText: q.parentText,
        text,
        by: item.by,
        time: item.time,
        numKids: (item.kids || []).length,
      });
      if (q.depth < MAX_DEPTH && item.kids) {
        item.kids.forEach((kid, rank) =>
          queue.push({ id: kid, depth: q.depth + 1, threadRank: rank, parentText: text })
        );
      }
    }
  }
  return flat;
}

const depthBin = d => (d === 1 ? "top" : d === 2 ? "mid" : "deep");
const engagementTier = k => (k >= 3 ? "high" : k >= 1 ? "mid" : "low");

function stratifiedSample(flat, n, storyMeta) {
  const ok = flat.filter(c => c.text && c.text.length >= MIN_LEN && c.text.length <= MAX_LEN);
  if (!ok.length) return [];

  const strata = {};
  for (const c of ok) {
    const key = `${depthBin(c.depth)}|${engagementTier(c.numKids)}`;
    (strata[key] ||= []).push(c);
  }

  const keys = Object.keys(strata);
  const perStratum = Math.max(1, Math.floor(n / keys.length));
  const picked = new Set();
  const out = [];
  for (const k of keys) {
    for (const c of sampleWithoutReplacement(strata[k], perStratum)) {
      out.push(c); picked.add(c.id);
    }
  }
  if (out.length < n) {
    const remaining = ok.filter(c => !picked.has(c.id));
    for (const c of sampleWithoutReplacement(remaining, n - out.length)) out.push(c);
  }

  return out.slice(0, n).map(c => ({
    id: c.id,
    story_id: storyMeta.id,
    story_title: storyMeta.title,
    story_url: storyMeta.url,
    story_type: storyMeta.type,
    story_points: storyMeta.points,
    story_num_comments: storyMeta.num_comments,
    story_time: storyMeta.time,
    depth: c.depth,
    depth_bin: depthBin(c.depth),
    thread_rank: c.threadRank,
    reply_count: c.numKids,
    engagement_tier: engagementTier(c.numKids),
    parent_text: c.parentText,
    comment_text: c.text,
    by: c.by,
    time: c.time,
  }));
}

// --- Main ---

async function main() {
  await mkdir(dirname(OUT), { recursive: true });

  console.log(`Selecting stories across ${DAYS_BACK} days in ${DAY_BUCKETS} buckets...`);
  const stories = await selectStories();

  const typeCounts = {};
  for (const s of stories) typeCounts[s.type] = (typeCounts[s.type] || 0) + 1;
  console.log(`\nSelected ${stories.length} stories:`);
  for (const [t, n] of Object.entries(typeCounts)) console.log(`  ${t.padEnd(16)} ${n}`);

  const perStory = Math.ceil(TARGET_COMMENTS / Math.max(stories.length, 1)) + 2;
  console.log(`\nFlattening trees, sampling up to ${perStory} comments per story...\n`);

  const allSampled = [];
  for (const s of stories) {
    const flat = await flattenTree(s.id);
    const rows = stratifiedSample(flat, perStory, s);
    allSampled.push(...rows);
    console.log(
      `  [${s.type.padEnd(14)}] pts=${String(s.points).padStart(4)} ` +
      `comm=${String(s.num_comments).padStart(4)}  ` +
      `${(s.title || "").slice(0, 52).padEnd(52)}  -> ${rows.length}`
    );
  }

  // Round-robin by story_type to keep the final corpus balanced even if some
  // stories yielded more usable comments than others.
  const byType = {};
  for (const c of allSampled) (byType[c.story_type] ||= []).push(c);
  const final = [];
  while (final.length < TARGET_COMMENTS && Object.values(byType).some(v => v.length)) {
    for (const t of Object.keys(byType)) {
      if (byType[t].length) {
        final.push(byType[t].shift());
        if (final.length >= TARGET_COMMENTS) break;
      }
    }
  }

  await writeFile(OUT, final.map(c => JSON.stringify(c)).join("\n") + "\n", "utf8");

  const finalByType = {}, finalByDepth = {}, finalByEng = {};
  for (const c of final) {
    finalByType[c.story_type] = (finalByType[c.story_type] || 0) + 1;
    finalByDepth[c.depth_bin] = (finalByDepth[c.depth_bin] || 0) + 1;
    finalByEng[c.engagement_tier] = (finalByEng[c.engagement_tier] || 0) + 1;
  }
  console.log(`\nWrote ${final.length} comments -> ${OUT}`);
  console.log("  by story_type:     ", finalByType);
  console.log("  by depth_bin:      ", finalByDepth);
  console.log("  by engagement_tier:", finalByEng);
}

main().catch(e => { console.error(e); process.exit(1); });
