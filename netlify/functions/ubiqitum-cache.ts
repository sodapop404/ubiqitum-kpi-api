// netlify/functions/ubiqitum-cache.ts
import type { Handler } from "@netlify/functions";
import crypto from "crypto";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function canonicalDomain(u: string) {
  u = u.trim().toLowerCase().replace(/^https?:\/\//, "");
  const h = u.split(/[\/?#]/, 1)[0];
  return h.startsWith("www.") ? h.slice(4) : h;
}

function sha256(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function buildSK(args: {
  brand_url: string;
  brand_name?: string;
  market?: string;
  sector?: string;
  segment?: string;
  timeframe?: string;
  industry_definition?: string;
  seed?: number;
}) {
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

function isValidKpiPayload(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;

  const fields = [
    "brand_relevance_percent",
    "brand_awareness_percent",
    "sector_relevance_avg_percent",
    "sector_awareness_avg_percent"
  ];

  const validCount = fields.filter((key) => {
    const v = payload[key];
    if (v === null || v === undefined || v === "") return false;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n);
  }).length;

  // Allow partial validity (3/4)
  return validCount >= 3;
}

function normaliseKpiPayload(payload: any) {
  const fields = [
    "brand_relevance_percent",
    "brand_awareness_percent",
    "sector_relevance_avg_percent",
    "sector_awareness_avg_percent"
  ];

  for (const f of fields) {
    if (payload[f] !== undefined && payload[f] !== null) {
      payload[f] = Number(payload[f]);
    }
  }

  return payload;
}

// ------------------------------------------------------------------
// Handler
// ------------------------------------------------------------------
export const handler: Handler = async (event) => {
  const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "https://ubiqitum-freemium.webflow.io",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "POST only" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    if (!body.brand_url) {
      return { statusCode: 400, headers: CORS_HEADERS, body: "brand_url required" };
    }

    const sk = buildSK(body);
    const windowDays = Number(body.consistency_window_days ?? 180);
    const mode = body.stability_mode || "pinned";
    const nowIso = new Date().toISOString();

    const redisKey = `ubiqitum:sk:${sk}`;
    const cached = await redis.get<any>(redisKey);

    let cacheStatus: "hit" | "stale" | "invalid" | "degraded" | "miss" = "miss";

    // --------------------------------------------------------------
    // Cache evaluation
    // --------------------------------------------------------------
    if (cached && mode === "pinned") {
      const last = new Date(cached.meta?.last_refreshed_at || nowIso);
      const ageDays = (Date.now() - last.getTime()) / 86400000;

      const withinWindow =
        ageDays <= (cached.meta?.consistency_window_days ?? windowDays);

      const payloadValid = isValidKpiPayload(cached.payload);

      if (withinWindow && payloadValid) {
        cacheStatus = "hit";
      } else if (!withinWindow) {
        cacheStatus = "stale";
      } else if (!payloadValid) {
        cacheStatus = "invalid";
      }

      // Serve degraded cache without recompute
      if (withinWindow && !payloadValid) {
        cacheStatus = "degraded";
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Cache-Status": cacheStatus,
            ...CORS_HEADERS
          },
          body: JSON.stringify({
            ...cached.payload,
            cache_status: cacheStatus
          })
        };
      }

      if (cacheStatus === "hit") {
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Cache-Status": cacheStatus,
            ...CORS_HEADERS
          },
          body: JSON.stringify({
            ...cached.payload,
            cache_status: cacheStatus
          })
        };
      }
    }

    // --------------------------------------------------------------
    // KPI invocation
    // --------------------------------------------------------------
    const kpiUrl = `${process.env.URL}/.netlify/functions/ubiqitum-kpi`;
    const kpiRes = await fetch(kpiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const payload = JSON.parse(await kpiRes.text());
    const valid = isValidKpiPayload(payload);

    if (!valid) {
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: "KPI returned invalid payload"
      };
    }

    normaliseKpiPayload(payload);

    await redis.set(
      redisKey,
      {
        payload,
        meta: {
          sk,
          last_refreshed_at: nowIso,
          consistency_window_days: windowDays
        }
      },
      { ex: windowDays * 86400 }
    );

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Cache-Status": cacheStatus === "miss" ? "miss" : cacheStatus,
        ...CORS_HEADERS
      },
      body: JSON.stringify({
        ...payload,
        cache_status: cacheStatus === "miss" ? "miss" : cacheStatus
      })
    };

  } catch (err) {
    console.error("🔥 cache fatal error", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: "Internal cache error"
    };
  }
};
