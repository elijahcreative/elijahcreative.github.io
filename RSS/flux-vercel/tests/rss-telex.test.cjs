const test=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/rss-telex');
const rss='<?xml version="1.0"?><rss><channel><title>Telex RSS</title><item><title>Hír</title><link>https://telex.hu/belfold/2026/10/27/test</link><guid>id</guid><enclosure url="https://assets.telex.hu/image.jpg" type="image/jpeg"/><pubDate>Tue, 27 Oct 2026 07:00:00 GMT</pubDate></item></channel></rss>';
function response(){return{headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},status(n){this.statusCode=n;return this},send(s){this.body=s}}}
const req={method:'GET',headers:{host:'fluxreader.vercel.app','x-forwarded-proto':'https'}};
test('direct RSS uses existing Flux feed identity and preserves Widgy article/image/date fields',async()=>{
 const original=global.fetch;try{
  let calls=0;global.fetch=async(url,options)=>{calls++;assert.equal(url,'https://telex.hu/rss');assert.equal(options.headers['user-agent'],'Mozilla/5.0 FluxReader/1.0');assert.match(options.headers['accept-language'],/hu-HU/);assert.ok(options.signal);return new Response(rss,{headers:{'content-type':'application/rss+xml'}})};
  const res=response();await handler(req,res);assert.equal(res.statusCode,200);assert.equal(calls,1);assert.match(res.body,/<link>https:\/\/fluxreader.vercel.app\/\?open=https%3A%2F%2Ftelex.hu/);assert.match(res.body,/enclosure url="https:\/\/assets.telex.hu\/image.jpg"/);assert.match(res.body,/27 Oct 2026/);assert.match(res.headers['cache-control'],/s-maxage=600/);
 }finally{global.fetch=original}
});
test('HTTP 200 challenge is not served as RSS; the existing JSON fallback remains available',async()=>{
 const original=global.fetch;try{
  let calls=0;global.fetch=async()=>{calls++;return calls===1?new Response('<html><title>Just a moment</title></html>'):new Response(JSON.stringify({status:'ok',feed:{title:'Telex'},items:[{title:'Fallback',link:'https://telex.hu/belfold/2026/10/27/fallback',pubDate:'2026-10-27 07:00:00',enclosure:{link:'https://assets.telex.hu/fallback.jpg'}}]}))};
  const res=response();await handler(req,res);assert.equal(res.statusCode,200);assert.equal(calls,2);assert.match(res.body,/<title>Fallback<\/title>/);assert.match(res.body,/fallback.jpg/);
 }finally{global.fetch=original}
});
test('upstream failures are not cached as a feed; HEAD makes no upstream request',async()=>{
 const original=global.fetch;try{
  global.fetch=async()=>new Response('blocked',{status:403});let res=response();await handler(req,res);assert.equal(res.statusCode,502);assert.equal(res.headers['cache-control'],'no-store');assert.equal(res.headers['retry-after'],'60');
  global.fetch=async()=>{throw Error('HEAD must not fetch')};res=response();await handler({...req,method:'HEAD'},res);assert.equal(res.statusCode,200);assert.equal(res.body,'');
 }finally{global.fetch=original}
});
test('configured authenticated relay is the only upstream; Widgy link rewriting remains',async()=>{
 const old=global.fetch;process.env.TELEX_RSS_RELAY_URL='https://flux-telex-reader-preview.balazskemenesi.workers.dev/rss';process.env.TELEX_RSS_SECRET='test-secret';try{
 let calls=0;global.fetch=async(url,opts)=>{calls++;assert.equal(url,process.env.TELEX_RSS_RELAY_URL);assert.equal(opts.headers['X-Flux-Signature'],require('node:crypto').createHmac('sha256','test-secret').update(`${opts.headers['X-Flux-Time']}\nrss`).digest('hex'));return new Response(rss)};
 const res=response();await handler(req,res);assert.equal(res.statusCode,200);assert.equal(calls,1);assert.match(res.body,/fluxreader.vercel.app\/\?open=/);
 global.fetch=async()=>{calls++;return new Response('blocked',{status:403})};const failed=response();await handler(req,failed);assert.equal(failed.statusCode,502);assert.equal(calls,2);
 }finally{global.fetch=old;delete process.env.TELEX_RSS_RELAY_URL;delete process.env.TELEX_RSS_SECRET}
});
