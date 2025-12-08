import type { Handler } from "@netlify/functions";
import crypto from "crypto";

// ---- Interfaces ----
interface Overrides {
brand_name?: string;
market?: string;
sector?: string;
segment?: string;
timeframe?: string;
industry_definition?: string;
allow_model_inference?: boolean;
}

interface CachedMeta {
sk: string;
last_refreshed_at: string;
consistency_window_days?: number;
}

interface CachedPayload {
payload: Record<string, any>;
meta: CachedMeta;
}

interface CacheRequest {
brand_url: string;
seed?: number;
stability_mode?: "pinned" | "live";
consistency_window_days?: number;
overrides?: Overrides;
cached?: CachedPayload;
provided_metrics?: Record<string, any>;
}

// ---- Helpers ----

// Rule 1: Canonicalise domain
function canonicalizeDomain(url: string): string {
try {
const host = new URL(url).host.toLowerCase();
return host.startsWith("[www](http://www).") ? host.slice(4) : host;
} catch {
return url.toLowerCase();
}
}

// Rule 2: Build Stability Key (SK)
function computeSK(
canonical_domain: string,
brand_name: string,
market: string,
sector: string,
segment: string,
timeframe: string,
industry_definition: string | null,
seed: number
): string {
const input = [
canonical_domain,
brand_name.toLowerCase(),
market.toLowerCase(),
sector.toLowerCase(),
segment.toLowerCase(),
timeframe,
industry_definition?.toLowerCase() ?? "",
seed.toString(),
"V3.5.14"
].join("|");
return crypto.createHash("sha256").update(input).digest("hex");
}

// ---- Serverless Function ----
export const handler: Handler = async (event) => {
if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };

const body: CacheRequest = JSON.parse(event.body || "{}");
const now = new Date();
const seed = body.seed ?? 0;
const stability_mode = body.stability_mode || "pinned";
const consistency_window_days = body.consistency_window_days ?? 180;

// Rule 1: Resolve overrides or infer heuristics
const canonical_domain = canonicalizeDomain(body.brand_url);
const overrides = body.overrides || {};
const brand_name = overrides.brand_name || canonical_domain.split(".")[0];
const market = overrides.market || "Global";
const sector = overrides.sector || "General";
const segment = overrides.segment || "B2C";
const timeframe = overrides.timeframe || "Current";
const industry_definition = overrides.industry_definition || null;
const allow_model_inference = overrides.allow_model_inference ?? true;

// Rule 2: Compute SK
const sk = computeSK(
canonical_domain,
brand_name,
market,
sector,
segment,
timeframe,
industry_definition,
seed
);

// Rule 3: Decide whether to serve cached payload
let serveCache = false;
if (stability_mode === "pinned" && body.cached?.meta) {
const last = new Date(body.cached.meta.last_refreshed_at);
const windowDays = body.cached.meta.consistency_window_days ?? consistency_window_days;
const ageDays = (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24);


// Rule 4: Simplified material change check
// You could expand this to check provided_metrics % changes, counts, or timeframe/market/sector changes
const noMaterialChange = body.cached.meta.sk === sk;

if (ageDays <= windowDays && noMaterialChange) {
  serveCache = true;
}


}

// Rule 3 output: Serve cache if valid
if (serveCache) {
return {
statusCode: 200,
body: JSON.stringify({
action: "serve_cache",
sk,
payload: body.cached!.payload
})
};
}

// Rule 4 output: Recompute payload via KPI Engine
const kpi_request = {
brand_url: body.brand_url,
seed,
stability_mode,
consistency_window_days,
evidence_history: [], // can be populated from previous cache/evidence
brand_name,
market,
sector,
segment,
timeframe,
industry_definition,
allow_model_inference
};

return {
statusCode: 200,
body: JSON.stringify({
action: "recompute",
sk,
kpi_request
})
};
};
