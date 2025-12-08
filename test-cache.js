import fetch from "node-fetch";

const FUNCTION_URL = "[https://ubiqitum-kpi.netlify.app/.netlify/functions/ubiqitum-cache](https://ubiqitum-kpi.netlify.app/.netlify/functions/ubiqitum-cache)";
// Replace with your deployed Netlify function URL

const payload = {
brand_url: "[https://nike.com](https://nike.com)",       // any real brand URL
brand_name: "Nike",
market: "Global",
sector: "Sportswear",
segment: "B2C",
timeframe: "Current",
industry_definition: "Standard",
seed: 123,
consistency_window_days: 180,
stability_mode: "pinned"
};

async function testCache() {
let lastETag = null;
let lastModified = null;

for (let i = 1; i <= 2; i++) {
console.log(`\n=== Request ${i} ===`);


const res = await fetch(FUNCTION_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});

const data = await res.json();
const etag = res.headers.get("ETag");
const lastMod = res.headers.get("Last-Modified");

const cacheHit = lastETag && lastETag === etag && lastModified === lastMod;

console.log("Response:", data);
console.log("ETag:", etag);
console.log("Last-Modified:", lastMod);
console.log("CACHE HIT:", cacheHit ? "✅ Yes" : "❌ No (fresh computation)");

lastETag = etag;
lastModified = lastMod;


}
}

testCache().catch(console.error);
