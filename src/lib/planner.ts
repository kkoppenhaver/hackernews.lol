/**
 * Thread planner — given an ingested article, produce a tree of comment
 * slots the generator will populate. Shapes and archetype proportions come
 * from data/archetype-mix.json, derived from observation of 20 eval threads.
 */

import archetypeMix from "../../data/archetype-mix.json";
import type { StoryType } from "@/lib/ingest";

// ---------- Types ----------

export interface CommentSlot {
  id: string;
  parentId: string | null;
  depth: number;
  archetype: string;
  modifiers: string[];
  lengthTarget: number;
  role: "commenter" | "author";
  /** Fake-username slot — populated by generator post-hoc. */
  username?: string;
}

export interface ThreadPlan {
  storyType: StoryType;
  totalSlots: number;
  slots: CommentSlot[];          // flat list, parent-before-child order
}

// ---------- Mix lookup with fallback ----------

type MixTable = Record<string, Record<string, number>>;

function typeMix(storyType: StoryType): Record<string, number> {
  const m = archetypeMix as unknown as MixTable;
  return m[storyType] || m["other"];
}

function typeShape(storyType: StoryType) {
  const base = (archetypeMix as any).thread_shape;
  const override = base.per_type_overrides?.[storyType] || {};
  return {
    top_level_fraction: override.top_level_fraction ?? base.top_level_fraction,
    deep_branch_count: override.deep_branch_count ?? base.deep_branch_count,
    deep_branch_reply_share: override.deep_branch_reply_share ?? base.deep_branch_reply_share,
    max_depth: override.max_depth ?? base.max_depth,
    typical_branch_depth: override.typical_branch_depth ?? base.typical_branch_depth,
  };
}

function lengthFor(storyType: StoryType, role: "top" | "reply"): number {
  const lt = (archetypeMix as any).length_targets;
  const t = lt[storyType] || lt["blog_technical"];
  const p50 = role === "top" ? t.top_p50 : t.reply_p50;
  const p90 = role === "top" ? t.top_p90 : t.reply_p90;
  const stddev = Math.max(30, (p90 - p50) / 1.28);
  const raw = gauss(p50, stddev);
  return Math.max(40, Math.round(raw));
}

function authorReplyRate(storyType: StoryType): number {
  const r = (archetypeMix as any).author_reply_rates;
  return r[storyType] ?? r.default;
}

// ---------- Sampling helpers ----------

function gauss(mean: number, stddev: number): number {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function weightedPick<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as Array<[T, number]>;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  const r = Math.random() * total;
  let acc = 0;
  for (const [key, w] of entries) {
    acc += w;
    if (r <= acc) return key;
  }
  return entries[entries.length - 1][0];
}

function sampleModifiers(): string[] {
  const probs = (archetypeMix as any).modifier_probabilities;
  const out: string[] = [];
  for (const [k, p] of Object.entries(probs)) {
    if (k.startsWith("_")) continue;
    if (Math.random() < (p as number)) out.push(k);
  }
  return out;
}

function cryptoId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ---------- Total-comment sampling ----------

