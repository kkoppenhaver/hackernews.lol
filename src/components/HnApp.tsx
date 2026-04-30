"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Comment, Thread } from "@/types";

export default function HnApp({ basePath }: { basePath: "/" | "/item" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  const [url, setUrl] = useState("");
  const [thread, setThread] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the thread when ?id changes (initial mount with id in URL, or
  // back/forward navigation between /item?id=X and /item?id=Y).
  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setThread(null);
      setError(null);
      return;
    }
    if (thread?.id === id) return; // already loaded
    setLoading(true);
    setError(null);
    fetch(`/api/item?id=${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error || `HTTP ${r.status}`);
        }
        const data = (await r.json()) as Thread;
        if (!cancelled) setThread(data);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // intentionally only watch id — thread mutation is internal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url) return;
    await runSimulate(url, false);
  }

  async function regenerate() {
    if (!thread?.url) return;
    if (!confirm("Regenerate this thread? It will overwrite the saved version.")) return;
    await runSimulate(thread.url, true);
  }

  async function runSimulate(submitUrl: string, force: boolean) {
    setLoading(true);
    setError(null);
    setThread(null);
    try {
      const r = await fetch("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: submitUrl, force }),
      });
      if (!r.ok) {
        let msg: string;
        try {
          const j = await r.clone().json();
          msg = typeof j?.error === "string" ? j.error : `HTTP ${r.status}`;
        } catch {
          msg = r.status === 504
            ? "timed out — the generator took too long"
            : `HTTP ${r.status} (upstream error)`;
        }
        throw new Error(msg);
      }
      const data = (await r.json()) as Thread;
      setThread(data);
      if (data.id) {
        const target = `/item?id=${encodeURIComponent(data.id)}`;
        if (force) router.replace(target); // regenerate keeps you on the same id
        else router.push(target);            // new submit pushes onto history
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <center>
      <table
        id="hnmain"
        border={0}
        cellPadding={0}
        cellSpacing={0}
        width="85%"
        style={{ backgroundColor: "#f6f6ef" }}
      >
        <tbody>
          <tr>
            <td style={{ backgroundColor: "#ff6600" }}>
              <Header />
            </td>
          </tr>
          <tr style={{ height: 10 }} />
          <tr id="bigbox">
            <td>
              <SubmitForm url={url} setUrl={setUrl} onSubmit={submit} loading={loading} />
              {error && <div className="hnl-error">error: {error}</div>}
              {loading && <div className="hnl-status">ingesting article and simulating thread…</div>}
              {thread && (
                <ThreadView
                  thread={thread}
                  onRegenerate={loading ? undefined : regenerate}
                />
              )}
              {!thread && !loading && !error && basePath === "/" && (
                <div className="hnl-status">
                  paste a URL above to generate an HN-style comment thread for that article
                </div>
              )}
            </td>
          </tr>
          <tr style={{ height: 10 }} />
          <tr><td><Footer /></td></tr>
        </tbody>
      </table>
    </center>
  );
}

function Header() {
  return (
    <table border={0} cellPadding={0} cellSpacing={0} width="100%" style={{ padding: 2 }}>
      <tbody>
        <tr>
          <td style={{ width: 18, paddingRight: 4 }}>
            <a href="/">
              <img src="/y18.svg" width={18} height={18} alt=""
                   style={{ border: "1px white solid", display: "block" }} />
            </a>
          </td>
          <td style={{ lineHeight: "12pt", height: 10 }}>
            <span className="pagetop">
              <b className="hnname"><a href="/">hackernews.lol</a></b>
              <a href="/">new</a> | <a href="/">past</a> |{" "}
              <a href="/">comments</a> | <a href="/">ask</a> |{" "}
              <a href="/">show</a> | <a href="/">jobs</a> |{" "}
              <a href="/">submit</a>
            </span>
          </td>
          <td style={{ textAlign: "right", paddingRight: 4 }}>
            <span className="pagetop"><a href="/">login</a></span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function SubmitForm({ url, setUrl, onSubmit, loading }: {
  url: string;
  setUrl: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  loading: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="hnl-form">
      <input
        type="url"
        placeholder="https://example.com/article"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        required
      />{" "}
      <input type="submit" value={loading ? "simulating…" : "simulate"} disabled={loading} />
    </form>
  );
}

function Footer() {
  return (
    <>
      <img src="/s.gif" height={10} width={0} alt="" />
      <table width="100%" cellSpacing={0} cellPadding={1}>
        <tbody><tr><td style={{ backgroundColor: "#ff6600" }}></td></tr></tbody>
      </table>
      <br />
      <span className="yclinks">
        <a href="/">hackernews.lol</a> · comments simulated by an LLM · no real
        people were consulted
      </span>
    </>
  );
}

function ThreadView({ thread, onRegenerate }: { thread: Thread; onRegenerate?: () => void }) {
  const flat: Array<{ c: Comment; depth: number }> = [];
  const walk = (cs: Comment[] | undefined, depth: number) => {
    for (const c of cs || []) {
      flat.push({ c, depth });
      walk(c.children, depth + 1);
    }
  };
  walk(thread.comments, 0);

  return (
    <>
      <StoryRow thread={thread} onRegenerate={onRegenerate} />
      <br />
      <br />
      <table border={0} className="comment-tree">
        <tbody>
          {flat.map(({ c, depth }) => (
            <CommentRow key={c.id} c={c} depth={depth} />
          ))}
        </tbody>
      </table>
    </>
  );
}

function StoryRow({ thread, onRegenerate }: { thread: Thread; onRegenerate?: () => void }) {
  return (
    <table border={0} cellPadding={0} cellSpacing={0}>
      <tbody>
        <tr className="athing submission">
          <td className="title" style={{ textAlign: "right", verticalAlign: "top" }}>
            <span className="rank">1.</span>
          </td>
          <td className="votelinks" style={{ verticalAlign: "top" }}>
            <center>
              <a href="#" aria-label="upvote" onClick={(e) => e.preventDefault()}>
                <div className="votearrow" title="upvote" />
              </a>
            </center>
          </td>
          <td className="title">
            <span className="titleline">
              <a href={thread.url} target="_blank" rel="noreferrer">{thread.title}</a>
              {thread.hostname && (
                <span className="sitebit comhead">
                  {" "}(<a href="#" onClick={(e) => e.preventDefault()}>
                    <span className="sitestr">{thread.hostname}</span>
                  </a>)
                </span>
              )}
            </span>
          </td>
        </tr>
        <tr>
          <td colSpan={2}></td>
          <td className="subtext">
            <span className="subline">
              <span className="score">{thread.points} points</span> by{" "}
              <a href="#" className="hnuser" onClick={(e) => e.preventDefault()}>{thread.by}</a>{" "}
              <span className="age">
                {thread.id ? (
                  <a href={`/item?id=${thread.id}`}>{thread.age}</a>
                ) : (
                  <a href="#" onClick={(e) => e.preventDefault()}>{thread.age}</a>
                )}
              </span>
              {onRegenerate && (
                <>
                  {" | "}
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); onRegenerate(); }}
                    title="Generate a fresh thread from the same article"
                  >
                    regenerate
                  </a>
                </>
              )}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function CommText({ text }: { text: string }) {
  const parts = text.split(/\n{2,}/);
  return (
    <div className="commtext c00">
      {parts[0]}
      {parts.slice(1).map((p, i) => <p key={i}>{p}</p>)}
    </div>
  );
}

function CommentRow({ c, depth }: { c: Comment; depth: number }) {
  return (
    <tr className="athing comtr">
      <td>
        <table border={0}>
          <tbody>
            <tr>
              <td className="ind" {...({ indent: String(depth) } as Record<string, string>)}>
                <img src="/s.gif" height={1} width={depth * 40} alt="" />
              </td>
              <td className="votelinks" style={{ verticalAlign: "top" }}>
                <center>
                  <a href="#" aria-label="upvote" onClick={(e) => e.preventDefault()}>
                    <div className="votearrow" title="upvote" />
                  </a>
                </center>
              </td>
              <td className="default">
                <div style={{ marginTop: 2, marginBottom: -10 }}>
                  <span className="comhead">
                    <a href="#" className="hnuser" onClick={(e) => e.preventDefault()}>{c.by}</a>{" "}
                    <span className="age">
                      <a href="#" onClick={(e) => e.preventDefault()}>{c.age}</a>
                    </span>{" "}
                    <span id={`unv_${c.id}`}></span>
                    <span className="navs">
                      {" | "}
                      <a className="togg clicky" href="#" onClick={(e) => e.preventDefault()}>[–]</a>
                    </span>
                  </span>
                </div>
                <br />
                <div className="comment">
                  <CommText text={c.text} />
                  <div className="reply">
                    <p>
                      <span style={{ fontSize: "7pt" }}>
                        <u>
                          <a href="#" rel="nofollow" onClick={(e) => e.preventDefault()}>reply</a>
                        </u>
                      </span>
                    </p>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  );
}
