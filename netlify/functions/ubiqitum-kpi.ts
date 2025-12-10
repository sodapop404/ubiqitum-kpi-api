import 'dotenv/config';
import type { Handler } from "@netlify/functions";

// ====================================================================
// CONFIGURATION AND CONSTANTS
// ====================================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// 🔍 DEBUG — Log environment variables
console.log("DEBUG ENV", {
  MODEL_BASE_URL: process.env.MODEL_BASE_URL,
  MODEL_API_KEY: process.env.MODEL_API_KEY ? "[OK]" : "[MISSING]",
  MODEL_NAME: process.env.MODEL_NAME,
});

// ====================================================================
// FULL SYSTEM PROMPT (EXACTLY AS PROVIDED)
// ====================================================================

const SYSTEM_PROMPT = `MASTER SYSTEM PROMPT — Ubiqitum V3 (V5.14) KPI Engine

Stable • Deterministic • URL-First • Eleven-Field Strict JSON (KPIs + Meta)

ROLE
You are the Ubiqitum scoring engine (Version 3, V5.14 semantics). Your ONLY task: compute and return exactly ELEVEN fields as STRICT JSON. No other text or keys.

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

NUMBER & FORMAT RULES
* KPI fields are numbers (or null); meta fields are strings.
* Dot decimal, EXACTLY two decimals for numeric fields. No %, no thousands separators, no scientific notation, no trailing commas.
* Clamp numeric values to [0,100] BEFORE rounding. Round HALF-UP to two decimals.
* NEVER end a numeric value in *.00 or *.50. If rounding would produce *.00 or *.50, apply a DETERMINISTIC ±0.01 nudge, then reclamp to [0,100].

INPUTS (URL-first; optional overrides)
User will supply at least:
* brand_url: "<required URL>"

Optional:
* seed: <int>
* stability_mode: <"pinned"|"live"> (default "pinned")
* consistency_window_days: <int> (default 180)
* evidence_history: <array of prior eleven-field JSONs with timestamps>

Advanced overrides (replace inference if provided):
* brand_name, market (→ ubiqitum_market), sector (→ ubiqitum_sector), segment, timeframe ("Current" default), industry_definition, allow_model_inference (default true)

Optional direct metrics (override precedence for their fields):
* brand_awareness_percent, sector_awareness_avg_percent
* brand_relevance_percent, sector_relevance_avg_percent
* brand_consideration_percent, brand_trust_percent

Optional counts (used only when % missing and denominator>0):
* aware_brand_count, sample_awareness_denominator
* aware_competitors_total_count, sample_awareness_sector_denominator
* relevant_brand_count, sample_relevance_denominator
* relevant_competitors_total_count, sample_relevance_sector_denominator
* likely_to_buy_count, sample_consideration_denominator
* trust_positive_count, sample_trust_denominator

URL NORMALISATION & DERIVED CONTEXT
1. canonical_domain = lower-case host; strip scheme/path/query/fragment; drop leading "www."
2. brand_name: provided → on-page/meta → Title-Case of domain root.
3. ubiqitum_market: provided → ccTLD → content/locales → "Global".
4. ubiqitum_sector: provided → infer from About/Services/meta (concise, consumer-facing label).
5. segment (priors only): infer from site; default B2C unless agency/enterprise/partners/network cues → B2B.
6. timeframe default: "Current".

CONSTANCY ENGINE (Determinism, Stability, Caching)
* session_seed = uint32 from deterministic SK
* Use session_seed for tie-breakers and ±0.01 adjustment to avoid *.00/*.50

SCORING PRECEDENCE (per KPI field)
1. DIRECT % PROVIDED → use (then clamp → round → deterministic *.00/*.50 avoidance).
2. COUNTS → if numerator & denominator, compute %.
3. CACHE/HISTORY → reuse SK value.
4. MODEL-INFER (default ON) → if allow_model_inference !== false, infer via priors/benchmarks.
5. NULL POLICY → if steps fail, set field to null.

OVERALL COMPOSITE
ubiqitum_overallagainastallcompany_score =
 0.35*brand_consideration_percent +
 0.30*brand_trust_percent +
 0.20*brand_relevance_percent +
 0.15*brand_awareness_percent

FINALISATION (strict key order)
Return a single JSON object with keys in this exact order:
brand_name, canonical_domain, ubiqitum_market, ubiqitum_sector,
brand_relevance_percent, sector_relevance_avg_percent,
brand_awareness_percent, sector_awareness_avg_percent,
brand_consideration_percent, brand_trust_percent,
ubiqitum_overallagainastallcompany_score
`;