/** Samples a realistic total-comment count for a fresh thread. */
function sampleTotalComments(storyType: StoryType): number {
  // Front-page medians by type from our eval set:
  //   show_hn ~70, ask_hn ~150, tell_hn ~180, news ~150, blog_technical ~90,
  //   github ~80, research ~30, launch_hn ~90
  // But for the *simulated* thread we want a usable size — capped lower.
  const targets: Record<string, [number, number]> = {
    show_hn:        [14, 24],
    ask_hn:         [16, 28],
    tell_hn:        [18, 30],
    launch_hn:      [14, 22],
    news:           [16, 28],
    blog_technical: [14, 22],
    github:         [12, 20],
    research:       [8,  16],
    other:          [12, 20],
  };
  const [lo, hi] = targets[storyType] || targets.other;
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

// ---------- Branch-size distribution ----------

/**
 * Given N total comments and N_top top-level slots, allocate reply counts:
 * deep branches (count = shape.deep_branch_count) take deep_branch_reply_share
 * of the remaining budget; the rest is spread unevenly across the other
 * top-levels.
 */
function allocateReplies(
  nTotal: number,
  nTop: number,
  shape: ReturnType<typeof typeShape>,
): number[] {
  const remaining = Math.max(0, nTotal - nTop);
  const replies: number[] = new Array(nTop).fill(0);
  const deepCount = Math.min(shape.deep_branch_count, nTop);
  const deepBudget = Math.round(remaining * shape.deep_branch_reply_share);
  const restBudget = remaining - deepBudget;

  // First `deepCount` top-levels get the deep-branch share (order implies
  // engagement; we'll shuffle later so deep branches aren't always first).
  for (let i = 0; i < deepCount; i++) {
    replies[i] = Math.floor(deepBudget / deepCount);
  }
  // Spread leftover deep budget
  let leftover = deepBudget - replies.slice(0, deepCount).reduce((a, b) => a + b, 0);
  for (let i = 0; i < deepCount && leftover > 0; i++) { replies[i]++; leftover--; }

  // Distribute rest across remaining slots — random 1..4 until budget is gone.
  let r = restBudget;
  let i = deepCount;
  while (r > 0 && i < nTop) {
    const take = Math.min(r, 1 + Math.floor(Math.random() * 4));
    replies[i] += take;
    r -= take;
    i++;
  }
  while (r > 0) {
    // extra goes to the deep branches
    const idx = Math.floor(Math.random() * deepCount || 1);
    replies[idx]++;
    r--;
  }

  // Shuffle so deep branches aren't always the first top-levels rendered.
  for (let k = replies.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [replies[k], replies[j]] = [replies[j], replies[k]];
  }
  return replies;
}

// ---------- Recursive reply tree ----------

function buildReplies(
  parent: CommentSlot,
  count: number,
  shape: ReturnType<typeof typeShape>,
  mix: Record<string, number>,
  storyType: StoryType,
  out: CommentSlot[],
  authorRate: number,
): void {
  if (count <= 0) return;
  if (parent.depth + 1 > shape.max_depth) return;

  // Split count between direct replies and grand-replies.
  const directReplies = Math.max(1, Math.round(count * (0.55 + Math.random() * 0.2)));
  const grandBudget = count - directReplies;
  const budgets: number[] = new Array(directReplies).fill(0);
  for (let i = 0; i < grandBudget; i++) {
    budgets[Math.floor(Math.random() * directReplies)]++;
  }

  for (let i = 0; i < directReplies; i++) {
    const isAuthor =
      parent.role === "commenter" &&
      parent.depth === 0 &&
      Math.random() < authorRate;

    const slot: CommentSlot = {
      id: cryptoId(),
      parentId: parent.id,
      depth: parent.depth + 1,
      archetype: isAuthor ? "author-reply" : weightedPick(mix as any),
      modifiers: isAuthor ? [] : sampleModifiers(),
      lengthTarget: lengthFor(storyType, "reply"),
      role: isAuthor ? "author" : "commenter",
    };
    out.push(slot);
    buildReplies(slot, budgets[i], shape, mix, storyType, out, 0);
  }
}

// ---------- Top-level entrypoint ----------

export function planThread(
  args: { storyType: StoryType },
): ThreadPlan {
  const storyType = args.storyType;
  const mix = typeMix(storyType);
  const shape = typeShape(storyType);
  const authorRate = authorReplyRate(storyType);

  const nTotal = sampleTotalComments(storyType);
  const nTop = Math.max(3, Math.round(nTotal * shape.top_level_fraction));
  const replyCounts = allocateReplies(nTotal, nTop, shape);

  const slots: CommentSlot[] = [];
  for (let i = 0; i < nTop; i++) {
    const slot: CommentSlot = {
      id: cryptoId(),
      parentId: null,
      depth: 0,
      archetype: weightedPick(mix as any),
      modifiers: sampleModifiers(),
      lengthTarget: lengthFor(storyType, "top"),
      role: "commenter",
    };
    slots.push(slot);
    buildReplies(slot, replyCounts[i], shape, mix, storyType, slots, authorRate);
  }

  return {
    storyType,
    totalSlots: slots.length,
    slots,
  };
}
