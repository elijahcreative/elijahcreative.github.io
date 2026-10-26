'use strict';
const {createHmac, randomBytes}=require('node:crypto');
const {signTelexRequest}=require('./web-bot-auth');
const {ArticleFetchError,fetchDirectHtml,fetchRelayHtml}=require('./article-transport');
const {createArticleRequestPool}=require('./article-request-pool');
const htmlRequests=createArticleRequestPool({maxEntries:16,maxConcurrent:8,successTtl:60000});
const localClientSalt=randomBytes(32);
function canonicalTelexUrl(value) {
  let url;
  try {url=new URL(value);} catch {throw new ArticleFetchError('invalid_request');}
  if(url.protocol!=='https:' || !['telex.hu','www.telex.hu'].includes(url.hostname) || url.username || url.password || url.port || !/^\/[a-z0-9/-]+\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?$/.test(url.pathname))throw new ArticleFetchError('unsupported_source');
  url.hostname='telex.hu';url.search='';url.hash='';return url;
}
function clientIdentity(req,secret) {
  // Vercel overwrites this platform header. In local/test mode never trust
  // arbitrary caller-supplied IP headers. Only a daily digest goes to the relay.
  const raw=process.env.VERCEL==='1' ? String(req.headers?.['x-vercel-forwarded-for'] || req.headers?.['x-forwarded-for'] || 'anonymous').split(',')[0].trim() : req.socket?.remoteAddress || 'anonymous';
  return createHmac('sha256',secret || localClientSalt).update(new Date().toISOString().slice(0,10)+'\n'+raw).digest('hex');
}
async function fetchTelexHtml(req,value,requestId) {
  const canonical=canonicalTelexUrl(value);
  const key=canonical.href+'|'+(process.env.WEB_BOT_AUTH_ENABLED || '')+'|'+(process.env.TELEX_RELAY_URL || '');
  return htmlRequests.run(key,clientIdentity(req,process.env.TELEX_RELAY_SECRET),()=>loadTelexHtml(req,canonical.href,requestId));
}
async function loadTelexHtml(req,value,requestId) {
  const canonical=canonicalTelexUrl(value);
  const relaySecret=process.env.TELEX_RELAY_SECRET;
  const client=clientIdentity(req,relaySecret);
  const botIdentity=await signTelexRequest({targetUrl:canonical.href});
  const upstreamHeaders={accept:'text/html,application/xhtml+xml','user-agent':botIdentity?'FluxReader/1.0 (+https://fluxreader.vercel.app/reader-bot)':'Mozilla/5.0 FluxReader/1.0'};
  let html;
  const relayUrl=process.env.TELEX_RELAY_URL;
  if(!relayUrl || !relaySecret)throw new ArticleFetchError('relay_unavailable',{retryAfter:60});
  let endpoint;
  try{endpoint=new URL(relayUrl);}catch{throw new ArticleFetchError('relay_unavailable');}
  const allowed=['flux-telex-reader.balazskemenesi.workers.dev'];
  if(process.env.VERCEL_ENV!=='production')allowed.push('flux-telex-reader-preview.balazskemenesi.workers.dev');
  if(endpoint.protocol!=='https:' || !allowed.includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.port || endpoint.pathname!=='/article')throw new ArticleFetchError('relay_unavailable');
  endpoint.search='';endpoint.hash='';endpoint.searchParams.set('url',canonical.href);
  const timestamp=String(Date.now());
  const identity=botIdentity?`\nweb-bot-auth\n${botIdentity.headers['Signature-Agent']}\n${botIdentity.headers['Signature-Input']}\n${botIdentity.headers.Signature}`:'';
  const auth=createHmac('sha256',relaySecret).update(`${timestamp}\n${canonical.href}${identity}\nclient\n${client}`).digest('hex');
  try{
    html=await fetchRelayHtml(endpoint.href,{headers:{...upstreamHeaders,...(botIdentity?.headers || {}),'X-Flux-Time':timestamp,'X-Flux-Signature':auth,'X-Flux-Client':client}});
  }catch(e){
    // Never bypass a block, challenge, rate limit, or unavailable guard. A
    // fresh relay response may reserve exactly one direct retry in advance.
    if(!botIdentity && e.directFallbackAllowed && ['source_timeout','source_unavailable'].includes(e.code)){
      console.info(JSON.stringify({event:'reader_direct_fallback',requestId,code:e.code}));
      html=await fetchDirectHtml(canonical.href,{headers:upstreamHeaders,maxRedirects:0,allowUrl:u=>u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['telex.hu','www.telex.hu'].includes(u.hostname)});
    }else throw e;
  }

  return html;
}
module.exports={canonicalTelexUrl,clientIdentity,fetchTelexHtml};
