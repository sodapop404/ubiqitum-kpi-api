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

/**
 * Determines whether the KPI payload is usable.
 * Any null / undefined / NaN values force a refresh.
 */
function isValidKpiPayload(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;

  const requiredFields = [
    "brand_relevance_percent",
    "brand_awareness_percent",
    "sector_relevance_avg_percent",
    "sector_awareness_avg_percent"
  ];

  return requiredFields.every(
    (key) =>
      payload[key] !== null &&
      payload[key] !== undefined &&
      Number.isFinite(payload[key])
  );
}

// ------------------------------------------------------------------
// Handler
// ------------------------------------------------------------------
export const handler: Handler = async (event) => {
  console.log("🔥 ubiqitum-cache invoked");
  console.log("Method:", event.httpMethod);
  console.log("Raw body:", event.body);

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
    const { brand_url } = body;

    if (!brand_url) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: "brand_url required"
      };
    }

    // --------------------------------------------------------------
    // Cache key + options
    // --------------------------------------------------------------
    const sk = buildSK(body);
    const windowDays = Number(body.consistency_window_days ?? 180);
    const mode = body.stability_mode || "pinned";
    const nowIso = new Date().toISOString();

    const redisKey = `ubiqitum:sk:${sk}`;
    const cached = await redis.get<{
      payload: any;
      meta: any;
    }>(redisKey);

    // --------------------------------------------------------------
    // Cache HIT evaluation
    // --------------------------------------------------------------
    if (cached && mode === "pinned") {
      const last = new Date(cached.meta.last_refreshed_at || nowIso);
      const ageDays =
        (Date.now() - last.getTime()) / 86400000;

      const withinWindow =
        ageDays <= (cached.meta.consistency_window_days ?? windowDays);

      const payloadValid = isValidKpiPayload(cached.payload);

      if (withinWindow && payloadValid) {
        console.log("🟢 Cache HIT (valid):", sk);
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            "ETag": sk,
            "Last-Modified": cached.meta.last_refreshed_at,
            ...CORS_HEADERS
          },
          body: JSON.stringify(cached.payload)
        };
      }

      if (!payloadValid) {
        console.warn("🟠 Cache INVALID (null KPI values) — refreshing:", sk);
      } else {
        console.warn("🟠 Cache STALE — refreshing:", sk);
      }
    }

    console.log("🟡 Cache MISS — invoking KPI function");

    // --------------------------------------------------------------
    // Call KPI function
    // --------------------------------------------------------------
    const kpiUrl = `${process.env.URL}/.netlify/functions/ubiqitum-kpi`;

    const kpiRes = await fetch(kpiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const rawText = await kpiRes.text();

    console.log("🟦 KPI status:", kpiRes.status);
    console.log("🟦 KPI raw response:", rawText);

    if (!kpiRes.ok) {
      return {
        statusCode: kpiRes.status,
        headers: CORS_HEADERS,
        body: rawText
      };
    }

    let payload: any;
    try {
      payload = JSON.parse(rawText);
    } catch (err) {
      console.error("❌ KPI response not valid JSON");
      throw err;
    }

    // --------------------------------------------------------------
    // Validate KPI response BEFORE caching
    // --------------------------------------------------------------
    if (!isValidKpiPayload(payload)) {
      console.error("❌ KPI returned invalid / incomplete payload — not caching");
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: "KPI returned incomplete data"
      };
    }

    // --------------------------------------------------------------
    // Cache store
    // --------------------------------------------------------------
    await redis.set(
      redisKey,
      {
        payload,
        meta: {
          sk,
          model_version: "V3.5.14",
          last_refreshed_at: nowIso,
          consistency_window_days: windowDays
        }
      },
      { ex: windowDays * 86400 }
    );

    console.log("🟢 Cached SK:", sk);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "ETag": sk,
        "Last-Modified": nowIso,
        ...CORS_HEADERS
      },
      body: JSON.stringify(payload)
    };

  } catch (err) {
    console.error("🔥 ubiqitum-cache fatal error:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: "Internal cache/orchestration error"
    };
  }
};
