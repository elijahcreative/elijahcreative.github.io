const https = require('https');
const net = require('net');
const {randomUUID}=require('node:crypto');
const {ArticleFetchError}=require('../lib/article-transport');
const {createArticleRequestPool}=require('../lib/article-request-pool');
const {canonicalTelexUrl,clientIdentity,fetchTelexHtml}=require('../lib/telex-relay-client');
const {isWebBotAuthEnabled}=require('../lib/web-bot-auth');
const telexImages=createArticleRequestPool({maxEntries:128,maxConcurrent:4,successTtl:3600000});
async function telexImage(req,url,requestId) {
  const canonical=canonicalTelexUrl(url.href);
  const key=canonical.href+'|'+isWebBotAuthEnabled()+'|'+(process.env.TELEX_RELAY_URL || '');
  return telexImages.run(key,clientIdentity(req,process.env.TELEX_RELAY_SECRET),async()=>{
    const html=await fetchTelexHtml(req,canonical.href,requestId);
    return {image:imageFromHead(html,canonical.href)};
  });
}
const { safeLookup } = require('../lib/remote-image');

const MAX_HEAD_BYTES = 512 * 1024;
function publicUrl(value, base) {
  try {
    const url = new URL(value, base);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (url.protocol !== 'https:' || url.username || url.password ||
        (url.port && url.port !== '443') || net.isIP(host) || host === 'localhost' || host.endsWith('.localhost')) return null;
    return url;
  } catch { return null; }
}
function fetchHead(url, redirects = 3, deadline = Date.now() + 6000, req, requestId) {
  if (['telex.hu','www.telex.hu'].includes(url.hostname)) return telexImage(req,url,requestId);
  return new Promise((resolve, reject) => {
    if (Date.now() >= deadline) return reject(new Error('timeout'));
    const request = https.get(url, {
      lookup: safeLookup,
      headers: { accept: 'text/html,application/xhtml+xml', 'accept-encoding': 'identity', 'user-agent': 'Mozilla/5.0 FluxReader/1.0' }
    }, response => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.destroy();
        const target = publicUrl(response.headers.location, url);
        if (!target || redirects <= 0) return reject(new Error('redirect'));
        fetchHead(target, redirects - 1, deadline, req, requestId).then(resolve, reject);
        return;
      }
      if (status !== 200 || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers['content-type'] || '')) {
        response.destroy(); reject(new Error('not_html')); return;
      }
      let bytes = 0;
      const chunks = [];
      let complete = false;
      const finish = () => {
        if (complete) return;
        complete = true;
        resolve({ html: Buffer.concat(chunks).toString('utf8'), url: url.href });
        response.destroy();
      };
      response.on('data', chunk => {
        if (complete) return;
        const part = chunk.subarray(0, MAX_HEAD_BYTES - bytes);
        chunks.push(part); bytes += part.length;
        if (bytes >= MAX_HEAD_BYTES || /<\/head\s*>/i.test(Buffer.concat(chunks).toString('utf8'))) finish();
      });
      response.on('end', finish);
      response.on('error', error => { if (!complete) reject(error); });
    });
    const timer = setTimeout(() => request.destroy(new Error('timeout')), Math.max(1, deadline - Date.now()));
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}
function decode(value) {
  return String(value || '').replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[\da-f]+|\d+);/gi, entity => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const hex = /^&#x/i.test(entity);
    const n = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}
function imageFromHead(html, base) {
  const found = new Map();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match;
    while ((match = re.exec(tag))) attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4]);
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (attrs.content && !found.has(key)) found.set(key, attrs.content);
  }
  for (const key of ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) {
    const value = found.get(key);
    const url = value && publicUrl(value, base);
    if (url) return url.href;
  }
  return null;
}
module.exports = async function handler(req, res) {
  const requestId=randomUUID();
  res.setHeader('X-Request-ID',requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if(req.headers?.['sec-fetch-site']==='cross-site')return res.status(403).json({image:null,code:'cross_site_request',requestId});
  if (req.method !== 'GET') return res.status(405).json({ image: null });
  const value = req.query?.url;
  const url = typeof value === 'string' && value.length <= 4096 && publicUrl(value);
  if (!url) return res.status(400).json({ image: null });
  try {
    const page = await fetchHead(url,3,Date.now()+6000,req,requestId);
    const image = 'image' in page ? page.image : imageFromHead(page.html, page.url);
    res.setHeader('Cache-Control', image ? 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400' : 'public, max-age=300, s-maxage=300');
    return res.status(200).json({ image });
  } catch (error) {
    if(error instanceof ArticleFetchError){
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Retry-After',String(error.retryAfter));
      return res.status(error.statusCode).json({image:null,code:error.code,retryAfter:error.retryAfter,requestId});
    }
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).json({ image: null });
  }
};
