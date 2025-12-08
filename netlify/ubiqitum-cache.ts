import crypto from "crypto";
import fetch from "node-fetch"; // or global fetch if Node 18+
import { Handler } from "@netlify/functions";
import { Redis } from "@upstash/redis";

// Connect to Upstash Redis
const redis = Redis.fromEnv(); // UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN

function canonicalDomain(u: string) {
  u = u.trim().toLowerCase().replace(/^https?:\/\//, '');
  const host = u.split(/[\/?#]/,1)[0];
  return host.startsWith('www.') ? host.slice(4) : host;
}

function sha256(s: string) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function buildSK(args: { brand_url: string; brand_name?: string; market?: string; sector?: string; segment?: string; timeframe?: string; industry_definition?: string; seed?: number }) {
  const canon = canonicalDomain(args.brand_url);
  const parts = [
    canon,
    (args.brand_name || "").toLowerCase(),
    (args.market || "Global").toLowerCase(),
    (args.sector || "").toLowerCase(),
    (args.segment || "B2C").toLowerCase(),
    (args.timeframe || "Current").toLowerCase(),
    (args.industry_definition || "").toLowerCase(),
    args.seed == null ? "" : String(args.seed),
    "V3.5.14"
  ];
  return sha256(parts.join('|'));
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
  const body = JSON.parse(event.body || "{}");
  const { brand_url } = body;
  if (!brand_url) return { statusCode: 400, body: "brand_url required" };

  const sk = buildSK(body);
  const windowDays = Number(body.consistency_window_days ?? 180);
  const mode = body.stability_mode || "pinned";

  const key = `ubiqitum:sk:${sk}`;
  const cached = await redis.get<{payload:any, meta:any}>(key);
  const nowIso = new Date().toISOString();

  // Serve cached if fresh
  if (cached && mode === "pinned") {
    const last = new Date(cached.meta.last_refreshed_at || nowIso);
    const fresh = (Date.now() - last.getTime()) / 86400000 <= (cached.meta.consistency_window_days ?? windowDays);
    if (fresh) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "ETag": sk, "Last-Modified": cached.meta.last_refreshed_at },
        body: JSON.stringify(cached.payload)
      };
    }
  }

  // Otherwise, recompute via main KPI endpoint
  const res = await fetch(`${process.env.SITE_URL}/.netlify/functions/ubiqitum-kpi`, { // replace SITE_URL with your Netlify URL
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await res.json();

  // Cache result
  await redis.set(key, {
    payload,
    meta: { sk, model_version:"V3.5.14", last_refreshed_at: nowIso, consistency_window_days: windowDays }
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "ETag": sk, "Last-Modified": nowIso },
    body: JSON.stringify(payload)
  };
};
