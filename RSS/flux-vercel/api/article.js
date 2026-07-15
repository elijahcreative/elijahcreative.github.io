const ARTICLE_HOSTS = new Set([
  'telex.hu',
  'www.telex.hu',
  'index.hu',
  'www.index.hu',
  'hvg.hu',
  'www.hvg.hu',
  'portfolio.hu',
  'www.portfolio.hu',
  '444.hu',
  'www.444.hu',
  '24.hu',
  'www.24.hu'
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
    content: (html, url) => cleanupArticleContent(extractElementsByClass(html, 'article-html-content').join('\n'), url)
  },
  {
    source: '444',
    host: '444.hu',
    image: [['property', 'og:image'], ['name', 'twitter:image']],
    date: [['property', 'article:published_time']],
    content: (html, url, ctx) => extract444Content(html, url, ctx)
  },
  {
    source: '24',
    host: '24.hu',
    image: [['property', 'og:image'], ['property', 'og:image:secure_url'], ['name', 'twitter:image']],
    date: [['property', 'article:published_time'], ['itemprop', 'datePublished']],
    content: (html, url) => joinLeadBody(extractElementByClass(html, 'o-post__lead'), extractElementByClass(html, 'o-post__body'), url)
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
  'newsletter-box',
  'chart-trader-ad',
  'banner-container',
  'm-articleWidget',
  'm-articleListWidget',
  'article_box_border_szponzibox'
];
const STRIP_PATTERNS = [
  /<script\b[\s\S]*?<\/script>/gi,
  /<style\b[\s\S]*?<\/style>/gi,
  /<iframe\b[\s\S]*?<\/iframe>/gi,
  /<p\b[^>]*class=["'][^"']*\bad\b[^"']*["'][^>]*>[\s\S]*?<\/p>/gi,
  /<div\b[^>]*class=["'][^"']*\bplaceholder\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
  /<p>\s*The post[\s\S]*?first appeared on[\s\S]*?<\/p>/gi
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
  const image = metaFirst(html, cfg.image);
  return {
    source: cfg.source,
    url: articleUrl.href,
    title: metaFirst(html, [['property', 'og:title']]) || textBetween(html, '<h1', '</h1>'),
    desc: metaFirst(html, [['property', 'og:description'], ['name', 'description']]),
    image,
    date: metaFirst(html, cfg.date),
    author: metaFirst(html, [['name', 'author'], ['property', 'article:author'], ['name', 'dc.creator']]),
    content: cfg.content(html, articleUrl.href, { image })
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
function extract444Content(html, sourceUrl, ctx = {}) {
  const article = extract444Article(html, sourceUrl);
  if (!article) return '';
  const blocks = flatten444Blocks(article.body);
  const seenImages = new Set();
  const content = blocks.map(block => {
    const src = imageSrc444(block);
    if (src) {
      const key = imageKey(src);
      if (!key || seenImages.has(key) || imageKey(ctx.image) === key) return '';
      seenImages.add(key);
    }
    return render444Block(block, sourceUrl);
  }).filter(Boolean).join('\n');
  return cleanupArticleContent(content, sourceUrl);
}
function extract444Article(html, sourceUrl) {
  const raw = extractElementById(html, 'shoebox-apollo-cache');
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const cache = data.cache || data;
  const articles = Object.values(cache).filter(item => item && Array.isArray(item.body));
  const wanted = normalizeArticleUrl(sourceUrl);
  return articles.find(item => normalizeArticleUrl(item.url) === wanted) || articles[0] || null;
}
function flatten444Blocks(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flatten444Blocks);
  if (typeof value === 'object') {
    if (value.type) return [value];
    return Object.values(value).flatMap(flatten444Blocks);
  }
  return [];
}
function render444Block(block, sourceUrl) {
  const type = String(block.type || '').replace(/^core\//, '');
  const content = String(block.content || '').trim();
  if (type === 'paragraph') return content ? `<p>${content}</p>` : '';
  if (type === 'heading') return content ? `<h3>${content}</h3>` : '';
  if (type === 'quote' || type === 'blockquote') return content ? `<blockquote>${content}</blockquote>` : '';
  if (type === 'list') return content;
  if (type !== 'image') return '';

  const media = block.params?.mediaItem || {};
  const src = imageSrc444(block);
  if (!src) return '';
  const captionParts = uniqueTextParts([block.content, media.caption, media.author]);
  const caption = captionParts.join(' ');
  const img = `<img src="${escapeAttr(absoluteUrl(src, sourceUrl))}" alt="${escapeAttr(caption)}">`;
  return captionParts.length ? `<figure>${img}<figcaption class="article-image-meta">${captionParts.map((part, i) =>
    `${i ? '<span class="meta-sep" aria-hidden="true"></span>' : ''}<span>${escapeHtml(part)}</span>`
  ).join('')}</figcaption></figure>` : img;
}
function imageSrc444(block) {
  if (!block || String(block.type || '').replace(/^core\//, '') !== 'image') return '';
  return block.params?.mediaItem?.url || block.params?.src || '';
}
function uniqueTextParts(parts) {
  const seen = new Set();
  return parts.map(part => plainText(part || '')).filter(part => {
    const key = part.toLowerCase();
    if (!part || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function extractElementByClass(html, className) {
  const span = elementSpan(html, { className });
  return span ? html.slice(span.innerStart, span.innerEnd) : '';
}
function extractElementsByClass(html, className) {
  const chunks = [];
  let offset = 0;
  while (offset < html.length) {
    const span = elementSpan(html.slice(offset), { className });
    if (!span) break;
    chunks.push(html.slice(offset + span.innerStart, offset + span.innerEnd));
    offset += span.end;
  }
  return chunks;
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
function normalizeArticleUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return u.href.replace(/\/+$/, '');
  } catch {
    return String(url || '').split(/[?#]/)[0].replace(/\/+$/, '');
  }
}
function absoluteUrl(url, sourceUrl) {
  try {
    if (String(url).startsWith('//')) return 'https:' + url;
    return new URL(url, sourceUrl).href;
  } catch {
    return url;
  }
}
function imageKey(url) {
  if (!url) return '';
  const cleanName = name => String(name || '').replace(/-(?:xs|sm|md|lg|xl|full)(?=\.[a-z0-9]+$)/i, '');
  try {
    const u = new URL(String(url).startsWith('//') ? 'https:' + url : url);
    return cleanName(u.pathname.split('/').filter(Boolean).pop() || '');
  } catch {
    return cleanName(String(url).split(/[?#]/)[0].split('/').filter(Boolean).pop() || '');
  }
}
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(text) {
  return escapeHtml(text).replace(/`/g, '&#96;');
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
