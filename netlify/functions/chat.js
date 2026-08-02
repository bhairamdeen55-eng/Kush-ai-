// netlify/functions/chat.js
//
// Secure proxy for text + vision chat completions.
// The real Pollinations API key NEVER goes to the browser — it is read
// here from a Netlify environment variable (server-side only).
//
// Set this in Netlify: Site settings → Environment variables
//   POLLINATIONS_API_KEY = sk_xxxxxxxxxxxxxxxxxxxx

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { model, systemPrompt, userContent } = payload;

  if (!model || !userContent) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'model aur userContent zaroori hain' }) };
  }

  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server par POLLINATIONS_API_KEY set nahi hai. Netlify → Site settings → Environment variables me isse add karein.' })
    };
  }

  try {
    const upstream = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt || '' },
          { role: 'user', content: userContent }
        ],
        max_tokens: 4096,
        temperature: 0.7
      })
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const msg = data.error?.message || data.error || data.message || `Upstream HTTP ${upstream.status}`;
      return { statusCode: upstream.status, headers, body: JSON.stringify({ error: msg }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Unknown server error' }) };
  }
};
