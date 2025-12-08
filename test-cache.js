import fetch from "node-fetch";

const FUNCTION_URL = "https://ubiqitum-kpi.netlify.app/.netlify/functions/ubiqitum-cache";

const payload = {
  brand_url: "https://nike.com",       // <-- plain URL string
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
  for (let i = 1; i <= 2; i++) {
    console.log(`\n=== Request ${i} ===`);
    try {
      const res = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        console.error("HTTP error:", res.status, await res.text());
        continue;
      }

      const data = await res.json();

      const lastModified = res.headers.get("Last-Modified");
      const etag = res.headers.get("ETag");

      const isCacheHit = i === 2 && etag === lastModified ? true : false;

      console.log("Response:", data);
      console.log("ETag:", etag);
      console.log("Last-Modified:", lastModified);
      console.log("CACHE HIT:", isCacheHit ? "✅ Yes" : "❌ No (fresh computation)");
    } catch (err) {
      console.error("Fetch error:", err);
    }
  }
}

testCache();
