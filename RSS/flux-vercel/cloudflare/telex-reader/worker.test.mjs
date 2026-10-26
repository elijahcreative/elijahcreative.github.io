import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import worker, { isChallengeHtml, parseRetryAfter } from './worker.mjs';
import { ReaderBudgetEngine, readBudgetLimits } from './budget-core.mjs';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

const url = 'https://telex.hu/belfold/2026/10/02/21-kutatokozpont-tisza-part-tamogatottsag-kozvelemeny-kutatas';
const secret = 'test-only-not-a-deployment-secret';
const origin = 'https://flux-telex-reader.example.workers.dev/article';
const goodHtml = '<!doctype html><html><head><title>Tesztcikk</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></head><body><article class="article-html-content"><p>Az ellenőrzés a történet része: verify you are human.</p></article></body></html>';

class MemoryBudgetStore {
  constructor(state = {}) {
    state.counters ||= new Map();
    state.negatives ||= new Map();
    this.counters = state.counters;
    this.negatives = state.negatives;
  }

  transactionSync(callback) { return callback(); }

  getCounter(key, windowStart) {
    return this.counters.get(`${key}:${windowStart}`) || 0;
  }

  setCounter(key, windowStart, count) {
    this.counters.set(`${key}:${windowStart}`, count);
  }

  deleteCountersBefore(windowStart) {
    for (const key of this.counters.keys()) {
      if (Number(key.slice(key.lastIndexOf(':') + 1)) < windowStart) this.counters.delete(key);
    }
  }

  deleteExpiredNegatives(now) {
    for (const [key, value] of this.negatives) {
      if (value.expiresAt <= now) this.negatives.delete(key);
    }
  }

  getNegative(urlKey, now) {
    const value = this.negatives.get(urlKey);
    if (!value || value.expiresAt <= now) return null;
    return {
      code: value.code,
      upstreamStatus: value.upstreamStatus,
      retryAfter: Math.max(1, Math.ceil((value.expiresAt - now) / 1000))
    };
  }

  putNegative(urlKey, value) {
    this.negatives.set(urlKey, { ...value });
  }
}

function makeBudgetBinding(limits = {}) {
  const store = new MemoryBudgetStore();
  const engine = new ReaderBudgetEngine(store, limits);
  const calls = { admit: 0, reserveFallback: 0, recordNegative: 0 };
  const stub = {
    async admit(input) { calls.admit++; return engine.admit(input); },
    async reserveFallback(input) { calls.reserveFallback++; return engine.reserveFallback(input); },
    async recordNegative(input) { calls.recordNegative++; return engine.recordNegative(input); }
  };
  return {
    store,
    engine,
    calls,
    namespace: {
      getByName(name) {
        assert.equal(name, 'global');
        return stub;
      }
    }
  };
}

function installCache() {
  const entries = new Map();
  globalThis.caches = { default: {
    async match(key) { return entries.get(key.url)?.clone(); },
    async put(key, response) { entries.set(key.url, response.clone()); },
    async delete(key) { return entries.delete(key.url); }
  } };
  return entries;
}

function makeRequest(target = url, options = {}) {
  const time = String(options.time || Date.now());
  const targetHref = new URL(target).href;
  const headers = { 'X-Flux-Time': time };
  let relayIdentity = '';
  if (options.webBotAuth) {
    const webBotHeaders = {
      'signature-agent': '"https://fluxreader.vercel.app"',
      'signature-input': 'sig1=("@method" "@target-uri");created=1791000000',
      signature: 'sig1=:dGVzdA==:'
    };
    Object.assign(headers, webBotHeaders);
    relayIdentity = `\nweb-bot-auth\n${webBotHeaders['signature-agent']}\n${webBotHeaders['signature-input']}\n${webBotHeaders.signature}`;
  }
  const client = options.client;
  const clientSuffix = client === undefined ? '' : `\nclient\n${client}`;
  if (client !== undefined) headers['X-Flux-Client'] = client;
  headers['X-Flux-Signature'] = createHmac('sha256', secret)
    .update(`${time}\n${targetHref}${relayIdentity}${clientSuffix}`)
    .digest('hex');
  return new Request(`${origin}?url=${encodeURIComponent(targetHref)}`, { headers });
}

