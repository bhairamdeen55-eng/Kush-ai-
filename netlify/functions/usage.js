// netlify/functions/usage.js
// Frontend ko current quota/premium status deta hai (display ke liye)
const { initStore, getUser, isPremium, todayKey } = require('./_shared/quota');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  if (body.action !== 'check') return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown action' }) };
  const { userId } = body;
  if (!userId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'userId required' }) };

  const store = initStore(event);
  const user = await getUser(store, userId);
  const premium = isPremium(user);
  const day = (user.days && user.days[todayKey()]) || { premium: 0 };

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      premium,
      premiumUntil: user.premiumUntil || 0,
      premiumUsedToday: premium ? 0 : (day.premium || 0),
      remainingPremiumToday: premium ? -1 : Math.max(0, 3 - (day.premium || 0)),
      day: todayKey()
    })
  };
};
