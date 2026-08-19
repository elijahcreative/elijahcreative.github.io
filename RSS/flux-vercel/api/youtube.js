const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const CHANNEL_ID_RE = /UC[A-Za-z0-9_-]{22}/;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const input = String(Array.isArray(req.query?.input) ? req.query.input[0] : req.query?.input || '').trim();
  const fresh = String(Array.isArray(req.query?.fresh) ? req.query.fresh[0] : req.query?.fresh || '') === '1';
  if (!input) {
    sendJson(res, 400, { error: 'missing_input' });
    return;
  }

  try {
    res.setHeader('Cache-Control', fresh ? 'no-store' : 'public, s-maxage=300, stale-while-revalidate=60');
    const parsed = parseInput(input);
    if (!parsed) {
      const results = await searchChannels(input);
      if (!results.length) {
        const handleGuess = await resolveHandleGuess(input).catch(() => null);
        if (handleGuess) results.push(handleGuess);
      }
      sendJson(res, 200, { results });
      return;
    }

    const resolved = await resolveChannel(parsed);
    if (!resolved?.id) {
      sendJson(res, 404, { error: 'channel_not_found' });
      return;
    }

    const feed = await fetchChannelVideos(resolved.id);
    const channelName = feed.channelName || resolved.name || resolved.id;
    sendJson(res, 200, {
      id: resolved.id,
      idType: 'id',
      name: channelName,
      channelName,
      source: feed.source,
      videos: feed.videos
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
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

async function searchChannels(query) {
  const normalizedQuery = query.replace(/^@+/, '').trim();
  if (normalizedQuery.length < 2) return [];

  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(normalizedQuery)}&sp=EgIQAg%253D%253D`;
  const html = await fetchText(url);
  const results = [];
  const seen = new Set();
  const re = /"channelRenderer":\{"channelId":"(UC[A-Za-z0-9_-]{22})"[\s\S]{0,1000}?"title":\{"simpleText":"([^"]+)"[\s\S]{0,2400}?"canonicalBaseUrl":"([^"]+)"/g;
  let match;
  while ((match = re.exec(html)) && results.length < 8) {
    const id = match[1];
    if (seen.has(id)) continue;
    const name = decodeHtml(match[2]);
    const handle = decodeHtml(match[3]).replace(/^\//, '');
    if (!isRelevantChannelResult(normalizedQuery, name, handle)) continue;
    seen.add(id);
    results.push({
      id,
      idType: 'id',
      name,
      handle
    });
  }
  return results;
}

async function resolveHandleGuess(query) {
  const handle = query.trim().replace(/^@+/, '');
  if (!/^[A-Za-z0-9._-]{2,}$/.test(handle)) return null;
  const resolved = await resolveChannelPage(`https://www.youtube.com/@${handle}`);
  return resolved?.id ? {
    id: resolved.id,
    idType: 'id',
    name: resolved.name || handle,
    handle: `@${handle}`
  } : null;
}

function isRelevantChannelResult(query, name, handle) {
  const needle = normalizeForSearch(query);
  if (!needle) return false;
  return normalizeForSearch(name).includes(needle) ||
    normalizeForSearch(handle.replace(/^@/, '')).includes(needle);
}

function normalizeForSearch(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
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

async function fetchChannelVideos(channelId) {
  try {
    const feed = await fetchChannelFeed(channelId);
    if (feed.videos.length) return { ...feed, source: 'rss' };
  } catch (err) {}

  const page = await fetchChannelPageVideos(channelId);
  if (!page.videos.length) throw new Error('channel_videos_not_found');
  return { ...page, source: 'page' };
}

async function fetchChannelPageVideos(channelId) {
  const html = await fetchText(`https://www.youtube.com/channel/${encodeURIComponent(channelId)}/videos`);
  const data = extractInitialData(html);
  if (!data) return { channelName: channelId, videos: [] };

  const channelName = extractChannelNameFromHtml(html) || channelId;
  const models = [];
  walk(data, value => {
    const model = value?.lockupViewModel;
    if (model?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') models.push(model);
  });

  const seen = new Set();
  const videos = [];
  for (const model of models) {
    const videoId = model.contentId;
    const modelMetadata = model.metadata?.lockupMetadataViewModel;
    const title = modelMetadata?.title?.content || '';
    if (!videoId || !title || seen.has(videoId)) continue;
    seen.add(videoId);
    const parts = modelMetadata?.metadata?.contentMetadataViewModel?.metadataRows
      ?.flatMap(row => row.metadataParts || [])
      .map(part => part.text?.content || '') || [];
    const relativeDate = parts.find(part => /ago|streamed|premiered|scheduled/i.test(part)) || '';
    videos.push({
      videoId,
      title: decodeHtml(title),
      date: relativeDateToIso(relativeDate),
      thumb: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      channelName,
      channelId
    });
    if (videos.length >= 15) break;
  }
  return { channelName, videos };
}

function extractInitialData(html) {
  const marker = ['var ytInitialData = ', 'window["ytInitialData"] = ', 'ytInitialData = ']
    .find(candidate => html.includes(candidate));
  if (!marker) return null;
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf(';</script>', jsonStart);
  if (jsonEnd < 0) return null;
  try { return JSON.parse(html.slice(jsonStart, jsonEnd)); } catch (err) { return null; }
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  Object.values(value).forEach(child => walk(child, visit));
}

function relativeDateToIso(text) {
  const value = String(text || '').toLowerCase();
  const scheduled = Date.parse(value.replace(/^scheduled for\s+/, ''));
  if (value.startsWith('scheduled for') && Number.isFinite(scheduled)) return new Date(scheduled).toISOString();
  const match = value.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?/);
  if (!match) return new Date().toISOString();
  const unitMs = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000
  }[match[2]];
  return new Date(Date.now() - Number(match[1]) * unitMs).toISOString();
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
    cache: 'no-store',
    signal: AbortSignal.timeout(4500),
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.8',
      'cache-control': 'no-cache',
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
