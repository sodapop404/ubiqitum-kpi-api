import { Handler } from "@netlify/functions";
import { Redis } from "@upstash/redis";
import { buildSK, computeKpi } from "./ubiqitum-kpi-core";

// Initialize Upstash Redis
const redis = Redis.fromEnv(); // requires UPSTASH_REDIS_REST_URL + _TOKEN env vars

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
        body: JSON.stringify(cached.payload),
      };
    }
  }

  // Recompute via KPI core directly
  const payload = await computeKpi(body);

  // Set cache
  await redis.set(key, {
    payload,
    meta: { sk, model_version: "V3.5.14", last_refreshed_at: nowIso, consistency_window_days: windowDays },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "ETag": sk, "Last-Modified": nowIso },
    body: JSON.stringify(payload),
  };
};
