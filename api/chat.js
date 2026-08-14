// api/chat.js — Vercel serverless proxy for text + vision chat (Free/Pro quota ke saath)
const { initStore, canUse, recordUsage, resolveApiModel, modelIdFor, parseBody } = require('./_shared/quota');

module.exports = async (req, res) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (req.method === 'OPTIONS') { res.writeHead(204, headers); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, headers); return res.end(JSON.stringify({ error: 'Method Not Allowed' })); }

  const payload = parseBody(req);
  const { model, modelId, systemPrompt, userContent, userId } = payload;
  if (!model || !userContent) {
    res.writeHead(400, headers); return res.end(JSON.stringify({ error: 'model aur userContent zaroori hain' }));
  }

  const apiModel = model || resolveApiModel(modelId); // apiModel = asli Pollinations model
  const qid = modelId || modelIdFor(apiModel);        // qid = quota key (guru5...)

  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (!apiKey) {
    res.writeHead(500, headers); return res.end(JSON.stringify({ error: 'Server par POLLINATIONS_API_KEY set nahi hai.' }));
  }

  // ========== QUOTA CHECK (server-side) ==========
  let store = null;
  if (userId) {
    store = initStore();
    const { ok, quota } = await canUse(store, userId, qid);
    if (!ok) {
      const msg = quota.allowed === 3
        ? 'Aaj ke Pro (GURU 5-9) messages khatam (3/3). Quiz karke Pro unlock karo! 👑'
        : 'Is model ke 10 messages aaj khatam. Quiz karke Pro unlock karo ya doosra model try karo.';
      res.writeHead(429, headers); return res.end(JSON.stringify({ error: msg, quota }));
    }
  }
  // ===============================================

  try {
    const upstream = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: apiModel,
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
      res.writeHead(upstream.status, headers); return res.end(JSON.stringify({ error: msg }));
    }

    // ========== SUCCESS par hi count karo ==========
    if (userId && store) await recordUsage(store, userId, qid);
    // ===============================================

    res.writeHead(200, headers); return res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, headers); return res.end(JSON.stringify({ error: err.message || 'Unknown server error' }));
  }
};
