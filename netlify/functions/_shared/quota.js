// netlify/functions/_shared/quota.js
// Kush AI - Free/Pro quota system (server-side, Netlify Blobs)
const { connectLambda, getStore } = require('@netlify/blobs');

// 👑 PRO MODELS (GURU 5-8) — in models ko free me sirf 3 msg/day
const PREMIUM_MODELS = [
  'gpt-5.4-mini',    // GURU 5
  'gpt-5.4',         // GURU 6
  'gpt-5.6-sol',     // GURU 7
  'openai-large'     // GURU 8
];

const FREE_PREMIUM_DAILY = 3;          // Pro models: 3 msg/day (free users)
const FREE_NORMAL_PER_MODEL_DAILY = 10; // baaki models: 10 msg/day per model

// India timezone (IST, UTC+5:30) ke hisaab se "din" — subah 5:30 AM par reset
function todayKey() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

// Netlify Functions v1 me Blobs ko manually initialize karna padta hai
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
function quotaFor(user, model) {
  if (isPremium(user)) return { allowed: Infinity, used: 0, premium: true, premiumUntil: user.premiumUntil };
  const day = (user.days && user.days[todayKey()]) || { premium: 0, perModel: {} };
  if (PREMIUM_MODELS.includes(model)) {
    return { allowed: FREE_PREMIUM_DAILY, used: day.premium || 0, premium: false, premiumUntil: 0 };
  }
  return { allowed: FREE_NORMAL_PER_MODEL_DAILY, used: day.perModel[model] || 0, premium: false, premiumUntil: 0 };
}

async function canUse(store, userId, model) {
  const user = await getUser(store, userId);
  const q = quotaFor(user, model);
  return { ok: q.used < q.allowed, quota: q };
}

async function recordUsage(store, userId, model) {
  const user = await getUser(store, userId);
  if (isPremium(user)) return user; // Pro = koi count nahi
  const dayKey = todayKey();
  if (!user.days[dayKey]) user.days[dayKey] = { premium: 0, perModel: {} };
  const day = user.days[dayKey];
  if (PREMIUM_MODELS.includes(model)) day.premium = (day.premium || 0) + 1;
  day.perModel[model] = (day.perModel[model] || 0) + 1;
  // sirf 30 din ka data rakho (cleanup)
  const keys = Object.keys(user.days).sort();
  while (keys.length > 30) delete user.days[keys.shift()];
  await store.setJSON('u:' + userId, user);
  return user;
}

module.exports = { PREMIUM_MODELS, initStore, getUser, isPremium, quotaFor, canUse, recordUsage, todayKey };
