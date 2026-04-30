import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
}

export function urlKey(raw: string): string {
  return createHash("sha256").update(normalizeUrl(raw)).digest("hex");
}

/**
 * Numeric short ID derived from a urlKey, matching HN's 8–10 digit /item?id=N format.
 * First 8 hex chars → 32-bit unsigned integer in base 10. Stable per URL,
 * collision space ~4B (sufficient for our scale).
 */
export function shortId(key: string): string {
  return parseInt(key.slice(0, 8), 16).toString(10);
}

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    const tracking = /^(utm_|fbclid$|gclid$|mc_(eid|cid)$|ref$|ref_src$|trk$|igshid$|yclid$|_hsenc$|_hsmi$)/i;
    for (const k of [...url.searchParams.keys()]) {
      if (tracking.test(k)) url.searchParams.delete(k);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.protocol = url.protocol.toLowerCase();
    return url.toString();
  } catch {
    return u.trim();
  }
}

class FsCache implements Cache {
  constructor(private dir: string) {}
  private path(key: string) { return join(this.dir, `${key}.json`); }
  async get<T>(key: string): Promise<T | null> {
    const p = this.path(key);
    if (!existsSync(p)) return null;
    try {
      const raw = JSON.parse(await readFile(p, "utf8"));
      if (typeof raw?.expires === "number" && raw.expires < Date.now()) return null;
      return raw.value as T;
    } catch {
      return null;
    }
  }
  async set<T>(key: string, value: T, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const expires = Date.now() + ttlSeconds * 1000;
    await writeFile(this.path(key), JSON.stringify({ value, expires }), "utf8");
  }
}

class KvCache implements Cache {
  constructor(private kv: { get: (k: string) => Promise<unknown>; set: (k: string, v: unknown, o?: { ex?: number }) => Promise<unknown> }) {}
  async get<T>(key: string): Promise<T | null> {
    const v = await this.kv.get(key);
    return (v as T) ?? null;
  }
  async set<T>(key: string, value: T, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
    await this.kv.set(key, value, { ex: ttlSeconds });
  }
}

interface SupabaseLike {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: { data: unknown } | null; error: { message: string } | null }>;
      };
    };
    upsert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
}

class SupabaseCache implements Cache {
  constructor(private client: SupabaseLike, private table = "threads") {}
  async get<T>(key: string): Promise<T | null> {
    const { data, error } = await this.client
      .from(this.table)
      .select("data")
      .eq("id", key)
      .maybeSingle();
    if (error) {
      console.warn("[cache] supabase get error:", error.message);
      return null;
    }
    return (data?.data as T) ?? null;
  }
  /** TTL is intentionally ignored — Supabase rows persist forever unless explicitly deleted. */
  async set<T>(key: string, value: T): Promise<void> {
    const { error } = await this.client.from(this.table).upsert({
      id: key,
      data: value,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`supabase upsert failed: ${error.message}`);
  }
}

class MemoryCache implements Cache {
  private store = new Map<string, { value: unknown; expires: number }>();
  async get<T>(key: string): Promise<T | null> {
    const r = this.store.get(key);
    if (!r) return null;
    if (r.expires < Date.now()) { this.store.delete(key); return null; }
    return r.value as T;
  }
  async set<T>(key: string, value: T, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }
}

let cachePromise: Promise<Cache> | null = null;

export function getCache(): Promise<Cache> {
  if (!cachePromise) cachePromise = resolveCache();
  return cachePromise;
}

async function resolveCache(): Promise<Cache> {
  // Preferred: Supabase (permanent, queryable for analytics).
  const supaUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supaUrl && supaKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(supaUrl, supaKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      console.log("[cache] using Supabase");
      return new SupabaseCache(client as unknown as SupabaseLike);
    } catch (e) {
      console.warn("[cache] Supabase import failed, falling back:", e);
    }
  }

  // Fallback: Vercel KV (30-day TTL, distributed).
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import("@vercel/kv");
      console.log("[cache] using Vercel KV");
      return new KvCache(kv as unknown as { get: (k: string) => Promise<unknown>; set: (k: string, v: unknown, o?: { ex?: number }) => Promise<unknown> });
    } catch (e) {
      console.warn("[cache] Vercel KV import failed, falling back:", e);
    }
  }

  // Last resort: filesystem in dev, memory in prod.
  if (process.env.NODE_ENV === "production") {
    console.warn("[cache] no Supabase or KV configured — using in-memory cache (NOT PERSISTENT)");
    return new MemoryCache();
  }
  return new FsCache(".cache");
}

export const CACHE_TTL_SECONDS = DEFAULT_TTL_SECONDS;
