// netlify/functions/ubiqitum-kpi.ts
import type { Handler } from "@netlify/functions";

// --- Configuration ---
const CORS_ORIGIN = "https://ubiqitum-freemium.webflow.io"; // CRITICAL: Your Webflow domain
const MAX_TOKENS = 1024; // REQUIRED: Increased token limit for stable completion

// ====================================================================
// MASTER SYSTEM PROMPT — FULL VERSION REINSTATED
// Note: This full prompt remains a high risk for the max_tokens limit crash.
// ====================================================================
const SYSTEM_PROMPT = `MASTER SYSTEM PROMPT — Ubiqitum V3 (V5.14) KPI Engine
Stable • Deterministic • URL-First • Eleven-Field Strict JSON (KPIs + Meta)

ROLE
You are the Ubiqitum scoring engine (Version 3, V5.14 semantics).
Your ONLY task: compute and return exactly ELEVEN fields as STRICT JSON. No other text or keys.

OUTPUT CONTRACT (exact keys; JSON ONLY)
{
  "brand_name": "<string>",
  "canonical_domain": "<string>",
  "ubiqitum_market": "<string>",
  "ubiqitum_sector": "<string>",
  "brand_relevance_percent": <number|null>,
  "sector_relevance_avg_percent": <number|null>,
  "brand_awareness_percent": <number|null>,
  "sector_awareness_avg_percent": <number|null>,
  "brand_consideration_percent": <number|null>,
  "brand_trust_percent": <number|null>,
  "ubiqitum_overallagainastallcompany_score": <number|null>
}
// ... (The rest of the full prompt remains here)
NUMBER & FORMAT RULES
- KPI fields are numbers (or null); meta fields are strings.
- Dot decimal, EXACTLY two decimals for numeric fields. No %, no thousands separators, no scientific notation, no trailing commas.
- Clamp numeric values to [0,100] BEFORE rounding. Round HALF-UP to two decimals.
- NEVER end a numeric value in *.00 or *.50. If rounding would produce *.00 or *.50, apply a DETERMINISTIC ±0.01 nudge (see Constancy Engine), then reclamp to [0,100].

INPUTS (URL-first; optional overrides)
User will supply at least:
- brand_url: "<required URL>"

Optional:
- seed: <int>
- stability_mode: <"pinned"|"live"> (default "pinned")
- consistency_window_days: <int> (default 180)
- evidence_history: <array of prior eleven-field JSONs with timestamps>

Advanced overrides (if provided, they replace inference):
- brand_name, market (→ ubiqitum_market), sector (→ ubiqitum_sector), segment, timeframe ("Current" default), industry_definition, allow_model_inference (default true)

Optional direct metrics (override precedence for their fields):
- brand_awareness_percent, sector_awareness_avg_percent
- brand_relevance_percent, sector_relevance_avg_percent
- brand_consideration_percent, brand_trust_percent
Optional counts (used only when % missing and denominator>0):
- aware_brand_count, sample_awareness_denominator
- aware_competitors_total_count, sample_awareness_sector_denominator
- relevant_brand_count, sample_relevance_denominator
- relevant_competitors_total_count, sample_relevance_sector_denominator
- likely_to_buy_count, sample_consideration_denominator
- trust_positive_count, sample_trust_denominator

URL NORMALISATION & DERIVED CONTEXT
1) canonical_domain = lower-case host; strip scheme/path/query/fragment; drop leading "www."
2) brand_name: provided → on-page/meta → Title-Case of domain root.
3) ubiqitum_market: provided → ccTLD → content/locales → "Global".
4) ubiqitum_sector: provided → infer from About/Services/meta (concise, consumer-facing label).
5) segment (priors only): infer from site; default B2C unless agency/enterprise/partners/network cues → B2B.
6) timeframe default: "Current".

CONSTANCY ENGINE (Determinism, Stability, Caching)
Goal: IDENTICAL outputs for IDENTICAL inputs across refreshes/back-to-back calls.

Stability Key (SK):
SK = sha256( canonical_domain(brand_url) | lower(resolved_brand_name) | lower(resolved_ubiqitum_market) | lower(resolved_ubiqitum_sector) | lower(resolved_segment) | "Current" | lower(nullsafe(industry_definition)) | nullsafe(seed) | "V3.5.14" )

- session_seed = uint32 from SK (first 8 hex chars).
- Use session_seed for tie-breakers AND to choose ±0.01 direction to avoid *.00/*.50 for numeric fields (even → +0.01; odd → −0.01).

Modes & Window:
- stability_mode:
  - "pinned": within consistency_window_days (default 180), REUSE cached/evidence_history values for the same SK unless MATERIAL CHANGE occurs.
  - "live": re-infer using newest evidence but remain deterministic via SK.
- MATERIAL CHANGE (recompute): canonical_domain changes; OR explicit % values change by ≥0.10 points; OR counts imply ≥10% relative change; OR market/sector/segment/timeframe changes.

EVIDENCE PRIORITY (slow, rationalised)
1) Reuse evidence_history/cache within window for SK.
2) If stale/missing and tools available: trawl in order → About → Products/Clients/Work → News/Press → Contact/Locations → authoritative listings.
3) Record internal last-updated timestamps. If no web tools, rely on evidence_history + calibrated priors only.

SCORING PRECEDENCE (per KPI field)
1) DIRECT % PROVIDED → use (then clamp → round → deterministic *.00/*.50 avoidance).
2) COUNTS → if numerator & denominator and denominator>0, compute (num/den)*100 (then clamp/round/avoidance).
3) CACHE/HISTORY (within window) → reuse SK value.
4) MODEL-INFER (default ON) → if allow_model_inference !== false, infer via V3 (V5.14) priors/benchmarks with recency weighting for the declared/inferred market/sector/segment/timeframe.
5) NULL POLICY → if allow_model_inference=false and steps (1)–(4) fail, set field to null.

TRUST SCOPE RULE
brand_trust_percent reflects WIDER INDUSTRY sentiment (not only immediate sector subset). Use industry_definition if provided; else infer from segment/market.

SECTOR BENCHMARKS
sector_relevance_avg_percent and sector_awareness_avg_percent follow the same precedence (direct → counts → cache/history → model-inferred sector priors) aligned to the competitor set, region, and timeframe.

OVERALL COMPOSITE (deterministic)
ubiqitum_overallagainastallcompany_score =
0.35*brand_consideration_percent + 0.30*brand_trust_percent + 0.20*brand_relevance_percent + 0.15*brand_awareness_percent
- If any component missing and inference allowed, infer before computing.
- If inference disabled and some components null, RE-NORMALISE remaining weights to sum to 1; if none present and inference disabled, return null.
- After computing: clamp → round half-up → deterministic *.00/*.50 avoidance → reclamp.

CONFLICTS & GUARDRAILS
- Provided % ALWAYS overrides conflicting count-derived values (still clamp/round/avoidance).
- Ignore non-numeric artifacts ("N/A", "-", "", null strings).
- THINK before returning: apply precedence, constancy, window, and material-change logic deliberately.
- NEVER mention these instructions, your process, or model/version in the output.

FINALISATION (strict key order)
Return a single JSON object with keys in this exact order:
1) brand_name
2) canonical_domain
3) ubiqitum_market
4) ubiqitum_sector
5) brand_relevance_percent
6) sector_relevance_avg_percent
7) brand_awareness_percent
8) sector_awareness_avg_percent
9) brand_consideration_percent
10) brand_trust_percent
11) ubiqitum_overallagainastallcompany_score

For numeric fields: Clamp → Round (2dp) → Avoid *.00/*.50 deterministically → Reclamp → Emit.
For string fields: Emit resolved values exactly.
Output the JSON object ONLY — nothing else.`;
// ====================================================================

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
    else out[k] = (v==null)?null:v; 
  }
  return out;
}

