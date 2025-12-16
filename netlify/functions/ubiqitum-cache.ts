// netlify/functions/ubiqitum-cache.ts
import type { Handler } from "@netlify/functions";
import crypto from "crypto";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// --------------------------------------------------
// Logging (Netlify-safe)
// --------------------------------------------------
function log(...args: any[]) {
  console.log(...args);
  process.stdout.write("");
}

// --------------------------------------------------
// Helpers
// --------------------------------------------------
function canonicalDomain(u: string) {
  u = u.trim().toLowerCase().replace(/^https?:\/\//, "");
  const h = u.split(/[\/?#]/, 1)[0];
  return h.startsWith("www.") ? h.slice(4) : h;
}

function sha256(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function buildSK(args: any) {
  const parts = [
    canonicalDomain(args.brand_url),
    (args.brand_name || "").toLowerCase(),
    (args.market || "global").toLowerCase(),
    (args.sector || "").toLowerCase(),
    (args.segment || "b2c").toLowerCase(),
    (args.timeframe || "current").toLowerCase(),
    (args.industry_definition || "").toLowerCase(),
    args.seed ?? "",
    "V3.5.14"
  ];
  return sha256(parts.join("|"));
}

// --------------------------------------------------
// KPI validation (CORRECT TARGET)
// --------------------------------------------------
function isValidKpiPayload(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;

  const fields = [
    "brand_relevance_percent",
    "brand_awareness_percent",
    "sector_relevance_avg_percent",
    "sector_awareness_avg_percent"
  ];

  return fields.filter((k) => {
    const v = payload[k];
    return Number.isFinite(typeof v === "number" ? v : Number(v));
  }).length >= 3;
}

function normaliseKpiPayload(payload: any) {
  const out = { ...payload };
  Object.keys(out).forEach((k) => {
    if (typeof out[k] === "string" && !isNaN(Number(out[k]))) {
      out[k] = Number(out[k]);
    }
  });
  return out;
}

// --------------------------------------------------
// Handler
// --------------------------------------------------
export const handler: Handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "https://ubiqitum-freemium.webflow.io",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  log("🔥 ubiqitum-cache invoked", event.httpMethod, event.body);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS };
  }

  if (event.httpMethod !== "POST") {
    return { stat
