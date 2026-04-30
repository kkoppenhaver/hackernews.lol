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

import type { Article } from "@/lib/ingest";
import type { CommentSlot, ThreadPlan } from "@/lib/planner";
import type { Comment, Thread } from "@/types";
import { generateUsernames, pickUsername } from "@/lib/usernames";
import { pickExemplars, type CorpusRow } from "@/lib/exemplars";

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

// ---- System prompt construction ----

const PREAMBLE = `You write a single Hacker News comment to fit a specific slot in a thread. Every example below is a REAL HN comment scraped from news.ycombinator.com. Match their voice: their cadence, length, vocabulary, casualness, specificity, abruptness, punctuation, and willingness to be wrong, terse, snarky, or off-topic. Do not synthesize an "average" HN comment — pick one specific exemplar's energy and write in that key.

What real HN comments do that LLMs over-smooth:
- Many are short. 50-150 chars is common. Don't pad.
- Sentence fragments are fine. Periods are optional. Run-ons exist.
- Drop named specifics: actual model numbers, library names, dollar amounts, person names, hardware specs.
- Disagreement is often blunt: "No.", "That's wrong because...", "Not really.", "Counterpoint:".
- Praise is often three words: "This is dope.", "Nice work."
- Some comments ramble; some are dense; some are typo-ridden; some are just a question.
- DO NOT write balanced essays with three paragraphs and a meta-conclusion. That is the LLM voice. Avoid it.

Output: plain text, the comment body only. No quotes around it, no "Comment:" label, no username. If quoting the parent makes sense, use "> " on its own line; many comments don't quote at all.`;

function exemplarBlock(exemplars: CorpusRow[]): string {
  return exemplars
    .map((c, i) => {
      const parent = c.parent_text
        ? `[parent] ${c.parent_text.slice(0, 200).replace(/\s+/g, " ")}\n`
        : "";
      const len = c.comment_text.length;
      return `--- exemplar ${i + 1} (${c.story_type}, ${len} chars, depth ${c.depth}) ---\n${parent}${c.comment_text}`;
    })
    .join("\n\n");
}

function buildSystemPrompt(exemplars: CorpusRow[]): string {
  return `${PREAMBLE}\n\n# REAL HN COMMENTS — match this voice\n\n${exemplarBlock(exemplars)}`;
}

// ---- Per-comment call ----

function buildUserMessage(
  slot: CommentSlot,
  article: Article,
  parentChain: string[],
  siblingGists: string[],
): string {
  const storyLine = `Story: "${article.title}" (${article.hostname})`;
  const excerpt = article.excerpt
    ? `\nExcerpt: ${article.excerpt}`
    : "";
  const articleSnippet = `\nArticle text:\n${article.text.slice(0, 1200)}${article.text.length > 1200 ? "…" : ""}`;

  const parentBlock = parentChain.length
    ? `\n\nParent chain (root first):\n${parentChain
        .map((t, i) => `[${i + 1}] ${t.slice(0, 400)}${t.length > 400 ? "…" : ""}`)
        .join("\n")}`
    : "";

  const siblingBlock = siblingGists.length
    ? `\n\nPoints siblings have already made (avoid repeating):\n${siblingGists
        .map((g) => `- ${g.slice(0, 140).replace(/\s+/g, " ")}`)
        .join("\n")}`
    : "";

  const role =
    slot.role === "author"
      ? "You are the ORIGINAL POSTER replying to this comment. Be gracious and specific, acknowledge limitations, often commit to a fix. Don't defend."
      : `Voice: ${slot.archetype}${slot.modifiers.length ? ` (${slot.modifiers.join(", ")})` : ""}`;

  const position = slot.depth === 0 ? "top-level" : `reply at depth ${slot.depth}`;

  return `${storyLine}${excerpt}${articleSnippet}${parentBlock}${siblingBlock}

Write ONE comment for this slot, in the voice of the exemplars above.
Position: ${position}
${role}
Aim for around ${slot.lengthTarget} characters but pick whatever length the chosen voice naturally produces — could be 50, could be 600.

Comment:`;
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

function medianOf(xs: number[]): number {
  if (!xs.length) return 200;
  const sorted = xs.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// ---- Entry point ----

export async function generateThread(
  article: Article,
  plan: ThreadPlan,
): Promise<Thread> {
  // Per-thread system prompt is built once with a single batch of exemplars
  // matched to the *median* slot length so the same cached prefix is reused
  // across all the per-slot calls within this thread.
  const medianLengthTarget = medianOf(plan.slots.map((s) => s.lengthTarget));
  const exemplars = await pickExemplars({
    storyType: article.storyType,
    lengthTarget: medianLengthTarget,
    n: 14,
    isReply: false,
  });
  const system = buildSystemPrompt(exemplars);

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
