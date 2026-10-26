'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, createPublicKey, createHmac, verify } = require('node:crypto');
const handler = require('../api/article');
const directoryHandler = require('../api/bot-directory');
const URL_PATH = '/belfold/2026/10/26/test-article';
const target = `https://telex.hu${URL_PATH}`;
const relay = 'https://flux-telex-reader.balazskemenesi.workers.dev/article';
const secret = 'local-test-only-not-a-deployed-secret';
const html = '<html><head><meta property="og:title" content="Teszt"></head><body><div class="article-html-content"><p>' + 'Magyar szöveg a teszteléshez. '.repeat(30) + '</p></div></body></html>';
function response() {
  return { headers: {}, statusCode: 200, setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;},send(v){this.body=v;},end(v){this.body=JSON.parse(v);} };
}
function signedRelayRequest(headers) {
  const ts=String(Date.now());
  return new Request(relay+'?url='+encodeURIComponent(target),{headers:{'X-Flux-Time':ts,'X-Flux-Signature':createHmac('sha256',secret).update(`${ts}\n${target}`).digest('hex'),...headers}});
}
test('signed Telex identity survives authenticated relay and unsigned/non-Telex behavior is preserved', async () => {
  const {default: worker} = await import('../cloudflare/telex-reader/worker.mjs');
  const oldEnv={...process.env}, oldFetch=globalThis.fetch,oldCaches=globalThis.caches;
  const key=generateKeyPairSync('ed25519').privateKey.export({format:'jwk'});
  try {
    process.env.WEB_BOT_AUTH_ENABLED='true';
    process.env.FLUX_BOT_PRIVATE_KEY_JWK=JSON.stringify(key);
    process.env.TELEX_RELAY_URL=relay;process.env.TELEX_RELAY_SECRET=secret;
    globalThis.caches={default:{match:async()=>null,put:async()=>{}}};
    const env={TELEX_RELAY_SECRET:secret,RATE_LIMITER:{limit:async()=>({success:true})},TELEX_BUDGET:{getByName:()=>({admit:async()=>({kind:'ok'}),recordNegative:async()=>{},reserveFallback:async()=>({allowed:false})})}};
    const ctx={waitUntil:p=>{void p;}};
    let sawSigned=false, capturedRelay;
    const dispatch=async(url,options)=>{
      if(new URL(url).hostname===new URL(relay).hostname) {capturedRelay=new Request(url,options);return worker.fetch(capturedRelay.clone(),env,ctx);}
      assert.equal(url,target);
      const headers=new Headers(options.headers);
      assert.equal(headers.get('signature-agent'),'"https://fluxreader.vercel.app"');
      assert.equal(headers.has('x-flux-signature'),false);
      assert.equal(headers.has('x-flux-time'),false);
      assert.equal(headers.get('user-agent'),'FluxReader/1.0 (+https://fluxreader.vercel.app/reader-bot)');
      const params=headers.get('signature-input').slice('sig1='.length);
      const base=`"@authority": telex.hu\n"signature-agent": ${headers.get('signature-agent')}\n"@method": GET\n"@path": ${URL_PATH}\n"@signature-params": ${params}`;
      const bytes=Buffer.from(/^sig1=:([^:]+):$/.exec(headers.get('signature'))[1],'base64');
      const publicKey=createPublicKey({key:{kty:key.kty,crv:key.crv,x:key.x},format:'jwk'});
      assert.equal(verify(null,Buffer.from(base),publicKey,bytes),true);
      sawSigned=true;
      return new Response(html,{headers:{'content-type':'text/html'}});
    };
    globalThis.fetch=dispatch;
    let res=response();await handler({method:'GET',query:{url:target.replace('telex.hu','www.telex.hu')+'?utm_source=test#top'}},res);
    assert.equal(res.statusCode,200);assert.ok(res.body.content.length>240);assert.equal(sawSigned,true);
    globalThis.fetch=async()=>{throw new Error('malformed identities must not fetch');};
    const stripped=capturedRelay.clone();for(const k of ['signature','signature-input','signature-agent'])stripped.headers.delete(k);
    assert.equal((await worker.fetch(stripped,env,ctx)).status,401);
    const changed=capturedRelay.clone();changed.headers.set('signature',changed.headers.get('signature').replace('sig1=','sig2='));
    assert.equal((await worker.fetch(changed,env,ctx)).status,401);
    assert.equal((await worker.fetch(signedRelayRequest({'signature':'sig1=:bad:'}),env,ctx)).status,400);
    assert.equal((await worker.fetch(signedRelayRequest({'signature':'sig1=:bad:','signature-input':'bad','signature-agent':'"https://other.example"'}),env,ctx)).status,400);
    // An enabled Telex-only key must never alter another publisher's request.
    process.env.FLUX_BOT_PRIVATE_KEY_JWK='invalid';
    globalThis.fetch=async(url,options)=>{assert.equal(url,'https://444.hu/2026/10/26/test');assert.equal(new Headers(options.headers).has('signature'),false);return new Response(html,{headers:{'content-type':'text/html'}});};
    await handler({method:'GET',query:{url:'https://444.hu/2026/10/26/test'}},response());
    // Enabled signing cannot bypass the relay if its configuration is missing.
    process.env.FLUX_BOT_PRIVATE_KEY_JWK=JSON.stringify(key);delete process.env.TELEX_RELAY_URL;
    globalThis.fetch=async()=>{throw new Error('signed mode must not fall back to a direct fetch');};
    res=response();await handler({method:'GET',query:{url:target}},res);assert.equal(res.statusCode,503);
    // Both explicit-off and unset mode retain the legacy UA through the guarded relay.
    process.env.WEB_BOT_AUTH_ENABLED='false';process.env.TELEX_RELAY_URL=relay;process.env.TELEX_RELAY_SECRET=secret;
    globalThis.fetch=async(url,options)=>{assert.equal(new URL(url).hostname,new URL(relay).hostname);const h=new Headers(options.headers);assert.equal(h.has('signature'),false);assert.equal(h.get('user-agent'),'Mozilla/5.0 FluxReader/1.0');return new Response(html,{headers:{'content-type':'text/html'}});};
    res=response();await handler({method:'GET',query:{url:target}},res);assert.equal(res.statusCode,200);
    delete process.env.WEB_BOT_AUTH_ENABLED;process.env.FLUX_BOT_PRIVATE_KEY_JWK='invalid';
    res=response();await handler({method:'GET',query:{url:target}},res);assert.equal(res.statusCode,200);
  } finally {
    for(const k of Object.keys(process.env))if(!(k in oldEnv))delete process.env[k];Object.assign(process.env,oldEnv);
    globalThis.fetch=oldFetch;globalThis.caches=oldCaches;
  }
});
test('directory route refuses untrusted hosts, stays off by default, and never leaks invalid secret material', async () => {
  const oldEnv={...process.env};
  try {
    delete process.env.WEB_BOT_AUTH_DIRECTORY_ENABLED;
    let res=response();await directoryHandler({method:'GET',headers:{host:'fluxreader.vercel.app'}},res);assert.equal(res.statusCode,404);assert.equal(res.body.error,'not_enabled');
    process.env.WEB_BOT_AUTH_DIRECTORY_ENABLED='true';
    process.env.FLUX_BOT_PRIVATE_KEY_JWK='DO-NOT-RETURN-THIS';
    res=response();await directoryHandler({method:'GET',headers:{host:'attacker.example'}},res);assert.equal(res.statusCode,404);
    res=response();await directoryHandler({method:'GET',headers:{host:'fluxreader.vercel.app'}},res);assert.equal(res.statusCode,503);assert.equal(JSON.stringify(res).includes('DO-NOT-RETURN-THIS'),false);
    const key=generateKeyPairSync('ed25519').privateKey.export({format:'jwk'});process.env.FLUX_BOT_PRIVATE_KEY_JWK=JSON.stringify(key);
    res=response();await directoryHandler({method:'GET',headers:{host:'fluxreader.vercel.app'}},res);assert.equal(res.statusCode,200);assert.equal(res.headers['content-type'],'application/http-message-signatures-directory+json');assert.equal(res.body.includes(key.d),false);
    res=response();await directoryHandler({method:'POST',headers:{host:'fluxreader.vercel.app'}},res);assert.equal(res.statusCode,405);
  } finally {for(const k of Object.keys(process.env))if(!(k in oldEnv))delete process.env[k];Object.assign(process.env,oldEnv);}
});
