/**
 * Per-comment thread generator.
 *
 * For each slot in a ThreadPlan, issues one Claude Haiku 4.5 call with a
 * cached system prompt (style guide + archetype definitions + few-shot
 * exemplars drawn from data/corpus.jsonl). Siblings at the same depth are
 * generated in parallel after the cache is primed by a single seed call;
 * replies are serialized by depth so parent text can be supplied as context.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Article } from "@/lib/ingest";
import type { CommentSlot, ThreadPlan } from "@/lib/planner";
import type { Comment, Thread } from "@/types";
import { generateUsernames, pickUsername } from "@/lib/usernames";

// ---- Claude client (lazy, so `next build` doesn't crash without a key) ----

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    client = new Anthropic();
  }
  return client;
}

const MODEL = "claude-haiku-4-5";

// max_tokens scaled to the slot's length target. Soft prompt instructions
// to "stay within ±30% of N chars" are ignored by Haiku; bounded max_tokens
// is the only way to actually force length. Headroom factor 1.6x at 4 chars
// per token keeps us under p90 without truncating mid-sentence.
function maxTokensFor(lengthTarget: number): number {
  return Math.max(64, Math.min(512, Math.round((lengthTarget * 1.6) / 4)));
}

// ---- Style guide + corpus loading (cached in module scope) ----

let styleGuideCache: string | null = null;
async function loadStyleGuide(): Promise<string> {
  if (styleGuideCache) return styleGuideCache;
  const path = join(process.cwd(), "prompts", "style-guide.md");
  styleGuideCache = await readFile(path, "utf8");
  return styleGuideCache;
}

interface CorpusRow {
  id: number;
  story_type: string;
  story_title: string;
  depth: number;
  depth_bin: string;
  reply_count: number;
  parent_text: string | null;
  comment_text: string;
}

let corpusCache: CorpusRow[] | null = null;
async function loadCorpus(): Promise<CorpusRow[]> {
  if (corpusCache) return corpusCache;
  const path = join(process.cwd(), "data", "corpus.jsonl");
  const text = await readFile(path, "utf8");
  corpusCache = text.split("\n").filter(Boolean).map(l => JSON.parse(l) as CorpusRow);
  return corpusCache;
}

function sampleExemplars(corpus: CorpusRow[], storyType: string, n: number): CorpusRow[] {
  const matching = corpus.filter(c => c.story_type === storyType);
  const pool = matching.length >= n ? matching : corpus;
  const copy = pool.slice();
  const out: CorpusRow[] = [];
  while (out.length < n && copy.length) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

function buildSystemPrompt(styleGuide: string, exemplars: CorpusRow[]): string {
  const exBlock = exemplars.map((c, i) => {
    const parent = c.parent_text
      ? `[parent excerpt] ${c.parent_text.slice(0, 280).replace(/\s+/g, " ")}\n\n`
      : "";
    return `## Example ${i + 1} — story_type=${c.story_type}, depth=${c.depth}, replies=${c.reply_count}\n\n${parent}${c.comment_text}`;
  }).join("\n\n---\n\n");

  return `${styleGuide}\n\n# Reference exemplars (REAL Hacker News comments — never copy verbatim)\n\n${exBlock}`;
}

// ---- Per-comment call ----

function buildUserMessage(
  slot: CommentSlot,
  article: Article,
  parentChain: string[],
  siblingGists: string[],
): string {
  const storyBlock = [
    "STORY",
    `title: ${article.title}`,
    `site:  ${article.hostname}`,
    article.byline ? `byline: ${article.byline}` : null,
    article.excerpt ? `excerpt: ${article.excerpt}` : null,
    `\narticle (first ~1500 chars):\n${article.text.slice(0, 1500)}${article.text.length > 1500 ? "…" : ""}`,
  ].filter(Boolean).join("\n");

  const parentBlock = parentChain.length
    ? "\n\nPARENT CHAIN (root → direct parent)\n" +
      parentChain.map((t, i) => `[${i + 1}] ${t.slice(0, 500)}${t.length > 500 ? "…" : ""}`).join("\n\n")
    : "";

  const siblingBlock = siblingGists.length
    ? "\n\nSIBLING POINTS ALREADY MADE (avoid repeating)\n" +
      siblingGists.map((g, i) => `- ${g.slice(0, 160).replace(/\s+/g, " ")}`).join("\n")
    : "";

  const modText = slot.modifiers.length ? ` · modifiers: ${slot.modifiers.join(", ")}` : "";
  const role = slot.role === "author"
    ? `You are the ORIGINAL POSTER (OP) of this ${article.storyType} submission. Reply to the parent comment. Be gracious, substantive, acknowledge limitations openly, never defensive. Often commit to a fix. OP replies are 100-400 chars.`
    : `Archetype: ${slot.archetype}${modText}`;

  const positionHint = slot.depth === 0
    ? "top-level comment on the story"
    : `reply at depth ${slot.depth}`;

  return `${storyBlock}${parentBlock}${siblingBlock}

TASK
Produce ONE Hacker News comment, nothing else.

${role}

Position: ${positionHint}

Hard rules — these are not suggestions:
- NO em-dashes. Use commas, periods, parentheses, or hyphens. The em-dash is the loudest LLM tell. If you write a "—" the comment will be rejected.
- Most HN comments do NOT start with a "> " quote. Real rate: ~7%. Only quote ONE specific sentence from the parent if you're disagreeing with that exact wording. Otherwise refer to the parent by paraphrase or respond directly with no quote.
- Plain text. No markdown headers. No username prefix. No "Comment:" label.
- Bare URLs are fine when relevant.
- Length target ${slot.lengthTarget} chars. Stay within ±30%. Many HN comments are SHORT (under 150 chars). Don't write an essay when a sentence will do. Length variance across the thread is critical.
- Match the voice of the story_type as defined in the style guide.
- Write ONE comment. Do not write a thread. Do not write replies to yourself.

Return only the comment body.`;
}

/**
 * Post-process LLM output to remove the loudest non-HN tells.
 * - Em-dashes are 68× more frequent in our raw output than in real HN.
 *   Replace " — " with ", " and standalone "—" with " - ".
 */
