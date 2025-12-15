// netlify/functions/ubiqitum-cache.ts
import type { Handler } from "@netlify/functions";
import crypto from "crypto";
import { Redis } from "@upstash/redis";

// 1. IMPORT THE HANDLER FOR DIRECT CALLING
// Assuming ubiqitum-kpi is in the same functions directory
import { handler as kpiHandler } from "./ubiqitum-kpi"; 

// --- CORS Configuration ---
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
    // 1. Handle Preflight/Non-POST requests (CORS remains)
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 204, 
            headers: {
                "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Max-Age": "86400", 
            },
        };
    }
    
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
    
    // Setup generic headers
    const successHeaders = { 
        "Content-Type": "application/json", 
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN 
    };
    const errorHeaders = { "Access-Control-Allow-Origin": ALLOWED_ORIGIN };

    const body = JSON.parse(event.body || "{}");
    const { brand_url } = body;
    if (!brand_url) return { statusCode: 400, headers: errorHeaders, body: "brand_url required" };

    const sk = buildSK(body);
    const windowDays = Number(body.consistency_window_days ?? 180);
    const mode = body.stability_mode || "pinned";

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
            headers: { ...successHeaders, "ETag": sk, "Last-Modified": cached.meta.last_refreshed_at },
            body: JSON.stringify(cached.payload)
        };
      }
    }

    // 2. DIRECT CALL TO THE KPI FUNCTION (REPLACING THE fetch CALL)
    
    // Create a mock event object for the kpiHandler
    const mockEvent = {
        ...event, // Inherit necessary context from the original event
        httpMethod: 'POST', // Ensure the sub-handler runs correctly
        body: JSON.stringify(body),
        // Headers and path may need cleaning if the kpiHandler is sensitive
    };
    
    // Direct synchronous call (using await)
    const kpiResponse = await kpiHandler(mockEvent, {} as any, () => {});
    
    // We assume kpiResponse is { statusCode: 200, body: 'JSON string', ... }
    if (kpiResponse.statusCode !== 200) {
        // Handle failure of the inner function
        return {
            statusCode: kpiResponse.statusCode || 500,
            headers: errorHeaders,
            body: `KPI computation failed: ${kpiResponse.body}`
        };
    }
    
    const payload = JSON.parse(kpiResponse.body || "{}");

    // set cache
    await redis.set(key, {
      payload,
      meta: { sk, model_version:"V3.5.14", last_refreshed_at: nowIso, consistency_window_days: windowDays }
    });

    return {
      statusCode: 200,
      headers: { ...successHeaders, "ETag": sk, "Last-Modified": nowIso },
      body: JSON.stringify(payload)
    };
};
