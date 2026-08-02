// netlify/functions/image.js
//
// Secure proxy for image generation. The Pollinations image endpoint
// needs the API key as a query param — we attach it here, server-side,
// so the key is never visible in the browser or in any URL the client
// sees. We fetch the image ourselves and hand the browser back a
// base64 data URL instead of a key-bearing link.
//
// Uses the SAME env var as chat.js:
//   POLLINATIONS_API_KEY = sk_xxxxxxxxxxxxxxxxxxxx

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { prompt, model } = payload;
  if (!prompt) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt zaroori hai' }) };
  }

  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server par POLLINATIONS_API_KEY set nahi hai. Netlify → Site settings → Environment variables me isse add karein.' })
    };
  }

  try {
    const seed = Math.floor(Math.random() * 1000000);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`
      + `?width=1536&height=1536&seed=${seed}`
      + `&nologo=true&enhance=true`
      + `&model=${encodeURIComponent(model || 'flux')}`
      + `&referrer=kushai`
      + `&key=${encodeURIComponent(apiKey)}`;

    const upstream = await fetch(url);
    if (!upstream.ok) {
      return { statusCode: upstream.status, headers, body: JSON.stringify({ error: `Image generation failed (HTTP ${upstream.status})` }) };
    }

    const arrayBuffer = await upstream.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ dataUrl: `data:${contentType};base64,${base64}` })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Unknown server error' }) };
  }
};
