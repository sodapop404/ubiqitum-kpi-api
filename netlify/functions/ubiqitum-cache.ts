

// netlify/functions/ubiqitum-cache.ts
import type { Handler } from "@netlify/functions";
import crypto from "crypto";
import { Redis } from "@upstash/redis";
import { handler as kpiHandler } from "./ubiqitum-kpi"; // CRITICAL: Direct Import

const redis = Redis.fromEnv(); // UPSTASH_REDIS_REST_URL / _TOKEN

// --- Helper functions (copy/paste from your guide) ---
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
  const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "https://ubiqitum-freemium.webflow.io", // <--- REPLACE WITH YOUR WEBFLOW DOMAIN
    "Access-Control-Allow-Headers": "Content-Type",
  };
    
  if (event.httpMethod === "OPTIONS") {
     return { statusCode: 200, headers: CORS_HEADERS };
  }
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only", headers: CORS_HEADERS };

  try {
    const body = JSON.parse(event.body || "{}");
    const { brand_url } = body;
    if (!brand_url) return { statusCode: 400, body: "brand_url required", headers: CORS_HEADERS };

    const sk = buildSK(body);
    const windowDays = Number(body.consistency_window_days ?? 180);
    const mode = body.stability_mode || "pinned";
    const nowIso = new Date().toISOString();

    // Try cache
    const key = `ubiqitum:sk:${sk}`;
    const cached = await redis.get<{payload:any, meta:any}>(key);

    if (cached && mode === "pinned") {
      const last = new Date(cached.meta.last_refreshed_at || nowIso);
      const fresh = (Date.now() - last.getTime()) / 86400000 <= (cached.meta.consistency_window_days ?? windowDays);
      if (fresh) {
        return {
          statusCode: 200,
          headers: { 
            "Content-Type": "application/json", 
            "ETag": sk, 
            "Last-Modified": cached.meta.last_refreshed_at,
            ...CORS_HEADERS // Include CORS headers
          },
          body: JSON.stringify(cached.payload)
        };
      }
    }

    // RECOMPUTE VIA DIRECT IMPORT
    const kpiResponse = await kpiHandler(event, {} as any, () => {});

    if (kpiResponse.statusCode !== 200) {
        console.error("KPI Handler failed to recompute.", kpiResponse);
        return { 
            statusCode: kpiResponse.statusCode, 
            body: kpiResponse.body,
            headers: { ...CORS_HEADERS } // Forward error status with CORS
        };
    }
    
    const payload = JSON.parse(kpiResponse.body as string);

    // Set cache
    await redis.set(key, {
      payload,
      meta: { sk, model_version:"V3.5.14", last_refreshed_at: nowIso, consistency_window_days: windowDays }
    }, { ex: windowDays * 86400 }); 

    return {
      statusCode: 200,
      headers: { 
        "Content-Type":"application/json", 
        "ETag": sk, 
        "Last-Modified": nowIso,
        ...CORS_HEADERS // Include CORS headers
      },
      body: JSON.stringify(payload)
    };

  } catch (e) {
    console.error("An unexpected error occurred in ubiqitum-cache handler:", e);
    return { 
      statusCode: 500, 
      body: "Internal Server Error during caching/orchestration.",
      headers: CORS_HEADERS 
    };
  }
};
