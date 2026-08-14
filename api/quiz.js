// api/quiz.js — Pro Unlock Quiz: 12 sawaal, 10 sahi = 30 din Premium (Vercel version)
const { initStore, getUser, isPremium, parseBody } = require('./_shared/quota');

// ================== QUIZ DATA (sirf yahan edit karo) ==================
const QUESTIONS = [
  { q: 'Kush AI ka main kaam kya hai?', options: ['Movie streaming', '24×7 Study Assistant', 'Gaming platform', 'Shopping app'], ans: 1 },
  { q: 'Kush AI kis platform par deploy hai?', options: ['GitHub Pages', 'Vercel', 'Netlify', 'Heroku'], ans: 2 },
  { q: 'GURU 6 ka provider kya hai?', options: ['SEARCH ENGINE', 'PROGRAMMING', 'FAST RESPONSE', 'IMAGE GEN'], ans: 2 },
  { q: 'GURU 8 kis kaam ke liye hai?', options: ['Coading', 'Search engine', 'IMAGE GEN', 'Reading'], ans: 2 },
  { q: 'GURU 5 (PROGRAMMING) ka apiModel kaunsa hai?', options: ['kimi-k3', 'qwen-coder', 'mistral', 'deepseek'], ans: 1 },
  { q: 'Photo upload karne par app kya karta hai?', options: ['Delete kar deta hai', 'Sirf save karta hai', 'Vision/OCR se padhkar jawab deta hai', 'Filter lagata hai'], ans: 2 },
  { q: 'PDF upload karne par kya hota hai?', options: ['Text extract hokar padha jaata hai', 'File corrupt ho jaati hai', 'Sirf preview milta hai', 'Kuch nahi hota'], ans: 0 },
  { q: 'Incognito Mode on karne par kya hota hai?', options: ['Chat history save hoti hai', 'Chat history save nahi hoti', 'Speed double hoti hai', 'Theme dark ho jaata hai'], ans: 1 },
  { q: 'App me kitne themes available hain?', options: ['Sirf 1 (dark)', 'Sirf 1 (light)', '2 (dark + light)', '5 rainbow themes'], ans: 2 },
  { q: 'Har jawab ke end me kya milta hai?', options: ['Advertisement', 'Nayi shayari ✨', 'Song link', 'Game coupon'], ans: 1 },
  { q: 'GURU 1 ka icon kaunsa hai?', options: ['⚡', '🔍', '💎', '🎨'], ans: 0 },
  { q: 'GURU 9 kis kaam ke liye hai?', options: ['Coading', 'IMAGE GEN', 'Search', 'Study'], ans: 1 }
];

const PASS_SCORE = 10;                    // 12 me se 10 sahi chahiye
const PREMIUM_DURATION_MS = 15 * 864e5;   // ⏰ 30 din ka premium
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const publicQuestions = () => QUESTIONS.map((item, i) => ({ id: i, q: item.q, options: item.options }));

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  // ---------- GET: quiz data (answers BINA) ----------
  if (req.method === 'GET') {
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ questions: publicQuestions(), total: QUESTIONS.length, passScore: PASS_SCORE }));
  }

  // ---------- POST: submit + server-side check ----------
  if (req.method === 'POST') {
    const body = parseBody(req);
    const { userId, answers } = body;
    if (!userId) { res.writeHead(400, CORS); return res.end(JSON.stringify({ error: 'userId required' })); }
    if (!Array.isArray(answers) || answers.length !== QUESTIONS.length) {
      res.writeHead(400, CORS); return res.end(JSON.stringify({ error: 'Saare sawaal ke jawab bhejo' }));
    }

    const store = initStore();
    const user = await getUser(store, userId);

    // Pehle se premium hai?
    if (isPremium(user)) {
      res.writeHead(200, CORS);
      return res.end(JSON.stringify({ passed: true, alreadyPremium: true, premium: true, premiumUntil: user.premiumUntil }));
    }

    // Server-side scoring — frontend par bharosa nahi
    let score = 0;
    answers.forEach((a, i) => { if (QUESTIONS[i] && a === QUESTIONS[i].ans) score++; });
    const passed = score >= PASS_SCORE;

    user.quizAttempts = (user.quizAttempts || 0) + 1;
    user.lastQuizScore = score;
    if (passed) {
      user.premiumUntil = Date.now() + PREMIUM_DURATION_MS;   // ⏰ 30 din
      user.lastQuizPassAt = Date.now();
    }
    await store.setJSON('u:' + userId, user);

    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ passed, score, total: QUESTIONS.length, premium: passed, premiumUntil: user.premiumUntil || 0 }));
  }

  res.writeHead(405, CORS); return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
};
