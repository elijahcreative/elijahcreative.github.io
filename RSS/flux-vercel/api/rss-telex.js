const TELEX_RSS_URL = 'https://telex.hu/rss';
const RSS2JSON_URL = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(TELEX_RSS_URL)}`;
const CACHE_SECONDS = 600;
const STALE_SECONDS = 1200;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  try {
    setRssHeaders(res);
    if (req.method === 'HEAD') {
      res.status(200).send('');
      return;
    }

    const rss = await fetchTelexRss();
    const baseUrl = fluxBaseUrl(req);
    const rewritten = rewriteTelexRss(rss, baseUrl);

    res.status(200).send(rewritten);
  } catch (err) {
    res.status(500).send('RSS proxy error');
  }
};

function setRssHeaders(res) {
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`);
}

async function fetchTelexRss() {
  const upstream = await fetch(TELEX_RSS_URL, {
    headers: {
      accept: 'application/rss+xml, application/xml, text/xml',
      'user-agent': 'FluxReader/1.0 RSS proxy'
    }
  }).catch(() => null);
  if (upstream?.ok) return upstream.text();

  const fallback = await fetch(RSS2JSON_URL, {
    headers: { accept: 'application/json' }
  });
  if (!fallback.ok) throw new Error('upstream_rss');
  const data = await fallback.json();
  if (data.status !== 'ok' || !Array.isArray(data.items)) throw new Error('invalid_fallback_rss');
  return rssFromJson(data);
}

function rssFromJson(data) {
  const feed = data.feed || {};
  const items = data.items.map(item => {
    const link = item.link || '';
    const image = item.enclosure?.link || item.thumbnail || '';
    const categories = Array.isArray(item.categories) ? item.categories : [];
    return `<item><title>${escapeXml(item.title || '')}</title><link>${escapeXml(link)}</link><guid isPermaLink="false">${escapeXml(item.guid || link || item.title || '')}</guid>${categories.map(category => `<category>${escapeXml(category)}</category>`).join('')}<pubDate>${escapeXml(rssDate(item.pubDate))}</pubDate><author>${escapeXml(item.author || '')}</author><description>${escapeXml(item.description || item.content || '')}</description>${image ? `<enclosure url="${escapeXml(image)}" type="${escapeXml(item.enclosure?.type || 'image/jpeg')}" length="0"/>` : ''}</item>`;
  }).join('');
  return `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>${escapeXml(feed.title || 'Telex RSS: Legfrissebb')}</title><link>${escapeXml(feed.link || TELEX_RSS_URL)}</link><description>${escapeXml(feed.description || 'Articles from https://telex.hu')}</description>${items}</channel></rss>`;
}

function rssDate(value) {
  const raw = String(value || '');
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? raw : date.toUTCString();
}

function fluxBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function rewriteTelexRss(rss, baseUrl) {
  return rss
    .replace(/<channel><title>[\s\S]*?<\/title>/, '<channel><title>Flux RSS: Telex</title>')
    .replace(/<item>([\s\S]*?)<\/item>/g, (item) => {
      const sourceUrl = textBetween(item, '<link>', '</link>');
      if (!sourceUrl) return item;
      const fluxUrl = `${baseUrl}/?open=${encodeURIComponent(sourceUrl)}`;
      return item
        .replace(/<link>[\s\S]*?<\/link>/, `<link>${escapeXml(fluxUrl)}</link>`)
        .replace(/<guid\b([^>]*)>[\s\S]*?<\/guid>/, `<guid$1>${escapeXml(fluxUrl)}</guid>`);
    });
}

function textBetween(text, start, end) {
  const from = text.indexOf(start);
  if (from < 0) return '';
  const to = text.indexOf(end, from + start.length);
  return to < 0 ? '' : text.slice(from + start.length, to).trim();
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
