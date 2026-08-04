// netlify/functions/chat.js
// Secure proxy for text + vision chat completions (with Free/Pro quota)
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

  const { model, systemPrompt, userContent, userId } = payload;
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

  // ========== QUOTA CHECK (server-side) ==========
  let store = null;
  if (userId) {
    store = initStore(event);
    const { ok, quota } = await canUse(store, userId, model);
    if (!ok) {
      const msg = quota.allowed === 3
        ? 'Aaj ke Pro (GURU 5-8) messages khatam (3/3). Quiz karke Pro unlock karo! 👑'
        : 'Is model ke 10 messages aaj khatam. Quiz karke Pro unlock karo ya doosra model try karo.';
      return { statusCode: 429, headers, body: JSON.stringify({ error: msg, quota }) };
    }
  }
  // ===============================================

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

    // ========== SUCCESS par hi count karo ==========
    if (userId && store) await recordUsage(store, userId, model);
    // ===============================================

    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Unknown server error' }) };
  }
};
