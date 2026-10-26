'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const start = app.indexOf('async function fetchExtractedArticle(a) {');
const end = app.indexOf('\nfunction setupContentInteractions()', start);
assert.ok(start >= 0 && end > start, 'reader fetch functions can be isolated from app.js');
const clientFunctions = app.slice(start, end);

function readerClient({ fetch, now = 1_000_000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const sandbox = {
    fetch,
    URL,
    AbortController,
    Response,
    console: { warn() {} },
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    __now: now
  };
  const prelude = `
    const ARTICLE_API = '/api/article?url=';
    const ARTICLE_NEGATIVE_CACHE_DEFAULT_TTL = 20000;
    const ARTICLE_NEGATIVE_CACHE_MIN_TTL = 5000;
    const ARTICLE_NEGATIVE_CACHE_MAX_TTL = 300000;
    const ARTICLE_CACHE_MAX_ENTRIES = 120;
    const ARTICLE_NEGATIVE_CACHE_MAX_ENTRIES = 120;
    const ARTICLE_REQUEST_MAX_IN_FLIGHT = 32;
    const extractedArticleCache = new Map();
    const articleExtractionFailures = new Map();
    const extractingArticlePromises = new Map();
    class ReaderDate extends Date { static now() { return globalThis.__now; } }
    globalThis.Date = ReaderDate;
    function fetchT(url, opts = {}, ms = 8000) {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), ms);
      return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(tid));
    }
    function stripHtml(html) { return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim(); }
  `;
  vm.runInNewContext(`${prelude}\n${clientFunctions}\nglobalThis.client = { fetchExtractedArticle, articleRequestKey, articleFailureDetails, setCappedMapValue, extractedArticleCache, articleExtractionFailures, extractingArticlePromises };`, sandbox);
  return sandbox;
}

function goodArticle(title = 'Tesztcikk') {
  return {
    title,
    desc: 'Rövid összefoglaló',
    image: 'https://example.test/image.jpg',
    date: '2026-10-26T10:00:00Z',
    author: 'Szerző',
    content: `<p>${'Ez a cikk valódi, olvasható magyar törzsszöveget tartalmaz. '.repeat(8)}</p>`
  };
}

test('coalesces Telex URLs after tracking cleanup while preserving other publishers’ query strings', async () => {
  let calls = 0;
  let finish;
  const sandbox = readerClient({ fetch: () => {
    calls++;
    return new Promise(resolve => { finish = resolve; });
  } });
  const client = sandbox.client;
  const first = { url: 'https://www.telex.hu/belfold/cikk?utm_source=feed&id=42#top', title: 'Első cím' };
  const second = { url: 'https://telex.hu/belfold/cikk?id=42&fbclid=tracker', title: 'Második cím' };
  const firstPromise = client.fetchExtractedArticle(first);
  const secondPromise = client.fetchExtractedArticle(second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  finish(new Response(JSON.stringify(goodArticle()), { status: 200, headers: { 'content-type': 'application/json' } }));
  const [a, b] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(a.content, b.content);
  assert.equal(client.extractingArticlePromises.size, 0);
  await client.fetchExtractedArticle({ url: 'https://telex.hu/belfold/cikk?id=42&utm_medium=mail' });
  assert.equal(calls, 1, 'positive cache shares canonical Telex entries');
  assert.notEqual(
    client.articleRequestKey('https://444.hu/cikk?id=42#top'),
    client.articleRequestKey('https://444.hu/cikk?id=43#top'),
    'meaningful non-Telex query values remain part of the request key'
  );
});

test('typed negative cache respects retry-after, avoids repeated requests, then expires', async () => {
  let calls = 0;
  const sandbox = readerClient({ fetch: async () => {
    calls++;
    if (calls === 1) {
      return new Response(JSON.stringify({ code: 'reader_rate_limited', error: 'reader_rate_limited', retryAfter: 2, requestId: 'req-123' }), {
        status: 429,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify(goodArticle()), { status: 200 });
  } });
  const client = sandbox.client;
  const target = { url: 'https://index.hu/cikk?id=1' };
  await assert.rejects(client.fetchExtractedArticle(target), err => {
    assert.equal(err.code, 'reader_rate_limited');
    assert.equal(err.upstreamStatus, null);
    assert.equal(err.requestId, 'req-123');
    return true;
  });
  await assert.rejects(client.fetchExtractedArticle(target), err => err.code === 'reader_rate_limited');
  assert.equal(calls, 1, 'backoff suppresses duplicate requests');
  sandbox.__now += 5001;
  const article = await client.fetchExtractedArticle(target);
  assert.equal(article.title, 'Tesztcikk');
  assert.equal(calls, 2);
  assert.equal(client.articleExtractionFailures.size, 0);
});

test('rejects recognizable HTTP 200 challenges, but accepts challenge phrases in real article prose', async () => {
  let calls = 0;
  const sandbox = readerClient({ fetch: async () => {
    calls++;
    return new Response(JSON.stringify({
      title: 'Just a moment…',
      content: `<p>Checking your browser before accessing this page. Please enable JavaScript and cookies to continue.</p>${'<p>Security verification is still in progress.</p>'.repeat(8)}`
    }), { status: 200 });
  } });
  const client = sandbox.client;
  const target = { url: 'https://hvg.hu/cikk' };
  await assert.rejects(client.fetchExtractedArticle(target), err => err.code === 'challenge_detected');
  await assert.rejects(client.fetchExtractedArticle(target), err => err.code === 'challenge_detected');
  assert.equal(calls, 1, 'challenge failures are briefly cached');

  const htmlSandbox = readerClient({ fetch: async () => new Response(
    '<!doctype html><html><head><title>Attention Required! | Cloudflare</title></head><body><div class="cf-browser-verification">Checking your browser before accessing this site. Please enable JavaScript and cookies to continue.</div></body></html>',
    { status: 200, headers: { 'content-type': 'text/html' } }
  ) });
  await assert.rejects(htmlSandbox.client.fetchExtractedArticle({ url: 'https://telex.hu/cikk' }), err => err.code === 'challenge_detected');

  const articleWithPhrases = goodArticle('Mit jelent a „Just a moment” üzenet?');
  articleWithPhrases.content = `<p>Az „Access denied” és a „Just a moment” felirat mellett ilyen szövegek is előfordulnak: „Checking your browser before accessing”, „verify you are human”, „Cloudflare Ray ID” és „unusual traffic”. ${'Ez a valódi cikk a témát tárgyalja, nem ellenőrző oldal. '.repeat(7)}</p>`;
  const validSandbox = readerClient({ fetch: async () => new Response(JSON.stringify(articleWithPhrases), { status: 200 }) });
  const valid = await validSandbox.client.fetchExtractedArticle({ url: 'https://hvg.hu/captcha-cikk' });
  assert.equal(valid.title, articleWithPhrases.title);
  assert.match(valid.content, /Access denied.*Just a moment/);

  const shortSandbox = readerClient({ fetch: async () => new Response(JSON.stringify({ title: 'Valódi cím', content: '<p>Túl rövid tartalom.</p>' }), { status: 200 }) });
  await assert.rejects(shortSandbox.client.fetchExtractedArticle({ url: 'https://444.hu/cikk' }), err => err.code === 'invalid_content');
});

test('maps aborted requests to client_timeout and removes settled promises', async () => {
  let calls = 0;
  const sandbox = readerClient({
    fetch: (_url, options) => {
      calls++;
      return options.signal.aborted
        ? Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        : Promise.reject(new Error('unexpected'));
    },
    setTimer: callback => { callback(); return 1; },
    clearTimer() {}
  });
  const client = sandbox.client;
  await assert.rejects(client.fetchExtractedArticle({ url: 'https://24.hu/cikk' }), err => err.code === 'client_timeout');
  assert.equal(client.extractingArticlePromises.size, 0);
  await assert.rejects(client.fetchExtractedArticle({ url: 'https://24.hu/cikk' }), err => err.code === 'client_timeout');
  assert.equal(calls, 1, 'timeout is cached during its short backoff');
});

test('bounded cache helper evicts the least recently used entry', () => {
  const sandbox = readerClient({ fetch: async () => new Response('{}') });
  const map = new Map();
  sandbox.client.setCappedMapValue(map, 'a', 1, 2);
  sandbox.client.setCappedMapValue(map, 'b', 2, 2);
  map.delete('a'); map.set('a', 1);
  sandbox.client.setCappedMapValue(map, 'c', 3, 2);
  assert.deepEqual([...map.keys()], ['a', 'c']);
});

test('keeps extraction diagnostics concise and removes article hover/touch prefetch handlers', () => {
  const sandbox = readerClient({ fetch: async () => new Response('{}') });
  assert.equal(sandbox.client.articleFailureDetails({code:'source_challenge',requestId:'test'}).code,'source_challenge');
  const interactionsStart = app.indexOf('function setupContentInteractions()');
  const interactionsEnd = app.indexOf('\nfunction renderArticleLoading(', interactionsStart);
  const interactions = app.slice(interactionsStart, interactionsEnd);
  assert.doesNotMatch(interactions, /addEventListener\(['"]pointer(?:over|down|enter|move)/);
  assert.doesNotMatch(app, /prefetchArticle\(/);
  assert.match(interactions, /content\.addEventListener\('click'/, 'article opening still happens from the click handler');
});
