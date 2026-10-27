// Fixed feed only: authenticated server requests share the Reader's global budget.
const SOURCE = 'https://telex.hu/rss';
const encoder = new TextEncoder();
const MAX_BYTES = 1024 * 1024;
const error = (status, code, retry = 60) => Response.json({error: code}, {
  status, headers: {'Cache-Control': 'no-store', 'Retry-After': String(retry)}
});
export const isRss = text => /^\s*(?:<\?xml[^>]*>\s*)?<rss\b/i.test(text)
  && /<channel\b/i.test(text) && /<\/rss>\s*$/i.test(text);

export async function handleRss(request, env, ctx) {
  if (request.method !== 'GET') return error(405, 'invalid_method');
  if (!env.TELEX_RSS_SECRET) return error(503, 'relay_unavailable');
  const time = request.headers.get('X-Flux-Time') || '';
  const signature = request.headers.get('X-Flux-Signature') || '';
  if (!/^\d{13}$/.test(time) || Math.abs(Date.now() - Number(time)) > 60000
      || !/^[a-f0-9]{64}$/.test(signature)) return error(401, 'unauthorized');
  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.TELEX_RSS_SECRET),
      {name: 'HMAC', hash: 'SHA-256'}, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key,
      Uint8Array.from(signature.match(/../g), x => parseInt(x, 16)), encoder.encode(`${time}\nrss`));
    if (!valid) return error(401, 'unauthorized');
    const cache = globalThis.caches?.default;
    const cacheKey = new Request(`${new URL(request.url).origin}/cached-rss-v1`);
    const cached = await cache?.match(cacheKey);
    if (cached) return cached;
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(SOURCE));
    const urlKey = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const budget = env.TELEX_BUDGET.getByName('global');
    const admission = await budget.admit({clientKey: urlKey, urlKey, now: Date.now()});
    if (admission.kind !== 'ok') return error(
      admission.kind === 'negative' ? 502 : 429, admission.code || admission.kind, admission.retryAfter || 60);
    let failure = 'source_unavailable';
    let upstreamStatus = null;
    try {
      const upstream = await fetch(SOURCE, {redirect: 'manual', signal: AbortSignal.timeout(5000), headers: {
        accept: 'application/rss+xml, application/xml, text/xml',
        'accept-language': 'hu-HU,hu;q=0.9,en-US;q=0.8,en;q=0.7',
        'user-agent': 'Mozilla/5.0 FluxReader/1.0'
      }});
      upstreamStatus = upstream.status;
      if (!upstream.ok) {
        failure = upstream.status === 403 ? 'source_blocked' : 'source_unavailable';
        await upstream.body?.cancel();
      } else {
        const reader = upstream.body?.getReader();
        if (!reader) throw new Error('empty_body');
        const chunks = [];
        let size = 0;
        while (true) {
          const {value, done} = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) { await reader.cancel(); failure = 'response_too_large'; break; }
          chunks.push(value);
        }
        if (size <= MAX_BYTES) {
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          const text = new TextDecoder().decode(bytes);
          if (isRss(text)) {
            const response = new Response(text, {headers: {
              'Content-Type': 'application/rss+xml; charset=utf-8',
              'Cache-Control': 'public, max-age=600', 'X-Content-Type-Options': 'nosniff'
            }});
            if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
            return response;
          }
          failure = 'invalid_content';
        }
      }
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') failure = 'source_timeout';
    }
    await budget.recordNegative({urlKey, code: failure, upstreamStatus, now: Date.now()});
    return error(502, failure);
  } catch { return error(503, 'relay_unavailable'); }
}
