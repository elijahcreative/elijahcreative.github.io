const ARTICLE_HOSTS = new Set([
  'telex.hu',
  'www.telex.hu',
  'index.hu',
  'www.index.hu',
  'hvg.hu',
  'www.hvg.hu',
  'portfolio.hu',
  'www.portfolio.hu'
]);
const SOURCE_CONFIG = [
  {
    source: 'index',
    host: 'index.hu',
    image: [['property', 'og:image'], ['name', 'i:image16_9']],
    date: [['property', 'article:published_time']],
    content: (html, url) => joinLeadBody(
      extractElementByClass(html, 'lead'),
      extractElementByClass(html, 'cikk-torzs') || extractIndexLiveblogEntry(html, url),
      url
    )
  },
  {
    source: 'hvg',
    host: 'hvg.hu',
    image: [['property', 'og:image'], ['itemprop', 'image']],
    date: [['property', 'article:published_time'], ['itemprop', 'datePublished']],
    content: (html, url) => joinLeadBody(extractElementByClass(html, 'lead'), extractElementById(html, 'free-body'), url)
  },
  {
    source: 'portfolio',
    host: 'portfolio.hu',
    image: [['property', 'og:image'], ['name', 'twitter:image']],
    date: [['name', 'publish-date']],
    content: (html, url) => joinLeadBody(extractElementByClass(html, 'pfarticle-section-lead'), extractElementByClass(html, 'pfarticle-section-content'), url)
  },
  {
    source: 'telex',
    host: 'telex.hu',
    image: [['property', 'og:image']],
    date: [['name', 'article:published_time']],
    content: (html, url) => cleanupArticleContent(extractElementByClass(html, 'article-html-content') || '', url)
  }
];
const REMOVE_IDS = ['googlePrefBanner'];
const REMOVE_CLASSES = [
  'google-pref-banner',
  'cikk-bottom-text-ad',
  'social-stripe',
  'cikk-bottom-box',
  'social-follow',
  'iap',
  'miniapp',
  'microsite',
  'ad-container',
  'cikk-inline-ad',
  'adoceanzone',
  'pfadoceanzone',
  'related',
  'fs-09',
  'tags',
  'tab-content',
  'grey-tabs',
  'grid-block',
  'article-series-box',
  'recommendation-box',
  'newsletter-box'
];
const STRIP_PATTERNS = [
  /<script\b[\s\S]*?<\/script>/gi,
  /<style\b[\s\S]*?<\/style>/gi,
  /<iframe\b[\s\S]*?<\/iframe>/gi,
  /<p\b[^>]*class=["'][^"']*\bad\b[^"']*["'][^>]*>[\s\S]*?<\/p>/gi,
  /<div\b[^>]*class=["'][^"']*\bplaceholder\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi
];
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }
  try {
    await handleArticle(req, res);
  } catch (err) {
    sendJson(res, 500, { error: 'server_error' });
  }
};
async function handleArticle(req, res) {
  const rawUrl = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url || '';
  let articleUrl;
  try {
    articleUrl = new URL(rawUrl);
  } catch {
    sendJson(res, 400, { error: 'bad_url' });
    return;
  }
  if (articleUrl.protocol !== 'https:' || !ARTICLE_HOSTS.has(articleUrl.hostname)) {
    sendJson(res, 400, { error: 'unsupported_source' });
    return;
  }
  const upstream = await fetch(articleUrl.href, {
    headers: {
      'accept': 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 FluxReader/1.0'
    }
  });
  if (!upstream.ok) {
    sendJson(res, 502, { error: 'upstream_error', status: upstream.status });
    return;
  }
  const html = await upstream.text();
  const article = extractArticleForHost(articleUrl, html);
  if (!article.content || plainText(article.content).length < 240) {
    sendJson(res, 422, { error: 'extract_failed' });
    return;
  }
  sendJson(res, 200, article);
}
function extractArticleForHost(articleUrl, html) {
  const cfg = SOURCE_CONFIG.find(s => articleUrl.hostname.includes(s.host)) || SOURCE_CONFIG.at(-1);
  return {
    source: cfg.source,
    url: articleUrl.href,
    title: metaFirst(html, [['property', 'og:title']]) || textBetween(html, '<h1', '</h1>'),
    desc: metaFirst(html, [['property', 'og:description'], ['name', 'description']]),
    image: metaFirst(html, cfg.image),
    date: metaFirst(html, cfg.date),
    content: cfg.content(html, articleUrl.href)
  };
}
function extractIndexLiveblogEntry(html, sourceUrl) {
  const normalizedUrl = sourceUrl.replace(/\/+$/, '');
  const candidates = [
    sourceUrl,
    normalizedUrl,
    normalizedUrl + '/'
  ];
  let start = -1;
  for (const url of candidates) {
    start = html.indexOf(`href="${url}"`);
    if (start >= 0) break;
  }
  if (start < 0) return '';
  return extractElementByClassFrom(html, 'pp-cikk-torzs', start) || '';
}
function joinLeadBody(rawLead, rawBody, sourceUrl) {
  const lead = cleanupArticleContent(rawLead || '', sourceUrl);
  const body = cleanupArticleContent(rawBody || '', sourceUrl);
  const content = [lead ? `<p>${lead}</p>` : '', body].join('\n').trim();
  return content;
}
function extractElementByClass(html, className) {
  const span = elementSpan(html, { className });
  return span ? html.slice(span.innerStart, span.innerEnd) : '';
}
function extractElementByClassFrom(html, className, start) {
  const span = elementSpan(html.slice(start), { className });
  return span ? html.slice(start + span.innerStart, start + span.innerEnd) : '';
}
function extractElementById(html, id) {
  const span = elementSpan(html, { id });
  return span ? html.slice(span.innerStart, span.innerEnd) : '';
}
function elementSpan(html, selector) {
  const startRe = /<([a-z0-9-]+)\b[^>]*>/ig;
  let match, attrRe;
  while ((match = startRe.exec(html))) {
    const tag = match[0];
    const classes = /\bclass=["']([^"']*)["']/i.exec(tag)?.[1] || '';
    if (selector.className && classes.split(/\s+/).includes(selector.className)) break;
    if (selector.id) {
      attrRe = new RegExp(`\\bid=["']${escapeRe(selector.id)}["']`, 'i');
      if (attrRe.test(tag)) break;
    }
  }
  if (!match) return null;
  return elementSpanFromMatch(html, match);
}
function elementSpanFromMatch(html, match) {
  const tag = match[1].toLowerCase();
  let depth = 1;
  let cursor = match.index + match[0].length;
  const tokenRe = new RegExp(`</?${tag}\\b[^>]*>`, 'ig');
  tokenRe.lastIndex = cursor;
  let token;
  while ((token = tokenRe.exec(html))) {
    if (token[0][1] === '/') depth--;
    else depth++;
    if (depth === 0) {
      return {
        start: match.index,
        end: tokenRe.lastIndex,
        innerStart: cursor,
        innerEnd: token.index
      };
    }
  }
  return null;
}
function cleanupArticleContent(content, sourceUrl) {
  const base = new URL(sourceUrl);
  let out = removeElements(removeElements(content, REMOVE_IDS, id => ({ id })), REMOVE_CLASSES, className => ({ className }));
  STRIP_PATTERNS.forEach(re => { out = out.replace(re, ''); });
  out = out.replace(/\s(?:href|src)=["']\/\/([^"']*)["']/gi, (m, p1) => m.replace('//' + p1, 'https://' + p1));
  out = out.replace(/\s(?:href|src)=["']\/([^"']*)["']/gi, (m, p1) => m.replace('/' + p1, new URL('/' + p1, base).href));
  return out.trim();
}
function removeElements(html, values, toSelector) {
  let out = html;
  for (const value of values) {
    let span;
    while ((span = elementSpan(out, toSelector(value)))) {
      out = out.slice(0, span.start) + out.slice(span.end);
    }
  }
  return out;
}
function meta(html, attr, value) {
  const re = new RegExp(`<meta\\b(?=[^>]*\\b${attr}=["']${escapeRe(value)}["'])(?=[^>]*\\bcontent=["']([^"']*)["'])[^>]*>`, 'i');
  const match = re.exec(html);
  return match ? decodeHtml(match[1]) : '';
}
function metaFirst(html, pairs) {
  for (const [attr, value] of pairs) {
    const found = meta(html, attr, value);
    if (found) return found;
  }
  return '';
}
function textBetween(html, open, close) {
  const start = html.indexOf(open);
  if (start < 0) return '';
  const gt = html.indexOf('>', start);
  const end = html.indexOf(close, gt + 1);
  return end < 0 ? '' : decodeHtml(plainText(html.slice(gt + 1, end)));
}
function plainText(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function decodeHtml(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function sendJson(res, status, data) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));
}
function send(res, status, type, body) {
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}
