const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'; // George
const MODEL_ID = 'eleven_flash_v2_5';
const MAX_TEXT_LENGTH = 450;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 80;
const requestsByIp = new Map();

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!isSameOriginRequest(req)) return sendJson(res, 403, { error: 'forbidden' });
  if (!withinRateLimit(clientIp(req))) return sendJson(res, 429, { error: 'rate_limited' });

  const text = cleanText(requestBody(req).text);
  if (!text || text.length > MAX_TEXT_LENGTH) return sendJson(res, 400, { error: 'invalid_text' });
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return sendJson(res, 503, { error: 'tts_not_configured' });

  try {
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_22050_32`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: MODEL_ID, language_code: 'hu' })
    });
    if (!upstream.ok) return sendJson(res, upstream.status === 429 ? 429 : 502, { error: 'tts_upstream_error' });
    const audio = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(audio.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(audio);
  } catch(e) {
    sendJson(res, 502, { error: 'tts_unavailable' });
  }
};

function requestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); } catch { return {}; }
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isSameOriginRequest(req) {
  const host = firstHeader(req.headers?.['x-forwarded-host']) || req.headers?.host || '';
  const source = req.headers?.origin || req.headers?.referer || '';
  if (!host || !source) return false;
  try { return new URL(source).host === host; } catch { return false; }
}

function clientIp(req) {
  return firstHeader(req.headers?.['x-forwarded-for']) || req.socket?.remoteAddress || 'unknown';
}

function withinRateLimit(ip) {
  const now = Date.now();
  const recent = (requestsByIp.get(ip) || []).filter(time => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  requestsByIp.set(ip, recent);
  if (requestsByIp.size > 500) {
    for (const [key, times] of requestsByIp) {
      if (!times.some(time => now - time < RATE_WINDOW_MS)) requestsByIp.delete(key);
    }
  }
  return true;
}

function firstHeader(value) {
  return String(value || '').split(',')[0].trim();
}

function sendJson(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(status).json(body);
}
