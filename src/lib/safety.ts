/**
 * SSRF protection — block requests to private networks, loopback, and
 * link-local addresses. Used before any outbound fetch to a user-supplied URL.
 */

import { promises as dns } from "node:dns";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// IPv4 CIDRs we refuse to fetch from.
const BLOCKED_V4: Array<[number, number]> = [
  [ipToInt("0.0.0.0"),         8],   // "this" network
  [ipToInt("10.0.0.0"),        8],   // private
  [ipToInt("100.64.0.0"),      10],  // CGNAT
  [ipToInt("127.0.0.0"),       8],   // loopback
  [ipToInt("169.254.0.0"),     16],  // link-local
  [ipToInt("172.16.0.0"),      12],  // private
  [ipToInt("192.0.0.0"),       24],  // IETF protocol assignments
  [ipToInt("192.0.2.0"),       24],  // TEST-NET-1
  [ipToInt("192.168.0.0"),     16],  // private
  [ipToInt("198.18.0.0"),      15],  // benchmark
  [ipToInt("198.51.100.0"),    24],  // TEST-NET-2
  [ipToInt("203.0.113.0"),     24],  // TEST-NET-3
  [ipToInt("224.0.0.0"),       4],   // multicast
  [ipToInt("240.0.0.0"),       4],   // reserved
  [ipToInt("255.255.255.255"), 32],  // broadcast
];

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

function inCidr(ip: number, [net, bits]: [number, number]): boolean {
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (net & mask);
}

function isBlockedV4(ip: string): boolean {
  const n = ipToInt(ip);
  return BLOCKED_V4.some(cidr => inCidr(n, cidr));
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === "::1" ||                 // loopback
    lower === "::" ||                  // unspecified
    lower.startsWith("fc") ||          // ULA (fc00::/7)
    lower.startsWith("fd") ||          // ULA
    lower.startsWith("fe80:") ||       // link-local
    lower.startsWith("ff")             // multicast
  );
}

export type SafetyResult = { ok: true; url: URL } | { ok: false; reason: string };

export async function checkUrl(raw: string): Promise<SafetyResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: `blocked protocol: ${url.protocol}` };
  }

  const host = url.hostname.toLowerCase();

  // Explicit hostname blocks before DNS
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, reason: "blocked host" };
  }
  if (host === "metadata.google.internal") {
    return { ok: false, reason: "blocked cloud metadata" };
  }

  // Resolve and check every returned address
  let records;
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    return { ok: false, reason: "DNS lookup failed" };
  }

  for (const r of records) {
    if (r.family === 4 && isBlockedV4(r.address)) {
      return { ok: false, reason: `resolves to private IPv4 ${r.address}` };
    }
    if (r.family === 6 && isBlockedV6(r.address)) {
      return { ok: false, reason: `resolves to private IPv6 ${r.address}` };
    }
  }

  return { ok: true, url };
}
