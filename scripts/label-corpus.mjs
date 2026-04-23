/**
 * Single-keypress corpus labeler.
 *
 * Reads data/corpus.jsonl, shows one comment at a time with story context,
 * prompts three dimensions via single keypress, appends labeled rows to
 * data/corpus-labeled.jsonl. Resumable — rows already in the output file
 * are skipped on restart.
 *
 * Keys:
 *   1-9,0  pick an option
 *   b      undo last dimension (within the current row)
 *   s      skip this row (don't label)
 *   q      save progress and quit
 *   Ctrl-C quit immediately (labeled rows already flushed)
 *
 * Run: node scripts/label-corpus.mjs
 */

import { readFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

const IN = "data/corpus.jsonl";
const OUT = "data/corpus-labeled.jsonl";

const ARCHETYPES = {
  "1": "skeptic",
  "2": "expert-actually",
  "3": "anecdote",
  "4": "pedant",
  "5": "tangent",
  "6": "meta-complaint",
  "7": "enthusiast",
  "8": "gotcha",
  "9": "explainer",
  "0": "name-drop",
};

const TONES = {
  "1": "dry",
  "2": "earnest",
  "3": "snarky",
  "4": "curious",
  "5": "mixed",
};

const OPENS = {
  "1": "question",
  "2": "disagreement",
  "3": "anecdote",
  "4": "claim",
  "5": "other",
};

const CLEAR = "\x1b[2J\x1b[H";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const MAGENTA = "\x1b[35m";

async function loadJsonl(path) {
  if (!existsSync(path)) return [];
  const text = await readFile(path, "utf8");
  return text.split("\n").filter(Boolean).map(l => JSON.parse(l));
}

function getKey() {
  return new Promise(resolve => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (d) => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      if (d === "") process.exit(0);
      resolve(d);
    };
    process.stdin.on("data", onData);
  });
}

async function prompt(question, map) {
  const opts = Object.entries(map).map(([k, v]) => `${MAGENTA}[${k}]${RESET}${v}`).join("  ");
  process.stdout.write(`\n${BOLD}${question}${RESET}\n${opts}  ${DIM}(b=back s=skip q=quit)${RESET}\n> `);
  while (true) {
    const key = await getKey();
    if (key === "q") return { action: "quit" };
    if (key === "b") return { action: "back" };
    if (key === "s") return { action: "skip" };
    if (map[key]) return { action: "answer", value: map[key] };
  }
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function render(row, pos, total, knownSoFar) {
  process.stdout.write(CLEAR);
  const pct = Math.round((pos / total) * 100);
  console.log(
    `${CYAN}[${pos}/${total}] ${pct}%${RESET}  ` +
    `${BOLD}${row.story_type}${RESET} · depth=${row.depth_bin} · eng=${row.engagement_tier} · replies=${row.reply_count}`
  );
  console.log(`${YELLOW}Story:${RESET} ${row.story_title}`);
  if (row.story_url) console.log(`${DIM}URL:   ${row.story_url}${RESET}`);
  if (row.parent_text) {
    console.log(`${DIM}────────────────────${RESET}`);
    console.log(`${DIM}Parent:${RESET}`);
    console.log(`${DIM}${truncate(row.parent_text, 400)}${RESET}`);
  }
  console.log(`${DIM}────────────────────${RESET}`);
  console.log(`${GREEN}Comment:${RESET}`);
  console.log(row.comment_text);
  console.log(`${DIM}────────────────────${RESET}`);
  for (const [label, val] of knownSoFar) {
    console.log(`${DIM}${label}: ${val}${RESET}`);
  }
}

async function main() {
  await mkdir(dirname(OUT), { recursive: true });
  const corpus = await loadJsonl(IN);
  const labeled = await loadJsonl(OUT);
  const done = new Set(labeled.map(r => r.id));
  const remaining = corpus.filter(r => !done.has(r.id));

  process.stdout.write(CLEAR);
  console.log(`${BOLD}Corpus labeler${RESET}`);
  console.log(`  Total:      ${corpus.length}`);
  console.log(`  Labeled:    ${done.size}`);
  console.log(`  Remaining:  ${remaining.length}`);
  console.log(`\n${DIM}Keys: 1-9/0 options · b back · s skip row · q save+quit · Ctrl-C exit${RESET}`);
  if (!remaining.length) {
    console.log(`\n${GREEN}Nothing left to label.${RESET}`);
    return;
  }
  console.log(`\n${DIM}Press any key to start.${RESET}`);
  await getKey();

  const fields = [
    ["archetype", "Archetype?", ARCHETYPES],
    ["tone", "Tone?", TONES],
    ["opens_with", "Opens with?", OPENS],
  ];

  let labeledCount = 0;
  let skippedCount = 0;

  outer: for (let i = 0; i < remaining.length; i++) {
    const row = remaining[i];
    const state = { archetype: null, tone: null, opens_with: null };
    const pos = done.size + labeledCount + skippedCount + 1;
    let stage = 0;
    let skip = false;

    while (stage < fields.length) {
      const knownSoFar = fields
        .slice(0, stage)
        .map(([k, label]) => [label.replace(/\?$/, ""), state[k]]);
      render(row, pos, corpus.length, knownSoFar);

      const [key, question, map] = fields[stage];
      const res = await prompt(question, map);
      if (res.action === "quit") {
        console.log(`\n${YELLOW}Saved. Labeled this session: ${labeledCount}, skipped: ${skippedCount}.${RESET}`);
        break outer;
      }
      if (res.action === "skip") { skip = true; break; }
      if (res.action === "back") {
        if (stage > 0) {
          state[fields[stage - 1][0]] = null;
          stage -= 1;
        }
        continue;
      }
      state[key] = res.value;
      stage += 1;
    }

    if (skip) { skippedCount += 1; continue; }
    const out = { ...row, ...state };
    await appendFile(OUT, JSON.stringify(out) + "\n");
    labeledCount += 1;
  }

  const final = await loadJsonl(OUT);
  console.log(`\n${BOLD}Done.${RESET} ${final.length}/${corpus.length} labeled in ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
