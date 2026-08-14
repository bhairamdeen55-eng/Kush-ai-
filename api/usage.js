// api/usage.js — Frontend ko current quota/premium status deta hai (display ke liye)
const { initStore, getUser, isPremium, todayKey, parseBody } = require('./_shared/quota');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, CORS); return res.end(JSON.stringify({ error: 'Method Not Allowed' })); }

  const body = parseBody(req);
  if (body.action !== 'check') { res.writeHead(400, CORS); return res.end(JSON.stringify({ error: 'Unknown action' })); }
  const { userId } = body;
  if (!userId) { res.writeHead(400, CORS); return res.end(JSON.stringify({ error: 'userId required' })); }

  const store = initStore();
  const user = await getUser(store, userId);
  const premium = isPremium(user);
  const day = (user.days && user.days[todayKey()]) || { premium: 0 };

  res.writeHead(200, CORS);
  return res.end(JSON.stringify({
    premium,
    premiumUntil: user.premiumUntil || 0,
    premiumUsedToday: premium ? 0 : (day.premium || 0),
    remainingPremiumToday: premium ? -1 : Math.max(0, 3 - (day.premium || 0)),
    day: todayKey()
  }));
};
