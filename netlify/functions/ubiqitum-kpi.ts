import type { Handler } from "@netlify/functions";

/* ====================================================================
   CONFIGURATION
==================================================================== */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/* ====================================================================
   HELPERS
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

async function modelRequest(
  env: NodeJS.ProcessEnv,
  messages: any[],
  { maxTokens, timeoutMs }: { maxTokens: number; timeoutMs: number }
) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("timeout"),
    Math.min(timeoutMs, 60000)
  );

  try {
    const resp = await fetch(env.MODEL_BASE_URL as string, {
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
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const msg = (data?.error?.message || "").toLowerCase();
      if (msg.includes("max") || msg.includes("context")) {
        return { ok: false, reason: "exceeds_limit" };
      }
      return { ok: false, reason: "http_error", status: resp.status };
    }

    const finish = data?.choices?.[0]?.finish_reason;
    const text = data?.choices?.[0]?.message?.content;

    if (!text || finish !== "stop") {
      return { ok: false, reason: "truncated" };
    }

    try {
      const json = JSON.parse(text);
      return { ok: true, json };
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/* ====================================================================
   OUTPUT NORMALISATION
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

function normaliseScores(json: any, seed: number) {
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  const round2 = (x: number) =>
    Math.round((x + Number.EPSILON) * 100) / 100;

  const avoidBadDecimals = (x: number) => {
    const s = x.toFixed(2);
    if (s.endsWith("00") || s.endsWith("50")) {
      x += seed % 2 === 0 ? 0.01 : -0.01;
      x = clamp(x);
    }
    return parseFloat(x.toFixed(2));
  };

  const out: any = {};
  for (const k of REQUIRED_KEYS) {
    const v = json[k];
    if (typeof v === "number") {
      out[k] = avoidBadDecimals(round2(clamp(v)));
    } else {
      out[k] = v ?? null;
    }
  }
  return out;
}

/* ====================================================================
   FULL SYSTEM PROMPT
==================================================================== */
const SYSTEM_PROMPT = `MASTER SYSTEM PROMPT — Ubiqitum V3 (V5.14) KPI Engine

Stable • Deterministic • URL-First • Eleven-Field Strict JSON (KPIs + Meta)

ROLE
You are the Ubiqitum scoring engine. Your ONLY task: return EXACTLY eleven fields as STRICT JSON.

OUTPUT CONTRACT (JSON ONLY)
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

NUMBER RULES
• Clamp to [0,100]
• Exactly two decimals
• NEVER end in .00 or .50 (apply deterministic ±0.01)

URL NORMALISATION
canonical_domain = lower-case host only, no scheme, path, query, fragment, or www.

SCORING PRECEDENCE
1. Direct %
2. Counts → %
3. Cached history
4. Model inference
5. Null

OVERALL SCORE
0.35*consideration + 0.30*trust + 0.20*relevance + 0.15*awareness

Return JSON ONLY. No prose. Keys in exact order.
`;

/* ====================================================================
   NETLIFY HANDLER
==================================================================== */
export const handler: Handler = async (event) => {
  const env = process.env;

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "POST only" };
  }

  let body: any;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  /* ---- NORMALISE brand_url FIRST ---- */
  body.brand_url = normaliseInputUrl(body.brand_url);
  if (!body.brand_url) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid or missing brand_url" }),
    };
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(body) },
  ];

  const TIMEOUT = 60000;
  const attempts = [12000, 16000, 8000, 6000];

  let result: any;
  for (const maxTokens of attempts) {
    result = await modelRequest(env, messages, {
      maxTokens,
      timeoutMs: TIMEOUT,
    });
    if (result.ok) break;
    if (result.reason === "network" || result.reason === "timeout") break;
  }

  if (!result?.ok) {
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Model call failed", detail: result?.reason }),
    };
  }

  const seed = Number.isInteger(body.seed) ? body.seed : 0;
  const output = normaliseScores(result.json, seed);

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
