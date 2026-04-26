/**
 * Site ingestion — fetch a user-supplied URL, extract the article with
 * Mozilla Readability, classify story type, and return a structured summary
 * the generator can condition on.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

import { checkUrl } from "@/lib/safety";

const FETCH_TIMEOUT_MS = 12000;
const MAX_BYTES = 5_000_000;
const MAX_ARTICLE_CHARS = 18000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; hackernews.lol/0.1; +https://hackernews.lol)";

export type StoryType =
  | "show_hn"
  | "ask_hn"
  | "launch_hn"
  | "tell_hn"
  | "research"
  | "github"
  | "news"
  | "blog_technical"
  | "other";

export interface Article {
  url: string;
  finalUrl: string;
  hostname: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  excerpt: string;
  text: string;
  lang: string | null;
  storyType: StoryType;
  contentLength: number;
  truncated: boolean;
}

export type IngestResult =
  | { ok: true; article: Article }
  | { ok: false; reason: string };

const NEWS_DOMAINS = [
  "techcrunch.com", "theverge.com", "wired.com", "nytimes.com",
  "bloomberg.com", "reuters.com", "ft.com", "wsj.com",
  "arstechnica.com", "theregister.com", "economist.com",
  "bbc.com", "bbc.co.uk", "cnn.com", "foxnews.com",
  "washingtonpost.com", "guardian.com", "theguardian.com",
  "apnews.com", "cnbc.com",
];

const RESEARCH_SIGNALS = [
  "arxiv.org", "nature.com", "acm.org", "ieee.org", "openreview.net",
  "sciencedirect.com", "springer.com", ".edu/",
];

export function classifyStory(title: string, url: string): StoryType {
  const t = (title || "").toLowerCase();
  const u = url || "";
  if (t.startsWith("show hn:")) return "show_hn";
  if (t.startsWith("ask hn:")) return "ask_hn";
  if (t.startsWith("launch hn:")) return "launch_hn";
  if (t.startsWith("tell hn:")) return "tell_hn";
  if (RESEARCH_SIGNALS.some(s => u.includes(s)) || u.endsWith(".pdf")) return "research";
  if (u.includes("github.com") || u.includes("gitlab.com")) return "github";
  if (NEWS_DOMAINS.some(d => u.includes(d))) return "news";
  if (u) return "blog_technical";
  return "other";
}

async function fetchWithLimits(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "accept-language": "en",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml|application\/xml/.test(type)) {
      throw new Error(`unsupported content-type: ${type}`);
    }

    // Bounded read
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no response body");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        reader.cancel().catch(() => {});
        throw new Error("response too large");
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(bytes);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return { html, finalUrl: res.url };
  } finally {
    clearTimeout(timer);
  }
}

function extract(html: string, baseUrl: string) {
  // linkedom is a lightweight, pure-JS DOM that works on Vercel's Node runtime
  // (jsdom's @exodus/bytes / html-encoding-sniffer chain breaks under CJS/ESM mix).
  const { document } = parseHTML(html);
  void baseUrl; // kept in signature for future relative-link resolution
  const doc = document;

  // Fallback metadata if Readability fails
  const og = (p: string) =>
    doc.querySelector(`meta[property="${p}"]`)?.getAttribute("content") ||
    doc.querySelector(`meta[name="${p}"]`)?.getAttribute("content") ||
    null;

  const h1Title = doc.querySelector("h1")?.textContent?.trim();
  const docTitle = doc.querySelector("title")?.textContent?.trim();
  const ogTitle = og("og:title");
  const twTitle = og("twitter:title");
  const metaTitle = ogTitle || twTitle || h1Title || docTitle || "(untitled)";

  const metaDesc =
    og("og:description") ||
    doc.querySelector('meta[name="description"]')?.getAttribute("content") ||
    "";

  const metaSite = og("og:site_name");
  const htmlLang = doc.documentElement.getAttribute("lang");

  const reader = new Readability(doc, { charThreshold: 200 });
  const article = reader.parse();

  // Prefer og:title / twitter:title / first h1 over Readability's title,
  // because many blog themes put "site - date" in <title> and the real headline
  // in an h1 or og:title.
  const readabilityTitle = article?.title?.trim();
  const title = (ogTitle || twTitle || h1Title || readabilityTitle || docTitle || "(untitled)").trim();
  const textContent = (article?.textContent || metaDesc || "").trim();
  const excerpt = (article?.excerpt || metaDesc || "").slice(0, 400).trim();

  return {
    title,
    byline: article?.byline || null,
    siteName: article?.siteName || metaSite,
    textContent,
    excerpt,
    lang: article?.lang || htmlLang,
  };
}

export async function ingest(rawUrl: string): Promise<IngestResult> {
  const safety = await checkUrl(rawUrl);
  if (!safety.ok) return { ok: false, reason: safety.reason };

  let fetched;
  try {
    fetched = await fetchWithLimits(safety.url.toString());
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  let extracted;
  try {
    extracted = extract(fetched.html, fetched.finalUrl);
  } catch (e) {
    return { ok: false, reason: `extraction failed: ${e instanceof Error ? e.message : e}` };
  }

  const finalUrl = fetched.finalUrl;
  const hostname = new URL(finalUrl).hostname.replace(/^www\./, "");
  const text = extracted.textContent.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ");
  const truncated = text.length > MAX_ARTICLE_CHARS;
  const trimmed = truncated ? text.slice(0, MAX_ARTICLE_CHARS) : text;

  // If nothing extracted, bail — generator would hallucinate.
  if (trimmed.length < 120 && extracted.excerpt.length < 80) {
    return { ok: false, reason: "could not extract article content" };
  }

  const article: Article = {
    url: rawUrl,
    finalUrl,
    hostname,
    title: extracted.title,
    byline: extracted.byline,
    siteName: extracted.siteName,
    excerpt: extracted.excerpt,
    text: trimmed,
    lang: extracted.lang,
    storyType: classifyStory(extracted.title, finalUrl),
    contentLength: text.length,
    truncated,
  };

  return { ok: true, article };
}