function makeEnv(binding = makeBudgetBinding(), overrides = {}) {
  return {
    TELEX_RELAY_SECRET: secret,
    TELEX_BUDGET: binding.namespace,
    ...overrides
  };
}

function makeContext() {
  const pending = [];
  return { pending, ctx: { waitUntil(promise) { pending.push(promise); } } };
}

async function json(response) { return response.json(); }

test('default and environment budget limits are bounded and validated', () => {
  assert.deepEqual(readBudgetLimits({}), {
    clientPerMinute: 12,
    globalPerMinute: 20,
    globalPerDay: 500
  });
  assert.deepEqual(readBudgetLimits({
    TELEX_CLIENT_LIMIT_PER_MINUTE: '7',
    TELEX_GLOBAL_LIMIT_PER_MINUTE: '11',
    TELEX_GLOBAL_LIMIT_PER_DAY: '250'
  }), { clientPerMinute: 7, globalPerMinute: 11, globalPerDay: 250 });
  assert.throws(() => readBudgetLimits({ TELEX_GLOBAL_LIMIT_PER_DAY: '0' }));
  assert.throws(() => readBudgetLimits({ TELEX_CLIENT_LIMIT_PER_MINUTE: 'twelve' }));
  assert.throws(() => readBudgetLimits({
    TELEX_GLOBAL_LIMIT_PER_MINUTE: '21',
    TELEX_GLOBAL_LIMIT_PER_DAY: '20'
  }));
});

test('global daily budget survives restart and real fallback attempts count against client quota', () => {
  const state = {};
  const limits = {
    TELEX_CLIENT_LIMIT_PER_MINUTE: '3',
    TELEX_GLOBAL_LIMIT_PER_MINUTE: '4',
    TELEX_GLOBAL_LIMIT_PER_DAY: '4'
  };
  const firstEngine = new ReaderBudgetEngine(new MemoryBudgetStore(state), limits);
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);
  const clientKey = 'a'.repeat(64);
  assert.equal(firstEngine.admit({ clientKey, urlKey: '1'.repeat(64), now }).kind, 'ok');
  assert.equal(firstEngine.reserveFallback({ clientKey, now }).allowed, true);
  assert.equal(new MemoryBudgetStore(state).getCounter(`client-minute:${clientKey}`, Math.floor(now / 60000) * 60000), 2);
  assert.equal(firstEngine.admit({ clientKey, urlKey: '2'.repeat(64), now }).kind, 'ok');
  assert.equal(firstEngine.admit({ clientKey, urlKey: '4'.repeat(64), now }).kind, 'reader_rate_limited');
  assert.equal(firstEngine.admit({ clientKey: 'b'.repeat(64), urlKey: '5'.repeat(64), now }).kind, 'ok');

  const restartedEngine = new ReaderBudgetEngine(new MemoryBudgetStore(state), limits);
  const nextMinute = now + 60000;
  const daily = restartedEngine.admit({
    clientKey: 'b'.repeat(64), urlKey: '3'.repeat(64), now: nextMinute
  });
  assert.equal(daily.kind, 'reader_daily_limit');
  assert.equal(daily.retryAfter, Math.ceil((Date.UTC(2026, 9, 3) - nextMinute) / 1000));
});

