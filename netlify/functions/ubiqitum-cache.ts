// netlify/functions/ubiqitum-cache.ts
import type { Handler } from "@netlify/functions";
import crypto from "crypto";
import { Redis } from "@upstash/redis";

// --- CORS Configuration ---
// IMPORTANT: Replace this with your actual Webflow domain in production.
const ALLOWED_ORIGIN = "https://ubiqitum-freemium.webflow.io"; 
// --------------------------

const redis = Redis.fromEnv(); // UPSTASH_REDIS_REST_URL / _TOKEN

function canonicalDomain(u:string){ u=u.trim().toLowerCase().replace(/^https?:\/\//,''); const h=u.split(/[\/?#]/,1)[0]; return h.startsWith('www.')?h.slice(4):h; }
function sha256(s:string){ return crypto.createHash('sha256').update(s,'utf8').digest('hex'); }

function buildSK(args:{brand_url:string,brand_name?:string,market?:string,sector?:string,segment?:string,timeframe?:string,industry_definition?:string,seed?:number}){
  const canon = canonicalDomain(args.brand_url);
  const parts = [
    canon,
    (args.brand_name||"").toLowerCase(),
    (args.market||"Global").toLowerCase(),
    (args.sector||"").toLowerCase(),
    (args.segment||"B2C").toLowerCase(),
    (args.timeframe||"Current").toLowerCase(),
    (args.industry_definition||"").toLowerCase(),
    args.seed==null? "": String(args.seed),
    "V3.5.14"
  ];
  return sha256(parts.join('|'));
}

export const handler: Handler = async (event) => {
    // 1. Handle Preflight/Non-POST requests
    if (event.httpMethod === "OPTIONS") {
        // Handle CORS preflight request by immediately responding with allowed headers
        return {
            statusCode: 204, // No Content
            headers: {
                "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Max-Age": "86400", // Cache preflight for 24 hours
            },
        };
    }
    
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
    // Add CORS header to error responses too, just in case
    const errorHeaders = { "Access-Control-Allow-Origin": ALLOWED_ORIGIN };

    const body = JSON.parse(event.body || "{}");
    const { brand_url } = body;
    if (!brand_url) return { statusCode: 400, headers: errorHeaders, body: "brand_url required" };

    const sk = buildSK(body);
    const windowDays = Number(body.consistency_window_days ?? 180);
    const mode = body.stability_mode || "pinned";

    // Standard Success Headers
    const successHeaders = { 
        "Content-Type": "application/json", 
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN 
    };

    // try cache
    const key = `ubiqitum:sk:${sk}`;
    const cached = await redis.get<{payload:any, meta:any}>(key);

    const nowIso = new Date().toISOString();
    if (cached && mode === "pinned") {
      const last = new Date(cached.meta.last_refreshed_at || nowIso);
      const fresh = (Date.now() - last.getTime()) / 86400000 <= (cached.meta.consistency_window_days ?? windowDays);
      if (fresh) {
        return {
            statusCode: 200,
            headers: { ...successHeaders, "ETag": sk, "Last-Modified": cached.meta.last_refreshed_at }, // ADDED CORS HERE
            body: JSON.stringify(cached.payload)
        };
      }
    }

    // recompute via main endpoint
    const res = await fetch('/.netlify/functions/ubiqitum-kpi', { // same site call
      method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify(body)
    });
    const payload = await res.json();

    // set cache
    await redis.set(key, {
      payload,
      meta: { sk, model_version:"V3.5.14", last_refreshed_at: nowIso, consistency_window_days: windowDays }
    });

    return {
      statusCode: 200,
      headers: { ...successHeaders, "ETag": sk, "Last-Modified": nowIso }, // ADDED CORS HERE
      body: JSON.stringify(payload)
    };
};
