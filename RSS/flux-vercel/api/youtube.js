const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const CHANNEL_ID_RE = /UC[A-Za-z0-9_-]{22}/;

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
    const parsed = parseInput(input);
    if (!parsed) {
      sendJson(res, 400, { error: 'unsupported_input' });
      return;
    }

    const resolved = await resolveChannel(parsed);
    if (!resolved?.id) {
      sendJson(res, 404, { error: 'channel_not_found' });
      return;
    }

    const feed = await fetchChannelFeed(resolved.id);
    const channelName = feed.channelName || resolved.name || resolved.id;
    sendJson(res, 200, {
      id: resolved.id,
      idType: 'id',
      name: channelName,
      channelName,
      videos: feed.videos
    });
  } catch (err) {
    sendJson(res, 502, { error: 'youtube_lookup_failed' });
  }
};

function parseInput(rawInput) {
  let input = rawInput.trim().replace(/\/+$/, '');
  if (!input) return null;

  const feedId = input.match(/[?&]channel_id=(UC[A-Za-z0-9_-]{22})/)?.[1];
  if (feedId) return { type: 'id', value: feedId };
  if (CHANNEL_ID_RE.test(input) && input.match(CHANNEL_ID_RE)[0] === input) return { type: 'id', value: input };
  if (/^@[A-Za-z0-9._-]+$/.test(input)) return { type: 'page', value: `https://www.youtube.com/${input}` };

  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }

  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;

  const path = url.pathname.replace(/\/+$/, '');
  if (url.hostname === 'youtu.be') {
    const videoId = path.split('/').filter(Boolean)[0];
    return videoId ? { type: 'video', value: videoId } : null;
  }

  const directId = path.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})/)?.[1];
  if (directId) return { type: 'id', value: directId };

  const videoId = url.searchParams.get('v') || path.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/)?.[1];
  if (videoId) return { type: 'video', value: videoId };

  if (/^\/(?:@|c\/|user\/)/.test(path)) {
    return { type: 'page', value: `https://www.youtube.com${path}` };
  }

  return null;
}

async function resolveChannel(parsed) {
  if (parsed.type === 'id') return { id: parsed.value };
  if (parsed.type === 'video') return resolveVideo(parsed.value);
  if (parsed.type === 'page') return resolveChannelPage(parsed.value);
  return null;
}

async function resolveVideo(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const oembed = await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`).catch(() => null);
  if (oembed?.author_url) {
    const fromAuthorPage = await resolveChannelPage(oembed.author_url).catch(() => null);
    if (fromAuthorPage?.id) return { ...fromAuthorPage, name: oembed.author_name || fromAuthorPage.name };
  }

  const html = await fetchText(videoUrl);
  const id = extractChannelIdFromHtml(html);
  return id ? { id, name: extractChannelNameFromHtml(html) } : null;
}

async function resolveChannelPage(pageUrl) {
  const html = await fetchText(pageUrl);
  const id = extractChannelIdFromHtml(html);
  return id ? { id, name: extractChannelNameFromHtml(html) } : null;
}

async function fetchChannelFeed(channelId) {
  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
  const channelName = decodeXml(firstMatch(xml, /<author>\s*<name>([\s\S]*?)<\/name>/) || firstMatch(xml, /<title>([\s\S]*?)<\/title>/) || '');
  const videos = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRe.exec(xml)) && videos.length < 15) {
    const entry = match[1];
    const videoId = firstMatch(entry, /<yt:videoId>([^<]+)<\/yt:videoId>/) || firstMatch(entry, /[?&]v=([A-Za-z0-9_-]{11})/);
    const title = decodeXml(firstMatch(entry, /<title>([\s\S]*?)<\/title>/) || '');
    const published = firstMatch(entry, /<published>([^<]+)<\/published>/) || '';
    if (!videoId || !title) continue;
    videos.push({
      videoId,
      title,
      date: published,
      thumb: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      channelName,
      channelId
    });
  }
  return { channelName, videos };
}

function extractChannelIdFromHtml(html) {
  if (!html) return null;
  return firstMatch(html, /"externalId":"(UC[A-Za-z0-9_-]{22})"/) ||
    firstMatch(html, /"channelId":"(UC[A-Za-z0-9_-]{22})"/) ||
    firstMatch(html, /"browseId":"(UC[A-Za-z0-9_-]{22})"/) ||
    firstMatch(html, /"rssUrl":"https:\\\/\\\/www\.youtube\.com\\\/feeds\\\/videos\.xml\?channel_id=(UC[A-Za-z0-9_-]{22})"/) ||
    firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})["']/i) ||
    firstMatch(html, /<link[^>]+rel=["']alternate["'][^>]+type=["']application\/rss\+xml["'][^>]+href=["'][^"']*channel_id=(UC[A-Za-z0-9_-]{22})/i) ||
    firstMatch(html, /channel_id=(UC[A-Za-z0-9_-]{22})/) ||
    firstMatch(html, /\/channel\/(UC[A-Za-z0-9_-]{22})/);
}

function extractChannelNameFromHtml(html) {
  return decodeHtml(
    firstMatch(html, /"channelMetadataRenderer":\{"title":"([^"]+)"/) ||
    firstMatch(html, /"ownerChannelName":"([^"]+)"/) ||
    firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    ''
  );
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.8',
      'user-agent': 'Mozilla/5.0 FluxReader/1.0'
    }
  });
  if (!response.ok) throw new Error(`upstream_${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0 FluxReader/1.0'
    }
  });
  if (!response.ok) throw new Error(`upstream_${response.status}`);
  return response.json();
}

function firstMatch(text, pattern) {
  const match = text.match(pattern);
  return match?.[1] || '';
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXml(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}
