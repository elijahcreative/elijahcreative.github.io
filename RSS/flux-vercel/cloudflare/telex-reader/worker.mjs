const encoder = new TextEncoder();
const MAX_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 6000;
const SIGNATURE_HEADERS = ['signature', 'signature-input', 'signature-agent'];
const CHALLENGE_TTL_SECONDS = 120;

function errorResponse(status, code, requestId, options = {}) {
  const retryAfter = Number.isInteger(options.retryAfter) && options.retryAfter >= 0
    ? options.retryAfter
    : 0;
  const payload = {
    error: code,
    code,
    ...(Number.isInteger(options.upstreamStatus) ? { upstreamStatus: options.upstreamStatus } : {}),
    retryAfter,
    requestId,
    directFallbackAllowed: options.directFallbackAllowed === true
  };
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  if (retryAfter > 0) headers['Retry-After'] = String(retryAfter);
  return new Response(JSON.stringify(payload), { status, headers });
}

function logFailure(requestId, code, details = {}) {
  console.warn(JSON.stringify({
    event: 'telex_reader_failure',
    requestId,
    code,
    ...(Number.isInteger(details.upstreamStatus) ? { upstreamStatus: details.upstreamStatus } : {}),
    ...(details.stage ? { stage: details.stage } : {})
  }));
}

function cacheKeyFor(origin, targetUrl) {
  return new Request(`${origin}/cached-article?url=${encodeURIComponent(targetUrl)}`);
}

async function digestHex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function hasHtmlContentType(response) {
  return response.headers.get('content-type')?.toLowerCase().includes('text/html') === true;
}

function isHtmlDocument(html) {
  return typeof html === 'string'
    && html.trim().length > 0
    && /<(?:!doctype\s+html|html)\b/i.test(html);
}

