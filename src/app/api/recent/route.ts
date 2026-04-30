import { NextRequest, NextResponse } from "next/server";
import { getRecentThreads } from "@/lib/feed";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : 30;

  const items = await getRecentThreads(Number.isFinite(limit) ? limit : 30);

  return NextResponse.json(
    { items },
    {
      headers: {
        // Vercel edge cache: serve from cache for 30s, revalidate in background
        // for 5 min after that. Keeps Supabase load low under traffic.
        "cache-control": "public, s-maxage=30, stale-while-revalidate=300",
      },
    },
  );
}
