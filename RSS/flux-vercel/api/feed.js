const FEED_DIRECTORY = [
  { name: 'Telex', url: 'https://telex.hu/rss', site: 'telex.hu', tags: ['hírek', 'news', 'magyar'] },
  { name: 'Index', url: 'https://index.hu/24ora/rss', site: 'index.hu', tags: [] },
  { name: '444', url: 'https://444.hu/feed', site: '444.hu', tags: ['hírek', 'news', 'magyar'] },
  { name: 'HVG', url: 'https://hvg.hu/rss', site: 'hvg.hu', tags: ['hírek', 'news', 'magyar'] },
  { name: '24.hu', url: 'https://24.hu/feed/', site: '24.hu', tags: ['hírek', 'news', 'magyar'] },
  { name: 'Portfolio', url: 'https://www.portfolio.hu/rss/all.xml', site: 'portfolio.hu', tags: ['gazdaság', 'business', 'finance'] },
  { name: 'Qubit', url: 'https://qubit.hu/feed', site: 'qubit.hu', tags: ['tudomány', 'science', 'tech'] },
  { name: 'Forbes Magyarország', url: 'https://forbes.hu/feed/', site: 'forbes.hu', tags: ['business', 'üzlet', 'gazdaság'] },
  { name: 'Euronews magyarul', url: 'https://feeds.euronews.com/euronews/hu/home', site: 'euronews.com', tags: ['hírek', 'európa', 'world'] },
  { name: 'Prohardver', url: 'https://prohardver.hu/hirfolyam/anyagok/rss.xml', site: 'prohardver.hu', tags: ['tech', 'hardver'] },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', site: 'theverge.com', tags: ['tech', 'technology'] },
  { name: 'Wired', url: 'https://www.wired.com/feed/rss', site: 'wired.com', tags: ['tech', 'science'] },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', site: 'arstechnica.com', tags: ['tech', 'science'] },
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml', site: 'bbc.co.uk', tags: ['news', 'world'] },
  { name: 'Reuters Top News', url: 'https://www.reutersagency.com/feed/?best-topics=top-news&post_type=best', site: 'reuters.com', tags: ['news', 'world'] },
  { name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', site: 'theguardian.com', tags: ['news', 'world'] },
  { name: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml', site: 'npr.org', tags: ['news', 'world'] }
];
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const input = String(Array.isArray(req.query?.input) ? req.query.input[0] : req.query?.input || '').trim();
  if (!input) {
    sendJson(res, 400, { error: 'missing_input' });
    return;
  }

  try {
    const parsedUrl = parseUrlInput(input);
    if (parsedUrl) {
      if (req.query?.content === '1') {
        const content = await fetchText(parsedUrl.href);
        if (!looksLikeFeed(content)) {
          sendJson(res, 422, { error: 'invalid_feed' });
          return;
        }
        sendJson(res, 200, { content });
        return;
      }

      const direct = await validateFeed(parsedUrl.href).catch(() => null);
      if (direct) {
        sendJson(res, 200, { feed: direct });
        return;
      }

      const discovered = await discoverFeeds(parsedUrl).catch(() => []);
      const fallbacks = await fallbackFeedsForSite(parsedUrl, discovered).catch(() => []);
      for (const feed of fallbacks) {
        if (!discovered.some(item => item.url === feed.url)) discovered.push(feed);
      }
      sendJson(res, 200, { results: discovered });
      return;
    }

    sendJson(res, 200, { results: searchDirectory(input) });
  } catch (err) {
    sendJson(res, 502, { error: 'feed_lookup_failed' });
  }
};

function parseUrlInput(input) {
  if (!/[.:/]/.test(input)) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function searchDirectory(query) {
  const needle = normalizeForSearch(query);
  if (needle.length < 2) return [];
  return FEED_DIRECTORY
    .map(feed => ({ feed, score: feedScore(feed, needle) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.feed.name.localeCompare(b.feed.name))
    .slice(0, 10)
    .map(item => formatResult(item.feed));
}

function feedScore(feed, needle) {
  const name = normalizeForSearch(feed.name);
  const site = normalizeForSearch(feed.site);
  const tags = normalizeForSearch((feed.tags || []).join(' '));
  if (name === needle || site === needle) return 100;
  if (name.startsWith(needle) || site.startsWith(needle)) return 80;
  if (name.includes(needle) || site.includes(needle)) return 60;
  if (tags.includes(needle)) return 35;
  return 0;
}

async function discoverFeeds(siteUrl) {
  const html = await fetchText(siteUrl.href);
  const seen = new Set();
  const results = [];
  const linkRe = /<link\b[^>]*>/gi;
  let match;
  while ((match = linkRe.exec(html)) && results.length < 12) {
    const tag = match[0];
    const rel = attr(tag, 'rel');
    const type = attr(tag, 'type');
    const href = attr(tag, 'href');
    if (!href || !/alternate/i.test(rel) || !/(rss|atom|json)\+?xml|jsonfeed/i.test(type)) continue;
    const url = new URL(decodeHtml(href), siteUrl).href;
    if (seen.has(url)) continue;
    seen.add(url);
    const title = decodeHtml(attr(tag, 'title') || '');
    const feed = await validateFeed(url, title).catch(() => null);
    if (feed) results.push(feed);
  }
  return results;
}

async function fallbackFeedsForSite(siteUrl, existing = []) {
  const results = [];
  const host = siteUrl.hostname.replace(/^www\./, '');
  const directoryMatches = FEED_DIRECTORY.filter(feed => feed.site === host || host.endsWith(`.${feed.site}`));
  for (const feed of directoryMatches) results.push(formatResult(feed));

  const base = `${siteUrl.protocol}//${siteUrl.host}`;
  const candidates = ['/rss', '/feed', '/rss.xml', '/feed.xml', '/atom.xml'];
  for (const path of candidates) {
    const url = base + path;
    if (existing.some(feed => feed.url === url) || results.some(feed => feed.url === url)) continue;
    const feed = await validateFeed(url).catch(() => null);
    if (feed) results.push(feed);
    if (results.length >= 10) break;
  }
  return results.slice(0, 10);
}

async function validateFeed(url, fallbackTitle = '') {
  const text = await fetchText(url);
  if (!looksLikeFeed(text)) return null;
  const title = extractFeedTitle(text) || fallbackTitle || feedNameFromUrl(url);
  return { name: title, url, site: new URL(url).hostname.replace(/^www\./, '') };
}

function looksLikeFeed(text) {
  return /<(rss|feed)\b/i.test(text) || /"version"\s*:\s*"https:\/\/jsonfeed\.org\/version\//i.test(text);
}

function extractFeedTitle(text) {
  const channel = firstMatch(text, /<channel\b[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
  const atom = firstMatch(text, /<feed\b[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeXml(channel || atom || '');
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml,text/xml,application/rss+xml,application/atom+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'hu-HU,hu;q=0.9,en-US;q=0.8,en;q=0.7',
      'user-agent': 'Mozilla/5.0 FluxReader/1.0'
    }
  });
  if (!response.ok) throw new Error(`upstream_${response.status}`);
  return response.text();
}

function formatResult(feed) {
  return {
    name: feed.name,
    url: feed.url,
    site: feed.site || new URL(feed.url).hostname.replace(/^www\./, '')
  };
}

function feedNameFromUrl(url) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const name = host.split('.')[0] || host;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'));
  return match?.[1] || '';
}

function firstMatch(text, pattern) {
  const match = text.match(pattern);
  return match?.[1] || '';
}

function normalizeForSearch(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXml(text) {
  return decodeHtml(String(text || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}
