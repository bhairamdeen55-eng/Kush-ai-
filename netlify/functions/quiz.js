// netlify/functions/quiz.js
// Pro Unlock Quiz — 12 sawaal, 10 sahi = 30 din Premium
const { initStore, getUser, isPremium } = require('./_shared/quota');

// ================== QUIZ DATA (sirf yahan edit karo) ==================
const QUESTIONS = [
  { q: 'Kush AI ka main kaam kya hai?', options: ['Movie streaming', '24×7 Study Assistant', 'Gaming platform', 'Shopping app'], ans: 1 },
  { q: 'Kush AI kis platform par deploy hai?', options: ['GitHub Pages', 'Vercel', 'Netlify', 'Heroku'], ans: 2 },
  { q: 'GURU 5 model ka ID kaunsa hai?', options: ['gpt-5.4-mini', 'openai', 'gpt-oss', 'openai-fast'], ans: 2 },
  { q: 'GURU 8 (sabse powerful) model ka ID kaunsa hai?', options: ['guru1', 'guru6', 'openai-fast', 'gpt-5.4'], ans: 1 },
  { q: 'Kush AI ke har jawab ke end me kya milta hai?', options: ['Advertisement', 'Nayi shayari ✨', 'Song link', 'Game coupon'], ans: 1 },
  { q: 'Photo upload karne par app kya karta hai?', options: ['Delete kar deta hai', 'Sirf save karta hai', 'Vision/OCR se padhkar jawab deta hai', 'Filter lagata hai'], ans: 2 },
  { q: 'PDF upload karne par kya hota hai?', options: ['Text extract hokar padha jaata hai', 'File corrupt ho jaati hai', 'Sirf preview milta hai', 'Kuch nahi hota'], ans: 2 },
  { q: 'Incognito Mode on karne par kya hota hai?', options: ['Chat history save hoti hai', 'Chat history save nahi hoti', 'Speed double hoti hai', 'Theme dark ho jaata hai'], ans: 1 },
  { q: 'App me kitne themes available hain?', options: ['Sirf 1 (dark)', 'Sirf 1 (light)', '2 (dark + light)', '5 rainbow themes'], ans: 2 },
  { q: 'Science: H₂O kya hai?', options: ['Oxygen', 'Pani', 'Salt', 'Sugar'], ans: 1 },
  { q: 'Maths: √144 (144 ka vargmul) kya hai?', options: ['10', '11', '12', '14'], ans: 2 },
  { q: 'GK: Kis planet ko "Red Planet" kaha jaata hai?', options: ['Venus', 'Jupiter', 'Mars', 'Saturn'], ans: 2 }
];

const PASS_SCORE = 10;                    // 12 me se 10 sahi chahiye
const PREMIUM_DURATION_MS = 30 * 864e5;   // ⏰ 30 din ka premium
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const publicQuestions = () => QUESTIONS.map((item, i) => ({ id: i, q: item.q, options: item.options }));

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // ---------- GET: quiz data (answers BINA) ----------
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ questions: publicQuestions(), total: QUESTIONS.length, passScore: PASS_SCORE })
    };
  }

  // ---------- POST: submit + server-side check ----------
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const { userId, answers } = body;
    if (!userId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'userId required' }) };
    if (!Array.isArray(answers) || answers.length !== QUESTIONS.length) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Saare sawaal ke jawab bhejo' }) };
    }

    const store = initStore(event);
    const user = await getUser(store, userId);

    // Pehle se premium hai?
    if (isPremium(user)) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ passed: true, alreadyPremium: true, premium: true, premiumUntil: user.premiumUntil }) };
    }

    // Server-side scoring — kabhi bhi frontend par bharosa nahi
    let score = 0;
    answers.forEach((a, i) => { if (QUESTIONS[i] && a === QUESTIONS[i].ans) score++; });
    const passed = score >= PASS_SCORE;

    user.quizAttempts = (user.quizAttempts || 0) + 1;

    if (passed) {
      user.premiumUntil = Date.now() + PREMIUM_DURATION_MS;   // ⏰ 30 din
      user.lastQuizPassAt = Date.now();
      user.lastQuizScore = score;
      await store.setJSON('u:' + userId, user);
    } else {
      user.lastQuizScore = score;
      await store.setJSON('u:' + userId, user);
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ passed, score, total: QUESTIONS.length, premium: passed, premiumUntil: user.premiumUntil || 0 })
    };
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
};
