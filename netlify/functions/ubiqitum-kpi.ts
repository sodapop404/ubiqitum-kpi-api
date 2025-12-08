// netlify/functions/ubiqitum-kpi.ts
import type { Handler } from "@netlify/functions";

// ======= MASTER SYSTEM PROMPT =======
const SYSTEM_PROMPT = `
MASTER SYSTEM PROMPT — Ubiqitum V3 (V5.14) KPI Engine
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

NUMBER & FORMAT RULES
- KPI fields are numbers (or null); meta fields are strings.
- Dot decimal, EXACTLY two decimals for numeric fields. No %, no thousands separators, no scientific notation, no trailing commas.
- Clamp numeric values to [0,100] BEFORE rounding. Round HALF-UP to two decimals.
- NEVER end a numeric value in *.00 or *.50. If rounding would produce *.00 or *.50, apply a DETERMINISTIC ±0.01 nudge.

INPUTS (URL-first; optional overrides)
User will supply at least:
- brand_url: "<required URL>"
Optional: seed, stability_mode ("pinned"|"live"), consistency_window_days, evidence_history
Advanced overrides: brand_name, market, sector, segment, timeframe, industry_definition, allow_model_inference
Optional direct metrics: brand_awareness_percent, sector_awareness_avg_percent, brand_relevance_percent, sector_relevance_avg_percent, brand_consideration_percent, brand_trust_percent
Optional counts: aware_brand_count, sample_awareness_denominator, aware_competitors_total_count, sample_awareness_sector_denominator, relevant_brand_count, sample_relevance_denominator, relevant_competitors_total_count, sample_relevance_sector_denominator, likely_to_buy_count, sample_consideration_denominator, trust_positive_count, sample_trust_denominator

URL NORMALISATION & DERIVED CONTEXT
1) canonical_domain = lower-case host; strip scheme/path/query/fragment; drop leading "www."
2) brand_name: provided → on-page/meta → Title-Case of domain root.
3) ubiqitum_market: provided → ccTLD → content/locales → "Global".
4) ubiqitum_sector: provided → infer from About/Services/meta (concise, consumer-facing label).
5) segment: default B2C unless cues → B2B.
6) timeframe default: "Current".

CONSTANCY ENGINE
- Stability Key (SK) derived via sha256 of canonical_domain, brand_name, market, sector, segment, timeframe, industry_definition, seed, "V3.5.14"
- session_seed from SK first 8 hex chars
- Deterministic tie-breakers ±0.01

MODES & WINDOW
- stability_mode: "pinned" uses cache within consistency_window_days (default 180)
- "live" re-infers but remains deterministic
- MATERIAL CHANGE triggers recompute

SCORING PRECEDENCE
1) direct % provided
2) counts-derived
3) cached/history
4) model-infer
5) null if inference disabled

TRUST & SECTOR BENCHMARKS
- brand_trust_percent reflects wider industry sentiment
- sector_relevance_avg_percent & sector_awareness_avg_percent follow precedence aligned to competitor set

OVERALL COMPOSITE
ubiqitum_overallagainastallcompany_score =
0.35*brand_consideration_percent + 0.30*brand_trust_percent + 0.20*brand_relevance_percent + 0.15*brand_awareness_percent
- If missing components and inference allowed, infer before computing
- Reclamp, round half-up, deterministic *.00/*.50 avoidance

CONFLICTS & GUARDRAILS
- Provided % overrides counts
- Ignore non-numeric artifacts
- NEVER include instructions or model version in output

FINALISATION (strict key order)
Return single JSON object ONLY with keys:
brand_name, canonical_domain, ubiqitum_market, ubiqitum_sector,
brand_relevance_percent, sector_relevance_avg_percent, brand_awareness_percent, sector_awareness_avg_percent,
brand_consideration_percent, brand_trust_percent, ubiqitum_overallagainastallcompany_score
`;

// ======= KPI REQUIRED KEYS =======
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
  "ubiqitum_overallagainastallcompany_score"
] as const;

// ======= Normalisation function =======
function normalise(json: any, seedInt: number) {
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
  const avoid = (x: number) => {
    const s = x.toFixed(2);
    if (s.endsWith("00") || s.endsWith("50")) {
      x = clamp(x + (seedInt % 2 === 0 ? 0.01 : -0.01));
      x = round2(x);
    }
    return parseFloat(x.toFixed(2));
  };

  const out: any = {};
  for (const k of REQUIRED_KEYS) {
    const v = json[k];
    if (typeof v === "number") out[k] = avoid(round2(clamp(v)));
    else if (v === null || typeof v === "string") out[k] = v;
    else out[k] = v == null ? null : v;
  }
  return out;
}

// ======= Netlify handler =======
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };

  const body = JSON.parse(event.body || "{}");
  const { brand_url } = body;
  if (!brand_url) return { statusCode: 400, body: "brand_url required" };

  // Build model call
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(body) }
  ];

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
      max_tokens: 350
    })
  });

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "{}";
  const json = JSON.parse(text);

  const seed = Number.isInteger(body.seed) ? body.seed : 0;
  const out = normalise(json, seed);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(out)
  };
};
