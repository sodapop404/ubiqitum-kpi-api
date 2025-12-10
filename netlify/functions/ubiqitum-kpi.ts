import { Handler } from "@netlify/functions";

// =====================================================
// UBIQITUM KPI — FULL DEBUG + FULL SYSTEM PROMPT
// =====================================================

const SYSTEM_PROMPT = `
You are an AI model that analyses a brand’s homepage HTML and extracts KPI metrics.
Your task is to read the website content and produce BRAND INSIGHTS ONLY from what is explicitly present.

Always return VALID JSON matching EXACTLY this schema:

{
  "brand_name": string | null,
  "canonical_domain": string | null,
  "ubiqitum_market": string | null,
  "ubiqitum_sector": string | null,
  "brand_relevance_percent": number | null,
  "sector_relevance_avg_percent": number | null,
  "brand_awareness_percent": number | null,
  "sector_awareness_avg_percent": number | null,
  "brand_consideration_percent": number | null,
  "brand_trust_percent": number | null,
  "ubiqitum_overallagainastallcompany_score": number | null
}

CRITICAL RULES:

- Do NOT hallucinate numbers, brand categories, or sectors.
- If the data cannot be determined from the HTML, return null.
- The percentages should be ESTIMATES but must remain internally consistent:
    • relevance ≈ how aligned this brand appears with its stated market
    • awareness ≈ how clear + strong the homepage communicates who they are
    • consideration ≈ how convincing or compelling the homepage is
    • trust ≈ credibility based on content, tone, proof points
    • sector numbers are simple approximations based on typical benchmarks
- The "overall_against_allcompany_score" is a simple average of the other brand KPIs.
- All values must be numbers 0–100 (integers or decimals).
- If uncertain at ANY stage → return null instead of guessing.
- Output JSON ONLY, with no explanation, no commentary, and no text outside the JSON.

Your role is to be strict: if the homepage does not provide enough signal to infer a metric, set it to null.
`;

export const handler: Handler = async (event) => {
  try {
    console.log("🔵 FUNCTION STARTED — /ubiqitum-kpi");

    // --------------------------------------------------
    // 1. DEBUG ENVIRONMENT VARIABLES
    // --------------------------------------------------
    console.log("🔧 DEBUG ENV:", {
      MODEL_BASE_URL: process.env.MODEL_BASE_URL,
      MODEL_API_KEY: process.env.MODEL_API_KEY ? "[OK]" : "[MISSING]",
      MODEL_NAME: process.env.MODEL_NAME,
    });

    if (!process.env.MODEL_BASE_URL || !process.env.MODEL_API_KEY || !process.env.MODEL_NAME) {
      console.error("❌ Missing environment variables");
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing environment variables" }),
      };
    }

    // --------------------------------------------------
    // 2. Parse incoming request
    // --------------------------------------------------
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (err) {
      console.error("❌ Invalid JSON body", err);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid JSON body" }),
      };
    }

    const { url, html } = body;

    console.log("🌐 Request received for URL:", url);

    if (!url || !html) {
      console.error("❌ Missing input fields (url, html)");
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields: url, html" }),
      };
    }

    // --------------------------------------------------
    // 3. Compose model payload
    // --------------------------------------------------
    const payload = {
      model: process.env.MODEL_NAME,
      input: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `
Extract KPI metrics from the following website homepage.

URL: ${url}

HTML content below:
${html}
          `.trim(),
        },
      ],
    };

    console.log("📤 SENDING PAYLOAD TO LLM...");

    // --------------------------------------------------
    // 4. Perform model request
    // --------------------------------------------------
    const response = await fetch(process.env.MODEL_BASE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.MODEL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    console.log("📥 MODEL RESPONSE STATUS:", response.status);

    const raw = await response.text();
    console.log("📥 RAW MODEL RESPONSE:", raw);

    // --------------------------------------------------
    // 5. Parse JSON safely
    // --------------------------------------------------
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("❌ Failed to parse LLM JSON:", err);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Model returned invalid JSON",
          raw,
        }),
      };
    }

    console.log("✅ FINAL PARSED JSON:", parsed);

    return {
      statusCode: 200,
      body: JSON.stringify(parsed),
    };

  } catch (err: any) {
    console.error("❌ FUNCTION CRASHED:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