test('negative entries are global by URL, expire, and never spend quota', () => {
  const state = {};
  const engine = new ReaderBudgetEngine(new MemoryBudgetStore(state));
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);
  const urlKey = 'd'.repeat(64);
  engine.recordNegative({ urlKey, code: 'source_challenge', upstreamStatus: 200, retryAfter: 120, now });
  const sameNegative = new ReaderBudgetEngine(new MemoryBudgetStore(state)).admit({
    clientKey: 'e'.repeat(64), urlKey, now: now + 1000
  });
  assert.equal(sameNegative.kind, 'negative');
  assert.equal(sameNegative.code, 'source_challenge');
  assert.equal(sameNegative.upstreamStatus, 200);
  assert.equal(Object.hasOwn(sameNegative, 'directFallbackAllowed'), false);
  assert.equal(new MemoryBudgetStore(state).getCounter('global-minute', now), 0);

  assert.equal(new ReaderBudgetEngine(new MemoryBudgetStore(state)).admit({
    clientKey: 'e'.repeat(64), urlKey, now: now + 121000
  }).kind, 'ok');

  const rateKey = 'f'.repeat(64);
  const rateEngine = new ReaderBudgetEngine(new MemoryBudgetStore(state));
  rateEngine.recordNegative({
    urlKey: rateKey, code: 'source_rate_limited', upstreamStatus: 429, retryAfter: 86400, now
  });
  const afterOneHour = rateEngine.admit({
    clientKey: 'e'.repeat(64), urlKey: rateKey, now: now + 3600000
  });
  assert.equal(afterOneHour.kind, 'negative');
  assert.equal(afterOneHour.retryAfter, 82800);
  assert.equal(rateEngine.admit({
    clientKey: 'e'.repeat(64), urlKey: rateKey, now: now + 86400000
  }).kind, 'ok');
});

