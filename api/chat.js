// api/chat.js — Kush AI chat proxy (FULLY STANDALONE)
// Routing: pollinations (guru1-4,8,9) | gemini (guru5,6) | respan (guru7)
// Ye file kisi doosri file par depend nahi karti — mismatch hone par bhi sahi chalegi.

// ============================================================
// 📋 MODEL MAP — SINGLE SOURCE OF TRUTH (yahin routing set hai)
// ============================================================
const MODEL_MAP = {
  guru1: { apiModel: 'kimi-k3',    provider: 'pollinations', upstreamModel: '',                 premium: false }, // ALL HELP
  guru2: { apiModel: 'mistral',    provider: 'pollinations', upstreamModel: '',                 premium: false }, // SEARCH ENGINE
  guru3: { apiModel: 'llama',      provider: 'pollinations', upstreamModel: '',                 premium: false }, // READ BEST
  guru4: { apiModel: 'deepseek',   provider: 'pollinations', upstreamModel: '',                 premium: false }, // COADING
  guru5: { apiModel: 'qwen-coder', provider: 'gemini',       upstreamModel: 'gemini-3.7-flash', premium: true  }, // PROGRAMMING + SEARCH 👑
  guru6: { apiModel: 'openai',     provider: 'gemini',       upstreamModel: 'gemini-3.6-flash', premium: true  }, // FAST + SEARCH 👑
  guru7: { apiModel: 'kimi-k3',    provider: 'respan',       upstreamModel: 'perplexity/sonar', premium: true  }, // WEB SEARCH 👑
  guru8: { apiModel: 'flux',       provider: 'pollinations', upstreamModel: '',                 premium: true  }, // IMAGE GEN 👑
  guru9: { apiModel: 'turbo',      provider: 'pollinations', upstreamModel: '',                 premium: true  }  // IMAGE GEN 👑
};

const PREMIUM_IDS = ['guru5','guru6','guru7','guru8','guru9'];
const FREE_PREMIUM_DAILY = 3;   // free users: 3 msg/day total (guru5-9)
const FREE_NORMAL_DAILY = 10;   // free users: 10 msg/day per model (guru1-4)

// Fallback chains — pehla model fail ho toh automatic agla try hoga
const GEMINI_CHAIN = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
const RESPAN_CHAIN = ['perplexity/sonar', 'openai/gpt-5.6-sol', 'azure_deepseek/deepseek-chat'];

// ============================================================
// 📦 QUOTA STORE (Upstash Redis + memory fallback) — standalone
// ============================================================
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const memoryStore = new Map();

async function kvGet(key) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      const r = await fetch(`${UPSTASH_URL}/get/${key}`, { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } });
      const j = await r.json();
      return (j && j.result != null) ? JSON.parse(j.result) : null;
    } catch (e) { /* memory fallback */ }
  }
  return memoryStore.has(key) ? memoryStore.get(key) : null;
}

