// api/chat.js — Vercel serverless proxy for text + vision chat
// Multi-provider: Pollinations (default) + Gemini (GURU 5/6) + Respan (GURU 7)
const { initStore, canUse, recordUsage, resolveApiModel, modelIdFor, parseBody, MODEL_DEFS } = require('./_shared/quota');

// ---------- Gemini helpers (native REST <-> OpenAI format) ----------
function toGeminiBody(messages, maxTokens, temperature) {
  const contents = [];
  const sys = messages.find(m => m.role === 'system');

  for (const m of messages) {
    if (m.role === 'system') continue;
    const parts = [];
    if (typeof m.content === 'string') {
      parts.push({ text: m.content });
    } else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (!p) continue;
        if (p.type === 'text') {
          parts.push({ text: p.text || '' });
        } else if (p.type === 'image_url') {
          const m2 = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec((p.image_url && p.image_url.url) || '');
          if (m2) parts.push({ inline_data: { mime_type: m2[1], data: m2[2] } });
          else if (p.image_url && p.image_url.url) parts.push({ text: p.image_url.url });
        }
      }
    }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }

  const body = { contents };
  if (sys) body.systemInstruction = { parts: [{ text: typeof sys.content === 'string' ? sys.content : JSON.stringify(sys.content) }] };
  body.generationConfig = { maxOutputTokens: maxTokens || 4096, temperature: temperature != null ? temperature : 0.7 };
  return body;
}

function geminiToOpenAI(data) {
  const parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const text = parts.map(p => p.text || '').join('') || '';
  return {
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: (data && data.usageMetadata) || {}
  };
}

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

  const apiModel = model || resolveApiModel(modelId);
  const qid = modelId || modelIdFor(apiModel);
  const def = MODEL_DEFS[qid] || {};
  const provider = def.provider || 'pollinations';

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

  const messages = [
    { role: 'system', content: systemPrompt || '' },
    { role: 'user', content: userContent }
  ];

  const sendErr = (status, msg) => {
    res.writeHead(status, headers); return res.end(JSON.stringify({ error: msg }));
  };

  try {
    let upstream, data;

    // ---------- GEMINI (GURU 5, 6) ----------
    if (provider === 'gemini') {
      const gKey = process.env.GEMINI_API_KEY;
      if (!gKey) return sendErr(500, 'Server par GEMINI_API_KEY set nahi hai.');
      const gModel = def.upstreamModel || apiModel;
      upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${gKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toGeminiBody(messages, 4096, 0.7))
        }
      );
      const raw = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        const msg = (raw.error && raw.error.message) || `Gemini HTTP ${upstream.status}`;
        return sendErr(upstream.status, msg);
      }
      data = geminiToOpenAI(raw);

    // ---------- RESPAN (GURU 7) ----------
    } else if (provider === 'respan') {
      const rKey = process.env.RESPAN_API_KEY;
      if (!rKey) return sendErr(500, 'Server par RESPAN_API_KEY set nahi hai.');
      const rModel = def.upstreamModel || apiModel;
      upstream = await fetch('https://api.respan.ai/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rKey}` },
        body: JSON.stringify({ model: rModel, messages, max_tokens: 4096, temperature: 0.7 })
      });
      data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        const msg = (data.error && (data.error.message || data.error)) || `Respan HTTP ${upstream.status}`;
        return sendErr(upstream.status, msg);
      }

    // ---------- POLLINATIONS (GURU 1-4, 8, 9 — default) ----------
    } else {
      const apiKey = process.env.POLLINATIONS_API_KEY;
      if (!apiKey) return sendErr(500, 'Server par POLLINATIONS_API_KEY set nahi hai.');
      upstream = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: apiModel,
          messages,
          max_tokens: 4096,
          temperature: 0.7
        })
      });
      data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        const msg = (data.error && (data.error.message || data.error)) || data.message || `Upstream HTTP ${upstream.status}`;
        return sendErr(upstream.status, msg);
      }
    }

    // ========== SUCCESS par hi count karo ==========
    if (userId && store) await recordUsage(store, userId, qid);
    // ===============================================

    res.writeHead(200, headers); return res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, headers); return res.end(JSON.stringify({ error: err.message || 'Unknown server error' }));
  }
};