test('client identity participates in HMAC and keeps legacy plus Web Bot Auth tuples intact', async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = globalThis.caches;
  const cache = installCache();
  const binding = makeBudgetBinding();
  const { ctx } = makeContext();
  const calls = [];
  globalThis.fetch = async (_target, options) => {
    calls.push(options.headers);
    return new Response(goodHtml, { headers: { 'content-type': 'text/html' } });
  };
  try {
    const legacy = await worker.fetch(makeRequest(), makeEnv(binding), ctx);
    assert.equal(legacy.status, 200);

    cache.clear();
    const client = 'c'.repeat(64);
    const tampered = makeRequest(url, { client });
    tampered.headers.set('X-Flux-Client', 'f'.repeat(64));
    assert.equal((await worker.fetch(tampered, makeEnv(binding), ctx)).status, 401);

    const authenticated = await worker.fetch(makeRequest(url, { client, webBotAuth: true }), makeEnv(binding), ctx);
    assert.equal(authenticated.status, 200);
    assert.equal(calls[1]['signature-agent'], '"https://fluxreader.vercel.app"');
    assert.equal(calls[1]['user-agent'], 'FluxReader/1.0 (+https://fluxreader.vercel.app/reader-bot)');
    assert.equal(binding.calls.admit, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test('positive edge-cache hits are validated and bypass the global budget', async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = globalThis.caches;
  const cache = installCache();
  const binding = makeBudgetBinding();
  const { ctx, pending } = makeContext();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response(goodHtml, { headers: { 'content-type': 'text/html' } });
  };
  try {
    assert.equal((await worker.fetch(makeRequest(), makeEnv(binding), ctx)).status, 200);
    await Promise.all(pending);
    assert.equal((await worker.fetch(makeRequest(url, { client: '9'.repeat(64) }), makeEnv(binding), ctx)).status, 200);
    assert.equal(fetchCalls, 1);
    assert.equal(binding.calls.admit, 1);

    const key = [...cache.keys()][0];
    cache.set(key, new Response('<html><head><title>Just a moment...</title></head><body>cf-chl-x</body></html>', {
      headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=3600' }
    }));
    const challenge = await worker.fetch(makeRequest(), makeEnv(binding), ctx);
    const challengeBody = await json(challenge);
    assert.equal(challenge.status, 403);
    assert.equal(challengeBody.code, 'source_challenge');
    assert.equal(challengeBody.upstreamStatus, 200);
    assert.equal(challengeBody.directFallbackAllowed, false);
    assert.equal(fetchCalls, 1);
    assert.equal(cache.size, 0);
    assert.equal(binding.calls.admit, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test('HTTP 200 challenge becomes typed global negative; repeated hits spend no budget', async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = globalThis.caches;
  installCache();
  const binding = makeBudgetBinding();
  const { ctx } = makeContext();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response('<html><head><title>Just a moment...</title></head><body>cf-chl-x</body></html>', {
      headers: { 'content-type': 'text/html' }
    });
  };
  try {
    const first = await worker.fetch(makeRequest(), makeEnv(binding), ctx);
    const firstBody = await json(first);
    const second = await worker.fetch(makeRequest(), makeEnv(binding), ctx);
    const secondBody = await json(second);
    assert.equal(first.status, 403);
    assert.equal(firstBody.code, 'source_challenge');
    assert.equal(firstBody.upstreamStatus, 200);
    assert.equal(firstBody.directFallbackAllowed, false);
    assert.equal(second.status, 403);
    assert.equal(secondBody.code, 'source_challenge');
    assert.equal(secondBody.directFallbackAllowed, false);
    assert.equal(fetchCalls, 1);
    assert.equal(binding.calls.admit, 2);
    assert.equal(binding.store.getCounter('global-minute', Math.floor(Date.now() / 60000) * 60000), 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test('only a fresh timeout or source 5xx gets fallback permission after reserving another global slot', async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = globalThis.caches;
  installCache();
  const binding = makeBudgetBinding();
  const { ctx } = makeContext();
  globalThis.fetch = async () => new Response('temporarily unavailable', { status: 503 });
  try {
    const first = await worker.fetch(makeRequest(), makeEnv(binding), ctx);
    const firstBody = await json(first);
    assert.equal(first.status, 502);
    assert.equal(firstBody.code, 'source_unavailable');
    assert.equal(firstBody.upstreamStatus, 503);
    assert.equal(firstBody.directFallbackAllowed, true);
    assert.equal(binding.calls.reserveFallback, 1);
    assert.equal(binding.store.getCounter('global-minute', Math.floor(Date.now() / 60000) * 60000), 2);
    assert.equal(binding.store.getCounter('client-minute:anonymous', Math.floor(Date.now() / 60000) * 60000), 2);

    const repeat = await worker.fetch(makeRequest(), makeEnv(binding), ctx);
    const repeatBody = await json(repeat);
    assert.equal(repeatBody.code, 'source_unavailable');
    assert.equal(repeatBody.directFallbackAllowed, false);
    assert.equal(binding.calls.reserveFallback, 1);

    installCache();
    const signedBinding = makeBudgetBinding();
    globalThis.fetch = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
    const signed = await worker.fetch(makeRequest(url, { webBotAuth: true, client: '7'.repeat(64) }), makeEnv(signedBinding), ctx);
    const signedBody = await json(signed);
    assert.equal(signedBody.code, 'source_timeout');
    assert.equal(signedBody.directFallbackAllowed, false);
    assert.equal(signedBinding.calls.reserveFallback, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test('budget exhaustion refuses fallback permission and upstream denial errors remain typed', async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = globalThis.caches;
  installCache();
  const binding = makeBudgetBinding({
    TELEX_CLIENT_LIMIT_PER_MINUTE: '12',
    TELEX_GLOBAL_LIMIT_PER_MINUTE: '1',
    TELEX_GLOBAL_LIMIT_PER_DAY: '10'
  });
  const { ctx } = makeContext();
  globalThis.fetch = async () => new Response('down', { status: 503 });
  try {
    const response = await worker.fetch(makeRequest(), makeEnv(binding), ctx);
    const body = await json(response);
    assert.equal(response.status, 429);
    assert.equal(body.code, 'reader_rate_limited');
    assert.equal(body.directFallbackAllowed, false);
    assert.ok(Number(response.headers.get('retry-after')) >= 1);
    assert.equal(binding.calls.reserveFallback, 1);

    installCache();
    const perClientBinding = makeBudgetBinding({
      TELEX_CLIENT_LIMIT_PER_MINUTE: '1',
      TELEX_GLOBAL_LIMIT_PER_MINUTE: '20',
      TELEX_GLOBAL_LIMIT_PER_DAY: '40'
    });
    const perClient = await worker.fetch(makeRequest(url, { client: '1'.repeat(64) }), makeEnv(perClientBinding), ctx);
    const perClientBody = await json(perClient);
    assert.equal(perClient.status, 429);
    assert.equal(perClientBody.code, 'reader_rate_limited');
    assert.equal(perClientBody.directFallbackAllowed, false);
    assert.equal(perClientBinding.store.getCounter(`client-minute:${'1'.repeat(64)}`, Math.floor(Date.now() / 60000) * 60000), 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test('403, 429, invalid HTML, redirects, and oversized responses never allow direct fallback', async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = globalThis.caches;
  const { ctx } = makeContext();
  const cases = [
    { response: () => new Response('forbidden', { status: 403 }), code: 'source_blocked', status: 403 },
    { response: () => new Response('slow down', { status: 429, headers: { 'retry-after': '1' } }), code: 'source_rate_limited', status: 429 },
    { response: () => new Response('not HTML', { headers: { 'content-type': 'text/plain' } }), code: 'invalid_content', status: 422 },
    { response: () => new Response('', { status: 302, headers: { location: 'https://example.com' } }), code: 'redirect_blocked', status: 502 },
    { response: () => new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/html' } }), code: 'response_too_large', status: 502 }
  ];
  try {
    for (const item of cases) {
      installCache();
      const binding = makeBudgetBinding();
      globalThis.fetch = async () => item.response();
      const response = await worker.fetch(makeRequest(), makeEnv(binding), ctx);
      const body = await json(response);
      assert.equal(response.status, item.status);
      assert.equal(body.code, item.code);
      assert.equal(body.directFallbackAllowed, false);
      assert.equal(binding.calls.reserveFallback, 0);
      if (item.code === 'source_rate_limited') assert.equal(body.retryAfter, 5);
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test('timeouts are typed, but a missing budget guard fails closed before upstream access', async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = globalThis.caches;
  const { ctx } = makeContext();
  installCache();
  const binding = makeBudgetBinding();
  globalThis.fetch = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
  try {
    const timeout = await worker.fetch(makeRequest(), makeEnv(binding), ctx);
    const timeoutBody = await json(timeout);
    assert.equal(timeout.status, 504);
    assert.equal(timeoutBody.code, 'source_timeout');
    assert.equal(timeoutBody.directFallbackAllowed, true);

    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(goodHtml, { headers: { 'content-type': 'text/html' } }); };
    const unavailable = await worker.fetch(makeRequest(url, { client: '8'.repeat(64) }), makeEnv(undefined, { TELEX_BUDGET: undefined }), ctx);
    const unavailableBody = await json(unavailable);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailableBody.code, 'guard_unavailable');
    assert.equal(unavailableBody.directFallbackAllowed, false);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test('source failure helpers detect challenge markers and clamp Retry-After', () => {
  assert.equal(isChallengeHtml('<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/x"></script></body></html>'), true);
  assert.equal(isChallengeHtml('<html><head><title>Normal article</title></head><body>cf-chl-abc</body></html>'), false);
  assert.equal(isChallengeHtml(goodHtml), false);
  assert.equal(parseRetryAfter('1', 0), 5);
  assert.equal(parseRetryAfter('999999', 0), 86400);
  assert.equal(parseRetryAfter('bad', 0), 30);
});
