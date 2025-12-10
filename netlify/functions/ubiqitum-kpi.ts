Test Ubiqitum KPI Function
Brand URL: 
https://www.cat.com


Run KPI Test
Response:
{
  "input_payload": {
    "brand_url": "https://www.cat.com"
  },
  "ai_raw_response": {
    "id": "gen-1765340051-b7tsl8sACpLKlTKgEf8Y",
    "provider": "AtlasCloud",
    "model": "openai/gpt-oss-20b:free",
    "object": "chat.completion",
    "created": 1765340051,
    "choices": [
      {
        "logprobs": null,
        "finish_reason": "length",
        "native_finish_reason": "length",
        "index": 0,
        "message": {
          "role": "assistant",
          "content": "",
          "refusal": null,
          "reasoning": "We need to compute the eleven fields for brand_url https://www.cat.com. We have no overrides. So we need to infer brand_name, market, sector, etc. We need to compute metrics: brand_relevance_percent, sector_relevance_avg_percent, brand_awareness_percent, sector_awareness_avg_percent, brand_consideration_percent, brand_trust_percent, overall score.\n\nWe have no evidence_history. We need to use model inference. We need to compute deterministic SK and session_seed. But we don't have seed. So we compute SK from canonical_domain, brand_name, market, sector, segment, timeframe, industry_definition, seed, version. We need to infer brand_name: from domain root: cat.com -> \"Cat\". Title-case: \"Cat\". canonical_domain: lower-case host, strip scheme/path/query/fragment, drop leading www. So host is www.cat.com -> drop www -> cat.com. So canonical_domain = \"cat.com\".\n\nubiqitum_market: from ccTLD -> .com -> \"Global\" (since .com is global). So market = \"Global\".\n\nubiqitum_sector: infer from About/Services/meta. We need to guess sector for CAT. Cat.com is the website for Caterpillar Inc., a heavy equipment manufacturer. Sector: \"Heavy Machinery\" or \"Construction Equipment\". We need concise consumer-facing label. Maybe \"Construction Equipment\". Let's pick \"Construction Equipment\". Title-case: \"Construction Equipment\".\n\nSegment: default B2C unless agency/enterprise cues. Caterpillar sells to businesses, so B2B. So segment = \"B2B\".\n\nTimeframe: \"Current\".\n\nIndustry_definition: not provided.\n\nseed: not provided.\n\nNow we need to compute",
          "reasoning_details": [
            {
              "format": "unknown",
              "index": 0,
              "type": "reasoning.text",
              "text": "We need to compute the eleven fields for brand_url https://www.cat.com. We have no overrides. So we need to infer brand_name, market, sector, etc. We need to compute metrics: brand_relevance_percent, sector_relevance_avg_percent, brand_awareness_percent, sector_awareness_avg_percent, brand_consideration_percent, brand_trust_percent, overall score.\n\nWe have no evidence_history. We need to use model inference. We need to compute deterministic SK and session_seed. But we don't have seed. So we compute SK from canonical_domain, brand_name, market, sector, segment, timeframe, industry_definition, seed, version. We need to infer brand_name: from domain root: cat.com -> \"Cat\". Title-case: \"Cat\". canonical_domain: lower-case host, strip scheme/path/query/fragment, drop leading www. So host is www.cat.com -> drop www -> cat.com. So canonical_domain = \"cat.com\".\n\nubiqitum_market: from ccTLD -> .com -> \"Global\" (since .com is global). So market = \"Global\".\n\nubiqitum_sector: infer from About/Services/meta. We need to guess sector for CAT. Cat.com is the website for Caterpillar Inc., a heavy equipment manufacturer. Sector: \"Heavy Machinery\" or \"Construction Equipment\". We need concise consumer-facing label. Maybe \"Construction Equipment\". Let's pick \"Construction Equipment\". Title-case: \"Construction Equipment\".\n\nSegment: default B2C unless agency/enterprise cues. Caterpillar sells to businesses, so B2B. So segment = \"B2B\".\n\nTimeframe: \"Current\".\n\nIndustry_definition: not provided.\n\nseed: not provided.\n\nNow we need to compute"
            }
          ]
        }
      }
    ],
    "usage": {
      "prompt_tokens": 1726,
      "completion_tokens": 350,
      "total_tokens": 2076,
      "cost": 0,
      "is_byok": false,
      "prompt_tokens_details": {
        "cached_tokens": 0,
        "audio_tokens": 0,
        "video_tokens": 0
      },
      "cost_details": {
        "upstream_inference_cost": null,
        "upstream_inference_prompt_cost": 0,
        "upstream_inference_completions_cost": 0
      },
      "completion_tokens_details": {
        "reasoning_tokens": 397,
        "image_tokens": 0
      }
    }
  },
  "ai_message_content": null
}
