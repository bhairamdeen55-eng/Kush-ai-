// netlify/functions/image.js
// Image generation proxy with Free/Pro quota (10 image gen/day/model, Pro = unlimited)
const { initStore, canUse, recordUsage } = require('./_shared/quota');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { prompt, model, userId } = payload;
  if (!prompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt zaroori hai' }) };

  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server par POLLINATIONS_API_KEY set nahi hai.' }) };
  }

  const modelId = model || 'flux';

  // ========== QUOTA CHECK ==========
  let store = null;
  if (userId) {
    store = initStore(event);
    const { ok, quota } = await canUse(store, userId, modelId);
    if (!ok) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: `Image generation limit khatam (10/day per model). Quiz karke Pro unlock karo! 👑`, quota })
      };
    }
  }
  // =================================

  try {
    const seed = Math.floor(Math.random() * 1000000);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`
      + `?width=1536&height=1536&seed=${seed}`
      + `&nologo=true&enhance=true`
      + `&model=${encodeURIComponent(modelId)}`
      + `&referrer=kushai`
      + `&key=${encodeURIComponent(apiKey)}`;

    const upstream = await fetch(url);
    if (!upstream.ok) {
      return { statusCode: upstream.status, headers, body: JSON.stringify({ error: `Image generation failed (HTTP ${upstream.status})` }) };
    }

    const arrayBuffer = await upstream.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';

    // ========== SUCCESS par count ==========
    if (userId && store) await recordUsage(store, userId, modelId);
    // =======================================

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ dataUrl: `data:${contentType};base64,${base64}` })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Unknown server error' }) };
  }
};
