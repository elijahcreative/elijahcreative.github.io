const CACHE_SECONDS = 31536000;

module.exports = function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const sourceUrl = safeHttpUrl(queryValue(req, 'url'));
  if (!sourceUrl) {
    res.status(400).send('Invalid article URL');
    return;
  }

  const baseUrl = fluxBaseUrl(req);
  const title = cleanText(queryValue(req, 'title'), 280) || 'Cikk a Flux olvasóban';
  const description = cleanText(queryValue(req, 'description'), 500) || 'Olvasd el a cikket a Flux RSS olvasóban.';
  const image = safeHttpUrl(queryValue(req, 'image')) || `${baseUrl}/icons/pwa-512.png`;
  const previewImage = `${baseUrl}/share-image?v=3&image=${encodeURIComponent(image)}`;
  const readerUrl = `${baseUrl}/?open=${encodeURIComponent(sourceUrl)}`;
  const shareUrl = `${baseUrl}${requestPath(req)}`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', `public, s-maxage=${CACHE_SECONDS}, immutable`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (req.method === 'HEAD') {
    res.status(200).send('');
    return;
  }

  res.status(200).send(renderSharePage({ title, description, image: previewImage, shareUrl, readerUrl }));
};

function renderSharePage({ title, description, image, shareUrl, readerUrl }) {
  const safeTitle = escapeHtml(title);
  const safeTitleAttr = escapeAttr(title);
  const safeDescription = escapeAttr(description);
  const safeImage = escapeAttr(image);
  const safeShareUrl = escapeAttr(shareUrl);
  const safeReaderUrl = escapeAttr(readerUrl);
  const redirectJson = JSON.stringify(readerUrl).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeTitle} – Flux</title>
  <meta name="description" content="${safeDescription}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Flux">
  <meta property="og:locale" content="hu_HU">
  <meta property="og:title" content="${safeTitleAttr}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:image" content="${safeImage}">
  <meta property="og:image:secure_url" content="${safeImage}">
  <meta property="og:image:alt" content="${safeTitleAttr}">
  <meta property="og:url" content="${safeShareUrl}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitleAttr}">
  <meta name="twitter:description" content="${safeDescription}">
  <meta name="twitter:image" content="${safeImage}">
  <meta name="twitter:image:alt" content="${safeTitleAttr}">
  <link rel="canonical" href="${safeReaderUrl}">
  <script>location.replace(${redirectJson});</script>
</head>
<body>
  <p><a href="${safeReaderUrl}">Cikk megnyitása a Flux olvasóban</a></p>
</body>
</html>`;
}

function queryValue(req, key) {
  const value = req.query?.[key];
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function cleanText(value, maxLength) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function fluxBaseUrl(req) {
  const proto = firstHeader(req.headers?.['x-forwarded-proto']) || (req.socket?.encrypted ? 'https' : 'http');
  const host = firstHeader(req.headers?.['x-forwarded-host']) || req.headers?.host || '';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function requestPath(req) {
  const raw = String(req.url || '/share');
  return raw.startsWith('/api/share') ? raw.replace(/^\/api\/share/, '/share') : raw;
}

function firstHeader(value) {
  return String(value || '').split(',')[0].trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeHtml(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
