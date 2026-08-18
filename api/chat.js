// api/chat.js — Vercel serverless proxy (text + vision + WEB SEARCH)
// Providers: pollinations (default) | gemini (GURU 5/6, search grounding) | respan (GURU 7, perplexity search)
const { initStore, canUse, recordUsage, modelIdFor, parseBody, MODEL_DEFS } = require('./_shared/quota');

const GEMINI_MODEL_OK = /^[a-z0-9][a-z0-9.\-]*$/; // Gemini model name check

// "guru5", "GURU 5", "guru 5", "Guru5" — sab ko "guru5" bana do
function normalizeId(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveDef(model, modelId) {
  const norm = normalizeId(model);
  const qid = modelId
    ? normalizeId(modelId)
    : (MODEL_DEFS[norm] ? norm : modelIdFor(model) || norm);
  return { qid, def: MODEL_DEFS[qid] || {} };
}

// ---------- Gemini helpers ----------
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
        if (p.type === 'text') parts.push({ text: p.text || '' });
        else if (p.type === 'image_url') {
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
  // WEB SEARCH ON — Gemini khud decide karega kab search karna hai
  body.tools = [{ google_search: {} }];
  body.generationConfig = { maxOutputTokens: maxTokens || 4096, temperature: temperature != null ? temperature : 0.7 };
  return body;
}

function geminiToOpenAI(data) {
  const cand = data && data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  let text = parts.map(p => p.text || '').join('') || '';

  // 🔗 Search sources ko answer ke neeche clickable links me jodo
  const chunks = (data && data.groundingMetadata && data.groundingMetadata.groundingChunks) || [];
  const uris = [];
  for (const c of chunks) {
    if (c && c.web && c.web.uri && uris.indexOf(c.web.uri) === -1) uris.push(c.web.uri);
  }
  if (uris.length) {
    text += '\n\n---\n**🔗 Sources (internet se):**\n' +
      uris.map((u, i) => `${i + 1}. [${u}](${u})`).join('\n');
  }

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

  const { qid, def } = resolveDef(model, modelId);
  const provider = def.provider || 'pollinations';
  const sendErr = (status, msg) => { res.writeHead(status, headers); return res.end(JSON.stringify({ error: msg })); };

  // ========== QUOTA CHECK ==========
  let store = null;
  if (userId) {
    store = initStore();
    const { ok, quota } = await canUse(store, userId, qid);
    if (!ok) {
      const msg = quota.allowed === 3
        ? 'Aaj ke Pro (GURU 5-9) messages khatam (3/3). Quiz karke Pro unlock karo! 👑'
        : 'Is model ke 10 messages aaj khatam. Quiz karke Pro unlock karo ya doosra model try karo.';
      return sendErr(429, msg);
    }
  }

  const messages = [
    { role: 'system', content: systemPrompt || '' },
    { role: 'user', content: userContent }
  ];

  try {
    let data;

    // ---------- GEMINI (GURU 5, 6) — web search ON ----------
    if (provider === 'gemini') {
      const gKey = process.env.GEMINI_API_KEY;
      if (!gKey) return sendErr(500, 'Server par GEMINI_API_KEY set nahi hai.');
      const gModel = def.upstreamModel;
      if (!gModel || !GEMINI_MODEL_OK.test(gModel)) {
        return sendErr(500, `Gemini model name galat hai: "${gModel}". quota.js me guru5/guru6 ki upstreamModel line check karo.`);
      }
      const up = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${gKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toGeminiBody(messages, 4096, 0.7))
        }
      );
      const raw = await up.json().catch(() => ({}));
      if (!up.ok) {
        const msg = (raw.error && raw.error.message) || `Gemini HTTP ${up.status}`;
        return sendErr(up.status, msg);
      }
      data = geminiToOpenAI(raw);

    // ---------- RESPAN (GURU 7) — Perplexity search ON ----------
    } else if (provider === 'respan') {
      const rKey = process.env.RESPAN_API_KEY;
      if (!rKey) return sendErr(500, 'Server par RESPAN_API_KEY set nahi hai.');
      const rModel = def.upstreamModel;
      if (!rModel) return sendErr(500, 'GURU 7 ke liye upstreamModel quota.js me nahi hai.');
      const up = await fetch('https://api.respan.ai/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rKey}` },
        body: JSON.stringify({ model: rModel, messages, max_tokens: 4096, temperature: 0.7 })
      });
      data = await up.json().catch(() => ({}));
      if (!up.ok) {
        const msg = (data.error && (data.error.message || data.error)) || `Respan HTTP ${up.status}`;
        return sendErr(up.status, msg);
      }
      // 🔗 Perplexity ke citations ko clickable sources me jodo
      if (Array.isArray(data.citations) && data.citations.length) {
        const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        data.choices[0].message.content =
          content + '\n\n---\n**🔗 Sources (internet se):**\n' +
          data.citations.map((u, i) => `${i + 1}. [${u}](${u})`).join('\n');
      }

    // ---------- POLLINATIONS (GURU 1-4, 8, 9) ----------
    } else {
      const apiKey = process.env.POLLINATIONS_API_KEY;
      if (!apiKey) return sendErr(500, 'Server par POLLINATIONS_API_KEY set nahi hai.');
      const pModel = def.apiModel || model; // sirf mapped naam bhejo
      const up = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: pModel, messages, max_tokens: 4096, temperature: 0.7 })
      });
      data = await up.json().catch(() => ({}));
      if (!up.ok) {
        const msg = (data.error && (data.error.message || data.error)) || data.message || `Upstream HTTP ${up.status}`;
        return sendErr(up.status, msg);
      }
    }

    // ========== SUCCESS par hi count ==========
    if (userId && store) await recordUsage(store, userId, qid);

    res.writeHead(200, headers); return res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, headers); return res.end(JSON.stringify({ error: err.message || 'Unknown server error' }));
  }
};
