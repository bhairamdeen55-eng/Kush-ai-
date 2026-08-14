// api/image.js — Image generation proxy (GURU 8 = flux, GURU 9 = turbo) with Free/Pro quota
const { initStore, canUse, recordUsage, modelIdFor, parseBody } = require('./_shared/quota');

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
  const { prompt, model, modelId, userId } = payload;
  if (!prompt) { res.writeHead(400, headers); return res.end(JSON.stringify({ error: 'prompt zaroori hai' })); }

  const apiModel = model || (modelId === 'guru9' ? 'turbo' : 'flux'); // default flux
  const qid = modelId || modelIdFor(apiModel); // guru8/guru9 -> premium pool

  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (!apiKey) {
    res.writeHead(500, headers); return res.end(JSON.stringify({ error: 'Server par POLLINATIONS_API_KEY set nahi hai.' }));
  }

  // ========== QUOTA CHECK ==========
  let store = null;
  if (userId) {
    store = initStore();
    const { ok, quota } = await canUse(store, userId, qid);
    if (!ok) {
      res.writeHead(429, headers);
      return res.end(JSON.stringify({ error: 'Image generation limit khatam (GURU 8/9 sirf Pro me unlimited). Quiz karke Pro unlock karo! 👑', quota }));
    }
  }
  // =================================

  try {
    const seed = Math.floor(Math.random() * 1000000);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`
      + `?width=1536&height=1536&seed=${seed}`
      + `&nologo=true&enhance=true`
      + `&model=${encodeURIComponent(apiModel)}`
      + `&referrer=kushai`
      + `&key=${encodeURIComponent(apiKey)}`;

    const upstream = await fetch(url);
    if (!upstream.ok) {
      res.writeHead(upstream.status, headers);
      return res.end(JSON.stringify({ error: `Image generation failed (HTTP ${upstream.status})` }));
    }

    const arrayBuffer = await upstream.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';

    // ========== SUCCESS par count ==========
    if (userId && store) await recordUsage(store, userId, qid);
    // =======================================

    res.writeHead(200, headers); return res.end(JSON.stringify({ dataUrl: `data:${contentType};base64,${base64}` }));
  } catch (err) {
    res.writeHead(500, headers); return res.end(JSON.stringify({ error: err.message || 'Unknown server error' }));
  }
};
