export async function handler(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "https://ubiqitum-freemium.webflow.io",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const brandUrl = body.brand_url?.trim();

    if (!brandUrl) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing brand_url" })
      };
    }

    const MASTER_PROMPT = `[Your Full Master Prompt Here]`;

    // NEW ROUTER URL
    const ROUTER_URL = "https://router.huggingface.co/models/meta-llama/Llama-3.1-8B-Instruct";

    const hfResponse = await fetch(ROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        // The Router prefers the 'messages' format over 'inputs' string
        messages: [
          { role: "system", content: MASTER_PROMPT },
          { role: "user", content: `brand_url: "${brandUrl}"` }
        ],
        parameters: { 
          max_new_tokens: 800, 
          temperature: 0.1,
          return_full_text: false 
        }
      })
    });

    const result = await hfResponse.json();

    // The Router response structure: result.choices[0].message.content
    if (result.error) {
       return { statusCode: 500, headers, body: JSON.stringify(result) };
    }

    let aiText = result.choices[0].message.content.trim();
    const cleanJson = aiText.replace(/```json|```/g, "").trim();

    return {
      statusCode: 200,
      headers: headers,
      body: cleanJson
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
