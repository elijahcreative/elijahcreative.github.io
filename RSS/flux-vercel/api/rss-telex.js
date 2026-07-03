const TELEX_RSS_URL = 'https://telex.hu/rss';
const CACHE_SECONDS = 600;
const STALE_SECONDS = 1200;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  try {
    const upstream = await fetch(TELEX_RSS_URL, {
      headers: {
        accept: 'application/rss+xml, application/xml, text/xml',
        'user-agent': 'FluxReader/1.0 RSS proxy'
      }
    });

    if (!upstream.ok) {
      res.status(502).send('Upstream RSS error');
      return;
    }

    const rss = await upstream.text();
    const baseUrl = fluxBaseUrl(req);
    const rewritten = rewriteTelexRss(rss, baseUrl);

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`);
    res.status(200).send(rewritten);
  } catch (err) {
    res.status(500).send('RSS proxy error');
  }
};

function fluxBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function rewriteTelexRss(rss, baseUrl) {
  return rss
    .replace(/<rss\b([^>]*)>/, '<rss$1 xmlns:flux="https://elijahcreative.github.io/flux">')
    .replace(/<channel><title>[\s\S]*?<\/title>/, '<channel><title>Flux RSS: Telex</title><flux:source>https://telex.hu/rss</flux:source>')
    .replace(/<item>([\s\S]*?)<\/item>/g, (item) => {
      const sourceUrl = textBetween(item, '<link>', '</link>');
      if (!sourceUrl) return item;
      const fluxUrl = `${baseUrl}/?open=${encodeURIComponent(sourceUrl)}`;
      return item
        .replace(/<link>[\s\S]*?<\/link>/, `<link>${escapeXml(fluxUrl)}</link>`)
        .replace(/<guid\b([^>]*)>[\s\S]*?<\/guid>/, `<guid$1>${escapeXml(fluxUrl)}</guid>`)
        .replace('</item>', `<flux:originalLink>${escapeXml(sourceUrl)}</flux:originalLink></item>`);
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
