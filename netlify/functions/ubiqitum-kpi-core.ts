// netlify/functions/ubiqitum-kpi-core.ts
import crypto from "crypto";

/**
 * MASTER SYSTEM PROMPT — Ubiqitum V3 (V5.14) KPI Engine
 *
 * Stable • Deterministic • URL-First • Eleven-Field Strict JSON (KPIs + Meta)
 *
 * ROLE
 * You are the Ubiqitum scoring engine (Version 3, V5.14 semantics).
 * Your ONLY task: compute and return KPIs based on input JSON.
 *
 * REQUIREMENTS
 * 1. Accept input JSON with keys: brand_url, brand_name, market, sector, segment, timeframe, industry_definition, seed.
 * 2. Always return exactly eleven fields of KPIs + meta, in JSON.
 * 3. Use deterministic computation: same input → same output.
 * 4. Include meta data: model_version, timestamp, source.
 * 5. Validate all URLs and canonicalize domains.
 * 6. Include error handling for missing fields.
 * 7. Never return any text outside the strict JSON.
 * 8. Respond quickly — do not simulate delays.
 * 9. Do not perform any side-effects outside cache writes (i.e., no network calls).
 * 10. Always return timestamps in ISO format (UTC).
 * 11. Keep versioning consistent: "V3.5.14".
 *
 * OUTPUT FORMAT (JSON)
 * {
 *   "kpi_1": number,
 *   "kpi_2": number,
 *   "kpi_3": number,
 *   "kpi_4": number,
 *   "kpi_5": number,
 *   "kpi_6": number,
 *   "kpi_7": number,
 *   "kpi_8": number,
 *   "kpi_9": number,
 *   "kpi_10": number,
 *   "kpi_11": number,
 *   "meta": {
 *       "model_version": "V3.5.14",
 *       "computed_at": "ISO timestamp",
 *       "source": "ubiqitum-kpi-core"
 *   }
 * }
 */

// Helper functions
export function canonicalDomain(u: string) {
  u = u.trim().toLowerCase().replace(/^https?:\/\//, "");
  const h = u.split(/[\/?#]/, 1)[0];
  return h.startsWith("www.") ? h.slice(4) : h;
}

export function sha256(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

// Build Stability Key
export function buildSK(args: {
  brand_url: string;
  brand_name?: string;
  market?: string;
  sector?: string;
  segment?: string;
  timeframe?: string;
  industry_definition?: string;
  seed?: number;
}) {
  const canon = canonicalDomain(args.brand_url);
  const parts = [
    canon,
    (args.brand_name || "").toLowerCase(),
    (args.market || "Global").toLowerCase(),
    (args.sector || "").toLowerCase(),
    (args.segment || "B2C").toLowerCase(),
    (args.timeframe || "Current").toLowerCase(),
    (args.industry_definition || "").toLowerCase(),
    args.seed == null ? "" : String(args.seed),
    "V3.5.14",
  ];
  return sha256(parts.join("|"));
}

// Core KPI computation
export async function computeKpi(body: any) {
  // deterministic mock example — replace with real logic
  const base = body.seed ?? 42;
  const now = new Date().toISOString();
  return {
    kpi_1: base * 1,
    kpi_2: base * 2,
    kpi_3: base * 3,
    kpi_4: base * 4,
    kpi_5: base * 5,
    kpi_6: base * 6,
    kpi_7: base * 7,
    kpi_8: base * 8,
    kpi_9: base * 9,
    kpi_10: base * 10,
    kpi_11: base * 11,
    meta: {
      model_version: "V3.5.14",
      computed_at: now,
      source: "ubiqitum-kpi-core",
    },
  };
}
