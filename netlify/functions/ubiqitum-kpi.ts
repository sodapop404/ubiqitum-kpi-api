import type { Handler } from "@netlify/functions";

// ====================================================================
// CONFIGURATION AND CONSTANTS
// ====================================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// --------------------------------------------------
// HELPERS
// --------------------------------------------------
function normaliseInputUrl(raw: string) {
  if (!raw || typeof raw !== "string") return "";
  raw = raw.trim();

  // Add https:// if no scheme
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;

  try {
    const u = new URL(raw);

    // Lowercase host; leave path/query as-is
    u.hostname = u.hostname.toLowerCase();
    return u.href;
  } catch {
    return "";
  }
}

// Required output keys
const REQUIRED_KEYS = [
  "brand_name","canonical_domain","ubiqitum_market","ubiqitum_sector",
  "brand_relevance_percent","sector_relevance_avg_percent",
  "brand_awareness_percent","sector_awareness_avg_percent",
  "brand_consideration_percent","brand_trust_percent",
  "ubiqitum_overallagainastallcompany_score"
] as const;

// Deterministic normalization
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

// --------------------------------------------------
// FULL SYSTEM PROMPT
// --------------------------------------------------
const SYSTEM_PROMPT = `MASTER SYSTEM PROMPT — Ubiqitum V3 (V5.14) KPI Engine
... (rest of your SYSTEM_PROMPT here) ...
`;

// =============================================================================
// MAIN NETLIFY FUNCTION
// =============================================================================
export const handler: Handler = async (event) => {

  // Handle OPTIONS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  // Enforce POST
  if (event.httpMethod !== "POST") {
    return { 
      statusCode: 405, 
      headers: CORS_HEADERS,
      body: "POST only" 
    };
  }

  // Parse body
  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { 
      statusCode: 400, 
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid JSON input" }) 
    };
  }

  // -----------------------------
  // Normalize brand_url immediately
  // -----------------------------
  body.brand_url = normaliseInputUrl(body.brand_url);
  if (!body.brand_url) {
    return { 
      statusCode: 400, 
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid or missing brand_url" }) 
    };
  }

  // Compose messages
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(body) }
  ];

  // Fetch model
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

    if (!resp.ok) {
        rawText = await resp.text();
        console.error("LLM API Status Error:", resp.status, rawText);
        throw new Error(`LLM API failed with status ${resp.status}`);
    }
    
    rawText = await resp.text();
    console.log("RAW LLM RESPONSE:", rawText);
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Model request failed", detail: String(err), raw_llm_response: rawText })
    };
  }

  // Parse model JSON safely
  let llmJson: any = {};
  try {
      const data = JSON.parse(rawText);
      let jsonString = data.choices?.[0]?.message?.content || "{}";
      jsonString = jsonString.trim();
      if (jsonString.startsWith('```json')) jsonString = jsonString.substring(7);
      if (jsonString.endsWith('```')) jsonString = jsonString.substring(0, jsonString.length - 3);
      llmJson = JSON.parse(jsonString);
  } catch (err) {
    console.warn("Final LLM JSON Parsing failed:", err);
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Could not parse final JSON from model output", detail: String(err), raw_llm_response: rawText })
    };
  }

  const seed = Number.isInteger(body.seed) ? body.seed : 0;
  const out = normalise(llmJson, seed);

  // Success response with raw LLM response included
  return {
    statusCode: 200,
    headers: { 
      "Content-Type": "application/json",
      ...CORS_HEADERS
    },
    body: JSON.stringify({
      input_payload: body,
      ai_raw_response: rawText,
      normalized_output: out
    }, null, 2)
  };
};
