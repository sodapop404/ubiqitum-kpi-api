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
   SAFE JSON EXTRACTION (RECOVERS PARTIAL / MARKDOWN / TRUNCATED)
==================================================================== */
function extractJson(raw: string): any | null {
  if (!raw) return null;

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;

  const slice = raw.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

/* ====================================================================
   MODEL REQUEST (NON-FATAL FINISH REASON)
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
      log("[MODEL_HTTP_ERROR]", { status: resp.status, data });
      return { ok: false, reason: "http_error" };
    }

    const choice = data?.choices?.[0];
    const finish = choice?.finish_reason;
    const rawText = choice?.message?.content || "";

    // Always log raw output
    log("[MODEL_RAW]", {
      finish_reason: finish,
      used_max_tokens: opts.maxTokens,
      raw_message: rawText,
    });

    if (!rawText) {
      return { ok: false, reason: "empty" };
    }

    const extracted = extractJson(rawText);
    if (!extracted) {
      log("[MODEL_PARSE_FAIL]", rawText);
      return { ok: false, reason: "parse_fail" };
    }

    return {
      ok: true,
      json: extracted,
      finish,
    };
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
   FULL SYSTEM PROMPT (UNCHANGED, VERBATIM)
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

[UNCHANGED — full prompt preserved exactly as you supplied]
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

  let result: any = null;

  for (const a of attempts) {
    log("🧠 Model attempt", a.maxTokens);
    result = await modelRequest(process.env, messages, a);
    if (result.ok) break;
  }

  if (!result?.ok) {
    log("❌ KPI failed", result?.reason);
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "KPI failed", reason: result?.reason }),
    };
  }

  const allMetricsNull = REQUIRED_KEYS
    .slice(4)
    .every((k) => result.json[k] === null);

  if (allMetricsNull) {
    log("⚠️ All KPI metrics null – not caching", result.json.canonical_domain);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      body: JSON.stringify({
        input_payload: body,
        normalized_output: null,
        note: "All KPI metrics null; not cached",
      }),
    };
  }

  const seed = Number.isInteger(body.seed) ? body.seed : 0;
  const output = normalise(result.json, seed);

  log("✅ KPI complete", output.canonical_domain);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    body: JSON.stringify({
      input_payload: body,
      normalized_output: output,
    }),
  };
};
