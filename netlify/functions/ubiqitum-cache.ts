import { Handler } from "@netlify/functions";
const { Redis } = require("@upstash/redis");
import crypto from "crypto";

// Initialize Upstash Redis
const redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL + _TOKEN automatically

// Helper functions
function canonicalDomain(u: string) {
  u = u.trim().toLowerCase().replace(/^https?:\/\//, "");
  const h = u.split(/[\/?#]/, 1)[0];
  return h.startsWith("www.") ? h.slice(4) : h;
}

function sha256(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

// Build Stability Key
function buildSK(args: { brand_url: string; brand_name?: string; market?: string; sector?: string; segment?: string; timeframe?: string; industry_definition?: string; seed?: number; }) {
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
  return sha256(parts.join("|"));
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
  const body = JSON.parse(event.body || "{}");
  const { brand_url } = body;
  if (!brand_url) return { statusCode: 400, body: "brand_url required" };

  const sk = buildSK(body);
  const windowDays = Number(body.consistency_window_days ?? 180);
  const mode = body.stability_mode || "pinned";

  // Try cache
  const key = `ubiqitum:sk:${sk}`;
  const cached = await redis.get<{ payload: any; meta: any }>(key);

  const nowIso = new Date().toISOString();
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

  // Recompute via main KPI function
  const res = await fetch('/.netlify/functions/ubiqitum-kpi', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await res.json();

  // Set cache
  await redis.set(key, {
    payload,
    meta: { sk, model_version: "V3.5.14", last_refreshed_at: nowIso, consistency_window_days: windowDays }
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "ETag": sk, "Last-Modified": nowIso },
    body: JSON.stringify(payload)
  };
};