function scrub(text: string): string {
  return text
    // " — " (with surrounding spaces) → ", "
    .replace(/\s+—\s+/g, ", ")
    // "word—word" (no spaces) → "word-word"
    .replace(/—/g, "-");
}

async function generateOne(
  slot: CommentSlot,
  article: Article,
  parentChain: string[],
  siblingGists: string[],
  system: string,
): Promise<string> {
  const c = getClient();
  try {
    const response = await c.messages.create({
      model: MODEL,
      max_tokens: maxTokensFor(slot.lengthTarget),
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        { role: "user", content: buildUserMessage(slot, article, parentChain, siblingGists) },
      ],
    });
    const block = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    return scrub(block?.text.trim() ?? "");
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      console.error(`[generator] API error ${e.status} for slot ${slot.id}:`, e.message);
    } else {
      console.error(`[generator] error for slot ${slot.id}:`, e);
    }
    return "";
  }
}

// ---- Thread assembly helpers ----

function commentAgeForDepth(depth: number, storyAgeHours: number): string {
  // Comments are younger than the story; deeper comments tend to be younger on average.
  const maxMinutes = Math.max(10, storyAgeHours * 60 - 5);
  const youthBias = 1 - Math.min(0.85, depth * 0.12);
  const minutes = Math.floor(maxMinutes * Math.random() * youthBias);
  if (minutes < 60) return `${Math.max(1, minutes)} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

function storyAgeString(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.floor(hours * 60))} minutes ago`;
  const h = Math.floor(hours);
  return h === 1 ? "1 hour ago" : `${h} hours ago`;
}

function samplePoints(slot: CommentSlot): number {
  // Top-level: skewed right; deeper: smaller.
  const base = slot.depth === 0 ? 8 : slot.depth === 1 ? 3 : 1;
  const engagementBoost = Math.min(40, slot.lengthTarget / 20);
  const u = Math.random();
  const skew = Math.pow(u, 1.8);
  return Math.max(1, Math.round(base + skew * engagementBoost * (3 + slot.depth === 0 ? 5 : 1)));
}

