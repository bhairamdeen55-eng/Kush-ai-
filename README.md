# Kush AI 🤖

24×7 Smart Study Assistant — Hindi/Hinglish AI chatbot, deployed by **Bhairamdeen Kushwaha**, powered by **TEAMVB**.

Static frontend + Netlify Functions backend, so your Pollinations API key stays fully hidden from the browser.

---

## 📁 Project Structure

```
kushai-app/
├── index.html                     ← Frontend app (UI, chat logic, no keys inside)
├── netlify.toml                   ← Netlify build/redirect config
├── package.json
├── .gitignore
├── kushai.apk                     ← ⚠️ YOU add this (Android app, root folder)
├── assets/
│   └── ai.jpg                     ← ⚠️ YOU add this (app logo)
└── netlify/
    └── functions/
        ├── chat.js                ← Secure server-side proxy: text + vision chat
        └── image.js               ← Secure server-side proxy: image generation
```

## 🔑 Why the key is safe now

In the original single-file version, `CFG.apiKey` sat directly inside the HTML — anyone
could open dev tools / view-source and steal it. Now:

- `index.html` calls `/.netlify/functions/chat` and `/.netlify/functions/image` — **plain URLs, no key attached**.
- Those two functions run on Netlify's server, read `POLLINATIONS_API_KEY` from an
  **environment variable**, call Pollinations with it, and return only the result.
- The key never appears in any response sent to the browser, in page source, or in network tab request URLs.

## 🚀 Deploy Steps

### 1. Push to GitHub
```bash
cd kushai-app
git init
git add .
git commit -m "Kush AI - initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

### 2. Connect to Netlify
1. [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**
2. Pick your GitHub repo
3. Build settings: leave as-is (`netlify.toml` already handles it — no build command needed, publish dir `.`)
4. Deploy

### 3. Add your API key as an Environment Variable
Netlify Dashboard → your site → **Site configuration → Environment variables → Add a variable**

| Key | Value |
|---|---|
| `POLLINATIONS_API_KEY` | your real `sk_...` key from enter.pollinations.ai |

Then **Deploys → Trigger deploy → Clear cache and deploy site** (so functions pick up the new env var).

### 4. Add your assets
- Put your logo at `assets/ai.jpg`
- Put your built Android app at project root as `kushai.apk`
- Commit + push again (or drag-and-drop redeploy on Netlify)

### 5. Test
- Open your Netlify URL, send a chat message → confirms `chat.js` works
- Switch model to GURU 8/9 (image models), generate an image → confirms `image.js` works
- Open sidebar → tap **"App Install Karein (APK)"** → confirms the APK downloads

## 📱 Install App (APK) feature

A green **"App Install Karein (APK)"** button sits in the sidebar (`#sbInstallApp`). It's a
plain `<a download>` link pointing at `kushai.apk` in the site root, so tapping it downloads
the APK straight to the user's phone. A toast reminds them to enable "Install unknown apps"
in Android settings before installing.

## ✅ Features preserved
Everything from the original build is intact — multi-chat sessions with sidebar history,
search/rename/delete chats, incognito mode, light/dark theme, 9 model personas (text +
2 image-gen models), response-length effects (Fast/Balanced/Deep), photo upload with
vision or OCR fallback, PDF upload + text extraction, voice input, text-to-speech,
markdown + code rendering with copy buttons, auto shayari generation, source citation
chips, image generation with download/share/like/dislike, splash boot screen, and the
"stop generating" button. Only the API-key handling and the sidebar Install App option changed.

## 🛠 Local testing (optional)
```bash
npm install -g netlify-cli
netlify dev
```
This runs the functions locally too, so you can test end-to-end before deploying
(set `POLLINATIONS_API_KEY` in a local `.env` file — already gitignored).