// ====================================================================
// REQUIRED KEYS (UNCHANGED)
// ====================================================================

const REQUIRED_KEYS = [
  "brand_name","canonical_domain","ubiqitum_market","ubiqitum_sector",
  "brand_relevance_percent","sector_relevance_avg_percent",
  "brand_awareness_percent","sector_awareness_avg_percent",
  "brand_consideration_percent","brand_trust_percent",
  "ubiqitum_overallagainastallcompany_score"
] as const;

// ====================================================================
// NORMALISATION (UNCHANGED)
// ====================================================================

function normalise(json: any, seedInt: number) {
  const clamp = (x:number)=>Math.max(0,Math.min(100,x));
  const round2=(x:number)=>Math.round((x+Number.EPSILON)*100)/100;
  const avoid=(x:number)=>{
    const s=x.toFixed(2);
    if(s.endsWith("00")||s.endsWith("50")){
      x = clamp(x + (seedInt % 2 === 0 ? 0.01 : -0.01));
      x = round2(x);
    }
    return parseFloat(x.toFixed(2));
  };

  const out:any = {};
  for (const k of REQUIRED_KEYS) {
    const v = json[k];
    if (typeof v === "number") out[k] = avoid(round2(clamp(v)));
    else if (v === null || typeof v === "string") out[k] = v;
    else out[k] = (v == null) ? null : v;
  }
  return out;
}

// ====================================================================
// MAIN NETLIFY FUNCTION WITH DEBUGGING
// ====================================================================

export const handler: Handler = async (event) => {

  console.log("DEBUG REQUEST RECEIVED", {
    method: event.httpMethod,
    rawBody: event.body
  });

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { 
      statusCode: 405, 
      headers: CORS_HEADERS,
      body: "POST only" 
    };
  }

  let body: any;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (err) {
    console.error("DEBUG JSON PARSE ERROR", err);
    return { statusCode: 400, headers: CORS_HEADERS, body: "Invalid JSON" };
  }

  console.log("DEBUG PARSED BODY", body);

  const { brand_url } = body;
  if (!brand_url) {
    return { 
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "brand_url required" })
    };
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(body) }
  ];

  console.log("DEBUG MODEL REQUEST PAYLOAD", { messages });

  let rawText = "";
  try {
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
        max_tokens: 2000
      })
    });

    console.log("DEBUG MODEL STATUS:", resp.status);
    rawText = await resp.text();
    console.log("DEBUG RAW LLM RESPONSE:", rawText);

    if (!resp.ok) throw new Error(`Model error ${resp.status}`);

  } catch (err) {
    console.error("DEBUG MODEL REQUEST FAILED:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Model request failed", detail: String(err), raw_llm_response: rawText })
    };
  }

  let llmJson: any;
  try {
    const parsed = JSON.parse(rawText);
    let content = parsed?.choices?.[0]?.message?.content || "{}";

    if (content.startsWith("```json")) content = content.slice(7);
    if (content.endsWith("```")) content = content.slice(0, -3);

    llmJson = JSON.parse(content);

    console.log("DEBUG PARSED JSON FROM MODEL:", llmJson);

  } catch (err) {
    console.error("DEBUG FINAL LLM JSON PARSE ERROR:", err);
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Could not parse model JSON", detail: String(err), raw_llm_response: rawText })
    };
  }

  const seed = Number.isInteger(body.seed) ? body.seed : 0;
  const out = normalise(llmJson, seed);

  console.log("DEBUG NORMALIZED OUTPUT:", out);

  return {
    statusCode: 200,
    headers: { 
      "Content-Type": "application/json",
      ...CORS_HEADERS
    },
    body: JSON.stringify({
      input_payload: body,
      normalized_output: out
    }, null, 2)
  };
};
