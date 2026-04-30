/**
 * Pick N few-shot exemplars from the 320-comment corpus, matched to the
 * slot we're about to generate (story_type, length target). The goal is
 * imitation pressure: show the model real HN comments at the same rough
 * shape as the one we want it to write, then get out of its way.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface CorpusRow {
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
  const text = await readFile(join(process.cwd(), "data", "corpus.jsonl"), "utf8");
  corpusCache = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as CorpusRow);
  return corpusCache;
}

interface PickArgs {
  storyType: string;
  /** Target character length we're aiming for; we'll bias toward exemplars in [target/2, target*2]. */
  lengthTarget: number;
  /** Number of exemplars to return. */
  n: number;
  /** True if we want exemplars at depth ≥ 1 (replies); false for top-level. */
  isReply: boolean;
}

export async function pickExemplars(args: PickArgs): Promise<CorpusRow[]> {
  const corpus = await loadCorpus();
  const { storyType, lengthTarget, n, isReply } = args;

  // Layered filters from strict to loose; fall back when a layer is too thin.
  const candidates = filterCandidates(corpus, { storyType, lengthTarget, isReply });
  return diverseSample(candidates, n, lengthTarget);
}

function filterCandidates(
  corpus: CorpusRow[],
  { storyType, lengthTarget, isReply }: { storyType: string; lengthTarget: number; isReply: boolean },
): CorpusRow[] {
  const inLengthBand = (c: CorpusRow) => {
    const len = c.comment_text.length;
    return len >= Math.max(40, lengthTarget * 0.4) && len <= lengthTarget * 2.5;
  };
  const matchesDepth = (c: CorpusRow) => (isReply ? c.depth > 0 : c.depth === 0);

  // Ideal: same story_type + depth class + length band.
  let pool = corpus.filter(
    (c) => c.story_type === storyType && matchesDepth(c) && inLengthBand(c),
  );
  if (pool.length >= 18) return pool;

  // Loosen: same story_type + length band (any depth).
  pool = corpus.filter((c) => c.story_type === storyType && inLengthBand(c));
  if (pool.length >= 18) return pool;

  // Loosen further: any story_type + length band.
  pool = corpus.filter(inLengthBand);
  if (pool.length >= 18) return pool;

  // Last resort: any story_type, no length filter.
  return corpus;
}

/**
 * Return n exemplars that span the length band rather than clustering at one
 * point. We sort by distance from the target, then sample with stride to get
 * spread.
 */
function diverseSample(pool: CorpusRow[], n: number, target: number): CorpusRow[] {
  if (pool.length <= n) return shuffle(pool.slice());
  const sorted = pool
    .slice()
    .sort((a, b) =>
      Math.abs(a.comment_text.length - target) -
      Math.abs(b.comment_text.length - target),
    );
  // Stride through the sorted list — pulls in some short, some at-target, some longer.
  const stride = Math.max(1, Math.floor(sorted.length / n));
  const picks: CorpusRow[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.min(sorted.length - 1, i * stride + Math.floor(Math.random() * stride));
    picks.push(sorted[idx]);
  }
  return shuffle(picks);
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
