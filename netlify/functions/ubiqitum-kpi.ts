import type { Handler } from "@netlify/functions";

/* ====================================================================
   LOGGING (VISIBLE IN NETLIFY)
==================================================================== */
const log = (...args: any[]) => {
  console.log("[KPI]", ...args);
};

/* ====================================================================
   CORS
==================================================================== */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/* ====================================================================
   URL NORMALISATION (MATCHES CACHE)
==================================================================== */
function normaliseInputUrl(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  raw = raw.trim();

  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;

  try {
    const u = new URL(raw);
    u.hostname = u.hostname.toLowerCase();
    return u.href;
  } catch {
    return "";
  }
}

/* ====================================================================
   MODEL REQUEST (STRICT JSON, TRUNCATION SAFE)
==================================================================== */
async function modelRequest(
  env: any,
  messages: any[],
  opts: { maxTokens: number; timeoutMs: number }
) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("timeout"),
    Math.min(opts.timeoutMs, 60000)
  );

  try {
    const resp = await fetch(env.MODEL_BASE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MODEL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.MODEL_NAME,
        messages,
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: opts.maxTokens,
      }),
      signal: controller.signal,
    });

    const data = await resp.json().catch(() => ({}));

if (!resp.ok) {
  const errorText = await resp.text().catch(() => "");
  console.error("[KPI][MODEL_HTTP_ERROR]", {
    status: resp.status,
    body: errorText,
    url: env.MODEL_BASE_URL,
    model: env.MODEL_NAME
  });

  return {
    ok: false,
    reason: "http_error",
    status: resp.status
  };
}

    const choice = data?.choices?.[0];
    const finish = choice?.finish_reason;
    const text = choice?.message?.content;

    if (!text || finish !== "stop") {
      return { ok: false, reason: "truncated" };
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, reason: "truncated" };
    }

    return { ok: true, json };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network", err };
  } finally {
    clearTimeout(timer);
  }
}

/* ====================================================================
   REQUIRED OUTPUT KEYS
==================================================================== */
const REQUIRED_KEYS = [
  "brand_name",
  "canonical_domain",
  "ubiqitum_market",
  "ubiqitum_sector",
  "brand_relevance_percent",
  "sector_relevance_avg_percent",
  "brand_awareness_percent",
  "sector_awareness_avg_percent",
  "brand_consideration_percent",
  "brand_trust_percent",
  "ubiqitum_overallagainastallcompany_score",
] as const;

/* ====================================================================
   DETERMINISTIC NORMALISATION
==================================================================== */
function normalise(json: any, seed: number) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  const avoid = (n: number) => {
    let v = round2(clamp(n));
    const s = v.toFixed(2);
    if (s.endsWith("00") || s.endsWith("50")) {
      v = round2(clamp(v + (seed % 2 === 0 ? 0.01 : -0.01)));
    }
    return parseFloat(v.toFixed(2));
  };

  const out: any = {};
  for (const k of REQUIRED_KEYS) {
    const v = json[k];
    if (typeof v === "number") out[k] = avoid(v);
    else out[k] = v ?? null;
  }
  return out;
}

/* ====================================================================
   FULL SYSTEM PROMPT (VERBATIM — NO MODIFICATIONS)
==================================================================== */
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
4. ubiqitum_sector resolution (precision-first, deterministic):
   Resolve in this order and stop at first match:
   
   1) If sector override is provided → use it verbatim.
   2) If page title or meta description (from the provided URL string) contains clear industry terms, map to a concise sector label (see Sector Mapper below).
   3) Else, infer from domain root tokens and path/slug keywords:
      • Domain tokens: split host on . and -; use adjacent tokens for context (e.g., aminworldwide + network → “B2B agency network”).
      • Path/slug keywords: /services/creative, /clients/, /work/ strengthen “agency network” inference; /shop, /buy, /store weaken B2B and suggest B2C retail.
   4) Else, use organisation cues in the input string:
      • words like partners, network, enterprise, B2B, wholesale, integrator → B2B
      • words like store, retail, collection, menu, booking → B2C
   5) If still ambiguous, prefer the narrower of the plausible labels (e.g., prefer “B2B agency network” over “Marketing & Advertising”), and keep phrasing concise and consumer-facing.

5. segment (priors only): infer from site; default B2C unless agency/enterprise/partners/network cues → B2B.
6. timeframe default: "Current".

SECTOR MAPPER (keyword-to-label map; choose the closest single label):
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
(If multiple sets match, pick the most specific label. Do not output composite labels.)

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

/* ====================================================================
   HANDLER
==================================================================== */
export const handler: Handler = async (event) => {
  log("🔥 Invoked", event.httpMethod);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "POST only" };
  }

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  body.brand_url = normaliseInputUrl(body.brand_url);
  if (!body.brand_url) {
    log("❌ Invalid brand_url");
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid brand_url" }),
    };
  }

  log("🌐 brand_url", body.brand_url);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(body) },
  ];

  const attempts = [
    { maxTokens: 12000, timeoutMs: 60000 },
    { maxTokens: 16000, timeoutMs: 60000 },
  ];

  const fallbacks = [
    { maxTokens: 8000, timeoutMs: 60000 },
    { maxTokens: 6000, timeoutMs: 60000 },
  ];

  let result: any = null;

  for (const a of attempts) {
    log("🧠 Model attempt", a.maxTokens);
    result = await modelRequest(process.env, messages, a);
    if (result.ok) break;
    if (result.reason === "exceeds_limit") break;
  }

  if (!result?.ok && result?.reason === "exceeds_limit") {
    for (const f of fallbacks) {
      log("🧠 Fallback", f.maxTokens);
      result = await modelRequest(process.env, messages, f);
      if (result.ok) break;
    }
  }

  if (!result?.ok) {
    log("❌ KPI failed", result?.reason);
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "KPI failed", reason: result?.reason }),
    };
  }

  const seed = Number.isInteger(body.seed) ? body.seed : 0;
  const output = normalise(result.json, seed);

  log("✅ KPI complete", output.canonical_domain);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    body: JSON.stringify(
      {
        input_payload: body,
        normalized_output: output,
      },
      null,
      2
    ),
  };
};
