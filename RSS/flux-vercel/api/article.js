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
  const host = articleUrl.hostname;
  if (host.includes('index.hu')) return extractIndexArticle(html, articleUrl.href);
  if (host.includes('hvg.hu')) return extractHvgArticle(html, articleUrl.href);
  if (host.includes('portfolio.hu')) return extractPortfolioArticle(html, articleUrl.href);
  return extractTelexArticle(html, articleUrl.href);
}

function extractTelexArticle(html, sourceUrl) {
  let content = extractElementByClass(html, 'article-html-content') || '';
  content = cleanupArticleContent(content, sourceUrl);

  return {
    source: 'telex',
    url: sourceUrl,
    title: meta(html, 'property', 'og:title') || textBetween(html, '<h1', '</h1>'),
    desc: meta(html, 'property', 'og:description') || meta(html, 'name', 'description'),
    image: meta(html, 'property', 'og:image'),
    date: meta(html, 'name', 'article:published_time'),
    content
  };
}

function extractIndexArticle(html, sourceUrl) {
  const lead = cleanupArticleContent(extractElementByClass(html, 'lead') || '', sourceUrl);
  const body = cleanupArticleContent(extractElementByClass(html, 'cikk-torzs') || '', sourceUrl);
  const content = [lead ? `<p>${lead}</p>` : '', body].join('\n').trim();

  return {
    source: 'index',
    url: sourceUrl,
    title: meta(html, 'property', 'og:title') || textBetween(html, '<h1', '</h1>'),
    desc: meta(html, 'property', 'og:description') || meta(html, 'name', 'description'),
    image: meta(html, 'property', 'og:image') || meta(html, 'name', 'i:image16_9'),
    date: meta(html, 'property', 'article:published_time'),
    content
  };
}

function extractHvgArticle(html, sourceUrl) {
  const lead = cleanupArticleContent(extractElementByClass(html, 'lead') || '', sourceUrl);
  const body = cleanupArticleContent(extractElementById(html, 'free-body') || '', sourceUrl);
  const content = [lead ? `<p>${lead}</p>` : '', body].join('\n').trim();

  return {
    source: 'hvg',
    url: sourceUrl,
    title: meta(html, 'property', 'og:title') || textBetween(html, '<h1', '</h1>'),
    desc: meta(html, 'property', 'og:description') || meta(html, 'name', 'description'),
    image: meta(html, 'property', 'og:image') || meta(html, 'itemprop', 'image'),
    date: meta(html, 'property', 'article:published_time') || meta(html, 'itemprop', 'datePublished'),
    content
  };
}

function extractPortfolioArticle(html, sourceUrl) {
  const lead = cleanupArticleContent(extractElementByClass(html, 'pfarticle-section-lead') || '', sourceUrl);
  const body = cleanupArticleContent(extractElementByClass(html, 'pfarticle-section-content') || '', sourceUrl);
  const content = [lead ? `<p>${lead}</p>` : '', body].join('\n').trim();

  return {
    source: 'portfolio',
    url: sourceUrl,
    title: meta(html, 'property', 'og:title') || textBetween(html, '<h1', '</h1>'),
    desc: meta(html, 'property', 'og:description') || meta(html, 'name', 'description'),
    image: meta(html, 'property', 'og:image') || meta(html, 'name', 'twitter:image'),
    date: meta(html, 'name', 'publish-date'),
    content
  };
}

function extractElementByClass(html, className) {
  const span = elementSpanByClass(html, className);
  return span ? html.slice(span.innerStart, span.innerEnd) : '';
}

function extractElementById(html, id) {
  const span = elementSpanById(html, id);
  return span ? html.slice(span.innerStart, span.innerEnd) : '';
}

function elementSpanByClass(html, className) {
  const startRe = /<([a-z0-9-]+)\b[^>]*class=["']([^"']*)["'][^>]*>/ig;
  let match;
  while ((match = startRe.exec(html))) {
    if (match[2].split(/\s+/).includes(className)) break;
  }
  if (!match) return null;

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

function elementSpanById(html, id) {
  const startRe = new RegExp(`<([a-z0-9-]+)\\b(?=[^>]*\\bid=["']${escapeRe(id)}["'])[^>]*>`, 'ig');
  const match = startRe.exec(html);
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
  let out = content;
  out = removeElementsById(out, ['googlePrefBanner']);
  out = removeElementsByClass(out, [
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
  ]);
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<style\b[\s\S]*?<\/style>/gi, '');
  out = out.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');
  out = out.replace(/<p\b[^>]*class=["'][^"']*\bad\b[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '');
  out = out.replace(/<div\b[^>]*class=["'][^"']*\bplaceholder\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
  out = out.replace(/\s(?:href|src)=["']\/\/([^"']*)["']/gi, (m, p1) => m.replace('//' + p1, 'https://' + p1));
  out = out.replace(/\s(?:href|src)=["']\/([^"']*)["']/gi, (m, p1) => m.replace('/' + p1, new URL('/' + p1, base).href));
  return out.trim();
}

function removeElementsByClass(html, classNames) {
  let out = html;
  for (const className of classNames) {
    let span;
    while ((span = elementSpanByClass(out, className))) {
      out = out.slice(0, span.start) + out.slice(span.end);
    }
  }
  return out;
}

function removeElementsById(html, ids) {
  let out = html;
  for (const id of ids) {
    const re = new RegExp(`<([a-z0-9-]+)\\b(?=[^>]*\\bid=["']${escapeRe(id)}["'])[^>]*>`, 'i');
    let match;
    while ((match = re.exec(out))) {
      const tag = match[1].toLowerCase();
      let depth = 1;
      const tokenRe = new RegExp(`</?${tag}\\b[^>]*>`, 'ig');
      tokenRe.lastIndex = match.index + match[0].length;
      let token;
      while ((token = tokenRe.exec(out))) {
        if (token[0][1] === '/') depth--;
        else depth++;
        if (depth === 0) {
          out = out.slice(0, match.index) + out.slice(tokenRe.lastIndex);
          break;
        }
      }
      if (!token) break;
    }
  }
  return out;
}

function meta(html, attr, value) {
  const re = new RegExp(`<meta\\b(?=[^>]*\\b${attr}=["']${escapeRe(value)}["'])(?=[^>]*\\bcontent=["']([^"']*)["'])[^>]*>`, 'i');
  const match = re.exec(html);
  return match ? decodeHtml(match[1]) : '';
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
