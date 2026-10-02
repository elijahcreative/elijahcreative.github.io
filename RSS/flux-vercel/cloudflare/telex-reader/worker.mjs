const encoder = new TextEncoder();
const MAX_BYTES = 2 * 1024 * 1024;
const fail = (status) => new Response('Unavailable', { status, headers: { 'Cache-Control': 'no-store' } });

export default {
  async fetch(request, env, ctx) {
    try {
      const endpoint = new URL(request.url);
      if (request.method !== 'GET' || endpoint.pathname !== '/article') return fail(404);
      if (!env.TELEX_RELAY_SECRET || !env.RATE_LIMITER) return fail(503);
      const raw = endpoint.searchParams.get('url') || '';
      let target;
      try { target = new URL(raw); } catch { return fail(400); }
      if (target.protocol !== 'https:' || !['telex.hu', 'www.telex.hu'].includes(target.hostname)
        || target.port || target.username || target.password
        || !/^\/[a-z0-9/-]+\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?$/.test(target.pathname)
        || target.search || target.hash) return fail(400);
      const timestamp = request.headers.get('X-Flux-Time') || '';
      const signature = request.headers.get('X-Flux-Signature') || '';
      if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60000
        || !/^[a-f0-9]{64}$/.test(signature)) return fail(401);
      const key = await crypto.subtle.importKey('raw', encoder.encode(env.TELEX_RELAY_SECRET),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
      const bytes = Uint8Array.from(signature.match(/../g), hex => parseInt(hex, 16));
      if (!await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`${timestamp}\n${target.href}`))) return fail(401);
      // One shared key limits all authorised Flux calls at this Cloudflare location.
      if (!(await env.RATE_LIMITER.limit({ key: 'flux-telex' })).success) return fail(429);
      const cacheKey = new Request(`${endpoint.origin}/cached-article?url=${encodeURIComponent(target.href)}`);
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      const upstream = await fetch(target.href, {
        redirect: 'manual', signal: AbortSignal.timeout(6000),
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0 FluxReader/1.0' }
      });
      if (!upstream.ok || !upstream.headers.get('content-type')?.includes('text/html') || !upstream.body) {
        console.error(JSON.stringify({ reason: 'upstream_rejected', status: upstream.status, contentType: upstream.headers.get('content-type') }));
        return fail(502);
      }
      const reader = upstream.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); return fail(502); }
        chunks.push(value);
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      const response = new Response(body, { headers: {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
      } });
      ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
      return response;
    } catch (error) {
      console.error(JSON.stringify({ reason: 'relay_failed', name: error?.name }));
      return fail(502);
    }
  }
};
