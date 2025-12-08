import { handler as kpiHandler } from "./ubiqitum-kpi"; // adjust path if needed
import { createRequest, createResponse } from "node-mocks-http";

async function testKPI() {
const req = createRequest({
method: "POST",
body: {
brand_url: "[https://example.com](https://example.com)",
seed: 42,
stability_mode: "live",
overrides: {
brand_name: "ExampleBrand",
market: "Global",
sector: "Retail",
segment: "B2C",
timeframe: "Current"
},
provided_metrics: {
brand_awareness_percent: 60,
brand_trust_percent: 75,
brand_consideration_percent: 55
}
}
});

const res = createResponse();

await kpiHandler(req as any, res as any);

console.log("KPI Engine Output:");
console.log(JSON.parse(res._getData()));
}

testKPI();
