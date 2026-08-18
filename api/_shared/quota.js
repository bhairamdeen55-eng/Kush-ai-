// api/_shared/quota.js
// Kush AI - Free/Pro quota system (Vercel-compatible)
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const memoryStore = new Map(); // fallback (single instance memory)

async function kvGet(key) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      const r = await fetch(`${UPSTASH_URL}/get/${key}`, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
      });
      const j = await r.json();
      return (j && j.result != null) ? JSON.parse(j.result) : null;
    } catch (e) { /* fallback to memory */ }
  }
  return memoryStore.has(key) ? memoryStore.get(key) : null;
}

async function kvSet(key, value) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      await fetch(`${UPSTASH_URL}/set/${key}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(value), ex: 7776000 }) // 90 din TTL
      });
      return;
    } catch (e) { /* fallback to memory */ }
  }
  memoryStore.set(key, value);
}

function initStore() {
  return {
    async get(key, opts) { return await kvGet(key); },
    async setJSON(key, value) { await kvSet(key, value); }
  };
}

function parseBody(req) {
  try {
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    return req.body || {};
  } catch (e) { return {}; }
}

// ================================================================
// 📋 MODEL MAPPING — provider: pollinations | gemini | respan
// ⚠️ GURU 5/6 = gemini, GURU 7 = respan (yeh line mat badalna)
// ================================================================
const MODEL_DEFS = {
  guru1: { apiModel: 'kimi-k3',     provider: 'pollinations', premium: true }, // ALL HELP
  guru2: { apiModel: 'mistral',     provider: 'pollinations', premium: true }, // SEARCH ENGINE
  guru3: { apiModel: 'llama',       provider: 'pollinations', premium: true }, // READ BEST
  guru4: { apiModel: 'deepseek',    provider: 'pollinations', premium: true }, // COADING
  guru5: { apiModel: 'qwen-coder',  provider: 'gemini', upstreamModel: 'gemini-2.5-pro',   premium: true }, // PROGRAMMING + SEARCH 👑
  guru6: { apiModel: 'openai',      provider: 'gemini', upstreamModel: 'gemini-2.5-flash', premium: true }, // FAST + SEARCH     👑
  guru7: { apiModel: 'kimi-k3',     provider: 'respan', upstreamModel: 'perplexity/sonar',  premium: true }, // WEB SEARCH        👑
  guru8: { apiModel: 'flux',        provider: 'pollinations', premium: true }, // IMAGE GEN     👑
  guru9: { apiModel: 'turbo',       provider: 'pollinations', premium: true }  // IMAGE GEN     👑
};

const PREMIUM_MODEL_IDS = Object.keys(MODEL_DEFS).filter(id => MODEL_DEFS[id].premium);

const FREE_PREMIUM_DAILY = 3;            // GURU 5-9 total: 3 msg/day (free users)
const FREE_NORMAL_PER_MODEL_DAILY = 10;  // GURU 1-4: 10 msg/day per model

function modelIdFor(apiModel) {
  return Object.keys(MODEL_DEFS).find(id => MODEL_DEFS[id].apiModel === apiModel) || apiModel;
}
function resolveApiModel(modelId) {
  return (MODEL_DEFS[modelId] && MODEL_DEFS[modelId].apiModel) || modelId;
}
function isPremiumModel(id) {
  return PREMIUM_MODEL_IDS.indexOf(id) !== -1;
}

function todayKey() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function getUser(store, userId) {
  try {
    return (await store.get('u:' + userId)) || { premiumUntil: 0, days: {} };
  } catch (e) {
    return { premiumUntil: 0, days: {} };
  }
}

function isPremium(user) {
  return !!user.premiumUntil && user.premiumUntil > Date.now();
}

function quotaFor(user, modelId) {
  if (isPremium(user)) return { allowed: Infinity, used: 0, premium: true, premiumUntil: user.premiumUntil };
  const day = (user.days && user.days[todayKey()]) || { premium: 0, perModel: {} };
  if (isPremiumModel(modelId)) {
    return { allowed: FREE_PREMIUM_DAILY, used: day.premium || 0, premium: false, premiumUntil: 0 };
  }
  return { allowed: FREE_NORMAL_PER_MODEL_DAILY, used: day.perModel[modelId] || 0, premium: false, premiumUntil: 0 };
}

async function canUse(store, userId, modelId) {
  const user = await getUser(store, userId);
  const q = quotaFor(user, modelId);
  return { ok: q.used < q.allowed, quota: q };
}

async function recordUsage(store, userId, modelId) {
  const user = await getUser(store, userId);
  if (isPremium(user)) return user;
  const dayKey = todayKey();
  if (!user.days[dayKey]) user.days[dayKey] = { premium: 0, perModel: {} };
  const day = user.days[dayKey];
  if (isPremiumModel(modelId)) day.premium = (day.premium || 0) + 1;
  day.perModel[modelId] = (day.perModel[modelId] || 0) + 1;
  const keys = Object.keys(user.days).sort();
  while (keys.length > 30) delete user.days[keys.shift()];
  await store.setJSON('u:' + userId, user);
  return user;
}

module.exports = {
  MODEL_DEFS, PREMIUM_MODEL_IDS, modelIdFor, resolveApiModel, isPremiumModel,
  initStore, parseBody, getUser, isPremium, quotaFor, canUse, recordUsage, todayKey
};
