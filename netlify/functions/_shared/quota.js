// netlify/functions/_shared/quota.js
// Kush AI - Free/Pro quota system (server-side, Netlify Blobs)
const { connectLambda, getStore } = require('@netlify/blobs');

// ================================================================
// 📋 MODEL MAPPING — frontend ke MODELS ke hisaab se (yahi hai source of truth)
// ================================================================
const MODEL_DEFS = {
  guru1: { apiModel: 'kimi-k3',    premium: false }, // ALL HELP
  guru2: { apiModel: 'mistral',    premium: false }, // SEARCH ENGINE
  guru3: { apiModel: 'llama',      premium: false }, // READ BEST
  guru4: { apiModel: 'deepseek',   premium: false }, // COADING
  guru5: { apiModel: 'qwen-coder', premium: true  }, // PROGRAMMING   👑
  guru6: { apiModel: 'openai',     premium: true  }, // FAST RESPONSE 👑
  guru7: { apiModel: 'kimi-k3',    premium: true  }, // IMAGE         👑
  guru8: { apiModel: 'flux',       premium: true  }, // IMAGE GEN     👑
  guru9: { apiModel: 'turbo',      premium: true  }  // IMAGE GEN     👑
};
// ⬆️ Sirf GURU 5-8 premium chahiye? Toh 'guru9' wali line me premium: false kar do.

const PREMIUM_MODEL_IDS = Object.keys(MODEL_DEFS).filter(id => MODEL_DEFS[id].premium);

const FREE_PREMIUM_DAILY = 3;            // GURU 5-9 total: 3 msg/day (free users)
const FREE_NORMAL_PER_MODEL_DAILY = 10;  // GURU 1-4: 10 msg/day per model

// apiModel (jaise 'flux') se id (jaise 'guru8') find karo
function modelIdFor(apiModel) {
  return Object.keys(MODEL_DEFS).find(id => MODEL_DEFS[id].apiModel === apiModel) || apiModel;
}
// id se apiModel nikaalo (agar frontend sirf id bheje)
function resolveApiModel(modelId) {
  return (MODEL_DEFS[modelId] && MODEL_DEFS[modelId].apiModel) || modelId;
}
function isPremiumModel(id) {
  return PREMIUM_MODEL_IDS.indexOf(id) !== -1;
}

// India timezone (IST) ke hisaab se "din" — subah 5:30 AM par reset
function todayKey() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

// Netlify Functions v1 me Blobs manually initialize karna padta hai
function initStore(event) {
  connectLambda(event);
  return getStore('kushai-data');
}

async function getUser(store, userId) {
  try {
    return (await store.get('u:' + userId, { type: 'json' })) || { premiumUntil: 0, days: {} };
  } catch (e) {
    return { premiumUntil: 0, days: {} };
  }
}

function isPremium(user) {
  return !!user.premiumUntil && user.premiumUntil > Date.now();
}

// User ki aaj ki usage info
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
  if (isPremium(user)) return user; // Pro = koi count nahi
  const dayKey = todayKey();
  if (!user.days[dayKey]) user.days[dayKey] = { premium: 0, perModel: {} };
  const day = user.days[dayKey];
  if (isPremiumModel(modelId)) day.premium = (day.premium || 0) + 1;
  day.perModel[modelId] = (day.perModel[modelId] || 0) + 1;
  // sirf 30 din ka data rakho (cleanup)
  const keys = Object.keys(user.days).sort();
  while (keys.length > 30) delete user.days[keys.shift()];
  await store.setJSON('u:' + userId, user);
  return user;
}

module.exports = {
  MODEL_DEFS, PREMIUM_MODEL_IDS, modelIdFor, resolveApiModel, isPremiumModel,
  initStore, getUser, isPremium, quotaFor, canUse, recordUsage, todayKey
};
