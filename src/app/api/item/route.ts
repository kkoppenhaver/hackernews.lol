import { NextRequest, NextResponse } from "next/server";
import type { Thread } from "@/types";
import { getCache } from "@/lib/cache";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const cache = await getCache();
  const thread = await cache.get<Thread>(id);
  if (!thread) {
    return NextResponse.json({ error: "thread not found" }, { status: 404 });
  }
  return NextResponse.json({ ...thread, id });
}
