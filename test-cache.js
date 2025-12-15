import fetch from "node-fetch";

const FUNCTION_URL =
  "https://ubiqitum-kpi.netlify.app/.netlify/functions/ubiqitum-cache";

const payload = {
  brand_url: "https://nike.com",
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

async function testFunction() {
  console.log("🚀 Starting test");
  console.log("➡️  URL:", FUNCTION_URL);
  console.log("➡️  Payload:", JSON.stringify(payload, null, 2));

  let res;

  try {
    res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("❌ Network / fetch error:", err);
    return;
  }

  console.log("\n=== RESPONSE METADATA ===");
  console.log("Status:", res.status, res.statusText);
  console.log("Headers:");
  for (const [key, value] of res.headers.entries()) {
    console.log(`  ${key}: ${value}`);
  }

  let rawText;
  try {
    rawText = await res.text();
  } catch (err) {
    console.error("❌ Failed reading response body:", err);
    return;
  }

  console.log("\n=== RAW RESPONSE BODY ===");
  console.log(rawText);

  // Try JSON parsing separately so we can see failures
  try {
    const json = JSON.parse(rawText);
    console.log("\n=== PARSED JSON ===");
    console.dir(json, { depth: null });
  } catch (err) {
    console.warn("\n⚠️ Response is NOT valid JSON");
    console.warn(err.message);
  }

  console.log("\n✅ Test complete");
}

testFunction().catch(err => {
  console.error("🔥 Unhandled test error:", err);
});
