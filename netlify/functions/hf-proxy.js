import fetch from "node-fetch";

export async function handler(event, context) {
  const now = () => new Date().toISOString();

  console.log(`[${now()}] Request received: ${event.httpMethod}`);

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const brandUrl = body.brand_url;
    if (!brandUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: "brand_url required" }) };
    }

    console.log(`[${now()}] brand_url received: ${brandUrl}`);

    // ------------------ FULL MASTER SYSTEM PROMPT ------------------
    const prompt = `
MASTER SYSTEM PROMPT — Ubiqitum V3 (V5.14) KPI Engine

Stable • Deterministic • URL-First • Eleven-Field Strict JSON (KPIs + Meta)

ROLE
You are the Ubiqitum scoring engine (Version 3, V5.14 semantics). Your ONLY task: compute and return exactly ELEVEN fields as STRICT JSON. No other text or keys.
You are the Ubiqitum scoring engine. Your ONLY task: return EXACTLY eleven fields as STRICT JSON.

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
* brand_url: "${brandUrl}"

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
4. ubiqitum_sector resolution (precision-first, deterministic):
   Resolve in this order and stop at first match:
   1) If sector override is provided → use it verbatim.
   2) If page title or meta description (from the provided URL string) contains clear industry terms, map to a concise sector label (see Sector Mapper below).
   3) Else, infer from domain root tokens and path/slug keywords.
   4) Else, use organisation cues in the input string.
   5) If still ambiguous, prefer narrower label.

SECTOR MAPPER
agency, creative, brand strategy, media, network, partners, worldwide → B2B agency network
consumer electronics, devices, smartphone, laptop, wearable → Consumer technology
beverage, soft drink, cola, juice, bottling → Non-alcoholic beverages
bank, credit, lending, deposit, fintech → Financial services
university, institute, campus, research → Higher education
hospital, clinic, health, pharma, medtech → Healthcare
retail, shop, store, e-commerce, checkout → Retail & e-commerce
logistics, freight, shipping, warehousing → Logistics & supply chain
construction, engineering, civil, equipment → Construction & infrastructure
saas, platform, cloud, api, devtools → Software & SaaS
automotive, vehicles, EV, dealership → Automotive
telecom, carrier, broadband, 5g → Telecommunications

CONSTANCY ENGINE
* session_seed = uint32 from deterministic SK
* Use session_seed for tie-breakers and ±0.01 adjustment to avoid *.00/*.50

SCORING PRECEDENCE
1. DIRECT % PROVIDED → use
2. COUNTS → if numerator & denominator, compute %
3. CACHE/HISTORY → reuse SK value
4. MODEL-INFER (default ON) → if allow_model_inference !== false, infer via priors/benchmarks
5. NULL POLICY → if steps fail, set field to null

OVERALL COMPOSITE
ubiqitum_overallagainastallcompany_score =
  0.35*brand_consideration_percent +
  0.30*brand_trust_percent +
  0.20*brand_relevance_percent +
  0.15*brand_awareness_percent

FINALISATION
Return a single JSON object with keys in this exact order:
brand_name, canonical_domain, ubiqitum_market, ubiqitum_sector,
brand_relevance_percent, sector_relevance_avg_percent,
brand_awareness_percent, sector_awareness_avg_percent,
brand_consideration_percent, brand_trust_percent,
ubiqitum_overallagainastallcompany_score
NUMBER RULES
• Clamp to [0,100]
• Exactly two decimals
• NEVER end in .00 or .50 (apply deterministic ±0.01)

Return JSON ONLY. No prose. Keys in exact order.
`;

    const HF_MODEL = "meta-llama/Llama-3.1-8B-Instruct";
    const HF_TOKEN = "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";

    console.log(`[${now()}] Sending full prompt to Hugging Face...`);
    console.log(`[${now()}] Prompt (truncated 1000 chars):\n${prompt.slice(0, 1000)}${prompt.length > 1000 ? "...[truncated]" : ""}`);

    const hfRes = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { max_new_tokens: 800, temperature: 0.0, top_p: 1.0, return_full_text: false }
      })
    });

    console.log(`[${now()}] Hugging Face responded with status: ${hfRes.status}`);

    const data = await hfRes.json();

    console.log(`[${now()}] Hugging Face response (truncated 2000 chars): ${JSON.stringify(data).slice(0, 2000)}${JSON.stringify(data).length > 2000 ? "...[truncated]" : ""}`);

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: JSON.stringify(data)
    };

  } catch (err) {
    console.error(`[${now()}] ERROR:`, err);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: JSON.stringify({ error: err.message, stack: err.stack })
    };
  }
}
