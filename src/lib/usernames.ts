/**
 * Fake-username generator. Pool designed to mimic the HN distribution:
 * lowercase handles, snake_case, CamelCase, initials+numbers, and a few
 * word-combo throwaways. Real HN power-users are excluded by name so we
 * don't impersonate anyone specific.
 */

// Known HN power-users — never generate these.
const RESERVED = new Set([
  "dang", "tptacek", "jacquesm", "patio11", "simonw", "swyx", "pg", "kibwen",
  "gruseom", "cperciva", "colanderman", "userbinator", "zhugeqian",
  "aqme28", "jnwatson", "throwaway", "anonymous",
]);

const WORDS_ADJ = [
  "old", "deep", "fast", "slow", "red", "blue", "green", "grey", "dark", "mild",
  "flat", "sharp", "soft", "broken", "tiny", "vast", "quiet", "loud", "plain",
  "lost", "known", "odd", "raw", "wet", "dry", "cold", "hot", "wise", "clever",
  "lazy", "eager", "brave", "weary", "silent", "basic", "nimble", "bent",
];

const WORDS_NOUN = [
  "river", "stone", "dust", "cable", "cache", "parser", "daemon", "socket",
  "widget", "signal", "packet", "thread", "forest", "glider", "anchor", "crate",
  "canyon", "pebble", "feather", "marble", "spark", "fiber", "mesh", "badge",
  "wagon", "sleeve", "pilot", "beacon", "comet", "ember", "vector", "matrix",
  "lantern", "compass", "valley", "plateau", "tundra", "maple", "cedar", "oak",
];

const SUFFIXES = ["", "", "", "", "42", "7", "23", "99", "2", "_"];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomHandle(): string {
  const style = Math.random();
  const suffix = randomItem(SUFFIXES);

  // snake_case with adj+noun
  if (style < 0.25) {
    return `${randomItem(WORDS_ADJ)}_${randomItem(WORDS_NOUN)}${suffix}`;
  }
  // concatenated adj+noun
  if (style < 0.45) {
    return `${randomItem(WORDS_ADJ)}${randomItem(WORDS_NOUN)}${suffix}`;
  }
  // CamelCase
  if (style < 0.60) {
    const a = randomItem(WORDS_ADJ);
    const n = randomItem(WORDS_NOUN);
    return a[0].toUpperCase() + a.slice(1) + n[0].toUpperCase() + n.slice(1) + suffix;
  }
  // initials + numbers
  if (style < 0.75) {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const len = 2 + Math.floor(Math.random() * 3);
    let out = "";
    for (let i = 0; i < len; i++) out += letters[Math.floor(Math.random() * letters.length)];
    out += Math.floor(Math.random() * 900 + 100);
    return out;
  }
  // throwaway
  if (style < 0.85) {
    return `throwaway_${Math.floor(Math.random() * 9000 + 1000)}`;
  }
  // short lowercase word
  return `${randomItem(WORDS_NOUN)}${Math.floor(Math.random() * 90)}`;
}

export function generateUsernames(count: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let attempts = 0;
  while (out.length < count && attempts < count * 10) {
    attempts++;
    const h = randomHandle();
    if (seen.has(h) || RESERVED.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  // Top up if we somehow failed to generate enough
  while (out.length < count) out.push(`user_${out.length}_${Date.now() % 10000}`);
  return out;
}

export function pickUsername(): string {
  return generateUsernames(1)[0];
}
