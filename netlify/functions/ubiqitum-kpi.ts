// netlify/functions/ubiqitum-kpi.ts
import type { Handler } from "@netlify/functions";

// (SYSTEM_PROMPT and REQUIRED_KEYS remain the same)
const SYSTEM_PROMPT = `UBIQITUM CACHE ORCHESTRATOR — Stability Key Resolver & Response Packager

ROLE
You decide whether to SERVE CACHED or RECOMPUTE for a given request. You must return strict JSON (no prose).

INPUT
{
  "brand_url": "<required URL>",
  "seed": <int|optional>,
  "stability_mode": "<pinned|live|optional>",
  "consistency_window_days": <int|optional>,
  "overrides": { "brand_name": "...", "market": "...", "sector": "...", "segment": "...", "timeframe": "...", "industry_definition": "...", "allow_model_inference": true|false },
  "cached": { "payload": <11-field JSON|optional>, "meta": { "sk": "<hex>", "last_refreshed_at": "<ISO8601>", "consistency_window_days": <int> } },
  "provided_metrics": { /* optional direct % or counts, passthrough */ }
}

RULES
1) Canonicalise domain; resolve brand_name/market/sector/segment/timeframe with overrides or inference heuristics.
2) Build SK = sha256(canonical_domain|brand_name|market|sector|segment|timeframe|industry_definition|seed|"V3.5.14").
3) If stability_mode == "pinned" AND cached.meta exists AND (now - last_refreshed_at) ≤ window AND no MATERIAL CHANGE:
   - Return { "action":"serve_cache", "sk": "<hex>", "payload": cached.payload }
4) Else:
   - Return { "action":"recompute", "sk":"<hex>", "kpi_request": { /* forward inputs required by KPI Engine */ } }

MATERIAL CHANGE if:
- canonical_domain differs from cached.meta.sk basis
- any provided % changed by ≥0.10 abs points
- counts imply ≥10% relative change
- market/sector/segment/timeframe changed

OUTPUT (JSON ONLY; one of the shapes)
SERVE:
{ "action":"serve_cache", "sk":"<hex>", "payload": <11-field JSON> }

RECOMPUTE:
{
  "action":"recompute",
  "sk":"<hex>",
  "kpi_request": {
    "brand_url":"<url>",
    "seed": <int|null>,
    "stability_mode": "<pinned|live>",
    "consistency_window_days": <int>,
    "evidence_history": <array|[]>,
    "brand_name":"<string|null>",
    "market":"<string|null>",
    "sector":"<string|null>",
    "segment":"<string|null>",
    "timeframe":"<string|null>",
    "industry_definition":"<string|null>",
    "allow_model_inference": true
  }
}`;

const REQUIRED_KEYS = [
 "brand_name","canonical_domain","ubiqitum_market","ubiqitum_sector",
 "brand_relevance_percent","sector_relevance_avg_percent",
 "brand_awareness_percent","sector_awareness_avg_percent",
 "brand_consideration_percent","brand_trust_percent",
 "ubiqitum_overallagainastallcompany_score"
] as const;

function normalise(json: any, seedInt: number) {
  const clamp = (x:number)=>Math.max(0,Math.min(100,x));
  const round2=(x:number)=>Math.round((x+Number.EPSILON)*100)/100;
  const avoid=(x:number)=>{ const s=x.toFixed(2); if(s.endsWith("00")||s.endsWith("50")){ x=clamp(x + (seedInt%2===0?0.01:-0.01)); x=round2(x);} return parseFloat(x.toFixed(2)); };
  const out:any = {};
  for (const k of REQUIRED_KEYS) {
    const v = json[k];
    if (typeof v === "number") out[k] = avoid(round2(clamp(v)));
    else if (v === null || typeof v === "string") out[k] = v;
    else out[k] = (v==null)?null:v; // leave strings for meta
  }
  return out;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
  
  try {
    const body = JSON.parse(event.body || "{}");
    const { brand_url } = body;
    if (!brand_url) return { statusCode: 400, body: "brand_url required" };

    // build your model call (OpenAI-compatible or OSS gateway)
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(body) }
    ];

    // Check for environment variables (a common cause of 401/403 errors)
    if (!process.env.MODEL_BASE_URL || !process.env.MODEL_API_KEY) {
      console.error("FATAL: MODEL_BASE_URL or MODEL_API_KEY is missing from environment variables.");
      return { statusCode: 500, body: "Server configuration error: Model credentials missing." };
    }

    // Example OpenAI-compatible call (adjust base URL & key)
    const resp = await fetch(process.env.MODEL_BASE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.MODEL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.MODEL_NAME || "gpt-oss-20b",
        messages,
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: 350
      })
    });
    
    // === CRITICAL ERROR CHECK 1: Check HTTP Status Code ===
    if (!resp.ok) {
        const errorText = await resp.text();
        console.error(`Model API call failed with status ${resp.status}:`, errorText);
        // Return a generic error to the caller, but log the details internally
        return { statusCode: 502, body: JSON.stringify({ error: "External Model API Failed", status: resp.status, detail: errorText.slice(0, 100) }) };
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content;
    
    // === CRITICAL ERROR CHECK 2: Check for expected model output ===
    if (!text) {
        console.error("Model API returned OK status but no content in choices[0].message.content. Full response data:", data);
        return { statusCode: 500, body: JSON.stringify({ error: "Model output empty or unexpected structure." }) };
    }
    
    // Log the raw text output for debugging the JSON parsing
    console.log("Model Raw Text Output:", text);

    let json: any;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse JSON from model output:", e, "Raw text:", text);
      return { statusCode: 500, body: JSON.stringify({ error: "Model output was not valid JSON." }) };
    }

    // derive seed deterministically if not in body
    const seed = Number.isInteger(body.seed) ? body.seed : 0;
    const out = normalise(json, seed);
    
    console.log("Normalized Output to be returned:", out); // Final check

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(out)
    };

  } catch (e) {
    // Catch any synchronous errors (e.g., JSON.parse failure on event.body)
    console.error("An unexpected error occurred in ubiqitum-kpi handler:", e);
    return { statusCode: 500, body: "Internal Server Error during KPI processing." };
  }
};
