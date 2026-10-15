import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import worker from './worker.mjs';

test('auth, source restrictions, rate limit, cache, size cap and Reader integration', async () => {
  const url = 'https://telex.hu/belfold/2026/10/02/21-kutatokozpont-tisza-part-tamogatottsag-kozvelemeny-kutatas';
  const secret = 'test-only-not-a-deployment-secret';
  const origin = 'https://flux-telex-reader.balazskemenesi.workers.dev/article';
  const cache = new Map();
  globalThis.caches = { default: { match: async k => cache.get(k.url)?.clone(), put: async (k, r) => cache.set(k.url, r) } };
  const ctx = { waitUntil: promise => pending.push(promise) };
  const pending = [];
  let calls = 0;
  const html = '<html><head><meta property="og:title" content="Tesztcikk"></head><body><div class="article-html-content"><p>' + 'Ez egy magyar mondat. '.repeat(30) + '</p></div></body></html>';
  globalThis.fetch = async () => { calls++; return new Response(html, {headers:{'content-type':'text/html'}}); };
  const env = { TELEX_RELAY_SECRET: secret, RATE_LIMITER: { limit: async () => ({ success:true }) } };
  const signed = (target = url, time = String(Date.now())) => new Request(origin + '?url=' + encodeURIComponent(target), {
    headers: {'X-Flux-Time':time,'X-Flux-Signature':createHmac('sha256',secret).update(`${time}\n${target}`).digest('hex')}
  });
  assert.equal((await worker.fetch(new Request(origin+'?url='+encodeURIComponent(url)), env, ctx)).status,401);
  assert.equal((await worker.fetch(signed('https://example.com/a'), env, ctx)).status,400);
  assert.equal((await worker.fetch(signed(url,String(Date.now()-120000)), env, ctx)).status,401);
  const tampered = signed(); tampered.headers.set('X-Flux-Signature','0'.repeat(64));
  assert.equal((await worker.fetch(tampered,env,ctx)).status,401);
  assert.equal((await worker.fetch(signed(),{},ctx)).status,503);
  assert.equal(calls,0);
  assert.equal((await worker.fetch(signed(),env,ctx)).status,200);
  await Promise.all(pending);
  assert.equal(await (await worker.fetch(signed(),env,ctx)).text(),html);
  assert.equal(calls,1);
  assert.equal((await worker.fetch(signed(),{...env,RATE_LIMITER:{limit:async()=>({success:false})}},ctx)).status,429);
  cache.clear();
  globalThis.fetch = async () => new Response('',{status:302,headers:{location:'https://example.com'}});
  assert.equal((await worker.fetch(signed(),env,ctx)).status,502);
  globalThis.fetch = async () => new Response(new Uint8Array(2*1024*1024+1),{headers:{'content-type':'text/html'}});
  assert.equal((await worker.fetch(signed(),env,ctx)).status,502);
  const require = createRequire(import.meta.url);
  const handler = require('../../api/article.js');
  process.env.TELEX_RELAY_URL=origin; process.env.TELEX_RELAY_SECRET=secret;
  const remoteFetch = async () => new Response(html,{headers:{'content-type':'text/html'}});
  globalThis.fetch = async (endpoint, options) => {
    assert.equal(new URL(endpoint).hostname,new URL(origin).hostname);
    globalThis.fetch = remoteFetch;
    try { return await worker.fetch(new Request(endpoint,options),env,ctx); }
    finally { globalThis.fetch = dispatch; }
  };
  const dispatch = globalThis.fetch;
  let status, output;
  const res={setHeader(){},status(value){status=value;return this;},json(value){output=value;},end(value){output=JSON.parse(value);}};
  await handler({method:'GET',query:{url}},res);
  assert.equal(status || res.statusCode,200);
  assert.ok(output.content.length>240);
  assert.equal(output.title,'Tesztcikk');
  await handler({method:'GET',query:{url:url+'?utm_source=test#section'}},res);
  assert.equal(status || res.statusCode,200);
  // Other sources retain direct fetching and never receive relay credentials.
  const other = 'https://444.hu/2026/10/02/test';
  globalThis.fetch = async (endpoint,options) => {
    assert.equal(endpoint,other);
    assert.equal(options.headers['X-Flux-Signature'],undefined);
    return new Response(html,{headers:{'content-type':'text/html'}});
  };
  await handler({method:'GET',query:{url:other}},res);
  delete process.env.TELEX_RELAY_URL;
  delete process.env.TELEX_RELAY_SECRET;
  globalThis.fetch = async (endpoint,options) => {
    assert.equal(endpoint,url);
    assert.equal(options.headers['X-Flux-Signature'],undefined);
    return new Response(html,{headers:{'content-type':'text/html'}});
  };
  await handler({method:'GET',query:{url}},res);
  assert.equal(status || res.statusCode,200);
});
