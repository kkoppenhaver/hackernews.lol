import { NextRequest, NextResponse } from "next/server";
import type { Thread } from "@/types";
import { getCache, urlKey, shortId } from "@/lib/cache";
import { ingest } from "@/lib/ingest";
import { planThread } from "@/lib/planner";
import { generateThread } from "@/lib/generator";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : null;
  if (!rawUrl) {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }

  const cache = await getCache();
  const id = shortId(urlKey(rawUrl));

  const cached = await cache.get<Thread>(id);
  if (cached) return NextResponse.json({ ...cached, id, _cached: true });

  const ingested = await ingest(rawUrl);
  if (!ingested.ok) {
    return NextResponse.json({ error: ingested.reason }, { status: 400 });
  }

  const plan = planThread({ storyType: ingested.article.storyType });

  let thread: Thread;
  try {
    thread = await generateThread(ingested.article, plan);
  } catch (e) {
    console.error("[simulate] generator failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "generation failed" },
      { status: 500 },
    );
  }

  if (thread.comments.length === 0) {
    return NextResponse.json(
      { error: "no comments generated" },
      { status: 500 },
    );
  }

  thread.id = id;
  await cache.set(id, thread);
  return NextResponse.json(thread);
}
