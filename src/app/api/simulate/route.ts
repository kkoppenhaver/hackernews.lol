import { NextRequest, NextResponse } from "next/server";
import type { Thread } from "@/types";
import { getCache, urlKey } from "@/lib/cache";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : null;
  if (!rawUrl) return NextResponse.json({ error: "missing url" }, { status: 400 });

  let hostname: string | undefined;
  try {
    hostname = new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  const cache = await getCache();
  const key = urlKey(rawUrl);
  const cached = await cache.get<Thread>(key);
  if (cached) return NextResponse.json(cached);

  const thread: Thread = {
    url: rawUrl,
    title: "[stub] ingestion and generation land in Phase 2–5",
    hostname,
    by: "dang",
    age: "3 hours ago",
    points: 142,
    comments: [
      {
        id: "c1",
        by: "jacquesm",
        age: "2 hours ago",
        points: 84,
        text:
          "Hey, hackernews.lol dev here — this is the Phase 1 stub. The form, route, and 30-day cache are wired; ingestion and the LLM-driven generator come next.\n\nOnce someone hits this URL the response gets cached, so reloading the same URL is free.",
        children: [
          {
            id: "c2",
            by: "tptacek",
            age: "2 hours ago",
            points: 31,
            text:
              "The real test is whether a generated comment parses as HN when read out of context. Template theatre and a convincing CSS skin won't get you there — the voice model has to hold up at the level of the individual reply.",
          },
        ],
      },
      {
        id: "c3",
        by: "patio11",
        age: "1 hour ago",
        points: 22,
        text: "Curious how the archetype mix is derived. Static distribution per story type, or conditioned on something from the article itself?",
      },
    ],
  };

  await cache.set(key, thread);
  return NextResponse.json(thread);
}