async function kvSet(key, value) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      await fetch(`${UPSTASH_URL}/set/${key}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(value), ex: 7776000 }) // 90 din
      });
      return;
    } catch (e) { /* memory fallback */ }
  }
  memoryStore.set(key, value);
}

function todayKey() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function getUser(userId) {
  try { return (await kvGet('u:' + userId)) || { premiumUntil: 0, days: {} }; }
  catch (e) { return { premiumUntil: 0, days: {} }; }
}

function isPremiumUser(user) {
  return !!user.premiumUntil && user.premiumUntil > Date.now();
}

async function checkQuota(userId, qid) {
  if (!userId) return { ok: true, quota: { allowed: Infinity, used: 0 } };
  const user = await getUser(userId);
  if (isPremiumUser(user)) return { ok: true, quota: { allowed: Infinity, used: 0, premium: true } };
  const day = (user.days && user.days[todayKey()]) || { premium: 0, perModel: {} };
  if (PREMIUM_IDS.indexOf(qid) !== -1) {
    return { ok: day.premium < FREE_PREMIUM_DAILY, quota: { allowed: FREE_PREMIUM_DAILY, used: day.premium || 0, premium: false } };
  }
  return { ok: (day.perModel[qid] || 0) < FREE_NORMAL_DAILY, quota: { allowed: FREE_NORMAL_DAILY, used: day.perModel[qid] || 0, premium: false } };
}

async function recordUsage(userId, qid) {
  if (!userId) return;
  const user = await getUser(userId);
  if (isPremiumUser(user)) return;
  const dayKey = todayKey();
  if (!user.days[dayKey]) user.days[dayKey] = { premium: 0, perModel: {} };
  const day = user.days[dayKey];
  if (PREMIUM_IDS.indexOf(qid) !== -1) day.premium = (day.premium || 0) + 1;
  day.perModel[qid] = (day.perModel[qid] || 0) + 1;
  const keys = Object.keys(user.days).sort();
  while (keys.length > 30) delete user.days[keys.shift()];
  await kvSet('u:' + userId, user);
}

// ============================================================
// 🔀 ROUTING HELPERS
// ============================================================
function normalizeId(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveDef(model, modelId) {
  let qid = normalizeId(modelId || model);
  let def = MODEL_MAP[qid];
  if (!def) {
    const byApi = Object.keys(MODEL_MAP).find(id => MODEL_MAP[id].apiModel === String(model || '').trim());
    if (byApi) { qid = byApi; def = MODEL_MAP[byApi]; }
  }
  if (!def) { qid = 'guru1'; def = MODEL_MAP.guru1; } // unknown -> safe default
  return { qid, def };
}

function parseBody(req) {
  try {
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    return req.body || {};
  } catch (e) { return {}; }
}

// ---------- Gemini helpers ----------
function toGeminiBody(messages, maxTokens, temperature) {
  const contents = [];
  const sys = messages.find(m => m.role === 'system');
  for (const m of messages) {
    if (m.role === 'system') continue;
    const parts = [];
    if (typeof m.content === 'string') parts.push({ text: m.content });
    else if (Array.isArray(m.content)) {
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
  body.tools = [{ google_search: {} }]; // 🌐 WEB SEARCH ON
  body.generationConfig = { maxOutputTokens: maxTokens || 4096, temperature: temperature != null ? temperature : 0.7 };
  return body;
}

function geminiToOpenAI(data) {
  const cand = data && data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  let text = parts.map(p => p.text || '').join('') || '';
  const chunks = (data && data.groundingMetadata && data.groundingMetadata.groundingChunks) || [];
  const uris = [];
  for (const c of chunks) {
    if (c && c.web && c.web.uri && uris.indexOf(c.web.uri) === -1) uris.push(c.web.uri);
  }
  if (uris.length) {
    text += '\n\n---\n**🔗 Sources (internet se):**\n' + uris.map((u, i) => (i + 1) + '. [' + u + '](' + u + ')').join('\n');
  }
  return {
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: (data && data.usageMetadata) || {}
  };
}

// ============================================================
// 🚀 MAIN HANDLER
// ============================================================
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
  headers['X-Kush-Route'] = qid + ':' + provider; // debugging ke liye
  console.log('[kush-chat] qid=' + qid + ' provider=' + provider + ' model="' + model + '" modelId="' + (modelId || '') + '"');

  const sendErr = (status, msg) => { res.writeHead(status, headers); return res.end(JSON.stringify({ error: msg })); };

  // QUOTA CHECK
  const { ok, quota } = await checkQuota(userId, qid);
  if (!ok) {
    const msg = quota.allowed === FREE_PREMIUM_DAILY
      ? 'Aaj ke Pro (GURU 5-9) messages khatam (' + quota.used + '/' + quota.allowed + '). Quiz karke Pro unlock karo! 👑'
      : 'Is model ke ' + quota.allowed + ' messages aaj khatam. Quiz karke Pro unlock karo ya doosra model try karo.';
    return sendErr(429, msg);
  }

  const messages = [
    { role: 'system', content: systemPrompt || '' },
    { role: 'user', content: userContent }
  ];

  try {
    let data = null;

    // ---------- GEMINI (GURU 5, 6) — auto-fallback ke saath ----------
    if (provider === 'gemini') {
      const gKey = process.env.GEMINI_API_KEY;
      if (!gKey) return sendErr(500, 'Server par GEMINI_API_KEY set nahi hai.');
      const chain = [];
      const first = String(def.upstreamModel || '').trim();
      if (first) chain.push(first);
      for (const m of GEMINI_CHAIN) if (chain.indexOf(m) === -1) chain.push(m);

      const tried = [];
      let lastMsg = 'Unknown error';
      let okResp = false;
      for (const gModel of chain) {
        tried.push(gModel);
        console.log('[kush-chat] gemini try: ' + gModel);
        const up = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' + gModel + ':generateContent?key=' + gKey,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toGeminiBody(messages, 4096, 0.7))
          }
        );
        const raw = await up.json().catch(() => ({}));
        if (up.ok) { data = geminiToOpenAI(raw); okResp = true; break; }
        lastMsg = (raw.error && raw.error.message) || ('Gemini HTTP ' + up.status);
        console.log('[kush-chat] gemini fail: ' + gModel + ' -> ' + up.status + ' ' + lastMsg);
        if (up.status === 401 || up.status === 403 || up.status === 429) break; // key/limit — fallback bekaar
      }
      if (!okResp) return sendErr(502, 'Gemini error: ' + lastMsg + ' (tried: ' + tried.join(', ') + ')');

    // ---------- RESPAN (GURU 7) — search model + auto-fallback ----------
    } else if (provider === 'respan') {
      const rKey = process.env.RESPAN_API_KEY;
      if (!rKey) return sendErr(500, 'Server par RESPAN_API_KEY set nahi hai.');
      const chain = [];
      const first = String(def.upstreamModel || '').trim();
      if (first) chain.push(first);
      for (const m of RESPAN_CHAIN) if (chain.indexOf(m) === -1) chain.push(m);

      let lastMsg = 'Unknown error';
      for (const rModel of chain) {
        console.log('[kush-chat] respan try: ' + rModel);
        const up = await fetch('https://api.respan.ai/api/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + rKey },
          body: JSON.stringify({ model: rModel, messages, max_tokens: 4096, temperature: 0.7 })
        });
        const d = await up.json().catch(() => ({}));
        if (up.ok) { data = d; break; }
        lastMsg = (d.error && (d.error.message || d.error)) || ('Respan HTTP ' + up.status);
        console.log('[kush-chat] respan fail: ' + rModel + ' -> ' + up.status + ' ' + lastMsg);
        if (up.status === 401 || up.status === 403) break;
      }
      if (!data) return sendErr(502, 'GURU 7 fail: ' + lastMsg);
      // Perplexity citations -> clickable sources
      if (Array.isArray(data.citations) && data.citations.length) {
        const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        data.choices[0].message.content = content + '\n\n---\n**🔗 Sources (internet se):**\n' + data.citations.map((u, i) => (i + 1) + '. [' + u + '](' + u + ')').join('\n');
      }

    // ---------- POLLINATIONS (GURU 1-4, 8, 9) ----------
    } else {
      const apiKey = process.env.POLLINATIONS_API_KEY;
      if (!apiKey) return sendErr(500, 'Server par POLLINATIONS_API_KEY set nahi hai.');
      const pModel = def.apiModel || model;
      const up = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({ model: pModel, messages, max_tokens: 4096, temperature: 0.7 })
      });
      data = await up.json().catch(() => ({}));
      if (!up.ok) {
        const msg = (data.error && (data.error.message || data.error)) || data.message || ('Upstream HTTP ' + up.status);
        return sendErr(up.status, msg);
      }
    }

    // SUCCESS par hi count karo
    await recordUsage(userId, qid);

    res.writeHead(200, headers); return res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, headers); return res.end(JSON.stringify({ error: err.message || 'Unknown server error' }));
  }
};