function isUsefulTelexHtml(html, pathname) {
  if (!isHtmlDocument(html)) return false;
  if (/<[a-z][^>]*\bclass\s*=\s*["'][^"']*\barticle-html-content\b[^"']*["'][^>]*>/i.test(html)) {
    return true;
  }
  if (!pathname.startsWith('/video/')) return false;
  const normalized = html.replace(/\\u002f/gi, '/').replace(/\\\//g, '/');
  return /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?[^"'\\s<>]+|youtu\.be\/[A-Za-z0-9_-]{6,15})/i.test(normalized);
}

export function isChallengeHtml(html) {
  if (typeof html !== 'string') return false;
  const title = (/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '')
    .replace(/<[^>]*>/g, '')
    .trim();
  return /^(?:just a moment|attention required|security verification|security check|checking your browser|verify (?:that )?you (?:are|['’]re) human)/i.test(title)
    && /(?:cf-chl-|\/cdn-cgi\/challenge-platform|performing security verification|verify (?:that )?you are human|checking your browser)/i.test(html);
}

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return 30;
  const seconds = /^\d+$/.test(value.trim())
    ? Number(value.trim())
    : Math.ceil((Date.parse(value) - now) / 1000);
  if (!Number.isFinite(seconds)) return 30;
  return Math.min(86400, Math.max(5, seconds));
}

async function readLimitedBody(response) {
  if (!response.body) return { bytes: new Uint8Array(0), tooLarge: false };
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return { bytes: null, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, tooLarge: false };
}

async function safeCancel(response) {
  try { await response.body?.cancel(); } catch {}
}

async function readCacheHit(cache, cacheKey, targetPath) {
  let cached;
  try {
    cached = await cache.match(cacheKey);
  } catch {
    return { kind: 'miss' };
  }
  if (!cached) return { kind: 'miss' };

  let invalidKind = 'invalid';
  if (cached.status === 200 && hasHtmlContentType(cached)) {
    try {
      const body = await readLimitedBody(cached.clone());
      if (!body.tooLarge) {
        const html = new TextDecoder().decode(body.bytes);
        if (isChallengeHtml(html)) invalidKind = 'challenge';
        else if (isUsefulTelexHtml(html, targetPath)) return { kind: 'hit', response: cached };
      }
    } catch {
      // A stale cached response is treated as a miss if its body cannot be read.
    }
  }

  try { await cache.delete(cacheKey); } catch {}
  return { kind: invalidKind };
}

function budgetStub(env) {
  if (!env.TELEX_BUDGET || typeof env.TELEX_BUDGET.getByName !== 'function') {
    throw new Error('Budget binding unavailable');
  }
  return env.TELEX_BUDGET.getByName('global');
}

function statusForCode(code) {
  switch (code) {
    case 'source_blocked':
    case 'source_challenge': return 403;
    case 'source_rate_limited':
    case 'reader_rate_limited':
    case 'reader_daily_limit': return 429;
    case 'source_timeout': return 504;
    case 'source_unavailable':
    case 'response_too_large':
    case 'redirect_blocked': return 502;
    case 'invalid_content': return 422;
    case 'relay_unavailable':
    case 'guard_unavailable': return 503;
    case 'relay_unauthorized': return 401;
    default: return 400;
  }
}

async function rememberFailure(budget, details, requestId, { allowFallback = false, clientKey = 'anonymous' } = {}) {
  let reservation = null;
  if (allowFallback) {
    try {
      reservation = await budget.reserveFallback({ clientKey, now: Date.now() });
    } catch {
      logFailure(requestId, 'guard_unavailable', { stage: 'fallback_reservation' });
      return errorResponse(503, 'guard_unavailable', requestId, { retryAfter: 30 });
    }
  }

  try {
    await budget.recordNegative({ ...details, now: Date.now() });
  } catch {
    logFailure(requestId, 'guard_unavailable', { stage: 'negative_cache_write' });
    return errorResponse(503, 'guard_unavailable', requestId, { retryAfter: 30 });
  }

  if (reservation && reservation.allowed !== true) {
    const code = reservation.kind === 'reader_daily_limit' ? 'reader_daily_limit' : 'reader_rate_limited';
    logFailure(requestId, code, {
      upstreamStatus: details.upstreamStatus,
      stage: 'fallback_reservation_denied'
    });
    return errorResponse(statusForCode(code), code, requestId, {
      upstreamStatus: details.upstreamStatus,
      retryAfter: reservation.retryAfter
    });
  }

  const directFallbackAllowed = reservation?.allowed === true;
  logFailure(requestId, details.code, { upstreamStatus: details.upstreamStatus, stage: 'upstream' });
  return errorResponse(statusForCode(details.code), details.code, requestId, {
    upstreamStatus: details.upstreamStatus,
    retryAfter: details.retryAfter,
    directFallbackAllowed
  });
}

function cachePositive(cache, cacheKey, response, ctx) {
  if (!cache || typeof ctx?.waitUntil !== 'function') return;
  try {
    ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
  } catch {}
}

async function handleUpstream(target, upstreamHeaders, budget, clientKey, urlKey, requestId, cache, cacheKey, ctx) {
  const directFallbackEligible = !upstreamHeaders['signature-agent'];
  let upstream;
  try {
    upstream = await fetch(target.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: upstreamHeaders
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const code = timedOut ? 'source_timeout' : 'source_unavailable';
    return rememberFailure(budget, {
      urlKey,
      code,
      upstreamStatus: null,
      retryAfter: timedOut ? 5 : 30
    }, requestId, { allowFallback: directFallbackEligible, clientKey });
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    await safeCancel(upstream);
    return rememberFailure(budget, {
      urlKey, code: 'redirect_blocked', upstreamStatus: upstream.status, retryAfter: 30
    }, requestId);
  }

  if (upstream.status === 403) {
    let challenge = false;
    if (hasHtmlContentType(upstream)) {
      try {
        const body = await readLimitedBody(upstream.clone());
        if (!body.tooLarge) challenge = isChallengeHtml(new TextDecoder().decode(body.bytes));
      } catch {}
    }
    await safeCancel(upstream);
    return rememberFailure(budget, {
      urlKey,
      code: challenge ? 'source_challenge' : 'source_blocked',
      upstreamStatus: upstream.status,
      retryAfter: CHALLENGE_TTL_SECONDS
    }, requestId);
  }

  if (upstream.status === 429) {
    const retryAfter = parseRetryAfter(upstream.headers.get('retry-after'));
    await safeCancel(upstream);
    return rememberFailure(budget, {
      urlKey, code: 'source_rate_limited', upstreamStatus: upstream.status, retryAfter
    }, requestId);
  }

  if (upstream.status >= 500) {
    await safeCancel(upstream);
    return rememberFailure(budget, {
      urlKey, code: 'source_unavailable', upstreamStatus: upstream.status, retryAfter: 30
    }, requestId, { allowFallback: directFallbackEligible, clientKey });
  }

  if (!upstream.ok || !hasHtmlContentType(upstream) || !upstream.body) {
    await safeCancel(upstream);
    return rememberFailure(budget, {
      urlKey, code: 'invalid_content', upstreamStatus: upstream.status, retryAfter: 30
    }, requestId);
  }

  let body;
  try {
    body = await readLimitedBody(upstream);
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const code = timedOut ? 'source_timeout' : 'source_unavailable';
    return rememberFailure(budget, {
      urlKey, code, upstreamStatus: upstream.status, retryAfter: timedOut ? 5 : 30
    }, requestId, { allowFallback: directFallbackEligible, clientKey });
  }

  if (body.tooLarge) {
    return rememberFailure(budget, {
      urlKey, code: 'response_too_large', upstreamStatus: upstream.status, retryAfter: 30
    }, requestId);
  }

  const html = new TextDecoder().decode(body.bytes);
  if (isChallengeHtml(html)) {
    return rememberFailure(budget, {
      urlKey,
      code: 'source_challenge',
      upstreamStatus: upstream.status,
      retryAfter: CHALLENGE_TTL_SECONDS
    }, requestId);
  }
  if (!isUsefulTelexHtml(html, target.pathname)) {
    return rememberFailure(budget, {
      urlKey, code: 'invalid_content', upstreamStatus: upstream.status, retryAfter: 30
    }, requestId);
  }

  const response = new Response(body.bytes, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
  } });
  cachePositive(cache, cacheKey, response, ctx);
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    try {
      const endpoint = new URL(request.url);
      if (request.method !== 'GET' || endpoint.pathname !== '/article') {
        return errorResponse(404, 'invalid_request', requestId);
      }
      if (!env.TELEX_RELAY_SECRET) {
        return errorResponse(503, 'relay_unavailable', requestId, { retryAfter: 30 });
      }

      const raw = endpoint.searchParams.get('url') || '';
      let target;
      try { target = new URL(raw); } catch {
        return errorResponse(400, 'invalid_request', requestId);
      }
      if (target.protocol !== 'https:' || !['telex.hu', 'www.telex.hu'].includes(target.hostname)
        || target.port || target.username || target.password
        || !/^\/[a-z0-9/-]+\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?$/.test(target.pathname)
        || target.search || target.hash) {
        return errorResponse(400, 'invalid_request', requestId);
      }

      const supplied = SIGNATURE_HEADERS.filter(name => request.headers.has(name));
      if (supplied.length && (supplied.length !== SIGNATURE_HEADERS.length
        || request.headers.get('signature-agent') !== '"https://fluxreader.vercel.app"'
        || SIGNATURE_HEADERS.some(name => request.headers.get(name).length > 8192))) {
        return errorResponse(400, 'invalid_request', requestId);
      }
      const relayIdentity = supplied.length
        ? `\nweb-bot-auth\n${request.headers.get('signature-agent')}\n${request.headers.get('signature-input')}\n${request.headers.get('signature')}`
        : '';
      const clientHeader = request.headers.get('x-flux-client');
      if (clientHeader !== null && clientHeader !== 'anonymous' && !/^[a-f0-9]{64}$/.test(clientHeader)) {
        return errorResponse(400, 'invalid_request', requestId);
      }
      const clientSuffix = clientHeader === null ? '' : `\nclient\n${clientHeader}`;
      const clientKey = clientHeader || 'anonymous';

      const timestamp = request.headers.get('X-Flux-Time') || '';
      const signature = request.headers.get('X-Flux-Signature') || '';
      if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60000
        || !/^[a-f0-9]{64}$/.test(signature)) {
        return errorResponse(401, 'relay_unauthorized', requestId);
      }
      let authenticated = false;
      try {
        const key = await crypto.subtle.importKey('raw', encoder.encode(env.TELEX_RELAY_SECRET),
          { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        const bytes = Uint8Array.from(signature.match(/../g), hex => parseInt(hex, 16));
        authenticated = await crypto.subtle.verify(
          'HMAC', key, bytes,
          encoder.encode(`${timestamp}\n${target.href}${relayIdentity}${clientSuffix}`)
        );
      } catch {
        return errorResponse(503, 'relay_unavailable', requestId, { retryAfter: 30 });
      }
      if (!authenticated) return errorResponse(401, 'relay_unauthorized', requestId);

      const cache = globalThis.caches?.default;
      const cacheKey = cacheKeyFor(endpoint.origin, target.href);
      if (cache) {
        const cached = await readCacheHit(cache, cacheKey, target.pathname);
        if (cached.kind === 'hit') return cached.response;
        if (cached.kind === 'challenge') {
          logFailure(requestId, 'source_challenge', { upstreamStatus: 200, stage: 'stale_cache' });
          try {
            const key = await digestHex(target.href);
            const budget = budgetStub(env);
            await budget.recordNegative({
              urlKey: key,
              code: 'source_challenge',
              upstreamStatus: 200,
              retryAfter: CHALLENGE_TTL_SECONDS,
              now: Date.now()
            });
          } catch {
            logFailure(requestId, 'guard_unavailable', { stage: 'stale_cache_negative' });
          }
          return errorResponse(403, 'source_challenge', requestId, {
            upstreamStatus: 200,
            retryAfter: CHALLENGE_TTL_SECONDS
          });
        }
        if (cached.kind === 'invalid') logFailure(requestId, 'invalid_content', { stage: 'cache_discard' });
      }

      const urlKey = await digestHex(target.href);
      let budget;
      let admission;
      try {
        budget = budgetStub(env);
        admission = await budget.admit({ clientKey, urlKey, now: Date.now() });
      } catch {
        logFailure(requestId, 'guard_unavailable', { stage: 'admission' });
        return errorResponse(503, 'guard_unavailable', requestId, { retryAfter: 30 });
      }

      if (admission?.kind === 'negative') {
        logFailure(requestId, admission.code, {
          upstreamStatus: admission.upstreamStatus,
          stage: 'negative_cache_hit'
        });
        return errorResponse(statusForCode(admission.code), admission.code, requestId, {
          upstreamStatus: admission.upstreamStatus,
          retryAfter: admission.retryAfter
        });
      }
      if (admission?.kind === 'reader_rate_limited' || admission?.kind === 'reader_daily_limit') {
        logFailure(requestId, admission.kind, { stage: 'budget' });
        return errorResponse(statusForCode(admission.kind), admission.kind, requestId, {
          retryAfter: admission.retryAfter
        });
      }
      if (admission?.kind !== 'ok') {
        logFailure(requestId, 'guard_unavailable', { stage: 'admission_response' });
        return errorResponse(503, 'guard_unavailable', requestId, { retryAfter: 30 });
      }

      const upstreamHeaders = {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 FluxReader/1.0'
      };
      // Only the authenticated Vercel caller can supply this optional identity.
      // Never forward arbitrary request headers or the relay authentication secret.
      if (supplied.length) {
        for (const name of SIGNATURE_HEADERS) upstreamHeaders[name] = request.headers.get(name);
        upstreamHeaders['user-agent'] = 'FluxReader/1.0 (+https://fluxreader.vercel.app/reader-bot)';
      }

      return await handleUpstream(target, upstreamHeaders, budget, clientKey, urlKey, requestId, cache, cacheKey, ctx);
    } catch {
      logFailure(requestId, 'relay_unavailable', { stage: 'worker' });
      return errorResponse(503, 'relay_unavailable', requestId, { retryAfter: 30 });
    }
  }
};
