import { Handler } from "@netlify/functions";
import { Redis } from "@upstash/redis";
import crypto from "crypto";

// Initialize Upstash Redis
const redis = Redis.fromEnv(); // Make sure UPSTASH_REDIS_REST_URL and _TOKEN are set

// Helper functions
function canonicalDomain(url: string) {
url = url.trim().toLowerCase().replace(/^https?:///, "");
const host = url.split(/[/?#]/, 1)[0];
return host.startsWith("[www](http://www).") ? host.slice(4) : host;
}

function sha256(input: string) {
return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

// Build Stability Key
function buildStabilityKey(params: Record<string, any>) {
const parts = [
canonicalDomain(params.brand_url || ""),
(params.brand_name || "").toLowerCase(),
(params.market || "Global").toLowerCase(),
(params.sector || "").toLowerCase(),
(params.segment || "B2C").toLowerCase(),
(params.timeframe || "Current").toLowerCase(),
(params.industry_definition || "").toLowerCase(),
params.seed != null ? String(params.seed) : "",
"V3.5.14"
];
return sha256(parts.join("|"));
}

// Main handler
export const handler: Handler = async (event) => {
if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };

let body;
try {
body = JSON.parse(event.body || "{}");
} catch {
return { statusCode: 400, body: "Invalid JSON" };
}

const { brand_url } = body;
if (!brand_url) return { statusCode: 400, body: "brand_url required" };

const sk = buildStabilityKey(body);
const windowDays = Number(body.consistency_window_days || 180);
const mode = body.stability_mode || "pinned";

const key = `ubiqitum:sk:${sk}`;
const nowIso = new Date().toISOString();

// --- Try cache ---
try {
const cached = await redis.get<{ payload: any; meta: any }>(key);
if (cached && mode === "pinned") {
const last = new Date(cached.meta.last_refreshed_at || nowIso);
const ageDays = (Date.now() - last.getTime()) / 86400000;
if (ageDays <= (cached.meta.consistency_window_days || windowDays)) {
// Cache hit
return {
statusCode: 200,
headers: { "Content-Type": "application/json", "ETag": sk, "Last-Modified": cached.meta.last_refreshed_at },
body: JSON.stringify(cached.payload)
};
}
}
} catch (err) {
console.error("Redis GET failed:", err);
}

// --- Compute KPI ---
let payload;
try {
const { computeKpi } = await import("./ubiqitum-kpi-core");
payload = await computeKpi(body);
} catch (err) {
console.error("KPI computation failed:", err);
return { statusCode: 500, body: "KPI computation failed" };
}

// --- Set cache ---
try {
await redis.set(key, {
payload,
meta: { sk, model_version: "V3.5.14", last_refreshed_at: nowIso, consistency_window_days: windowDays }
});
} catch (err) {
console.error("Redis SET failed:", err);
}

return {
statusCode: 200,
headers: { "Content-Type": "application/json", "ETag": sk, "Last-Modified": nowIso },
body: JSON.stringify(payload)
};
};