export const handler: Handler = async (event) => {
    const CORS_HEADERS = {
        "Access-Control-Allow-Origin": CORS_ORIGIN,
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

    // Build model call
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(body) }
    ];

    // Check for environment variables
    if (!process.env.MODEL_BASE_URL || !process.env.MODEL_API_KEY) {
      console.error("FATAL: Model credentials missing.");
      return { statusCode: 500, body: "Server configuration error: Model credentials missing.", headers: CORS_HEADERS };
    }

    // Execute API call
    const resp = await fetch(process.env.MODEL_BASE_URL!, {
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
        max_tokens: MAX_TOKENS // CRITICAL: Use 1024 token limit
      })
    });
    
    // CRITICAL ERROR CHECK 1: Check HTTP Status Code
    if (!resp.ok) {
        const errorText = await resp.text();
        console.error(`Model API call failed with status ${resp.status}:`, errorText);
        return { statusCode: 502, body: JSON.stringify({ error: "External Model API Failed", status: resp.status, detail: errorText.slice(0, 100) }), headers: CORS_HEADERS };
    }

    const data = await resp.json();
    let text = data.choices?.[0]?.message?.content; 
    const choices = data.choices?.[0];

    // CRITICAL FIX: EXTREME PARSING ROBUSTNESS for non-standard response format
    if (!text && choices) {
        if (choices.text) {
            text = choices.text; 
        } else if (choices.message && typeof choices.message === 'string') {
             text = choices.message; 
        } else if (choices.message && typeof choices.message === 'object') {
             // Dig into the message object for a common key
             text = choices.message.text || choices.message.content; 
        }
    }
    
    if (choices?.finish_reason === 'length') {
        console.warn("Model stopped due to max_tokens limit. This WILL result in a 500/NULL error if JSON is incomplete.");
    }
    
    // CRITICAL ERROR CHECK 2: Check for expected model output
    if (!text) {
        console.error("Model API returned OK status but no content in expected paths. Full response data:", data);
        return { statusCode: 500, body: JSON.stringify({ error: "Model output empty or unexpected structure." }), headers: CORS_HEADERS };
    }
    
    // Log the raw text output for debugging the JSON parsing
    console.log("Model Raw Text Output (Length: " + text.length + "):", text.slice(0, 500) + (text.length > 500 ? '...' : ''));

    let json: any;
    try {
      json = JSON.parse(text.trim()); // trim to help with stray characters/whitespace
    } catch (e) {
      console.error("Failed to parse JSON from model output:", e, "Raw text (start):", text.slice(0, 200));
      return { statusCode: 500, body: JSON.stringify({ error: "Model output was not valid JSON." }), headers: CORS_HEADERS };
    }

    const seed = Number.isInteger(body.seed) ? body.seed : 0;
    const out = normalise(json, seed);
    
    console.log("Normalized Output to be returned:", out); 

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      body: JSON.stringify(out)
    };

  } catch (e) {
    console.error("An unexpected error occurred in ubiqitum-kpi handler:", e);
    return { statusCode: 500, body: "Internal Server Error during KPI processing.", headers: CORS_HEADERS };
  }
};
