'use strict';
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const CODES = Object.freeze({
  invalid_request:400, unsupported_source:400, relay_unauthorized:503,
  source_blocked:403, source_challenge:403, source_rate_limited:429,
  reader_rate_limited:429, reader_daily_limit:429, reader_busy:503,
  source_timeout:504, source_unavailable:502, relay_unavailable:503,
  guard_unavailable:503, invalid_content:422, extract_failed:422,
  response_too_large:502, redirect_blocked:502
});
class ArticleFetchError extends Error {
  constructor(code, options = {}) {
    super(typeof code==='string' && Object.hasOwn(CODES,code) ? code : 'source_unavailable');
    this.code = this.message;
    this.statusCode = CODES[this.code];
    this.retryAfter = Math.ceil(Math.max(1, Math.min(86400, Number(options.retryAfter) || (['source_blocked','source_challenge'].includes(this.code) ? 120 : 30))));
    if (Number.isInteger(options.upstreamStatus) && options.upstreamStatus>=100 && options.upstreamStatus<=599) this.upstreamStatus = options.upstreamStatus;
    this.directFallbackAllowed = options.directFallbackAllowed === true;
  }
}
function retryAfter(value, fallback = 30) {
  if (!value) return fallback;
  const n = Number(value);
  return Math.max(1, Math.min(86400, Number.isFinite(n) ? Math.ceil(n) : Math.ceil((Date.parse(value)-Date.now())/1000) || fallback));
}
async function limitedText(response, max = MAX_HTML_BYTES) {
  if (Number(response.headers.get('content-length')) > max) throw new ArticleFetchError('response_too_large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new ArticleFetchError('response_too_large'); }
      text += decoder.decode(value,{stream:true});
    }
  } catch(e) {
    if (['AbortError','TimeoutError'].includes(e?.name)) throw new ArticleFetchError('source_timeout');
    throw e;
  } finally { reader.releaseLock(); }
}
function isChallenge(html) {
  const title = (/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').replace(/<[^>]*>/g,'').trim();
  return /^(?:just a moment(?:\.{0,3}|…)|attention required!?(?:\s*\|\s*cloudflare)?|security verification|checking your browser(?:\.{0,3}|…))$/i.test(title)
    && /(?:cf-chl-|\/cdn-cgi\/challenge-platform|performing security verification|verify (?:that )?you are human|checking your browser)/i.test(html);
}
async function htmlBody(response) {
  const html = await limitedText(response);
  if (isChallenge(html)) throw new ArticleFetchError('source_challenge',{upstreamStatus:response.status});
  if (response.headers.get('content-type') && !/(?:text\/html|application\/xhtml\+xml)/i.test(response.headers.get('content-type'))) throw new ArticleFetchError('invalid_content',{upstreamStatus:response.status});
  if (!html.trim()) throw new ArticleFetchError('invalid_content',{upstreamStatus:response.status});
  return html;
}
function statusError(status, after) {
  if (status === 403 || status === 401) return new ArticleFetchError('source_blocked',{upstreamStatus:status});
  if (status === 429) return new ArticleFetchError('source_rate_limited',{upstreamStatus:status,retryAfter:after});
  if (status >= 300 && status < 400) return new ArticleFetchError('redirect_blocked',{upstreamStatus:status});
  return new ArticleFetchError('source_unavailable',{upstreamStatus:status});
}
async function fetchResponse(url, options, timeout, relay) {
  try { return await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(timeout)}); }
  catch (e) { throw new ArticleFetchError(relay ? 'relay_unavailable' : (['TimeoutError','AbortError'].includes(e?.name) ? 'source_timeout' : 'source_unavailable')); }
}
async function fetchDirectHtml(url, {headers, allowUrl, timeout = 4000, maxRedirects = 2} = {}) {
  for (let redirects=0; redirects<=maxRedirects; redirects++) {
    const response = await fetchResponse(url,{headers},timeout,false);
    if (response.status >= 300 && response.status < 400) {
      let target;
      try {const location=response.headers.get('location');if(!location)throw new Error('missing redirect');target = new URL(location,url);} catch {throw new ArticleFetchError('redirect_blocked');}
      if (redirects===maxRedirects || !allowUrl?.(target)) throw new ArticleFetchError('redirect_blocked',{upstreamStatus:response.status});
      await response.body?.cancel();url=target.href;continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw statusError(response.status,retryAfter(response.headers.get('retry-after'))); }
    return htmlBody(response);
  }
}
async function fetchRelayHtml(url, {headers, timeout = 7500} = {}) {
  const response = await fetchResponse(url,{headers},timeout,true);
  if (!response.ok || /application\/json/i.test(response.headers.get('content-type')||'')) {
    let data;
    try { data=JSON.parse(await limitedText(response,16384)); } catch(e) { if(e instanceof ArticleFetchError) throw e; }
    const code = data?.code || data?.error;
    if (typeof code==='string' && Object.hasOwn(CODES,code)) {
      const permitted = data.directFallbackAllowed === true && ['source_timeout','source_unavailable'].includes(code);
      throw new ArticleFetchError(code,{upstreamStatus:Number.isInteger(data.upstreamStatus)?data.upstreamStatus:undefined,retryAfter:retryAfter(data.retryAfter || response.headers.get('retry-after')),directFallbackAllowed:permitted});
    }
    // Legacy/unknown relay errors never grant an unbudgeted direct retry.
    throw new ArticleFetchError('relay_unavailable',{upstreamStatus:response.status,retryAfter:30});
  }
  return htmlBody(response);
}
module.exports={ArticleFetchError,fetchDirectHtml,fetchRelayHtml,isChallenge,limitedText};
