// netlify/functions/ubiqitum-cache.ts
import type { Handler } from "@netlify/functions";
import crypto from "crypto";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// --------------------------------------------------
// Logging (Netlify-safe flush)
// --------------------------------------------------
function log(...args: any[]) {
  console.log(...args);
  process.stdout.write("");
}

// --------------------------------------------------
// Helpers
// --------------------------------------------------
function canonicalDomain(u: string) {
  u = u.trim().toLowerCase().replace(/^https?:\/\//, "");
  const h = u.split(/[\/?#]/, 1)[0];
  return h.startsWith("www.") ? h.slice(4) : h;
}

function sha256(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function buildSK(args: any) {
  const parts = [
    canonicalDomain(args.brand_url),
    (args.brand_name || "").toLowerCase(),
    (args.market || "global").toLowerCase(),
    (args.sector || "").toLowerCase(),
    (args.segment || "b2c").toLowerCase(),
    (args.timeframe || "current").toLowerCase(),
    (args.industry_definition || "").toLowerCase(),
    args.seed ?? "",
    "V3.5.14"
  ];
  return sha256(parts.join("|"));
}

// --------------------------------------------------
// KPI validation (ONLY normalized KPI fields)
// --------------------------------------------------
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
    return Number.isFinite(typeof v === "number" ? v : Number(v));
  }).length;

  return validCount >= 3;
}

function normaliseKpiPayload(payload: any) {
  const out = { ...payload };
  Object.keys(out).forEach((k) => {
    if (typeof out[k] === "string" && !isNaN(Number(out[k]))) {
      out[k] = Number(out[k]);
    }
  });
  return out;
}

// --------------------------------------------------
// Handler
// --------------------------------------------------
export const handler: Handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "https://ubiqitum-freemium.webflow.io",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  log("🔥 ubiqitum-cache invoked", event.httpMethod, event.body);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: "POST only" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    if (!body.brand_url) {
      return { statusCode: 400, headers: CORS, body: "brand_url required" };
    }

    const sk = buildSK(body);
    const redisKey = `ubiqitum:sk:${sk}`;
    const windowDays = 1; // 24 hours cache
    const nowIso = new Date().toISOString();

    const cached = await redis.get<any>(redisKey);

    let cache_status: "hit" | "stale" | "invalid" | "degraded" | "miss" = "miss";

    // --------------------------------------------------
    // Cache evaluation (NORMALIZED OUTPUT ONLY)
    // --------------------------------------------------
    if (cached?.normalized_output && cached?.meta) {
      const ageDays =
        (Date.now() - new Date(cached.meta.last_refreshed_at).getTime()) / 86400000;

      const maxAge = Number(cached.meta.consistency_window_days ?? windowDays);
      const withinWindow = ageDays <= maxAge;

      const payloadValid =
        isValidKpiPayload(cached.normalized_output);

      log("📦 Cache found", {
        sk,
        withinWindow,
        payloadValid,
        keys: Object.keys(cached.normalized_output || {})
      });

      if (withinWindow && payloadValid) {
        cache_status = "hit";
        log("🟢 Cache HIT (normalized_output)", sk);

        return {
          statusCode: 200,
          headers: { ...CORS, "X-Cache-Status": cache_status },
          body: JSON.stringify({
            ...cached.normalized_output,
            cache_status
          })
        };
      }

      cache_status = withinWindow ? "invalid" : "stale";
    }

    // --------------------------------------------------
    // KPI invocation
    // --------------------------------------------------
    log("➡️ Calling KPI", { sk, cache_status });

    try {
      const kpiRes = await fetch(
        `${process.env.URL}/.netlify/functions/ubiqitum-kpi`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );

      const text = await kpiRes.text();
      const raw = JSON.parse(text);

      const normalized =
        normaliseKpiPayload(raw.normalized_output ?? raw);

      if (!isValidKpiPayload(normalized)) {
        throw new Error("KPI returned invalid payload");
      }

      await redis.set(
        redisKey,
        {
          input_payload: body,
          ai_raw_response: raw,
          normalized_output: normalized,
          meta: {
            sk,
            last_refreshed_at: nowIso,
            consistency_window_days: windowDays
          }
        },
        { ex: windowDays * 86400 }
      );

      log("🟢 KPI success & cached", sk);

      return {
        statusCode: 200,
        headers: { ...CORS, "X-Cache-Status": cache_status },
        body: JSON.stringify({
          ...normalized,
          cache_status
        })
      };

    } catch (kpiErr) {
      log("❌ KPI failed", kpiErr);

      // --------------------------------------------------
      // Degraded fallback (normalized_output only)
      // --------------------------------------------------
      if (cached?.normalized_output) {
        cache_status = "degraded";
        log("🟠 Returning degraded cache (normalized_output)", sk);

        return {
          statusCode: 200,
          headers: { ...CORS, "X-Cache-Status": cache_status },
          body: JSON.stringify({
            ...cached.normalized_output,
            cache_status
          })
        };
      }

      throw kpiErr;
    }

  } catch (err) {
    log("🔥 Fatal cache error", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: "Cache error"
    };
  }
};
