import fetch from "node-fetch";

const FUNCTION_URL = "https://ubiqitum-kpi.netlify.app/.netlify/functions/ubiqitum-cache";
// change this to your deployed Netlify URL when testing remotely

const payload = {
brand_url: "[https://example.com](https://example.com)",
brand_name: "Example Brand",
market: "Global",
sector: "Tech",
segment: "B2C",
timeframe: "Current",
industry_definition: "Standard",
seed: 123,
consistency_window_days: 180,
stability_mode: "pinned"
};

async function testCache() {
console.log("=== First request (should compute fresh) ===");
let res = await fetch(FUNCTION_URL, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(payload)
});
let data = await res.json();
console.log("Response:", data);
console.log("ETag:", res.headers.get("ETag"));
console.log("Last-Modified:", res.headers.get("Last-Modified"));

console.log("\n=== Second request (should hit cache) ===");
res = await fetch(FUNCTION_URL, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(payload)
});
data = await res.json();
console.log("Response:", data);
console.log("ETag:", res.headers.get("ETag"));
console.log("Last-Modified:", res.headers.get("Last-Modified"));
}

testCache().catch(console.error);
