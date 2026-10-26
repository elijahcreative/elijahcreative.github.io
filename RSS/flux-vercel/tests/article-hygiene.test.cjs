'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createArticleRequestPool}=require('../lib/article-request-pool');
const {ArticleFetchError,fetchDirectHtml,fetchRelayHtml,isChallenge}=require('../lib/article-transport');
const articleUrl='https://telex.hu/belfold/2026/10/26/hygiene-test';
const relay='https://flux-telex-reader.balazskemenesi.workers.dev/article';
const html='<html><head><meta property="og:title" content="Hír"></head><div class="article-html-content"><p>'+('Ellenőrzött magyar cikk szövege. '.repeat(30))+'</p></div></html>';
const challenge='<html><head><title>Just a moment...</title></head><body>Performing security verification<script src="/cdn-cgi/challenge-platform/test"></script></body></html>';
const res=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},end(s){this.body=JSON.parse(s);},json(s){this.body=s;}});
test('pool merges pending requests, remembers typed failures, retries after expiry, and serves success without spending admission',async()=>{
 let time=0,calls=0,resolve;const pool=createArticleRequestPool({now:()=>time,perClientMinute:1});
 const pending=new Promise(r=>resolve=r);const a=pool.run('article','client',()=>{calls++;return pending;});const b=pool.run('article','client',()=>{throw Error('duplicate');});resolve({content:'ready'});assert.deepEqual(await a,await b);assert.equal(calls,1);
 assert.equal((await pool.run('article','client',()=>{throw Error('cached');})).content,'ready');
 const other=createArticleRequestPool({now:()=>time});let errors=0;
 const load=()=>{errors++;throw new ArticleFetchError('source_challenge',{retryAfter:120,upstreamStatus:200,directFallbackAllowed:true});};
 await assert.rejects(other.run('blocked','c',load),e=>e.code==='source_challenge');
 await assert.rejects(other.run('blocked','c',load),e=>e.code==='source_challenge'&&e.directFallbackAllowed===false);assert.equal(errors,1);
 time=121000;await assert.rejects(other.run('blocked','c',load));assert.equal(errors,2);
});
test('200 challenge, oversized body, redirects to private hosts and transport timeouts are rejected',async()=>{
 const previous=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(challenge,{headers:{'content-type':'text/html'}});await assert.rejects(fetchDirectHtml(articleUrl),e=>e.code==='source_challenge'&&e.upstreamStatus===200);
  assert.equal(isChallenge('<title>Article about Cloudflare</title><script src="/cdn-cgi/challenge-platform/test"></script>'+html),false);
  globalThis.fetch=async()=>new Response('x',{headers:{'content-type':'text/html','content-length':'2097153'}});await assert.rejects(fetchDirectHtml(articleUrl),e=>e.code==='response_too_large');
  let calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status:302,headers:{location:'http://127.0.0.1/private'}});};await assert.rejects(fetchDirectHtml(articleUrl,{allowUrl:u=>u.protocol==='https:'&&u.hostname==='telex.hu'}),e=>e.code==='redirect_blocked');assert.equal(calls,1);
  globalThis.fetch=async()=>{throw new DOMException('timeout','TimeoutError');};await assert.rejects(fetchDirectHtml(articleUrl),e=>e.code==='source_timeout');await assert.rejects(fetchRelayHtml(relay),e=>e.code==='relay_unavailable'&&!e.directFallbackAllowed);
 }finally{globalThis.fetch=previous;}
});
test('API preserves typed errors/backoff and only permits one prepaid direct fallback',async()=>{
 const originalFetch=globalThis.fetch,old={...process.env};
 try{
  process.env.TELEX_RELAY_URL=relay;process.env.TELEX_RELAY_SECRET='test-secret-only';delete process.env.WEB_BOT_AUTH_ENABLED;
  function fresh(){delete require.cache[require.resolve('../lib/telex-relay-client')];delete require.cache[require.resolve('../api/article')];return require('../api/article');}
  let calls=0;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({code:'source_challenge',upstreamStatus:200,retryAfter:120,directFallbackAllowed:true}),{status:403,headers:{'content-type':'application/json'}});};
  let handler=fresh(),a=res(),b=res();await handler({method:'GET',query:{url:articleUrl}},a);await handler({method:'GET',query:{url:articleUrl+'?utm_source=x#p'}},b);assert.equal(a.statusCode,403);assert.equal(b.body.code,'source_challenge');assert.equal(a.body.upstreamStatus,200);assert.equal(calls,1);assert.equal(a.headers['retry-after'],'120');assert.match(a.body.requestId,/^[0-9a-f-]{36}$/);
  calls=0;handler=fresh();globalThis.fetch=async u=>{calls++;if(new URL(u).hostname===new URL(relay).hostname)return new Response(JSON.stringify({code:'source_unavailable',upstreamStatus:503,retryAfter:30,directFallbackAllowed:true}),{status:502,headers:{'content-type':'application/json'}});return new Response(html,{headers:{'content-type':'text/html'}});};
  a=res();await handler({method:'GET',query:{url:articleUrl}},a);assert.equal(a.statusCode,200);assert.equal(calls,2);assert.ok(a.body.content.length>240);b=res();await handler({method:'GET',query:{url:articleUrl}},b);assert.equal(calls,2);
  calls=0;handler=fresh();globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({code:'reader_daily_limit',retryAfter:10000,directFallbackAllowed:true}),{status:429,headers:{'content-type':'application/json'}});};a=res();await handler({method:'GET',query:{url:articleUrl}},a);assert.equal(a.statusCode,429);assert.equal(a.body.code,'reader_daily_limit');assert.equal(calls,1);
  calls=0;handler=fresh();a=res();await handler({method:'GET',headers:{'sec-fetch-site':'cross-site'},query:{url:articleUrl}},a);assert.equal(a.statusCode,403);assert.equal(calls,0);
  delete process.env.TELEX_RELAY_SECRET;handler=fresh();a=res();await handler({method:'GET',query:{url:articleUrl}},a);assert.equal(a.statusCode,503);assert.equal(calls,0);
 }finally{globalThis.fetch=originalFetch;for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
});

 test('Telex image metadata shares the authenticated transport, cache and typed failure memory',async()=>{
 const originalFetch=globalThis.fetch,old={...process.env};
 try{
  process.env.TELEX_RELAY_URL=relay;process.env.TELEX_RELAY_SECRET='image-test-secret';delete process.env.WEB_BOT_AUTH_ENABLED;
  delete require.cache[require.resolve('../lib/telex-relay-client')];delete require.cache[require.resolve('../api/feed-image')];delete require.cache[require.resolve('../api/article')];
  const images=require('../api/feed-image'),articles=require('../api/article');let calls=0;
  globalThis.fetch=async(u,opts)=>{calls++;assert.equal(new URL(u).hostname,new URL(relay).hostname);const h=new Headers(opts.headers);assert.match(h.get('x-flux-client'),/^[0-9a-f]{64}$/);assert.match(h.get('x-flux-signature'),/^[0-9a-f]{64}$/);return new Response(html.replace('</head>','<meta property="og:image" content="https://assets.telex.hu/test.jpg"></head>'),{headers:{'content-type':'text/html'}});};
  const a=res(),b=res();await Promise.all([images({method:'GET',query:{url:articleUrl}},a),articles({method:'GET',query:{url:articleUrl}},b)]);
  assert.equal(calls,1);assert.equal(a.body.image,'https://assets.telex.hu/test.jpg');assert.equal(b.statusCode,200);
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({code:'source_challenge',retryAfter:120}),{status:403,headers:{'content-type':'application/json'}});};
  const blocked=articleUrl+'-blocked';let c=res();await images({method:'GET',query:{url:blocked}},c);assert.equal(c.statusCode,403);assert.equal(c.body.code,'source_challenge');assert.equal(c.headers['cache-control'],'no-store');
  c=res();await images({method:'GET',query:{url:blocked}},c);assert.equal(calls,2);
  c=res();await images({method:'GET',query:{url:'https://telex.hu/'}},c);assert.equal(c.statusCode,400);assert.equal(calls,2);
 }finally{globalThis.fetch=originalFetch;for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
});
