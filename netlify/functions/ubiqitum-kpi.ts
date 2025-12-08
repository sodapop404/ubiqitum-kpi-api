import { Handler } from "@netlify/functions";
import { computeKpi } from "./ubiqitum-kpi-core";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };

  const body = JSON.parse(event.body || "{}");
  if (!body.brand_url) return { statusCode: 400, body: "brand_url required" };

  const payload = await computeKpi(body);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
};