function gist(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 180);
}

// ---- Entry point ----

export async function generateThread(
  article: Article,
  plan: ThreadPlan,
): Promise<Thread> {
  const [styleGuide, corpus] = await Promise.all([loadStyleGuide(), loadCorpus()]);
  const exemplars = sampleExemplars(corpus, article.storyType, 5);
  const system = buildSystemPrompt(styleGuide, exemplars);

  // Index slots for parent-chain lookup + sibling context.
  const slotsById = new Map(plan.slots.map(s => [s.id, s]));
  const textsById = new Map<string, string>();

  // Group by depth; within each depth, by parentId to gather siblings.
  const byDepth = new Map<number, CommentSlot[]>();
  for (const s of plan.slots) {
    if (!byDepth.has(s.depth)) byDepth.set(s.depth, []);
    byDepth.get(s.depth)!.push(s);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);

  // Helpers that read the current state.
  const parentChainFor = (slot: CommentSlot): string[] => {
    const chain: string[] = [];
    let p = slot.parentId;
    while (p) {
      const parent = slotsById.get(p);
      if (!parent) break;
      const t = textsById.get(p);
      if (t) chain.unshift(t);
      p = parent.parentId;
    }
    return chain;
  };

  const siblingGistsFor = (slot: CommentSlot, completedInSameLevel: CommentSlot[]): string[] => {
    return completedInSameLevel
      .filter(s => s.parentId === slot.parentId && s.id !== slot.id)
      .map(s => gist(textsById.get(s.id) || ""))
      .filter(Boolean);
  };

  for (const depth of depths) {
    const slotsAtDepth = byDepth.get(depth)!;
    if (slotsAtDepth.length === 0) continue;

    // Prime the cache with the first slot at this depth (serial), then run
    // the rest in parallel so they all hit the cached system prefix.
    const [seed, ...rest] = slotsAtDepth;
    const seedText = await generateOne(
      seed,
      article,
      parentChainFor(seed),
      siblingGistsFor(seed, []),
      system,
    );
    textsById.set(seed.id, seedText);
    const completed: CommentSlot[] = [seed];

    if (rest.length > 0) {
      const results = await Promise.all(
        rest.map(slot =>
          generateOne(
            slot,
            article,
            parentChainFor(slot),
            siblingGistsFor(slot, completed),
            system,
          ).then(t => ({ slot, text: t })),
        ),
      );
      for (const r of results) {
        textsById.set(r.slot.id, r.text);
      }
    }
  }

  // ---- Assemble tree with metadata ----

  const storyAgeHours = 1 + Math.random() * 5;
  const usernames = generateUsernames(plan.slots.length + 2);
  const authorUsername = usernames.pop()!;

  const commentsById = new Map<string, Comment>();
  const roots: Comment[] = [];
  const orderedSlots = [...plan.slots].sort((a, b) => a.depth - b.depth);

  for (const slot of orderedSlots) {
    const text = textsById.get(slot.id);
    if (!text) continue; // drop slots that failed to generate
    const comment: Comment = {
      id: slot.id,
      by: slot.role === "author" ? authorUsername : (usernames.pop() ?? pickUsername()),
      age: commentAgeForDepth(slot.depth, storyAgeHours),
      points: samplePoints(slot),
      text,
      children: [],
    };
    commentsById.set(slot.id, comment);
    if (slot.parentId) {
      const parent = commentsById.get(slot.parentId);
      if (parent) parent.children!.push(comment);
      else roots.push(comment); // orphaned due to failed parent — attach to root
    } else {
      roots.push(comment);
    }
  }

  return {
    url: article.finalUrl,
    title: article.title,
    hostname: article.hostname,
    by: authorUsername,
    age: storyAgeString(storyAgeHours),
    points: 40 + Math.floor(Math.random() * 300),
    comments: roots,
  };
}
