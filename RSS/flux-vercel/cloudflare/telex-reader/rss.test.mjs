import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac, webcrypto} from 'node:crypto';
import {handleRss} from './rss.mjs';
globalThis.crypto ||= webcrypto;
const xml='<?xml version="1.0"?><rss><channel><title>Telex</title></channel></rss>';
function request(valid=true){const time=String(Date.now());return new Request('https://relay.test/rss',{headers:{'X-Flux-Time':time,'X-Flux-Signature':createHmac('sha256',valid?'test-secret':'wrong').update(`${time}\nrss`).digest('hex')}})}
function setup(cached=null){let admissions=0, negatives=0;globalThis.caches={default:{match:async()=>cached,put:async()=>{}}};return {env:{TELEX_RSS_SECRET:'test-secret',TELEX_BUDGET:{getByName:()=>({admit:async()=>{admissions++;return {kind:'ok'}},recordNegative:async()=>{negatives++}})}},counts:()=>({admissions,negatives}),ctx:{waitUntil:p=>p}}}
test('unauthenticated callers cannot use RSS cache or quota',async()=>{const s=setup(new Response(xml));assert.equal((await handleRss(request(false),s.env,s.ctx)).status,401);assert.equal(s.counts().admissions,0)});
test('positive RSS cache is returned before quota and upstream',async()=>{const s=setup(new Response(xml));const old=globalThis.fetch;try{globalThis.fetch=()=>{throw Error('must not fetch')};assert.equal(await(await handleRss(request(),s.env,s.ctx)).text(),xml);assert.equal(s.counts().admissions,0)}finally{globalThis.fetch=old}});
test('only fixed RSS is fetched and valid XML cached; challenge200 gets negative memory',async()=>{const old=globalThis.fetch;try{let s=setup();globalThis.fetch=async url=>{assert.equal(url,'https://telex.hu/rss');return new Response(xml)};assert.equal((await handleRss(request(),s.env,s.ctx)).status,200);assert.equal(s.counts().admissions,1);s=setup();globalThis.fetch=async()=>new Response('<html>challenge</html>');const r=await handleRss(request(),s.env,s.ctx);assert.equal(r.status,502);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(s.counts().negatives,1)}finally{globalThis.fetch=old}});
