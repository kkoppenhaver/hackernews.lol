/**
 * Front-page feed — list of recently-submitted threads from Supabase.
 *
 * Returns lightweight projections (no full comment trees) so /api/recent
 * can be cheaply edge-cached.
 */

import type { Thread, Comment } from "@/types";

export interface RecentRow {
  id: string;
  title: string;
  url: string;
  hostname?: string;
  by: string;
  age: string;
  points: number;
  comment_count: number;
  submitted_at: string;
}

let clientPromise: Promise<unknown> | null = null;

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    );
  }
  return clientPromise;
}

function countComments(nodes: Comment[] | undefined): number {
  let n = 0;
  const walk = (arr: Comment[] | undefined) => {
    for (const c of arr || []) { n++; walk(c.children); }
  };
  walk(nodes);
  return n;
}

interface RawRow { id: string; data: Thread; created_at: string }
interface SupabaseQueryResult { data: RawRow[] | null; error: { message: string } | null }
interface SupabaseFeedClient {
  from(table: string): {
    select(cols: string): {
      order(col: string, opts: { ascending: boolean }): {
        limit(n: number): Promise<SupabaseQueryResult>;
      };
    };
  };
}

export async function getRecentThreads(limit = 30): Promise<RecentRow[]> {
  const sbPromise = getSupabase();
  if (!sbPromise) return [];
  const sb = (await sbPromise) as SupabaseFeedClient;

  const { data, error } = await sb
    .from("threads")
    .select("id, data, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));

  if (error) {
    console.warn("[feed] supabase query error:", error.message);
    return [];
  }
  if (!data) return [];

  return data.map((row) => {
    const d = row.data;
    return {
      id: row.id,
      title: d.title,
      url: d.url,
      hostname: d.hostname,
      by: d.by,
      age: d.age,
      points: d.points,
      comment_count: countComments(d.comments),
      submitted_at: row.created_at,
    };
  });
}
