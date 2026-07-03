const RSS2JSON    = 'https://api.rss2json.com/v1/api.json?rss_url=';
const ALLORIGINS  = 'https://api.allorigins.win/get?url=';
const CORSPROXY   = 'https://corsproxy.io/?';
const ARTICLE_API = '/api/article?url=';
const YOUTUBE_API = '/api/youtube?input=';
const FEED_API    = '/api/feed?input=';
const CACHE_TTL   = 5 * 60 * 1000; // 5 minutes
const FEED_ARTICLE_LIMIT = 20;
const ARTICLE_HOSTS = new Set(['telex.hu','www.telex.hu','index.hu','www.index.hu','hvg.hu','www.hvg.hu','portfolio.hu','www.portfolio.hu']);
try { history.scrollRestoration = 'manual'; } catch(e) {}
let activeArticleMode = null;
let articleListSnapshot = null;
let currentArticleIds = [];
function fetchT(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(tid));
}
async function firstResult(attempts, accept = Boolean) {
  for (const attempt of attempts) {
    try {
      const value = await attempt();
      if (accept(value)) return value;
    } catch(e) {}
  }
  return null;
}
function proxyTextAttempts(url, ms = 10000) {
  return [
    () => fetchT(CORSPROXY + encodeURIComponent(url), { cache: 'no-store' }, ms).then(r => r.ok ? r.text() : Promise.reject()),
    () => fetchT(ALLORIGINS + encodeURIComponent(url), { cache: 'no-store' }, ms).then(r => r.ok ? r.json().then(d => d.contents) : Promise.reject()),
    () => fetchT('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url), { cache: 'no-store' }, ms).then(r => r.ok ? r.text() : Promise.reject())
  ];
}
function cacheBustUrl(url, bust = false) {
  return bust ? url + (url.includes('?') ? '&' : '?') + '_=' + Date.now() : url;
}
const PRESETS = {
  default: { name: 'Alap',
    light: { bg:'#ffffff', bg2:'#f5f5f5', card:'#ffffff', hover:'#f0f0f0', text:'#111111', text2:'#555555', muted:'#999999', border:'#e8e8e8', ac:'#0891b2', ac2:'#0e7490', acl:'#cffafe' },
    dark:  { bg:'#111111', bg2:'#1c1c1c', card:'#1c1c1c', hover:'#252525', text:'#eeeeee', text2:'#aaaaaa', muted:'#666666', border:'#2c2c2c', ac:'#22d3ee', ac2:'#0891b2', acl:'#164e63' }
  },
  nord: { name: 'Fjord',
    light: { bg:'#eceff4', bg2:'#e5e9f0', card:'#ffffff', hover:'#dce5f0', text:'#2e3440', text2:'#4c566a', muted:'#9aa3b0', border:'#d8dee9', ac:'#5e81ac', ac2:'#4c6f94', acl:'#dce5f0' },
    dark:  { bg:'#2e3440', bg2:'#3b4252', card:'#3b4252', hover:'#434c5e', text:'#eceff4', text2:'#d8dee9', muted:'#636f84', border:'#434c5e', ac:'#88c0d0', ac2:'#6db0c2', acl:'#3b4252' }
  },
  solarized: { name: 'Book',
    light: { bg:'#fff8e8', bg2:'#f7edd6', card:'#fffaf0', hover:'#f1e4c8', text:'#3f372d', text2:'#6b5d4b', muted:'#a6967f', border:'#eadcc3', ac:'#a8815d', ac2:'#8d6f52', acl:'#ead8c2' },
    dark:  { bg:'#211c18', bg2:'#2b241e', card:'#2b241e', hover:'#352c24', text:'#f2e8d8', text2:'#c9bba7', muted:'#8d7d68', border:'#3c332a', ac:'#c2a07a', ac2:'#aa8964', acl:'#3a2f27' }
  },
  rose: { name: 'Rózsa',
    light: { bg:'#fff1f2', bg2:'#ffe4e6', card:'#ffffff', hover:'#ffd6da', text:'#1e0a0c', text2:'#7b3040', muted:'#c08090', border:'#fecdd3', ac:'#e11d48', ac2:'#be123c', acl:'#ffe4e6' },
    dark:  { bg:'#1a0a0e', bg2:'#2d1420', card:'#2d1420', hover:'#3d1a2a', text:'#fecdd3', text2:'#fda4af', muted:'#9f1239', border:'#3d1a2a', ac:'#fb7185', ac2:'#f43f5e', acl:'#2d1420' }
  },
  mono: { name: 'Mono',
    light: { bg:'#ffffff', bg2:'#f0f0f0', card:'#ffffff', hover:'#e8e8e8', text:'#111111', text2:'#444444', muted:'#888888', border:'#dedede', ac:'#444444', ac2:'#222222', acl:'#e5e5e5' },
    dark:  { bg:'#111111', bg2:'#1e1e1e', card:'#1e1e1e', hover:'#2a2a2a', text:'#eeeeee', text2:'#aaaaaa', muted:'#555555', border:'#2a2a2a', ac:'#888888', ac2:'#666666', acl:'#2a2a2a' }
  }
};
const SWATCHES = ['#2563eb','#7c3aed','#db2777','#e11d48','#ea580c','#ca8a04','#16a34a','#0891b2'];
const FEED_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899'];
const DEFAULT_FEEDS = [
  { url: 'https://telex.hu/rss',            name: 'Telex',     color: '#ef4444' },
  { url: 'https://444.hu/feed',              name: '444',       color: '#3b82f6' },
  { url: 'https://hvg.hu/rss',               name: 'HVG',       color: '#22c55e' },
  { url: 'https://24.hu/feed/',              name: '24.hu',     color: '#14b8a6' }
];
const SUGGESTIONS = [
  { label: 'Telex',     url: 'https://telex.hu/rss' },
  { label: '444',       url: 'https://444.hu/feed' },
  { label: 'HVG',       url: 'https://hvg.hu/rss' },
  { label: '24.hu',     url: 'https://24.hu/feed/' },
  { label: 'Portfolio', url: 'https://www.portfolio.hu/rss/all.xml' },
  { label: 'Qubit',     url: 'https://qubit.hu/feed' },
  { label: 'Forbes',    url: 'https://forbes.hu/feed/' },
  { label: 'Euronews',  url: 'https://feeds.euronews.com/euronews/hu/home' }
];
const S = {
  feeds:        [],
  articles:     [],
  readLater:    [],
  activeUrl:    null,
  activeSpecialView: null,
  layout:       'magazine',
  theme:        'auto',
  preset:       'default',
  customAccent:    null,
  fontSize:        16,
  activeCategory:  null,
  ytChannels:    [],
  ytPerChannel:  3,
  ytMaxChannels: 5,
  ytColumns:     3,
  ytRows:        1,
  ytSortMode:    'channel',
  ytMiniCorner:  'tr',
  ytMiniSize:    'm',
  showYoutube:   true,
  readerMode:    'fullscreen',
  showArticleMore: true,
  articleMoreColumns: 3,
  articleMoreRows: 1,
  lastUpdated:   null,
  showWeather:   true,
  showF1:        true
};
const articleMap = {};
const extractedArticleCache = new Map();
const extractingArticlePromises = new Map();
let ytVideos = [];
const ytVideoMap = {};
let ytLoading = false;
let ytLoadProgress = 0;
let ytActiveVideoId = null;
let ytReturnScrollLeft = 0;
let ytPlayer = null;
let ytMiniEngaged = false;
let ytPlaybackIntent = false;
let ytApiPromise = null;
let ytPlaybackStartedAt = 0;
let ytLastKnownTime = 0;
let ytMiniCollapsed = false;
function ytCacheSignature() {
  return 'yt-cache-v2:' + JSON.stringify(
    (S.ytChannels || []).map(ch => `${ch.idType || 'id'}:${ch.id}`).sort()
  );
}
function ytChannelCountFromVideos(videos) {
  return new Set((videos || []).map(v => v.channelId).filter(Boolean)).size;
}
const Store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch(e) { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {} }
};
function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
const SETTINGS_KEYS = ['layout','theme','preset','customAccent','fontSize','activeUrl','ytPerChannel','ytMaxChannels','ytColumns','ytRows','ytSortMode','ytMiniCorner','ytMiniSize','showYoutube','readerMode','showArticleMore','articleMoreColumns','articleMoreRows','lastUpdated','showWeather','showF1'];
function saveSettings() {
  Store.set('flux_s', Object.fromEntries(SETTINGS_KEYS.map(k => [k, S[k]])));
}
function saveFeeds()      { Store.set('flux_f', S.feeds); }
function saveYtChannels() { Store.set('flux_yt', S.ytChannels); }
function saveArticles()   { Store.set('flux_art', S.articles); }
function saveReadLater()  { Store.set('flux_read_later', S.readLater); }
function loadStorage() {
  const s = Store.get('flux_s', {});
  Object.assign(S, {
    layout: s.layout || 'magazine',
    theme: s.theme || 'auto',
    preset: s.preset || 'default',
    customAccent: s.customAccent || null,
    fontSize: s.fontSize === 15 ? 16 : (s.fontSize || 16),
    activeUrl: s.activeUrl || null,
    ytPerChannel: s.ytPerChannel || 3,
    ytMaxChannels: s.ytMaxChannels || 5,
    ytColumns: clampInt(s.ytColumns, 1, 4, 3),
    ytRows: clampInt(s.ytRows, 1, 4, 1),
    ytSortMode: s.ytSortMode === 'time' ? 'time' : 'channel',
    ytMiniCorner: ['tl','tr','bl','br'].includes(s.ytMiniCorner) ? s.ytMiniCorner : 'tr',
    ytMiniSize: ['s','m','l'].includes(s.ytMiniSize) ? s.ytMiniSize : 'm',
    showYoutube: s.showYoutube !== false,
    readerMode: s.readerMode || (window.matchMedia?.('(max-width: 720px)').matches ? 'modal' : 'fullscreen'),
    showArticleMore: s.showArticleMore !== false,
    articleMoreColumns: clampInt(s.articleMoreColumns, 1, 4, 3),
    articleMoreRows: clampInt(s.articleMoreRows, 1, 4, 1),
    lastUpdated: s.lastUpdated || null,
    showWeather: s.showWeather !== false,
    showF1: s.showF1 !== false
  });
  const f = Store.get('flux_f', null);
  S.feeds = (f && f.length) ? f : [...DEFAULT_FEEDS];
  if (!localStorage.getItem('flux_f')) saveFeeds();
  const yt = Store.get('flux_yt', []);
  S.ytChannels = Array.isArray(yt) ? yt : [];
  const arts = Store.get('flux_art', []);
  S.articles = Array.isArray(arts) ? arts.map(a => ({ ...a, date: new Date(a.date) })) : [];
  const readLater = Store.get('flux_read_later', []);
  S.readLater = Array.isArray(readLater) ? readLater.map(item => ({
    ...item,
    article: item.article ? { ...item.article, date: new Date(item.article.date) } : null
  })).filter(item => item.id && item.article) : [];
}
const Theme = {
  apply() {
    const dark = S.theme === 'dark' || (S.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-preset', S.preset);
    const root = document.documentElement;
    const p = PRESETS[S.preset];
    const c = dark ? p.dark : p.light;
    root.style.setProperty('--bg',       c.bg);
    root.style.setProperty('--bg2',      c.bg2);
    root.style.setProperty('--bg-card',  c.card);
    root.style.setProperty('--bg-hover', c.hover);
    root.style.setProperty('--text',     c.text);
    root.style.setProperty('--text2',    c.text2);
    root.style.setProperty('--muted',    c.muted);
    root.style.setProperty('--border',   c.border);
    const ac  = S.customAccent || c.ac;
    const ac2 = S.customAccent ? this._shade(S.customAccent, -20) : c.ac2;
    const acl = S.customAccent ? this._shade(S.customAccent, 90)  : c.acl;
    root.style.setProperty('--ac',  ac);
    root.style.setProperty('--ac2', ac2);
    root.style.setProperty('--acl', acl);
    root.style.setProperty('--font-size-base', S.fontSize + 'px');
    const _hex = c.bg.replace('#','');
    const _r = parseInt(_hex.slice(0,2),16), _g = parseInt(_hex.slice(2,4),16), _b = parseInt(_hex.slice(4,6),16);
    root.style.setProperty('--bg-nav', `rgba(${_r},${_g},${_b},0.82)`);
    document.documentElement.style.backgroundColor = c.bg;
    document.body.style.backgroundColor = c.bg;
    const oldTc = document.getElementById('themeColorMeta');
    if (oldTc) oldTc.remove();
    const newTc = document.createElement('meta');
    newTc.name = 'theme-color';
    newTc.id = 'themeColorMeta';
    newTc.setAttribute('content', c.bg);
    document.head.appendChild(newTc);
    this._syncUI();
  },
  _shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
  },
  _syncUI() {
    document.querySelectorAll('.mode-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === S.theme));
    document.querySelectorAll('.reader-mode-btn[data-reader-mode]').forEach(b => b.classList.toggle('active', b.dataset.readerMode === S.readerMode));
    document.querySelectorAll('[data-setting]').forEach(input => {
      if (input.type === 'checkbox' && input.dataset.setting in S) input.checked = !!S[input.dataset.setting];
    });
    document.querySelectorAll('.preset-card').forEach(b => b.classList.toggle('active', b.dataset.preset === S.preset));
    document.querySelectorAll('.swatch').forEach(b => b.classList.toggle('active', b.dataset.color === S.customAccent));
    const sl = $('fontSlider'); if (sl) sl.value = S.fontSize;
    updateLayoutBtns();
  }
};
const Fetcher = {
  _cache: new Map(),
  async get(url, bust = false) {
    const cached = this._cache.get(url);
    if (!bust && cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
    const articles = (await this._fetchAny(url, bust) || [])
      .sort((a, b) => b.date - a.date)
      .slice(0, FEED_ARTICLE_LIMIT);
    this._cache.set(url, { data: articles, ts: Date.now() });
    return articles;
  },
  async _fetchAny(url, bust) {
    const complete = await this._viaFeedApi(url, bust).catch(() => null);
    if (complete?.length) return complete;
    const attempts = [
      () => this._direct(url, bust),
      () => this._viaCorsproxy(url, bust),
      () => this._viaAllorigins(url, bust),
      () => this._viaRss2json(url, bust)
    ];
    return Promise.any(attempts.map(fn => fn().then(a => a?.length ? a : Promise.reject())))
      .catch(() => null);
  },
  async _fromText(url, bust, load) { return this._parseXML(await load(cacheBustUrl(url, bust)), url); },
  async _viaFeedApi(url, bust = false) {
    const cb = bust ? '&_=' + Date.now() : '';
    const r = await fetchT(FEED_API + encodeURIComponent(url) + '&content=1' + cb, { cache: 'no-store' }, 12000);
    if (!r.ok) throw new Error('http');
    const d = await r.json();
    if (!d.content) throw new Error('empty');
    return this._parseXML(d.content, url);
  },
  _direct(url, bust = false) {
    return this._fromText(url, bust, async feedUrl => {
      const r = await fetchT(feedUrl, { cache: 'no-store' });
      if (!r.ok) throw new Error('http');
      return r.text();
    });
  },
  async _viaRss2json(url, bust = false) {
    const cb = bust ? '&_=' + Date.now() : '';
    const r = await fetchT(RSS2JSON + encodeURIComponent(url) + cb, { cache: 'no-store' });
    if (!r.ok) throw new Error('http');
    const d = await r.json();
    if (d.status !== 'ok') throw new Error(d.message);
    return d.items.map(i => ({
      id:         i.guid || i.link || i.title,
      title:      normalizeText(i.title || ''),
      desc:       normalizeText(this._strip(i.description || '')).slice(0, 500),
      content:    i.content || i.description || '',
      url:        i.link || '',
      image:      i.thumbnail || i.enclosure?.link || this._img(i.content || i.description || ''),
      date:       new Date(i.pubDate),
      author:     normalizeText(i.author || i.creator || ''),
      categories: i.categories || [],
      feedUrl:    url
    }));
  },
  _viaCorsproxy(url, bust = false) {
    return this._fromText(url, bust, async feedUrl => {
      const r = await fetchT(CORSPROXY + encodeURIComponent(feedUrl), { cache: 'no-store' });
      if (!r.ok) throw new Error('http');
      return r.text();
    });
  },
  _viaAllorigins(url, bust = false) {
    return this._fromText(url, bust, async feedUrl => {
      const r = await fetchT(ALLORIGINS + encodeURIComponent(feedUrl), { cache: 'no-store' });
      if (!r.ok) throw new Error('http');
      return (await r.json()).contents;
    });
  },
  _parseXML(xml, feedUrl) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return [...doc.querySelectorAll('item, entry')].map(el => {
      const qs = s => el.querySelector(s)?.textContent?.trim() || '';
      const link = qs('link') || el.querySelector('link')?.getAttribute('href') || '';
      const desc = qs('description') || qs('summary');
      const content = qs('content\\:encoded') || qs('content') || desc;
      const enc = el.querySelector('enclosure')?.getAttribute('url');
      const media = el.querySelector('media\\:content, media\\:thumbnail')?.getAttribute('url');
      const author = qs('dc\\:creator') || el.querySelector('author > name')?.textContent?.trim() || qs('author');
      return {
        id:         qs('guid') || qs('id') || link,
        title:      normalizeText(qs('title')),
        desc:       normalizeText(this._strip(desc)).slice(0, 500),
        content:    content,
        url:        link,
        image:      enc || media || this._img(content || desc),
        date:       new Date(qs('pubDate') || qs('published') || qs('updated')),
        author:     normalizeText(author),
        categories: [...el.querySelectorAll('category')].map(c => c.textContent.trim()).filter(Boolean),
        feedUrl
      };
    });
  },
  _strip(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent || '';
  },
  _img(html) {
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return m ? m[1] : null;
  },
  bust(url) { this._cache.delete(url); }
};
const ChevronIcon = '<svg class="chevron" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
const Renderer = {
  render(articles, layout = S.layout) {
    const el = $('content');
    currentArticleIds = articles.map(aid);
    if (!articles.length) {
      el.innerHTML = `<div class="state-box"><div class="icon">📭</div><div class="title">Nincsenek cikkek</div><div class="desc">A feed üres vagy nem töltődött be.</div></div>`;
      return;
    }
    articles.forEach(a => { articleMap[aid(a)] = a; });
    el.innerHTML = (this['_' + layout] || this._magazine).call(this, articles);
  },
  _feedName(url)  { return S.feeds.find(f => f.url === url)?.name || DEFAULT_FEEDS.find(f => f.url === url)?.name || ''; },
  _timeLabel(d) {
    if (!d || isNaN(d)) return '';
    const time = d.toLocaleTimeString('hu-HU', { hour: 'numeric', minute: '2-digit' });
    const dayStart = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.round((dayStart(new Date()) - dayStart(d)) / 86400000);
    if (days <= 0) return time;
    if (days === 1) return `tegnap ${time}`;
    return `${['V', 'H', 'K', 'SZE', 'CS', 'P', 'SZO'][d.getDay()]} ${time}`;
  },
  _section(cls, items, render) { return items.length ? `<div class="${cls}">${items.map(render).join('')}</div>` : ''; },
  _desc(a, cls) { return a.desc ? `<div class="${cls}">${e(a.desc)}</div>` : ''; },
  _metaHtml(a, sourceCls, opts = {}) {
    const feed = a.feedName || this._feedName(a.feedUrl);
    return this._metaParts(a, feed, opts).map((part, i) =>
      `${i ? '<span class="meta-sep" aria-hidden="true"></span>' : ''}<span${part === feed && sourceCls ? ` class="${sourceCls}"` : ''}>${e(part)}</span>`
    ).join('');
  },
  _metaParts(a, feed, opts = {}) {
    const seen = new Set();
    const full = opts.full === true;
    const parts = full ? [this._timeLabel(a.date), feed, a.author, this._category(a)] : [this._timeLabel(a.date), feed];
    return parts.map(v => normalizeText(v || '')).filter(v => {
      const key = v.toLowerCase();
      if (!v || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
  _category(a) {
    const categories = Array.isArray(a.categories) ? a.categories : String(a.categories || '').split(',');
    return categories.map(normalizeText).find(c =>
      c && c.length <= 40 && /[A-Za-zÀ-ž]/.test(c) && !/^https?:/i.test(c) && !/^(uncategorized|egyéb)$/i.test(c)
    ) || '';
  },
  _meta(a, sourceCls) { return this._metaHtml(a, sourceCls); },
  _readerMeta(a, sourceCls) { return this._metaHtml(a, sourceCls, { full: true }); },
  _rawImg(a, imgCls, noCls, hideTarget = 'this') {
    return a.image
      ? `<img class="${imgCls}" src="${e(a.image)}" alt="" loading="lazy" onerror="${hideTarget}.style.display='none'">`
      : `<div class="${noCls}">📰</div>`;
  },
  _ixImg(a, imgCls, noCls, wrapCls = '') {
    return `<div class="ix-img-wrap${wrapCls ? ' ' + wrapCls : ''}">${this._rawImg(a, imgCls, noCls, 'this.parentNode')}</div>`;
  },
  _card(a, type = 'ix', opt) {
    const id = aid(a);
    const defs = {
      grid: () => `<div class="card" data-id="${id}">${this._rawImg(a, 'card-img', 'card-no-img')}<div class="card-body"><div class="card-meta">${this._meta(a, 'card-source')}</div><div class="card-title">${e(a.title)}</div>${this._desc(a, 'card-desc')}</div></div>`,
      list: () => `<div class="list-item${isUnreadReadLater(id) ? ' unread-saved' : ''}" data-id="${id}">${this._rawImg(a, 'list-thumb', 'list-no-thumb')}<div class="list-body"><div class="list-title">${e(a.title)}</div>${this._desc(a, 'list-desc')}<div class="list-meta">${this._meta(a, 'list-source')}</div></div></div>`,
      ix: () => `<div class="ix-card" data-id="${id}">${this._ixImg(a, 'ix-card-img', 'ix-card-nobg')}<div class="ix-card-title">${e(a.title)}</div>${this._desc(a, 'ix-card-desc')}<div class="ix-card-time">${this._meta(a, 'ix-card-source')}</div></div>`,
      fill: () => `<div class="ix-text-fill" data-id="${id}"><div class="ix-tf-title">${e(a.title)}</div>${this._desc(a, 'ix-tf-desc')}</div>`,
      heroMini: () => `<div class="ix-hero-mini" data-id="${id}">${this._rawImg(a, 'ix-hero-mini-img', 'ix-hero-mini-nobg')}<div class="ix-hero-mini-body"><div class="ix-hero-mini-title">${e(a.title)}</div>${this._desc(a, 'ix-hero-mini-desc')}<div class="ix-hero-mini-meta">${this._meta(a, 'ix-hero-mini-source')}</div></div></div>`,
      mini: () => `<div class="ix-mini" data-id="${id}">${this._ixImg(a, 'ix-mini-img', 'ix-mini-nobg')}<div class="ix-mini-title">${e(a.title)}</div><div class="ix-mini-time">${this._meta(a, 'ix-mini-source')}</div></div>`,
      strip: withImg => `<div class="ix-strip-item" data-id="${id}">${withImg && a.image ? this._rawImg(a, 'ix-strip-img', '') : ''}<div class="ix-strip-body"><div class="ix-strip-title">${e(a.title)}</div><div class="ix-strip-meta">${this._meta(a, 'ix-strip-source')}</div></div></div>`,
      spot: () => `<div class="ix-spot-card" data-id="${id}"><div class="ix-spot-img-side"><div class="ix-spot-img-clip">${this._rawImg(a, 'ix-spot-img', 'ix-spot-nobg', 'this.parentNode')}</div></div><div class="ix-spot-body"><div class="ix-spot-title">${e(a.title)}</div>${this._desc(a, 'ix-spot-desc')}<div class="ix-spot-time">${this._meta(a, 'ix-spot-source')}</div></div></div>`,
      reader: () => `<div class="reader-item" data-id="${id}"><div class="reader-item-head"><div class="reader-item-info"><div class="reader-title">${e(a.title)}</div><div class="reader-meta">${this._readerMeta(a, 'reader-source')}</div></div>${ChevronIcon}</div></div>`
    };
    return defs[type](opt);
  },
  _grid(articles) { return this._section('grid-layout', articles, a => this._card(a, 'grid')); },
  _list(articles) { return this._section('list-layout', articles, a => this._card(a, 'list')); },
  _reader(articles) { return this._section('reader-layout', articles, a => this._card(a, 'reader')); },
  _footer(articles) {
    const updated = S.lastUpdated ? new Date(S.lastUpdated) : null;
    const feedCount = new Set(articles.map(a => a.feedUrl).filter(Boolean)).size;
    const parts = [`${feedCount} feed`, `${articles.length} cikk`];
    if (updated && !isNaN(updated)) parts.push(`frissítve ${updated.toLocaleTimeString('hu-HU', { hour:'2-digit', minute:'2-digit' })}`);
    return `<footer class="ix-footer"><button class="ix-footer-brand" type="button"><span class="ix-footer-mark"></span>Flux</button>${parts.map(p => `<span class="ix-footer-sep">·</span><span>${e(p)}</span>`).join('')}</footer>`;
  },
  _magazine(articles) {
    const pool = [...articles.filter(a => a.image), ...articles.filter(a => !a.image)];
    let idx = 0;
    const take = n => pool.slice(idx, idx += n);
    const [hero] = take(1);
    if (!hero) return '';
    const heroHtml = `<div class="ix-hero" data-id="${aid(hero)}">${this._ixImg(hero, 'ix-hero-img', 'ix-hero-nobg', 'hero-wrap')}<div class="ix-hero-body"><div class="ix-hero-title">${e(hero.title)}</div>${this._desc(hero, 'ix-hero-desc')}<div class="ix-hero-time">${this._meta(hero, 'ix-hero-source')}</div></div></div>`;
    const side = take(4);
    const heroSep = '<div class="ix-hero-separator"><span></span><span></span><span></span></div>';
    const rowSep = '<div class="ix-section-separator"><span></span><span></span><span></span></div>';
    const sideHtml = side.length ? `<div class="ix-hero-cluster"><div class="ix-hero-main">${heroHtml}</div><div class="ix-hero-side"><div class="ix-hero-side-head"><span>FONTOS</span></div>${this._card(side[0], 'ix')}${side.slice(1).map(a => this._card(a, 'heroMini')).join('')}</div></div>${heroSep}` : `<div class="ix-hero-main">${heroHtml}</div>${heroSep}`;
    const rows = [1, 0].map(row => {
      if (pool.length - idx < 2) return '';
      const [big] = take(1), [small] = take(1), fills = take(2);
      const sideCol = `<div class="ix-col-side">${this._card(small, 'ix')}${fills.map(a => this._card(a, 'fill')).join('')}</div>`;
      return `<div class="ix-row ${row ? 'row-b' : 'row-a'}">${row ? sideCol + this._card(big, 'ix') : this._card(big, 'ix') + sideCol}</div>${rowSep}`;
    }).join('');
    const trioHtml = this._section('ix-trio', take(3), a => this._card(a, 'ix'));
    const miniHtml = items => this._section('ix-mini-grid', items, a => this._card(a, 'mini'));
    const mini1Html = miniHtml(take(7));
    const rest = pool.slice(idx);
    const stripItems = rest.slice(-10);
    const mini2Html = miniHtml(rest.slice(0, -10));
    const stripCols = [stripItems.slice(0, 4), stripItems.slice(4, 7), stripItems.slice(7, 10)];
    const stripHtml = stripItems.length ? `<div class="ix-strip">${stripCols.map((col, i) => `<div class="ix-strip-col">${col.map(a => this._card(a, i ? 'strip' : 'strip', !i)).join('')}</div>`).join('')}</div>` : '';
    const stripSep = stripItems.length ? rowSep.replace('ix-section-separator', 'ix-section-separator ix-strip-separator') : '';
    return `<div class="magazine-layout">${sideHtml}${rows}${trioHtml}${mini1Html}${mini2Html}${stripSep}${stripHtml}${this._footer(articles)}</div>`;
  }
};
async function openArticle(id) {
  const a = articleMap[id];
  if (!a) return;
  if (S.activeSpecialView === 'readLater') markReadLaterRead(id);
  saveReturnScroll();
  const canOpenInside = canExtractArticle(a) || hasReadableRssContent(a);
  if (canOpenInside) pushArticleState();
  if (canExtractArticle(a)) {
    const cached = extractedArticleCache.get(a.url);
    if (cached) {
      renderArticleView({ ...a, ...cached, author: cached.author || a.author, date: cached.date ? new Date(cached.date) : a.date });
      return;
    }
    if (S.readerMode !== 'modal') renderArticleLoading(a);
    const extracted = await fetchExtractedArticle(a).catch(() => null);
    if (extracted && hasReadableRssContent(extracted)) {
      extractedArticleCache.set(a.url, extracted);
      renderArticleView({ ...a, ...extracted, author: extracted.author || a.author, date: extracted.date ? new Date(extracted.date) : a.date });
      return;
    }
  }
  if (!hasReadableRssContent(a)) {
    window.location.href = a.url;
    return;
  }
  renderArticleView(a);
}
async function openArticleUrl(url) {
  let articleUrl;
  try {
    articleUrl = new URL(url);
  } catch(e) {
    return;
  }
  if (!/^https?:$/.test(articleUrl.protocol)) return;

  const normalized = articleUrl.href.replace(/\/+$/, '');
  const existing = S.articles.find(a => (a.url || '').replace(/\/+$/, '') === normalized);
  if (existing) {
    openArticle(aid(existing));
    return;
  }

  const fallback = {
    id: articleUrl.href,
    url: articleUrl.href,
    feedUrl: 'https://telex.hu/rss',
    feedName: articleUrl.hostname.replace(/^www\./, '') === 'telex.hu' ? 'Telex' : '',
    title: 'Cikk betöltése...',
    desc: '',
    content: '',
    image: '',
    date: new Date()
  };
  if (!canExtractArticle(fallback)) {
    window.location.href = articleUrl.href;
    return;
  }
  pushArticleState();
  renderArticleLoading(fallback);
  const extracted = await fetchExtractedArticle(fallback).catch(() => null);
  if (extracted && hasReadableRssContent(extracted)) {
    renderArticleView({ ...fallback, ...extracted, author: extracted.author || fallback.author, date: extracted.date ? new Date(extracted.date) : fallback.date });
    return;
  }
  window.location.href = articleUrl.href;
}
function openUrlParam() {
  try {
    return new URLSearchParams(location.search).get('open') || '';
  } catch(e) {
    return '';
  }
}
function toggleReader(id) {
  openArticle(id);
}
function hasReadableRssContent(a) {
  const text = stripHtml(a.content || a.desc || '');
  return text.trim().length > 240;
}
function canExtractArticle(a) {
  if (location.protocol === 'file:') return false;
  try {
    return ARTICLE_HOSTS.has(new URL(a.url).hostname);
  } catch(e) { return false; }
}
async function fetchExtractedArticle(a) {
  const cached = extractedArticleCache.get(a.url);
  if (cached) return cached;
  if (extractingArticlePromises.has(a.url)) return extractingArticlePromises.get(a.url);
  const promise = fetchT(ARTICLE_API + encodeURIComponent(a.url), { cache: 'no-store' }, 12000)
    .then(r => {
      if (!r.ok) throw new Error('extract');
      return r.json();
    })
    .then(data => {
      extractedArticleCache.set(a.url, data);
      extractingArticlePromises.delete(a.url);
      return data;
    })
    .catch(err => {
      extractingArticlePromises.delete(a.url);
      throw err;
    });
  extractingArticlePromises.set(a.url, promise);
  return promise;
}
function prefetchArticle(id) {
  const a = articleMap[id];
  if (!a || !canExtractArticle(a) || extractedArticleCache.has(a.url) || extractingArticlePromises.has(a.url)) return;
  fetchExtractedArticle(a).catch(() => {});
}
function setupArticlePrefetch() {
  const content = $('content');
  if (!content || content._fluxPrefetchBound) return;
  content._fluxPrefetchBound = true;
  let timer = null;
  content.addEventListener('click', ev => {
    const video = ev.target.closest('[data-video-id]');
    if (video && content.contains(video)) return openYtVideo(video.dataset.videoId);
    const item = ev.target.closest('[data-id]');
    if (item && content.contains(item)) openArticle(item.dataset.id);
  });
  content.addEventListener('pointerover', ev => {
    const item = ev.target.closest('[data-id]');
    if (!item || !content.contains(item)) return;
    clearTimeout(timer);
    timer = setTimeout(() => prefetchArticle(item.dataset.id), 120);
  }, { passive: true });
  content.addEventListener('pointerdown', ev => {
    const item = ev.target.closest('[data-id]');
    if (!item || !content.contains(item)) return;
    prefetchArticle(item.dataset.id);
  }, { passive: true });
}
function renderArticleLoading(a) {
  renderArticleShell(articleViewHtml(a, { body: '<div class="article-content"><p>Cikk betöltése...</p></div>' }));
}
function renderArticleView(a) {
  articleMap[aid(a)] = a;
  renderArticleShell(articleViewHtml(a, {
    body: `${a.image ? `<img class="article-hero-img" src="${e(a.image)}" alt="">` : ''}
      <div class="article-content">${sanitizeArticleHtml(a.content || a.desc || '')}</div>
      <a class="reader-ext" href="${e(a.url)}" target="_self" rel="noopener">Eredeti cikk megnyitása</a>
      ${articleMoreHtml(a)}`
  }));
}
function articleViewHtml(a, opts = {}) {
  const saved = isReadLaterArticle(a);
  return `<article class="article-view">
    <button class="article-back" type="button">← Vissza</button>
    <h1 class="article-title">${e(a.title)}</h1>
    <div class="article-meta">${Renderer._metaHtml(a, 'article-source', { full: true })}</div>
    <button class="article-save-btn${saved ? ' saved' : ''}" type="button" data-save-id="${aid(a)}" title="${saved ? 'Mentve' : 'Mentés későbbre'}" aria-label="${saved ? 'Mentve' : 'Mentés későbbre'}" aria-pressed="${saved ? 'true' : 'false'}">${bookmarkIcon(saved, 18)}</button>
    ${opts.body || ''}
  </article>`;
}
function articleMoreHtml(a) {
  if (!S.showArticleMore) return '';
  const items = nextArticles(a, clampInt(S.articleMoreColumns, 1, 4, 3) * clampInt(S.articleMoreRows, 1, 4, 1));
  if (!items.length) return '';
  const cols = clampInt(S.articleMoreColumns, 1, 4, 3);
  return `<section class="article-more" style="--article-more-cols:${cols};--article-more-mobile-cols:${Math.min(cols, 2)}">
    <h2 class="article-more-title">Továbbiak</h2>
    <div class="article-more-grid">${items.map(item => `
      <div class="article-more-card" data-id="${aid(item)}">
        ${Renderer._rawImg(item, 'article-more-img', 'article-more-noimg')}
        <div class="article-more-card-title">${e(item.title)}</div>
      </div>`).join('')}</div>
  </section>`;
}
function nextArticles(a, limit) {
  const ids = currentArticleIds.length ? currentArticleIds : S.articles.map(aid);
  const current = aid(a);
  const targetWords = articleKeywords(a);
  const targetCategories = new Set(Array.isArray(a.categories) ? a.categories : []);
  return ids
    .map((id, i) => ({ article: articleMap[id], order: i }))
    .filter(item => item.article && idOfArticle(item.article) !== current)
    .map(item => ({ ...item, score: relatedArticleScore(a, item.article, targetWords, targetCategories, item.order) }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.article)
    .slice(0, limit);
}
function idOfArticle(a) {
  return aid(a);
}
function articleKeywords(a) {
  const stop = new Set('a az és hogy vagy de meg nem mint van volt lesz egy ezt azt akkor csak már még után alatt felett ahol amikor illetve mert'.split(' '));
  return new Set(normalizeText(`${a.title || ''} ${a.desc || ''}`)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stop.has(w))
    .slice(0, 28));
}
function relatedArticleScore(base, candidate, baseWords, baseCategories, order) {
  let score = Math.max(0, 20 - order * .1);
  if (candidate.feedUrl && candidate.feedUrl === base.feedUrl) score += 40;
  const candidateCategories = Array.isArray(candidate.categories) ? candidate.categories : [];
  candidateCategories.forEach(c => { if (baseCategories.has(c)) score += 30; });
  articleKeywords(candidate).forEach(w => { if (baseWords.has(w)) score += 7; });
  const deltaHours = Math.abs((new Date(candidate.date) - new Date(base.date)) / 36e5);
  if (Number.isFinite(deltaHours)) score += Math.max(0, 14 - deltaHours / 6);
  return score;
}
function renderArticleShell(html) {
  if (S.readerMode === 'modal') {
    activeArticleMode = 'modal';
    const layer = ensureArticleModal();
    layer.querySelector('.article-sheet').innerHTML = html;
    document.body.classList.add('article-modal-open');
    requestAnimationFrame(() => layer.classList.add('open'));
    return;
  }
  activeArticleMode = 'page';
  closeArticleModal();
  const content = $('content');
  preserveActiveYtPlayer(() => { content.innerHTML = html; });
  setScrollTopInstant(content, 0);
}
function ensureArticleModal() {
  let layer = $('articleModalLayer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'articleModalLayer';
    layer.className = 'article-modal-layer';
    layer.innerHTML = '<div class="article-sheet"></div>';
    layer.addEventListener('click', ev => {
      if (ev.target === layer) closeArticleView();
      const item = ev.target.closest('[data-id]');
      if (item && layer.querySelector('.article-sheet').contains(item)) openArticle(item.dataset.id);
    });
    document.body.appendChild(layer);
  }
  return layer;
}
function closeArticleModal() {
  const layer = $('articleModalLayer');
  if (layer) {
    layer.classList.remove('open');
    setTimeout(() => {
      if (!layer.classList.contains('open')) layer.querySelector('.article-sheet').innerHTML = '';
    }, 260);
  }
  document.body.classList.remove('article-modal-open');
}
function closeArticleView(fromHistory = false) {
  if (!fromHistory && history.state?.flux === 'article') {
    history.back();
    return;
  }
  closeArticleModal();
  if (activeArticleMode === 'modal') {
    activeArticleMode = null;
    clearReturnScroll();
    return;
  }
  activeArticleMode = null;
  restoreArticleList();
}
function pushArticleState() {
  if (history.state?.flux === 'article') return;
  try { history.pushState({ flux: 'article' }, '', location.href); } catch(e) {}
}
function $(id) { return document.getElementById(id); }
function saveReturnScroll() {
  try {
    const content = $('content');
    window._fluxReturnScrollTop = content ? content.scrollTop : 0;
    articleListSnapshot = (content && S.readerMode !== 'modal') ? content.innerHTML : null;
  } catch(e) {}
}
function restoreArticleList() {
  const content = $('content');
  if (!content) return;
  if (articleListSnapshot !== null) {
    preserveActiveYtPlayer(() => { content.innerHTML = articleListSnapshot; });
    articleListSnapshot = null;
    if (!content.querySelector('.yt-sidebar.yt-player-active')) {
      content.querySelectorAll('.yt-sidebar').forEach(sidebar => sidebar.remove());
      injectYtSidebar();
    }
    restoreReturnScroll(true);
    return;
  }
  renderArticles();
  restoreReturnScroll();
}
function restoreReturnScroll(immediate = false) {
  try {
    const top = window._fluxReturnScrollTop;
    if (typeof top !== 'number') return;
    window._fluxReturnScrollTop = null;
    const content = $('content');
    if (!content) return;
    if (immediate) {
      setScrollTopInstant(content, top || 0);
      return;
    }
    requestAnimationFrame(() => setScrollTopInstant(content, top || 0));
  } catch(e) {}
}
function clearReturnScroll() {
  window._fluxReturnScrollTop = null;
  articleListSnapshot = null;
}
function setScrollTopInstant(el, top) {
  const prev = el.style.scrollBehavior;
  el.style.scrollBehavior = 'auto';
  el.scrollTop = top;
  requestAnimationFrame(() => { el.style.scrollBehavior = prev; });
}
function stripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return d.textContent || '';
}
function sanitizeArticleHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  d.querySelectorAll('script, style, iframe, object, embed, form, input, button').forEach(el => el.remove());
  d.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value || '';
      if (name.startsWith('on') || name === 'style') el.removeAttribute(attr.name);
      if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) el.removeAttribute(attr.name);
    });
  });
  return d.innerHTML;
}
function aid(a) {
  const src = a.id || a.url || a.title || '';
  let h = 0;
  for (let i = 0; i < src.length; i++) { h = Math.imul(31, h) + src.charCodeAt(i) | 0; }
  return 'a' + Math.abs(h).toString(36);
}
function e(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function decodeEntities(text) {
  if (!text) return '';
  const d = document.createElement('textarea');
  d.innerHTML = text;
  return d.value;
}
function normalizeText(text) {
  return decodeEntities(String(text || '')).replace(/\s+/g, ' ').trim();
}
function bookmarkIcon(filled = false, size = 15) {
  return filled
    ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>`
    : `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>`;
}
function articleSnapshot(a) {
  return {
    id: a.id || '',
    title: a.title || '',
    url: a.url || '',
    feedUrl: a.feedUrl || '',
    image: a.image || '',
    desc: a.desc || '',
    date: a.date instanceof Date ? a.date.toISOString() : a.date,
    author: a.author || '',
    categories: Array.isArray(a.categories) ? a.categories : []
  };
}
function isReadLaterArticle(a) {
  const id = typeof a === 'string' ? a : aid(a);
  return S.readLater.some(item => item.id === id);
}
function isUnreadReadLater(id) {
  return S.activeSpecialView === 'readLater' && S.readLater.some(item => item.id === id && !item.readAt);
}
function updateReadLaterNav() {
  const btn = $('readLaterBtn');
  if (!btn) return;
  const active = S.activeSpecialView === 'readLater';
  btn.classList.toggle('active', active);
  btn.classList.toggle('has-unread', S.readLater.some(item => !item.readAt));
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.innerHTML = bookmarkIcon(active, 15);
}
function markReadLaterRead(id) {
  const item = S.readLater.find(item => item.id === id);
  if (!item || item.readAt) return;
  item.readAt = new Date().toISOString();
  saveReadLater();
  updateReadLaterNav();
}
function toggleReadLater(a) {
  const id = aid(a);
  const index = S.readLater.findIndex(item => item.id === id);
  const saved = index === -1;
  if (saved) {
    S.readLater.unshift({ id, savedAt: new Date().toISOString(), readAt: null, article: articleSnapshot(a) });
  } else {
    S.readLater.splice(index, 1);
  }
  saveReadLater();
  updateReadLaterNav();
  toast(saved ? 'Mentve.' : 'Eltávolítva.');
  return saved;
}
function setupHoverTapPopup(trigger, popup, openClass) {
  if (!trigger || !popup) return;
  if (trigger._fluxPopupCleanup) trigger._fluxPopupCleanup();
  let closeTimer = null;
  const isOpen = () => popup.classList.contains(openClass);
  const isTouchMode = () => window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches;
  const open = () => {
    clearTimeout(closeTimer);
    popup.classList.add(openClass);
  };
  const close = () => {
    clearTimeout(closeTimer);
    popup.classList.remove(openClass);
  };
  const closeSoon = () => {
    closeTimer = setTimeout(close, 150);
  };
  let lastPointerType = '';
  const onDocPointer = ev => {
    lastPointerType = ev.pointerType || '';
    if (!isOpen()) return;
    if (trigger.contains(ev.target) || popup.contains(ev.target)) return;
    close();
  };
  const onClick = ev => {
    if (lastPointerType === 'mouse' || !isTouchMode()) return;
    ev.preventDefault();
    ev.stopPropagation();
    isOpen() ? close() : open();
  };
  const onEnter = ev => { if (ev.pointerType === 'mouse') open(); };
  const onLeave = ev => { if (ev.pointerType === 'mouse') closeSoon(); };
  trigger.addEventListener('click', onClick);
  trigger.addEventListener('pointerenter', onEnter);
  trigger.addEventListener('pointerleave', onLeave);
  popup.addEventListener('pointerenter', onEnter);
  popup.addEventListener('pointerleave', onLeave);
  document.addEventListener('pointerdown', onDocPointer);
  trigger._fluxPopupCleanup = () => {
    trigger.removeEventListener('click', onClick);
    trigger.removeEventListener('pointerenter', onEnter);
    trigger.removeEventListener('pointerleave', onLeave);
    popup.removeEventListener('pointerenter', onEnter);
    popup.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('pointerdown', onDocPointer);
    clearTimeout(closeTimer);
  };
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}
function renderSidebar() {
  const all = S.activeUrl === null && S.activeSpecialView !== 'readLater';
  let html = `<button class="nav-feed${all?' active':''}" data-feed-url="">Összes</button>`;
  S.feeds.forEach(f => {
    const active = S.activeSpecialView !== 'readLater' && S.activeUrl === f.url;
    html += `<button class="nav-feed${active?' active':''}" data-feed-url="${e(f.url)}">${e(f.name)}</button>`;
  });
  $('feedList').innerHTML = html;
  renderMobileFeedPanel();
}
function renderMobileFeedPanel() {
  const panel = $('mobileFeedPanel');
  if (!panel) return;
  const option = (url, label) => {
    const active = S.activeSpecialView !== 'readLater' && (url ? S.activeUrl === url : S.activeUrl === null);
    return `<button class="mobile-feed-option${active ? ' active' : ''}" type="button" data-feed-url="${e(url)}">${e(label)}</button>`;
  };
  const feeds = S.feeds.length ? S.feeds : DEFAULT_FEEDS.map(f => ({ name: f.label, url: f.url }));
  panel.innerHTML = option('', 'Összes') + feeds.map(f => option(f.url, f.name)).join('');
}
function closeMobileFeedPanel() {
  $('mobileFeedPanel')?.classList.remove('open');
}
function openMobileFeedPanel() {
  renderMobileFeedPanel();
  const panel = $('mobileFeedPanel');
  if (!panel) return;
  panel.scrollTop = 0;
  panel.classList.add('open');
}
function destroySortableList(container) {
  if (container?._fluxSortable) {
    container._fluxSortable.destroy();
    container._fluxSortable = null;
  }
  container?.classList.remove('sorting');
}
function bindSortableList(container, items, afterMove) {
  destroySortableList(container);
  if (!window.Sortable) {
    console.warn('SortableJS is not available');
    return;
  }
  container._fluxSortable = Sortable.create(container, {
    animation: 150,
    handle: '.s-feed-drag',
    draggable: '.s-feed-item',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    forceFallback: true,
    fallbackClass: 'sortable-fallback',
    fallbackOnBody: true,
    onStart: () => container.classList.add('sorting'),
    onEnd: () => {
      container.classList.remove('sorting');
      const byId = new Map(items.map(item => [item.url || item.id, item]));
      const ordered = [...container.querySelectorAll('.s-feed-item')]
        .map(row => byId.get(row.dataset.id))
        .filter(Boolean);
      if (ordered.length !== items.length) return;
      items.splice(0, items.length, ...ordered);
      afterMove();
    }
  });
}
function settingsRow(o) {
  return `<div class="s-feed-item" data-kind="${o.kind}" data-id="${e(o.id)}" data-idx="${o.i}">
    <span class="s-feed-drag" title="Átrendezés"><span class="s-feed-grip">⠿</span></span>
    ${o.icon ? `<span style="flex-shrink:0;padding-top:3px">${o.icon}</span>` : ''}
    <div style="flex:1;min-width:0">
      <input class="s-feed-name" data-field="name" value="${e(o.name)}">
      <input class="s-feed-url" data-field="url" value="${e(o.url)}" title="${o.title}" ${o.placeholder ? `placeholder="${o.placeholder}"` : ''}>
    </div>
    <button class="s-feed-del" data-act="delete"${o.icon ? ' style="margin-top:1px"' : ''}>✕</button>
  </div>`;
}
function renderSFeeds() {
  const c = $('sFeedList');
  if (!S.feeds.length) { destroySortableList(c); c.innerHTML = '<div style="font-size:.78rem;color:var(--muted)">Nincs feed.</div>'; return; }
  c.innerHTML = S.feeds.map((f, i) => settingsRow({
    kind: 'feed', id: f.url, i, total: S.feeds.length, name: f.name, url: f.url,
    title: 'Feed URL — kattints a szerkesztéshez'
  })).join('');
  bindSortableList(c, S.feeds, () => { saveFeeds(); renderSFeeds(); renderSidebar(); renderArticles(); });
}
function selectFeed(url) {
  S.activeUrl = url;
  S.activeCategory = null;
  S.activeSpecialView = null;
  saveSettings();
  updateReadLaterNav();
  renderSidebar();
  renderArticles();
}
function confirmDialog(message, onConfirm, onCancel, opts = {}) {
  $('confirmTitle').textContent = opts.title || 'Megerősítés';
  $('confirmOk').textContent = opts.okLabel || 'OK';
  $('confirmOk').className = 'btn ' + (opts.danger !== false ? 'btn-danger' : 'btn-primary');
  $('confirmMsg').textContent = message;
  $('confirmModal').classList.add('open');
  $('confirmBg').classList.add('open');
  $('confirmOk').onclick = () => { closeConfirmModal(); onConfirm(); };
  $('confirmCancel').onclick = () => { closeConfirmModal(); if (onCancel) onCancel(); };
}
function closeConfirmModal() {
  $('confirmModal').classList.remove('open');
  $('confirmBg').classList.remove('open');
}
function deleteFeed(url) {
  const f = S.feeds.find(f => f.url === url);
  confirmDialog(`"${f?.name || url}" feed törlése visszavonhatatlan.`, () => {
    S.feeds = S.feeds.filter(f => f.url !== url);
    S.articles = S.articles.filter(a => a.feedUrl !== url);
    Fetcher.bust(url);
    if (S.activeUrl === url) S.activeUrl = null;
    saveFeeds();
    renderSidebar();
    renderSFeeds();
    renderArticles();
    toast('Feed törölve.');
  }, null, { title: 'Feed törlése', okLabel: 'Törlés' });
}
function renameFeed(url, name) {
  const f = S.feeds.find(f => f.url === url);
  if (f && name.trim()) { f.name = name.trim(); saveFeeds(); renderSidebar(); }
}
function renameFeedUrl(oldUrl, newUrl, inputEl) {
  newUrl = newUrl.trim();
  if (!newUrl || newUrl === oldUrl) return;
  const f = S.feeds.find(f => f.url === oldUrl);
  if (!f) return;
  confirmDialog(`URL módosítása erre:\n${newUrl}`, () => {
    S.articles = S.articles.filter(a => a.feedUrl !== oldUrl);
    f.url = newUrl;
    saveFeeds(); renderSFeeds(); renderSidebar(); refreshAll();
  }, () => {
    if (inputEl) inputEl.value = oldUrl;
  }, { title: 'URL módosítása', okLabel: 'Mentés', danger: false });
}
function renameYtChannelName(id, name) {
  const ch = S.ytChannels.find(c => c.id === id);
  if (ch && name.trim()) { ch.name = name.trim(); saveYtChannels(); }
}
function renameYtChannelUrl(oldId, newId, inputEl) {
  newId = newId.trim();
  if (!newId || newId === oldId) return;
  const ch = S.ytChannels.find(c => c.id === oldId);
  if (!ch) return;
  confirmDialog(`Csatorna ID módosítása erre:\n${newId}`, () => {
    if (newId.startsWith('http')) { ch.idType = 'url'; ch.id = newId; }
    else if (newId.startsWith('@')) { ch.idType = 'handle'; ch.id = newId.slice(1); }
    else if (/^UC[A-Za-z0-9_\-]{22}$/.test(newId)) { ch.idType = 'id'; ch.id = newId; }
    else { ch.idType = 'handle'; ch.id = newId; }
    saveYtChannels();
    ytVideos = ytVideos.filter(v => v.channelId !== oldId);
    renderSYtChannels(); refreshYtFeed();
  }, () => {
    if (inputEl) inputEl.value = oldId;
  }, { title: 'Csatorna módosítása', okLabel: 'Mentés', danger: false });
}
function interleaveArticles(articles) {
  const byFeed = {};
  S.feeds.forEach(f => { byFeed[f.url] = []; });
  articles.forEach(a => { if (byFeed[a.feedUrl]) byFeed[a.feedUrl].push(a); });
  return S.feeds.flatMap(f => (byFeed[f.url] || []).sort((a, b) => b.date - a.date));
}
function selectCategory(cat) {
  S.activeSpecialView = null;
  S.activeCategory = (S.activeCategory === cat) ? null : cat;
  updateReadLaterNav();
  renderArticles();
}
function renderArticles() {
  updateReadLaterNav();
  if (S.activeSpecialView === 'readLater') {
    const articles = S.readLater
      .slice()
      .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
      .map(item => ({ ...item.article, date: new Date(item.article.date) }));
    if (!articles.length) {
      $('content').innerHTML = `<div class="read-later-view"><div class="read-later-head"><div class="read-later-title">${bookmarkIcon(true, 15)}<span>Mentett cikkek</span></div><button class="read-later-close" type="button" title="Vissza" aria-label="Vissza">×</button></div><div class="state-box"><div class="icon">${bookmarkIcon(false, 34)}</div><div class="title">Nincsenek mentett cikkek</div><div class="desc">A cikkolvasóban tudsz cikkeket későbbre menteni.</div></div></div>`;
      return;
    }
    Renderer.render(articles, 'list');
    $('content').innerHTML = `<div class="read-later-view"><div class="read-later-head"><div class="read-later-title">${bookmarkIcon(true, 15)}<span>Mentett cikkek</span></div><button class="read-later-close" type="button" title="Vissza" aria-label="Vissza">×</button></div>${$('content').innerHTML}</div>`;
    return;
  }
  if (!S.feeds.length) {
    $('content').innerHTML = `<div class="state-box"><div class="icon">📰</div><div class="title">Nincs feed hozzáadva</div><div class="desc">Kattints a "Feed hozzáadása" gombra.</div></div>`;
    injectYtSidebar();
    return;
  }
  let articles = S.activeUrl
    ? S.articles.filter(a => a.feedUrl === S.activeUrl).sort((a,b) => b.date - a.date)
    : interleaveArticles(S.articles);
  if (S.activeCategory) {
    articles = articles.filter(a => a.categories && a.categories.includes(S.activeCategory));
  }
  const preservedYtPlayer = $('content').querySelector('.yt-sidebar.yt-player-active');
  if (preservedYtPlayer) preservedYtPlayer.remove();
  Renderer.render(articles);
  if (preservedYtPlayer) {
    placeYtSidebar($('content'), preservedYtPlayer);
    requestAnimationFrame(syncYtMiniPlayer);
  } else {
    injectYtSidebar();
  }
}
const LAYOUT_ICONS = {
  grid:     `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/></svg>`,
  list:     `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="5" y1="4" x2="14" y2="4"/><line x1="5" y1="8" x2="14" y2="8"/><line x1="5" y1="12" x2="14" y2="12"/><circle cx="2" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="2" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="2" cy="12" r="1" fill="currentColor" stroke="none"/></svg>`,
  magazine: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="9" height="9" rx="1.5"/><rect x="12" y="1" width="3" height="4" rx="1"/><rect x="12" y="7" width="3" height="3" rx="1"/><rect x="1" y="12" width="14" height="3" rx="1"/></svg>`,
  reader:   `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="7" x2="14" y2="7"/><line x1="2" y1="10" x2="10" y2="10"/><line x1="2" y1="13" x2="7" y2="13"/></svg>`
};
const LAYOUT_ORDER = ['magazine','grid','list','reader'];
function updateLayoutBtns() {
  document.querySelectorAll('.v-layout-btn[data-layout]').forEach(b =>
    b.classList.toggle('active', b.dataset.layout === S.layout)
  );
}
function setLayout(layout) {
  S.layout = layout;
  saveSettings();
  updateLayoutBtns();
  renderArticles();
}
async function refreshAll(bust = false) {
  if (bust) S.feeds.forEach(f => Fetcher.bust(f.url));
  const prevSig = S.articles.slice(0, 40).map(a => a.id).join('|');
  const hadArticles = S.articles.length > 0;
  setLoading(true);
  await Promise.all(S.feeds.map(async f => {
    const arts = await Fetcher.get(f.url, bust).catch(() => null);
    if (arts && arts.length) {
      S.articles = S.articles.filter(a => a.feedUrl !== f.url);
      S.articles.push(...arts);
    }
  }));
  S.articles.sort((a, b) => b.date - a.date);
  setLoading(false);
  const newSig = S.articles.slice(0, 40).map(a => a.id).join('|');
  const changed = bust || newSig !== prevSig;
  S.lastUpdated = new Date().toISOString();
  if (changed) renderArticles();
  saveArticles();
  saveSettings();
  if (hadArticles) toast(changed ? 'Frissítve.' : 'Nincs új cikk.');
}
function setLoading(on) {
  if (on) {
    const content = $('content');
    const hasContent = content.querySelector('.ix-article, .ix-card, .ix-text-fill, .ix-hero');
    if (!hasContent) {
      content.innerHTML = `<div class="state-box"><div class="spinner"></div></div>`;
    }
  }
}
function buildSettingsUI() {
  const darkPreview = S.theme === 'dark' || (S.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  $('presetGrid').innerHTML = Object.entries(PRESETS).map(([k, p]) => {
    const preview = darkPreview ? p.dark : p.light;
    return `
    <div class="preset-wrap">
      <div class="preset-card${S.preset===k?' active':''}" data-preset="${k}">
        <div class="preset-preview">
          <div class="pp-top" style="background:${preview.bg}"></div>
          <div class="pp-bot" style="background:${preview.card}">
            <div class="pp-dot" style="background:${preview.ac}"></div>
            <div class="pp-dot" style="background:${preview.bg}"></div>
          </div>
        </div>
      </div>
      <div class="preset-name">${p.name}</div>
    </div>`;
  }).join('');
  $('swatchRow').innerHTML = SWATCHES.map(c => `
    <div class="swatch${S.customAccent===c?' active':''}" style="background:${c}" data-color="${c}"></div>
  `).join('') + `<input type="color" id="accentPicker" title="Egyéni szín" value="${S.customAccent || PRESETS.default.light.ac}">`;
  $('accentPicker').addEventListener('input', ev => setAccent(ev.target.value));
  $('fontSlider').value = S.fontSize;
  document.querySelectorAll('.reader-mode-btn[data-reader-mode]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.readerMode === S.readerMode)
  );
  document.querySelectorAll('[data-setting]').forEach(input => {
    if (input.type === 'checkbox' && input.dataset.setting in S) input.checked = !!S[input.dataset.setting];
  });
  $('suggestions').innerHTML = SUGGESTIONS.map(s =>
    `<span class="chip" data-url="${e(s.url)}" data-label="${e(s.label)}">${s.label}</span>`
  ).join('');
}
function setPreset(p) {
  S.preset = p; S.customAccent = null; saveSettings(); Theme.apply(); buildSettingsUI();
}
function setAccent(c) {
  S.customAccent = c; saveSettings(); Theme.apply(); Theme._syncUI();
}
function openAddModal() {
  $('feedUrl').value = '';
  $('feedName').value = '';
  $('feedErr').classList.remove('show');
  clearFeedChoices();
  $('confirmAdd').disabled = false;
  $('confirmAdd').textContent = 'Hozzáadás';
  $('addModal').classList.add('open');
  $('overlay').classList.add('open');
  setTimeout(() => $('feedUrl').focus(), 80);
}
function closeAddModal() {
  $('addModal').classList.remove('open');
  $('overlay').classList.remove('open');
  clearFeedChoices();
}
function clearFeedChoices() {
  const list = $('feedChoiceList');
  if (!list) return;
  list.innerHTML = '';
  list.classList.remove('show');
}
function renderFeedChoices(results) {
  const list = $('feedChoiceList');
  if (!list) return;
  list.innerHTML = results.map(r => `<button class="feed-choice" type="button" data-url="${e(r.url)}" data-name="${e(r.name)}">
    <span class="feed-choice-mark">RSS</span>
    <span class="feed-choice-main">
      <span class="feed-choice-name">${e(r.name)}</span>
      <span class="feed-choice-meta">${e(r.site || r.url)}</span>
    </span>
  </button>`).join('');
  list.classList.toggle('show', results.length > 0);
}
async function fetchFeedLookup(input) {
  const response = await fetchT(FEED_API + encodeURIComponent(input), { cache: 'no-store' }, 12000);
  if (!response.ok) return null;
  const data = await response.json();
  if (Array.isArray(data?.results)) return { results: data.results.filter(r => r.url && r.name) };
  if (data?.feed?.url) return { feed: data.feed };
  return null;
}
function isLikelyFeedUrl(input) {
  return /^https?:\/\//i.test(input) || /\.[a-z]{2,}(?:\/|$)/i.test(input);
}
async function submitAddFeed(forcedInput) {
  let input = (typeof forcedInput === 'string' ? forcedInput : $('feedUrl').value).trim();
  if (!input) return;
  let url = input;
  if (S.feeds.find(f => f.url === url)) { toast('Ez a feed már létezik.'); closeAddModal(); return; }
  const btn = $('confirmAdd');
  btn.disabled = true;
  btn.textContent = 'Betöltés...';
  $('feedErr').classList.remove('show');
  clearFeedChoices();
  const lookup = await fetchFeedLookup(input).catch(() => null);
  if (lookup?.results) {
    if (!lookup.results.length) {
      $('feedErr').textContent = 'Nem találtam feedet. Próbálj pontosabb nevet vagy weboldal/RSS URL-t.';
      $('feedErr').classList.add('show');
      btn.disabled = false; btn.textContent = 'Hozzáadás';
      return;
    }
    renderFeedChoices(lookup.results);
    btn.disabled = false; btn.textContent = 'Hozzáadás';
    return;
  }
  if (lookup?.feed?.url) {
    url = lookup.feed.url;
    if (!$('feedName').value.trim()) $('feedName').value = lookup.feed.name || '';
  } else if (!isLikelyFeedUrl(input)) {
    $('feedErr').textContent = 'Nem találtam feedet. Próbálj pontosabb nevet vagy weboldal/RSS URL-t.';
    $('feedErr').classList.add('show');
    btn.disabled = false; btn.textContent = 'Hozzáadás';
    return;
  } else if (!url.startsWith('http')) {
    url = 'https://' + url;
  }
  if (S.feeds.find(f => f.url === url)) { toast('Ez a feed már létezik.'); closeAddModal(); return; }
  const articles = await Fetcher.get(url).catch(() => []);
  if (!articles.length) {
    $('feedErr').textContent = 'Nem sikerült betölteni a feedet. Ellenőrizd az URL-t.';
    $('feedErr').classList.add('show');
    btn.disabled = false; btn.textContent = 'Hozzáadás';
    return;
  }
  let name = $('feedName').value.trim();
  if (!name) {
    try { name = new URL(url).hostname.replace(/^www\./,'').split('.')[0]; name = name[0].toUpperCase() + name.slice(1); }
    catch(e) { name = url; }
  }
  S.feeds.push({ url, name });
  S.articles = S.articles.filter(a => a.feedUrl !== url);
  S.articles.push(...articles);
  S.articles.sort((a, b) => b.date - a.date);
  saveFeeds();
  renderSidebar();
  renderSFeeds();
  closeAddModal();
  renderArticles();
  toast(`"${name}" hozzáadva!`);
}
function bindEvents() {
  const scrollHome = () => document.querySelector('.content').scrollTo({ top: 0, behavior: 'smooth' });
  const logo = $('homeLogo');
  let logoPressTimer = null;
  let logoLongPressed = false;
  const canLongPressLogo = () => window.matchMedia?.('(hover: none), (pointer: coarse)').matches;
  const clearLogoPress = () => {
    clearTimeout(logoPressTimer);
    logoPressTimer = null;
  };
  logo.addEventListener('pointerdown', ev => {
    if (!canLongPressLogo()) return;
    clearLogoPress();
    logoLongPressed = false;
    logoPressTimer = setTimeout(() => {
      logoLongPressed = true;
      openMobileFeedPanel();
    }, 520);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => logo.addEventListener(type, clearLogoPress));
  logo.addEventListener('contextmenu', ev => {
    if (!canLongPressLogo()) return;
    ev.preventDefault();
  });
  logo.addEventListener('click', ev => {
    if (logoLongPressed) {
      ev.preventDefault();
      ev.stopPropagation();
      logoLongPressed = false;
      return;
    }
    closeMobileFeedPanel();
    scrollHome();
  });
  document.addEventListener('pointerup', ev => {
    if (!window.matchMedia?.('(max-width: 720px)').matches) return;
    if (ev.clientY > 14) return;
    if (ev.target.closest('button,a,input,textarea,select,[role="button"],.view-panel,.sp-page,.modal')) return;
    const content = $('content');
    if (content) content.scrollTo({ top: 0, behavior: 'smooth' });
  }, { passive: true });
  document.addEventListener('click', ev => {
    const mobileFeed = ev.target.closest('.mobile-feed-option[data-feed-url]');
    if (mobileFeed) {
      selectFeed(mobileFeed.dataset.feedUrl || null);
      closeMobileFeedPanel();
      return;
    }
    const feedPanel = $('mobileFeedPanel');
    if (feedPanel?.classList.contains('open') && !feedPanel.contains(ev.target) && !logo.contains(ev.target)) {
      closeMobileFeedPanel();
    }
    if (ev.target.closest('.read-later-close')) {
      S.activeSpecialView = null;
      renderSidebar();
      renderArticles();
      return;
    }
    const saveBtn = ev.target.closest('.article-save-btn[data-save-id]');
    if (saveBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      const article = articleMap[saveBtn.dataset.saveId];
      if (!article) return;
      const saved = toggleReadLater(article);
      saveBtn.classList.toggle('saved', saved);
      saveBtn.setAttribute('aria-pressed', saved ? 'true' : 'false');
      saveBtn.setAttribute('title', saved ? 'Mentve' : 'Mentés későbbre');
      saveBtn.setAttribute('aria-label', saved ? 'Mentve' : 'Mentés későbbre');
      saveBtn.innerHTML = bookmarkIcon(saved, 18);
      if (S.activeSpecialView === 'readLater' && !saved) renderArticles();
      return;
    }
    if (ev.target.closest('.ix-footer-brand')) return scrollHome();
    if (ev.target.closest('.article-back')) closeArticleView();
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && ev.target.matches('.s-feed-item input')) ev.target.blur();
  });
  document.addEventListener('focusout', ev => {
    const input = ev.target.closest('.s-feed-item input[data-field]');
    if (!input) return;
    const row = input.closest('.s-feed-item'), id = row.dataset.id;
    if (row.dataset.kind === 'feed') {
      input.dataset.field === 'name' ? renameFeed(id, input.value) : renameFeedUrl(id, input.value, input);
    } else {
      input.dataset.field === 'name' ? renameYtChannelName(id, input.value) : renameYtChannelUrl(id, input.value, input);
    }
  });
  document.addEventListener('click', ev => {
    const btn = ev.target.closest('.s-feed-item [data-act]');
    if (!btn) return;
    const row = btn.closest('.s-feed-item'), id = row.dataset.id;
    if (btn.dataset.act !== 'delete') return;
    row.dataset.kind === 'feed' ? deleteFeed(id) : deleteYtChannel(id);
  });
  $('feedList').addEventListener('click', ev => {
    const btn = ev.target.closest('.nav-feed[data-feed-url]');
    if (btn) selectFeed(btn.dataset.feedUrl || null);
  });
  $('readLaterBtn')?.addEventListener('click', () => {
    S.activeSpecialView = S.activeSpecialView === 'readLater' ? null : 'readLater';
    S.activeCategory = null;
    renderSidebar();
    renderArticles();
  });
  let _pP = undefined, _pA = undefined; // undefined = not previewing
  const pg = $('presetGrid');
  pg.addEventListener('mouseover', ev => {
    const card = ev.target.closest('.preset-card[data-preset]');
    if (!card) return;
    if (_pP === undefined) { _pP = S.preset; _pA = S.customAccent; }
    S.preset = card.dataset.preset; S.customAccent = null;
    Theme.apply();
    pg.querySelectorAll('.preset-card').forEach(c => c.classList.toggle('active', c.dataset.preset === S.preset));
  });
  pg.addEventListener('mouseleave', () => {
    if (_pP === undefined) return;
    S.preset = _pP; S.customAccent = _pA; _pP = _pA = undefined;
    Theme.apply();
    pg.querySelectorAll('.preset-card').forEach(c => c.classList.toggle('active', c.dataset.preset === S.preset));
  });
  pg.addEventListener('click', ev => {
    const card = ev.target.closest('.preset-card[data-preset]');
    if (!card) return;
    _pP = _pA = undefined;
    setPreset(card.dataset.preset);
  });
  let _pC = undefined;
  const sr = $('swatchRow');
  sr.addEventListener('mouseover', ev => {
    const sw = ev.target.closest('.swatch[data-color]');
    if (!sw) return;
    if (_pC === undefined) _pC = S.customAccent;
    S.customAccent = sw.dataset.color;
    Theme.apply();
    sr.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset.color === S.customAccent));
  });
  sr.addEventListener('mouseleave', () => {
    if (_pC === undefined) return;
    S.customAccent = _pC; _pC = undefined;
    Theme.apply();
    sr.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset.color === S.customAccent));
  });
  sr.addEventListener('click', ev => {
    const sw = ev.target.closest('.swatch[data-color]');
    if (!sw) return;
    _pC = undefined;
    setAccent(sw.dataset.color);
  });
  let _vTimer;
  const _vBtn = $('viewBtn'), _vPanel = $('viewPanel');
  const openView  = () => { clearTimeout(_vTimer); _vPanel.classList.add('open'); };
  const closeView = () => { _vTimer = setTimeout(() => _vPanel.classList.remove('open'), 150); };
  _vBtn.addEventListener('pointerenter', ev => { if (ev.pointerType === 'mouse') openView(); });
  _vBtn.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') closeView(); });
  _vPanel.addEventListener('pointerenter', ev => { if (ev.pointerType === 'mouse') clearTimeout(_vTimer); });
  _vPanel.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') closeView(); });
  _vBtn.addEventListener('click', () => _vPanel.classList.toggle('open'));
  _vPanel.addEventListener('click', ev => {
    const btn = ev.target.closest('.v-layout-btn[data-layout]');
    if (btn) { setLayout(btn.dataset.layout); _vPanel.classList.remove('open'); }
  });
  window.addEventListener('popstate', () => {
    if (history.state?.flux === 'article') return;
    closeArticleView(true);
  });
  const _spPage = $('settingsPage');
  const openSettingsPage = () => {
    Theme._syncUI();
    renderSFeeds(); renderSYtChannels();
    const pv = $('ytPerVal'); if (pv) pv.textContent = S.ytPerChannel || 3;
    const mv = $('ytMaxVal'); if (mv) mv.textContent = S.ytMaxChannels || 5;
    const cv = $('ytColsVal'); if (cv) cv.textContent = S.ytColumns || 3;
    const rv = $('ytRowsVal'); if (rv) rv.textContent = S.ytRows || 1;
    const amc = $('articleMoreColsVal'); if (amc) amc.textContent = S.articleMoreColumns || 3;
    const amr = $('articleMoreRowsVal'); if (amr) amr.textContent = S.articleMoreRows || 1;
    _spPage.classList.add('open');
  };
  $('settingsBtn').addEventListener('click', openSettingsPage);
  $('spClose').addEventListener('click', () => _spPage.classList.remove('open'));
  $('spNav').addEventListener('click', ev => {
    const item = ev.target.closest('.sp-nav-item[data-sp]');
    if (!item) return;
    document.querySelectorAll('.sp-nav-item').forEach(b => b.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.sp-section').forEach(s => s.classList.remove('active'));
    $('sp-' + item.dataset.sp).classList.add('active');
  });
  _spPage.addEventListener('click', ev => {
    const readerBtn = ev.target.closest('.reader-mode-btn[data-reader-mode]');
    if (!readerBtn) return;
    S.readerMode = readerBtn.dataset.readerMode;
    saveSettings();
    Theme._syncUI();
  });
  _spPage.addEventListener('change', ev => {
    const input = ev.target.closest('[data-setting]');
    if (!input || !(input.dataset.setting in S)) return;
    S[input.dataset.setting] = input.type === 'checkbox' ? input.checked : input.value;
    saveSettings();
    if (input.dataset.setting === 'showYoutube') injectYtSidebar();
    syncWidgets();
  });
  $('overlay').onclick = () => { closeAddModal(); closeAddYtModal(); };
  document.addEventListener('click', ev => {
    if (!_vBtn.contains(ev.target) && !_vPanel.contains(ev.target)) _vPanel.classList.remove('open');
  });
  $('suggestions').addEventListener('click', ev => {
    const chip = ev.target.closest('.chip[data-url]');
    if (!chip) return;
    clearFeedChoices();
    $('feedUrl').value = chip.dataset.url;
    $('feedName').value = chip.dataset.label;
  });
  $('feedChoiceList').addEventListener('click', ev => {
    const choice = ev.target.closest('.feed-choice[data-url]');
    if (!choice) return;
    $('feedUrl').value = choice.dataset.url;
    $('feedName').value = choice.dataset.name || '';
    submitAddFeed(choice.dataset.url);
  });
  $('addFeedBtn').onclick = openAddModal;
  $('cancelAdd').onclick = closeAddModal;
  $('confirmAdd').onclick = submitAddFeed;
  $('feedUrl').addEventListener('keydown', ev => { if (ev.key === 'Enter') submitAddFeed(); });
  const updateYtPer = delta => {
    S.ytPerChannel = Math.max(1, Math.min(10, (S.ytPerChannel || 3) + delta));
    $('ytPerVal').textContent = S.ytPerChannel;
    saveSettings(); injectYtSidebar();
  };
  $('ytPerMinus').onclick = () => updateYtPer(-1);
  $('ytPerPlus').onclick  = () => updateYtPer(+1);
  const updateYtMax = delta => {
    S.ytMaxChannels = Math.max(1, Math.min(10, (S.ytMaxChannels || 5) + delta));
    $('ytMaxVal').textContent = S.ytMaxChannels;
    saveSettings(); injectYtSidebar();
  };
  $('ytMaxMinus').onclick = () => updateYtMax(-1);
  $('ytMaxPlus').onclick  = () => updateYtMax(+1);
  const updateYtGrid = (key, valId, delta) => {
    S[key] = clampInt((S[key] || 1) + delta, 1, 4, key === 'ytColumns' ? 3 : 1);
    $(valId).textContent = S[key];
    saveSettings(); injectYtSidebar();
  };
  $('ytColsMinus').onclick = () => updateYtGrid('ytColumns', 'ytColsVal', -1);
  $('ytColsPlus').onclick  = () => updateYtGrid('ytColumns', 'ytColsVal', +1);
  $('ytRowsMinus').onclick = () => updateYtGrid('ytRows', 'ytRowsVal', -1);
  $('ytRowsPlus').onclick  = () => updateYtGrid('ytRows', 'ytRowsVal', +1);
  const updateArticleMoreGrid = (key, valId, delta) => {
    S[key] = clampInt((S[key] || 1) + delta, 1, 4, key === 'articleMoreColumns' ? 3 : 1);
    $(valId).textContent = S[key];
    saveSettings();
  };
  $('articleMoreColsMinus').onclick = () => updateArticleMoreGrid('articleMoreColumns', 'articleMoreColsVal', -1);
  $('articleMoreColsPlus').onclick  = () => updateArticleMoreGrid('articleMoreColumns', 'articleMoreColsVal', +1);
  $('articleMoreRowsMinus').onclick = () => updateArticleMoreGrid('articleMoreRows', 'articleMoreRowsVal', -1);
  $('articleMoreRowsPlus').onclick  = () => updateArticleMoreGrid('articleMoreRows', 'articleMoreRowsVal', +1);
  $('addYtBtn').onclick = openAddYtModal;
  $('cancelYt').onclick = closeAddYtModal;
  $('confirmYt').onclick = submitAddYt;
  $('ytChannelInput').addEventListener('keydown', ev => { if (ev.key === 'Enter') submitAddYt(); });
  $('ytChoiceList').addEventListener('click', ev => {
    const choice = ev.target.closest('.yt-choice[data-id]');
    if (!choice) return;
    $('ytChannelInput').value = choice.dataset.id;
    submitAddYt(choice.dataset.id);
  });
  $('modeBar').addEventListener('click', ev => {
    const b = ev.target.closest('.mode-btn');
    if (b) { S.theme = b.dataset.mode; saveSettings(); Theme.apply(); buildSettingsUI(); }
  });
  $('fontSlider').addEventListener('input', ev => {
    S.fontSize = +ev.target.value;
    document.documentElement.style.setProperty('--font-size-base', S.fontSize + 'px');
  });
  $('fontSlider').addEventListener('change', saveSettings);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (S.theme === 'auto') { Theme.apply(); buildSettingsUI(); }
  });
  $('configSaveBtn').onclick = () => Config.save();
  $('configLoadBtn').onclick = () => Config.load();
}
function syncWidgets() {
  Theme._syncUI();
  S.showWeather ? loadWeather() : clearWidget('navWeather');
  S.showF1 ? loadF1() : clearWidget('navF1');
}
function clearWidget(id) {
  const el = $(id);
  if (!el) return;
  if (el._fluxPopupCleanup) el._fluxPopupCleanup();
  el.innerHTML = id === 'navF1' ? '<span class="f1-badge">F1</span>' : '';
  el.style.display = 'none';
}
const WX_CDN = 'https://cdn.jsdelivr.net/gh/basmilius/weather-icons/production/fill/all/';
const WX_ICONS = {
  0: ['clear-day','clear-night'],
  1: ['partly-cloudy-day','partly-cloudy-night'],
  2: ['partly-cloudy-day','partly-cloudy-night'],
  3: ['overcast-day','overcast-night'],
  45:['fog-day','fog-night'], 48:['fog-day','fog-night'],
  51:['partly-cloudy-day-drizzle','partly-cloudy-night-drizzle'],
  53:['drizzle','drizzle'], 55:['rain','rain'],
  61:['partly-cloudy-day-rain','partly-cloudy-night-rain'],
  63:['rain','rain'], 65:['rain','rain'],
  71:['partly-cloudy-day-snow','partly-cloudy-night-snow'],
  73:['snow','snow'], 75:['snow','snow'],
  80:['partly-cloudy-day-rain','partly-cloudy-night-rain'],
  81:['rain','rain'], 82:['thunderstorms-rain','thunderstorms-rain'],
  95:['thunderstorms-day-rain','thunderstorms-night-rain'],
  96:['thunderstorms-rain','thunderstorms-rain'],
  99:['thunderstorms-rain','thunderstorms-rain']
};
const _wxSvgCache = {};
let _wxUid = 0;
async function _wxFetch(name) {
  if (_wxSvgCache[name]) return _wxSvgCache[name];
  try {
    const r = await fetch(WX_CDN + name + '.svg');
    _wxSvgCache[name] = r.ok ? await r.text() : '';
  } catch(e) { _wxSvgCache[name] = ''; }
  return _wxSvgCache[name];
}
function wxFallbackIcon(name, size) {
  const s = Math.max(11, size);
  const stroke = 'currentColor';
  const cloud = `<path d="M7.5 ${s*.64}h${s*.5}a${s*.2} ${s*.2} 0 0 0 .02-${s*.4} ${s*.3} ${s*.3} 0 0 0-${s*.58}-.08A${s*.36} ${s*.36} 0 0 0 ${s*.25} ${s*.46}a${s*.24} ${s*.24} 0 0 0 .02 ${s*.18}" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  let body;
  if (name.includes('rain') || name.includes('drizzle')) {
    body = `${cloud}<path d="M${s*.38} ${s*.75}l-${s*.05} ${s*.12}M${s*.55} ${s*.75}l-${s*.05} ${s*.12}M${s*.72} ${s*.75}l-${s*.05} ${s*.12}" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round"/>`;
  } else if (name.includes('snow')) {
    body = `${cloud}<path d="M${s*.42} ${s*.8}h.01M${s*.58} ${s*.84}h.01M${s*.74} ${s*.8}h.01" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round"/>`;
  } else if (name.includes('cloud') || name.includes('overcast') || name.includes('fog')) {
    body = `${cloud}${name.includes('fog') ? `<path d="M${s*.25} ${s*.82}h${s*.5}M${s*.32} ${s*.92}h${s*.36}" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round"/>` : ''}`;
  } else if (name.includes('wind')) {
    body = `<path d="M${s*.18} ${s*.38}h${s*.46}a${s*.12} ${s*.12} 0 1 0-${s*.12}-${s*.12}M${s*.16} ${s*.54}h${s*.62}M${s*.2} ${s*.7}h${s*.42}a${s*.12} ${s*.12} 0 1 1-${s*.12} ${s*.12}" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>`;
  } else if (name.includes('raindrop')) {
    body = `<path d="M${s*.5} ${s*.16}C${s*.36} ${s*.38} ${s*.26} ${s*.52} ${s*.26} ${s*.66}a${s*.24} ${s*.24} 0 0 0 ${s*.48} 0c0-${s*.14}-${s*.1}-${s*.28}-${s*.24}-${s*.5}Z" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linejoin="round"/>`;
  } else {
    body = `<circle cx="${s*.5}" cy="${s*.5}" r="${s*.22}" fill="none" stroke="${stroke}" stroke-width="1.8"/><path d="M${s*.5} ${s*.1}v${s*.1}M${s*.5} ${s*.8}v${s*.1}M${s*.1} ${s*.5}h${s*.1}M${s*.8} ${s*.5}h${s*.1}M${s*.22} ${s*.22}l${s*.07} ${s*.07}M${s*.71} ${s*.71}l${s*.07} ${s*.07}M${s*.78} ${s*.22}l-${s*.07} ${s*.07}M${s*.29} ${s*.71}l-${s*.07} ${s*.07}" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/>`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${s} ${s}" fill="none" style="display:block;flex-shrink:0;color:var(--ac);overflow:visible">${body}</svg>`;
}
function wxInline(svgText, size) {
  if (!svgText) return wxFallbackIcon('clear-day', size);
  const p = 'wx' + (_wxUid++);
  let svg = svgText
    .replace(/\bid="([^"]+)"/g,    `id="${p}$1"`)
    .replace(/url\(#([^)]+)\)/g,   `url(#${p}$1)`)
    .replace(/href="#([^"]+)"/g,   `href="#${p}$1"`);
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (!dark) {
    svg = svg
      .replace(/#f3f7fe/gi, '#bfdbfe')  // cloud fill light  → blue-200
      .replace(/#deeafb/gi, '#93c5fd')  // cloud fill darker → blue-300
      .replace(/#e6effc/gi, '#93c5fd'); // cloud stroke      → blue-300
  }
  return svg.replace(/<svg\b/, `<svg width="${size}" height="${size}" style="display:block;flex-shrink:0;overflow:visible"`);
}
function wxIconName(code, isDay) {
  const pair = WX_ICONS[code] || ['not-available','not-available'];
  return pair[isDay ? 0 : 1];
}
const WX_LABELS = {
  0:'Derült',1:'Enyhén felhős',2:'Változékony',3:'Borult',
  45:'Köd',48:'Zúzmarás köd',
  51:'Szitálás',53:'Szitálás',55:'Erős szitálás',
  61:'Eső',63:'Eső',65:'Erős eső',
  71:'Hószállingózás',73:'Havazás',75:'Erős havazás',
  80:'Zápor',81:'Erős zápor',82:'Viharos zápor',
  95:'Zivatar',96:'Zivatar jégesővel',99:'Zivatar jégesővel'
};
async function loadWeather() {
  const el = document.getElementById('navWeather');
  if (!el) return;
  if (!S.showWeather) { clearWidget('navWeather'); return; }
  el.style.display = '';
  const WX_TTL = 30 * 60 * 1000; // 30 perc
  async function renderWx(w) {
    if (!S.showWeather) return;
    const label = WX_LABELS[w.code] || '';
    const feels = w.feels    !== undefined ? w.feels    : '–';
    const humid = w.humidity !== undefined ? w.humidity : '–';
    const wind  = w.wind     !== undefined ? w.wind     : '–';
    const h = new Date().getHours();
    const isDay = h >= 6 && h < 21;
    const sunsetHourRx = w.sunsetTime ? parseInt(w.sunsetTime) : -1;
    const hourSlots  = (w.hours || []).slice(1, 7).map(hr => ({
      ...hr, isSunset: parseInt(hr.time) === sunsetHourRx
    }));
    const dayCodes   = (w.days  || []).map(d => wxIconName(d.code, true));
    const uvName     = `uv-index-${Math.min(Math.max(w.uv, 1), 11)}`;
    const hasSunset  = hourSlots.some(hr => hr.isSunset);
    const hourIconNames = hourSlots.map(hr => {
      const hrIsDay = parseInt(hr.time) >= 6 && parseInt(hr.time) < 21;
      return wxIconName(hr.code, hrIsDay);
    });
    const allNames   = [
      wxIconName(w.code, isDay),
      ...hourIconNames,
      ...dayCodes,
      uvName, 'wind', 'raindrop',
      ...(hasSunset ? ['sunset'] : [])
    ];
    await Promise.all([...new Set(allNames)].map(n => _wxFetch(n)));
    const ic = (name, size) => _wxSvgCache[name]
      ? wxInline(_wxSvgCache[name], size)
      : wxFallbackIcon(name, size);
    const mainSvg = ic(wxIconName(w.code, isDay), 52);
    const navSvg  = ic(wxIconName(w.code, isDay), 22);
    const hourlyHtml = hourSlots.map(hr => {
      const hrIsDay = parseInt(hr.time) >= 6 && parseInt(hr.time) < 21;
      if (hr.isSunset) {
        return `<div class="wx-hour">
          <span class="wx-hour-time" style="color:var(--ac);font-weight:600">${w.sunsetTime}</span>
          <div class="wx-hour-icon">${ic('sunset', 24)}</div>
          <span class="wx-hour-temp">${hr.temp}°</span>
        </div>`;
      }
      return `<div class="wx-hour">
        <span class="wx-hour-time">${hr.time || ''}</span>
        <div class="wx-hour-icon">${ic(wxIconName(hr.code, hrIsDay), 24)}</div>
        <span class="wx-hour-temp">${hr.temp}°</span>
      </div>`;
    }).join('');
    el.innerHTML = `
      <div class="nav-weather-icon">${navSvg}</div>
      <span class="nav-weather-temp">${w.temp}°</span>
      <div class="wx-popup" id="wxPopup">
        <div class="wx-top">
          <div class="wx-left">
            <div class="wx-big-temp">${w.temp}°</div>
          </div>
          <div class="wx-main-right">
            <div class="wx-big-icon">${mainSvg}</div>
            <div class="wx-condition">${label}</div>
          </div>
        </div>
        <div class="wx-bottom-row">
          <div class="wx-meta">
            ${w.precip0 > 0 ? `<span>${ic('raindrop', 14)}${w.precip0}%</span>` : ''}
            <span>${ic(uvName, 14)}UV ${w.uv}</span>
            <span>${ic('wind', 14)}${wind} km/h</span>
          </div>
          <div class="wx-minmax"><span style="color:#60a5fa">↓${w.tmin}°</span>&nbsp; <span style="color:#f97316">↑${w.tmax}°</span></div>
        </div>
        <div class="wx-hourly">${hourlyHtml}</div>
        <div class="wx-forecast">${(w.days || []).map((day, i) => {
          const HU = ['Vasárnap','Hétfő','Kedd','Szerda','Csütörtök','Péntek','Szombat'];
          return `<div class="wx-frow">
            <span class="wx-fday">${i === 0 ? 'Holnap' : HU[day.dow]}</span>
            <span class="wx-ficon">${ic(wxIconName(day.code, true), 20)}</span>
            <span class="wx-fcond">${WX_LABELS[day.code] || ''}</span>
            <span class="wx-frain">${day.precip > 0 ? `${day.precip}%${ic('raindrop', 11)}` : ''}</span>
            <span class="wx-ftemp-min">${day.tmin}°</span>
            <span class="wx-ftemp-max">${day.tmax}°</span>
          </div>`;
        }).join('')}</div>
      </div>`;
    el.title = '';
    setupHoverTapPopup(el, document.getElementById('wxPopup'), 'wx-open');
  }
  try {
    const cached = JSON.parse(localStorage.getItem('flux_wx') || 'null');
    const fresh = cached && Date.now() - cached.ts < WX_TTL && cached.uv !== undefined && cached.hours && cached.hours.length && cached.days && cached.days.length && cached.sunsetTime;
    const newFormat = fresh && !String(cached.hours[0]?.time || '').includes(':');
    if (fresh && newFormat) { renderWx(cached); return; }
  } catch(e) {}
  try {
    let lat, lon;
    const cachedCoords = JSON.parse(localStorage.getItem('flux_wx_coords') || 'null');
    if (cachedCoords) {
      lat = cachedCoords.lat; lon = cachedCoords.lon;
    } else {
      try {
        const pos = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000 })
        );
        lat = pos.coords.latitude; lon = pos.coords.longitude;
        localStorage.setItem('flux_wx_coords', JSON.stringify({ lat, lon }));
      } catch(e) {
        lat = 47.4979; lon = 19.0402;
      }
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weathercode,apparent_temperature,relative_humidity_2m,wind_speed_10m,uv_index` +
      `&hourly=temperature_2m,weathercode` +
      `&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max,sunset` +
      `&timezone=auto&forecast_days=7`;
    const d = await fetchT(url, {}, 10000).then(r => r.json());
    const sunsetStr  = d.daily.sunset?.[0] || '';          // "2026-04-02T19:43"
    const sunsetTime = sunsetStr.slice(11, 16);             // "19:43"
    const sunsetHour = sunsetTime ? parseInt(sunsetTime)  : -1;
    const nowH = new Date().getHours();
    const hours = [];
    for (let i = 0; i < 7; i++) {
      const hi = nowH + i;
      if (hi < (d.hourly.time || []).length) {
        const hourOfDay = hi % 24;
        hours.push({
          time:     String(hourOfDay),
          temp:     Math.round(d.hourly.temperature_2m[hi]),
          code:     d.hourly.weathercode[hi],
          isSunset: hourOfDay === sunsetHour
        });
      }
    }
    const w = {
      temp:     Math.round(d.current.temperature_2m),
      feels:    Math.round(d.current.apparent_temperature),
      humidity: d.current.relative_humidity_2m,
      wind:     Math.round(d.current.wind_speed_10m),
      code:     d.current.weathercode,
      uv:       Math.round(d.current.uv_index ?? 0),
      precip0:  d.daily.precipitation_probability_max?.[0] ?? 0,
      tmax:     Math.round(d.daily.temperature_2m_max[0]),
      tmin:     Math.round(d.daily.temperature_2m_min[0]),
      sunsetTime,
      hours,
      days: [1,2,3,4,5].map(i => ({
        dow:    new Date((d.daily.time[i] || '') + 'T12:00:00').getDay(),
        code:   d.daily.weathercode[i],
        tmax:   Math.round(d.daily.temperature_2m_max[i]),
        tmin:   Math.round(d.daily.temperature_2m_min[i]),
        precip: d.daily.precipitation_probability_max?.[i] ?? 0
      })).filter(x => !isNaN(x.tmax)),
      ts:       Date.now()
    };
    localStorage.setItem('flux_wx', JSON.stringify(w));
    renderWx(w);
  } catch(e) {
    try {
      const stale = JSON.parse(localStorage.getItem('flux_wx') || 'null');
      if (stale && stale.temp !== undefined) renderWx(stale);
    } catch(e2) {}
  }
}
function extractYtChannelId(input) {
  input = input.trim();
  if (!input) return null;
  input = input.replace(/\/+$/, '');
  if (/^UC[A-Za-z0-9_\-]{22}$/.test(input)) return { type: 'id', value: input };
  if (/^\@([A-Za-z0-9._\-]+)$/.test(input)) return { type: 'handle', value: input.slice(1) };
  let parsedUrl = null;
  try {
    const urlish = /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`;
    parsedUrl = new URL(urlish);
  } catch(e) {}
  if (parsedUrl) {
    const host = parsedUrl.hostname.replace(/^www\./, '').replace(/^m\./, '');
    const path = parsedUrl.pathname.replace(/\/+$/, '');
    const videoId = parsedUrl.searchParams.get('v');
    if ((host === 'youtube.com' || host === 'youtu.be') && (videoId || host === 'youtu.be')) {
      return { type: 'video', value: videoId || path.replace(/^\//, '') };
    }
    if (host === 'youtube.com') {
      const m1 = path.match(/^\/channel\/(UC[A-Za-z0-9_\-]{22})$/);
      if (m1) return { type: 'id', value: m1[1] };
      const m2 = path.match(/^\/@([A-Za-z0-9._\-]+)$/);
      if (m2) return { type: 'handle', value: m2[1] };
      const m3 = path.match(/^\/user\/([A-Za-z0-9._\-]+)$/);
      if (m3) return { type: 'user', value: m3[1] };
      return { type: 'url', value: `${parsedUrl.origin}${path}` };
    }
  }
  const m1 = input.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_\-]{22})/);
  if (m1) return { type: 'id', value: m1[1] };
  const m2 = input.match(/(?:youtube\.com\/)?\@([A-Za-z0-9._\-]+)/);
  if (m2) return { type: 'handle', value: m2[1] };
  const m3 = input.match(/youtube\.com\/user\/([A-Za-z0-9._\-]+)/);
  if (m3) return { type: 'user', value: m3[1] };
  return null;
}
async function fetchJsonThroughProxies(url) {
  const text = await firstResult(proxyTextAttempts(url), Boolean);
  try { return text ? JSON.parse(text) : null; } catch(e) { return null; }
}
async function resolveYtVideoToChannel(videoId) {
  if (!videoId) return null;
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const sources = [
    `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`,
    `https://noembed.com/embed?url=${encodeURIComponent(videoUrl)}`
  ];
  for (const src of sources) {
    const data = await fetchJsonThroughProxies(src).catch(() => null);
    const authorUrl = data?.author_url || '';
    const authorName = data?.author_name || '';
    if (!authorUrl) continue;
    const parsed = extractYtChannelId(authorUrl);
    if (!parsed) continue;
    const resolved = await resolveYtInputToChannel(parsed).catch(() => null);
    if (resolved) return { ...resolved, name: authorName || resolved.id };
  }
  return null;
}
async function fetchYtPage(pageUrl) {
  return firstResult(proxyTextAttempts(pageUrl), Boolean);
}
function extractChannelIdFromHtml(html) {
  if (!html) return null;
  return firstMatch(html, [
    /window\['ytCommand'\]\s*=\s*\{[\s\S]*?"browseEndpoint":\{"browseId":"(UC[A-Za-z0-9_\-]{22})"/,
    /"vanityChannelUrl":"[^"]+","externalId":"(UC[A-Za-z0-9_\-]{22})"/,
    /"rssUrl":"https:\\\/\\\/www\.youtube\.com\\\/feeds\\\/videos\.xml\?channel_id=(UC[A-Za-z0-9_\-]{22})"/,
    /"externalId":"(UC[A-Za-z0-9_\-]{22})"/,
    /<link[^>]+rel="alternate"[^>]+type="application\/rss\+xml"[^>]+href="https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=(UC[A-Za-z0-9_\-]{22})"/i,
    /<meta[^>]+itemprop="identifier"[^>]+content="(UC[A-Za-z0-9_\-]{22})"/i,
    /"channelId":"(UC[A-Za-z0-9_\-]{22})"/,
    /"browseId":"(UC[A-Za-z0-9_\-]{22})"/,
    /\/channel\/(UC[A-Za-z0-9_\-]{22})"/,
    /channel_id=(UC[A-Za-z0-9_\-]{22})/
  ]);
}
function firstMatch(text, patterns, group = 1) {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m?.[group]) return m[group];
  }
  return null;
}
async function resolveYtHandle(handle) {
  const html = await fetchYtPage(`https://www.youtube.com/@${handle}`);
  return extractChannelIdFromHtml(html);
}
async function resolveYtChannelUrl(url) {
  const html = await fetchYtPage(url);
  return extractChannelIdFromHtml(html);
}
async function resolveYtInputToChannel(parsed) {
  if (!parsed) return null;
  if (parsed.type === 'id') return { id: parsed.value, idType: 'id' };
  if (parsed.type === 'handle') {
    const id = await resolveYtHandle(parsed.value).catch(() => null);
    return id ? { id, idType: 'id' } : null;
  }
  if (parsed.type === 'user') {
    const id = await resolveYtChannelUrl(`https://www.youtube.com/user/${parsed.value}`).catch(() => null);
    return id ? { id, idType: 'id' } : { id: parsed.value, idType: 'user' };
  }
  if (parsed.type === 'url') {
    const id = await resolveYtChannelUrl(parsed.value).catch(() => null);
    return id ? { id, idType: 'id' } : null;
  }
  if (parsed.type === 'video') {
    return resolveYtVideoToChannel(parsed.value);
  }
  return null;
}
async function fetchYtLookup(input) {
  const response = await fetchT(YOUTUBE_API + encodeURIComponent(input), { cache: 'no-store' }, 15000);
  if (!response.ok) return null;
  const data = await response.json();
  if (Array.isArray(data?.results)) {
    return {
      results: data.results.map(r => ({
        id: r.id,
        idType: 'id',
        name: normalizeText(r.name || r.id),
        handle: normalizeText(r.handle || '')
      })).filter(r => r.id && r.name)
    };
  }
  if (!data?.id) return null;
  return {
    id: data.id,
    idType: 'id',
    name: normalizeText(data.name || data.channelName || data.id),
    videos: Array.isArray(data.videos) ? data.videos.map(v => ({
      videoId: v.videoId,
      title: normalizeText(v.title || ''),
      date: new Date(v.date || Date.now()),
      thumb: v.thumb || (v.videoId ? `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg` : ''),
      channelName: normalizeText(v.channelName || data.name || data.channelName || data.id),
      channelId: data.id
    })).filter(v => v.videoId && v.title) : []
  };
}
function parseYtVideosFromHtml(html, fallbackChannelId, fallbackChannelName) {
  if (!html) return { videos: [], channelName: fallbackChannelName || fallbackChannelId };
  const channelName = normalizeText(firstMatch(html, [/"ownerChannelName":"([^"]+)"/, /"channelMetadataRenderer":\{"title":"([^"]+)"/]) || fallbackChannelName || fallbackChannelId);
  const seen = new Set();
  const videos = [];
  const patterns = [
    /"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,600}?"title":\{"runs":\[\{"text":"([^"]+)"/g,
    /"gridVideoRenderer":\{[\s\S]{0,1200}?"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,1200}?"title":\{"runs":\[\{"text":"([^"]+)"/g,
    /"richItemRenderer":\{[\s\S]{0,1600}?"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,1600}?"title":\{"runs":\[\{"text":"([^"]+)"/g
  ];
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(html)) && videos.length < 15) {
      const videoId = m[1];
      const title = m[2];
      if (!videoId || seen.has(videoId)) continue;
      seen.add(videoId);
      videos.push({
        videoId,
        title: normalizeText(title),
        date: new Date(),
        thumb: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        channelName,
        channelId: fallbackChannelId
      });
    }
    if (videos.length) break;
  }
  return { videos, channelName };
}
async function fetchYtVideosFromChannelPage(url, channelId, channelName) {
  const html = await fetchYtPage(url);
  return parseYtVideosFromHtml(html, channelId, channelName);
}
async function fetchYtChannelVideos(ch) {
  if (ch.idType === 'handle') {
    return fetchYtVideosFromChannelPage(`https://www.youtube.com/@${ch.id}/videos`, ch.id, ch.name);
  }
  if (ch.idType === 'url') {
    return fetchYtVideosFromChannelPage(ch.id.replace(/\/+$/, '') + '/videos', ch.id, ch.name);
  }
  const param = ch.idType === 'id' ? `channel_id=${ch.id}` : `user=${ch.id}`;
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?${param}`;
  try {
    const r = await fetchT(RSS2JSON + encodeURIComponent(feedUrl), { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      if (d.status === 'ok' && Array.isArray(d.items) && d.items.length) {
        const channelName = normalizeText(d.feed?.title || ch.name || ch.id);
        const videos = d.items.slice(0, 15).map(i => {
          const link = i.link || '';
          const videoId = link.match(/[?&]v=([^&]+)/)?.[1] || '';
          return {
            videoId,
            title: normalizeText(i.title || ''),
            date: new Date(i.pubDate),
            thumb: i.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : ''),
            channelName,
            channelId: ch.id
          };
        }).filter(v => v.videoId);
        if (videos.length) return { videos, channelName };
      }
    }
  } catch(e) {}
  const xml = await firstResult(proxyTextAttempts(feedUrl), Boolean);
  if (!xml) return { videos: [], channelName: ch.name };
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const entries = [...doc.querySelectorAll('entry')];
  if (!entries.length) return { videos: [], channelName: ch.name };
  const channelName = normalizeText(doc.querySelector('author > name')?.textContent?.trim() || ch.name || ch.id);
  const videos = entries.slice(0, 15).map(el => {
    const link = el.querySelector('link')?.getAttribute('href') || '';
    const videoId = link.match(/[?&]v=([^&]+)/)?.[1] || '';
    const title = normalizeText(el.querySelector('title')?.textContent?.trim() || '');
    const published = el.querySelector('published')?.textContent || '';
    const thumb = videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : '';
    return { videoId, title, date: new Date(published), thumb, channelName, channelId: ch.id };
  }).filter(v => v.videoId);
  return { videos, channelName };
}
async function loadYouTube(bust = false) {
  if (!S.ytChannels.length) {
    ytLoading = false;
    ytVideos = [];
    removeYtSidebar();
    return;
  }
  const YT_TTL = 30 * 60 * 1000;
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem('flux_yt_cache') || 'null');
    if (cached?.sig === ytCacheSignature() && cached.videos?.length && !ytVideos.length) {
      ytVideos = cached.videos.map(v => ({ ...v, date: new Date(v.date) }));
      ytVideos.forEach(v => { ytVideoMap[v.videoId] = v; });
    }
    if (!bust && cached && Date.now() - cached.ts < YT_TTL && cached.videos?.length) {
      ytLoading = false;
      injectYtSidebar();
      return;
    }
  } catch(e) {}
  ytLoading = true;
  ytLoadProgress = 0;
  if (!ytActiveVideoId) injectYtSidebar();
  let completed = 0;
  const results = await Promise.all(
    S.ytChannels.map(async ch => {
      const result = await fetchYtChannelVideos(ch).catch(() => ({ videos: [], channelName: ch.name }));
      completed += 1;
      ytLoadProgress = completed / S.ytChannels.length;
      if (!ytActiveVideoId) injectYtSidebar();
      return result;
    })
  );
  results.forEach((r, i) => {
    if (r.channelName && r.channelName !== S.ytChannels[i].id) S.ytChannels[i].name = r.channelName;
  });
  saveYtChannels();
  const freshVideos = results.flatMap(r => r.videos).sort((a, b) => b.date - a.date);
  const expectedChannels = S.ytChannels.length;
  const freshChannelCount = ytChannelCountFromVideos(freshVideos);
  const cachedVideos = (cached && cached.sig === ytCacheSignature() && cached.videos?.length)
    ? cached.videos.map(v => ({ ...v, date: new Date(v.date) }))
    : [];
  const cachedChannelCount = ytChannelCountFromVideos(cachedVideos);
  ytVideos = freshVideos;
  if (freshChannelCount < expectedChannels && cachedChannelCount > freshChannelCount) {
    ytVideos = cachedVideos;
  }
  ytVideos.forEach(v => { ytVideoMap[v.videoId] = v; });
  if (freshChannelCount >= expectedChannels || !cachedChannelCount) {
    try {
      localStorage.setItem('flux_yt_cache', JSON.stringify({
        ts: Date.now(),
        sig: ytCacheSignature(),
        videos: freshVideos
      }));
    } catch(e) {}
  }
  ytLoading = false;
  ytLoadProgress = 0;
  if (!ytActiveVideoId) injectYtSidebar();
}
function ytAge(d) {
  if (!d || isNaN(d)) return '';
  const s = (Date.now() - d) / 1000;
  if (s < 3600) return `${Math.floor(s/60)}p`;
  if (s < 86400) return `${Math.floor(s/3600)}ó`;
  if (s < 604800) return `${Math.floor(s/86400)}n`;
  return d.toLocaleDateString('hu-HU', { month:'short', day:'numeric' });
}
function getYtSidebarGroups() {
  const n = S.ytPerChannel || 3;
  const maxChannels = clampInt(S.ytMaxChannels, 1, 10, 5);
  const byChannel = {};
  ytVideos.forEach(v => {
    if (!byChannel[v.channelId]) byChannel[v.channelId] = [];
    byChannel[v.channelId].push(v);
  });
  const groups = S.ytChannels.slice(0, maxChannels).map(ch => ({
    name: ch.name || ch.id,
    videos: (byChannel[ch.id] || []).slice(0, n)
  })).filter(g => g.videos.length);
  return groups;
}
function getYtSidebarVideos() {
  const videos = getYtSidebarGroups()
    .flatMap(g => g.videos.map(v => ({ ...v, displayChannelName: g.name })));
  return S.ytSortMode === 'time'
    ? videos.sort((a, b) => b.date - a.date)
    : videos;
}
function ytVideoById(videoId) {
  return getYtSidebarVideos().find(v => v.videoId === videoId) || ytVideos.find(v => v.videoId === videoId);
}
function buildYtSidebarHtml() {
  const videos = getYtSidebarVideos();
  if (!videos.length) {
    const message = ytLoading
      ? 'YouTube videók betöltése...'
      : 'Még nincs megjeleníthető videó. Ellenőrizd a csatornákat vagy frissíts újra.';
    return `<div class="yt-empty">${e(message)}</div>`;
  }
  const activeVideo = ytActiveVideoId ? ytVideoById(ytActiveVideoId) : null;
  if (activeVideo) {
    const channelName = activeVideo.displayChannelName || activeVideo.channelName || '';
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(activeVideo.videoId)}`;
    const origin = location.origin && location.origin !== 'null' ? `&origin=${encodeURIComponent(location.origin)}` : '';
    const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(activeVideo.videoId)}?autoplay=1&playsinline=1&rel=0&enablejsapi=1&iv_load_policy=3${origin}`;
    return `<div class="yt-player-head">
      <div class="yt-player-copy">
        <div class="yt-player-label">LEJÁTSZÁS</div>
        <div class="yt-player-title">${e(activeVideo.title)}</div>
        <div class="yt-player-meta">${e(channelName)}${channelName ? ' · ' : ''}${ytAge(activeVideo.date)}</div>
      </div>
      <button class="yt-player-close" type="button" data-yt-close title="Videó bezárása">×</button>
    </div>
    <div class="yt-player-stage">
      <div class="yt-player-frame-wrap">
      <iframe class="yt-player-frame" src="${e(embedUrl)}" title="${e(activeVideo.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share" allowfullscreen></iframe>
        <div class="yt-mini-tools">
          <button class="yt-mini-tool yt-mini-drag" type="button" data-yt-drag title="Mini player mozgatása" aria-label="Mini player mozgatása">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/></svg>
          </button>
          <button class="yt-mini-tool" type="button" data-yt-size title="Mini player mérete" aria-label="Mini player mérete">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 15l6-6M11 9h4v4"/></svg>
          </button>
          <button class="yt-mini-tool" type="button" data-yt-collapse title="Mini player összecsukása" aria-label="Mini player összecsukása">
            <svg class="yt-collapse-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12h8M12 8l4 4-4 4"/></svg>
          </button>
          <button class="yt-mini-tool" type="button" data-yt-close title="Videó bezárása" aria-label="Videó bezárása">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
      </div>
    </div>
    <a class="yt-player-external" href="${e(watchUrl)}" target="flux-youtube">Megnyitás YouTube-on</a>`;
  }
  const cols = clampInt(S.ytColumns, 1, 4, 3);
  const rows = clampInt(S.ytRows, 1, 4, 1);
  const pageSize = cols * rows;
  const pages = [];
  for (let i = 0; i < videos.length; i += pageSize) pages.push(videos.slice(i, i + pageSize));
  const cardHtml = v => `
      <button class="yt-vcard" type="button" data-yt-video-id="${e(v.videoId)}">
        <div class="yt-vcard-thumb-wrap"><img class="yt-vcard-thumb" src="${e(v.thumb)}" alt="" loading="lazy" onerror="this.parentNode.style.display='none'"></div>
        <div class="yt-vcard-body">
          <div class="yt-vcard-title">${e(v.title)}</div>
          <div class="yt-vcard-meta"><span class="yt-vcard-channel">${e(v.displayChannelName || v.channelName || '')}</span> · ${ytAge(v.date)}</div>
        </div>
      </button>`;
  const html = pages.map(page => `<div class="yt-page" style="--yt-cols:${cols}">${page.map(cardHtml).join('')}</div>`).join('');
  const pager = pages.length > 1 ? `<div class="yt-pager">
      <button class="yt-page-btn" type="button" data-dir="-1" title="Előző videók">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <button class="yt-page-btn" type="button" data-dir="1" title="Következő videók">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>` : '';
  const sortByTime = S.ytSortMode === 'time';
  const sortLabel = sortByTime ? 'Időrend szerint' : 'Csatorna szerint';
  return `<div class="yt-box-head${ytLoading ? ' is-loading' : ''}" style="--yt-progress:${Math.round(ytLoadProgress * 100)}%">
    <span class="yt-box-title">${ytLoading ? 'VIDEÓK FRISSÍTÉSE...' : 'LEGFRISSEBB VIDEÓK'}</span>
    <span class="yt-box-line"><span></span></span>
    <button class="yt-sort-toggle" type="button" data-yt-sort-toggle title="Rendezési mód váltása">
      <span class="yt-sort-label">${sortLabel}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h11l-3-3"/><path d="M17 17H6l3 3"/></svg>
    </button>
  </div><div class="yt-scroll-row">${html}</div>${pager}`;
}
function animateYtOpen(card, video) {
  const img = card.querySelector('.yt-vcard-thumb');
  if (!img || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    ytActiveVideoId = video.videoId;
    injectYtSidebar();
    return;
  }
  const from = img.getBoundingClientRect();
  const ghost = img.cloneNode();
  ghost.className = 'yt-player-zoom-ghost';
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  ghost.style.width = `${from.width}px`;
  ghost.style.height = `${from.height}px`;
  document.body.appendChild(ghost);
  ytActiveVideoId = video.videoId;
  injectYtSidebar();
  const sidebar = document.querySelector('.yt-sidebar');
  if (sidebar) sidebar.classList.add('yt-player-opening');
  requestAnimationFrame(() => {
    const target = document.querySelector('.yt-player-frame-wrap')?.getBoundingClientRect();
    if (!target) {
      ghost.remove();
      if (sidebar) sidebar.classList.remove('yt-player-opening');
      return;
    }
    ghost.style.left = `${target.left}px`;
    ghost.style.top = `${target.top}px`;
    ghost.style.width = `${target.width}px`;
    ghost.style.height = `${target.height}px`;
    ghost.style.opacity = '0';
    setTimeout(() => {
      ghost.remove();
      if (sidebar) sidebar.classList.remove('yt-player-opening');
    }, 360);
  });
}
function closeYtPlayer() {
  const sidebar = document.querySelector('.yt-sidebar');
  destroyYtPlayer();
  ytActiveVideoId = null;
  if (!sidebar) {
    injectYtSidebar();
    return;
  }
  sidebar.classList.remove('yt-player-active', 'yt-player-mini', 'yt-player-collapsed', 'yt-player-opening');
  applyYtMiniPreferences(sidebar);
  sidebar.innerHTML = buildYtSidebarHtml();
  placeYtSidebar($('content'), sidebar);
  initYtPager(sidebar);
  bindYtSidebarClicks(sidebar);
  requestAnimationFrame(() => {
    const row = sidebar.querySelector('.yt-scroll-row');
    if (row) row.scrollLeft = ytReturnScrollLeft;
  });
}
function loadYtPlayerApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (previousReady) previousReady();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return ytApiPromise;
}
function destroyYtPlayer() {
  try { ytPlayer?.destroy(); } catch(e) {}
  ytPlayer = null;
  ytMiniEngaged = false;
  ytPlaybackIntent = false;
  ytPlaybackStartedAt = 0;
  ytLastKnownTime = 0;
  ytMiniCollapsed = false;
  document.querySelector('.yt-sidebar')?.classList.remove('yt-player-mini');
}
function applyYtMiniPreferences(sidebar) {
  if (!sidebar) return;
  sidebar.dataset.miniCorner = S.ytMiniCorner;
  sidebar.dataset.miniSize = S.ytMiniSize;
  sidebar.classList.toggle('yt-player-collapsed', ytMiniCollapsed);
}
function syncYtMiniPlayer() {
  const sidebar = document.querySelector('.yt-sidebar.yt-player-active');
  const stage = sidebar?.querySelector('.yt-player-stage');
  if (!sidebar || !stage) {
    ytMiniEngaged = false;
    return;
  }
  const rect = stage.getBoundingClientRect();
  const top = $('navbar')?.getBoundingClientRect().bottom || 0;
  const visible = rect.bottom > top && rect.top < window.innerHeight;
  ytMiniEngaged = !visible;
  sidebar.classList.toggle('yt-player-mini', ytMiniEngaged && !visible);
  applyYtMiniPreferences(sidebar);
}
function cycleYtMiniSize() {
  const sizes = ['s','m','l'];
  S.ytMiniSize = sizes[(sizes.indexOf(S.ytMiniSize) + 1) % sizes.length];
  saveSettings();
  applyYtMiniPreferences(document.querySelector('.yt-sidebar'));
}
function toggleYtMiniCollapsed() {
  ytMiniCollapsed = !ytMiniCollapsed;
  applyYtMiniPreferences(document.querySelector('.yt-sidebar'));
}
function startYtMiniDrag(ev, sidebar) {
  if (!sidebar.classList.contains('yt-player-mini') || ytMiniCollapsed) return;
  const frame = sidebar.querySelector('.yt-player-frame-wrap');
  if (!frame) return;
  ev.preventDefault();
  ev.stopPropagation();
  const start = frame.getBoundingClientRect();
  const dx = ev.clientX - start.left;
  const dy = ev.clientY - start.top;
  frame.classList.add('dragging');
  const move = moveEv => {
    const left = Math.max(8, Math.min(window.innerWidth - start.width - 8, moveEv.clientX - dx));
    const top = Math.max(8, Math.min(window.innerHeight - start.height - 8, moveEv.clientY - dy));
    Object.assign(frame.style, { left:`${left}px`, top:`${top}px`, right:'auto', bottom:'auto' });
  };
  const end = endEv => {
    const rect = frame.getBoundingClientRect();
    const vertical = rect.top + rect.height / 2 < window.innerHeight / 2 ? 't' : 'b';
    const horizontal = rect.left + rect.width / 2 < window.innerWidth / 2 ? 'l' : 'r';
    S.ytMiniCorner = vertical + horizontal;
    saveSettings();
    frame.classList.remove('dragging');
    frame.style.removeProperty('left');
    frame.style.removeProperty('top');
    frame.style.removeProperty('right');
    frame.style.removeProperty('bottom');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    applyYtMiniPreferences(sidebar);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
async function setupYtPlayer(sidebar) {
  const frame = sidebar.querySelector('.yt-player-frame');
  if (!frame) return;
  ytPlaybackIntent = true;
  ytPlaybackStartedAt = Date.now();
  requestYtAutoplay(sidebar);
  try {
    const YT = await loadYtPlayerApi();
    if (!frame.isConnected || !ytActiveVideoId) return;
    ytPlayer = new YT.Player(frame, {
      events: {
        onReady: ev => {
          ytPlayer = ev.target;
          try { ev.target.playVideo(); } catch(e) {}
        },
        onStateChange: ev => {
          const currentTime = Number(ev.target?.getCurrentTime?.()) || 0;
          ytLastKnownTime = currentTime;
          if (ev.data === 1) {
            ytPlaybackIntent = true;
            ytPlaybackStartedAt = Date.now() - currentTime * 1000;
          } else if (ev.data === 0 || ev.data === 2) {
            ytPlaybackIntent = false;
          }
          syncYtMiniPlayer();
        }
      }
    });
  } catch(e) {}
}
function getYtPlaybackTime() {
  const exact = Number(ytPlayer?.getCurrentTime?.());
  if (Number.isFinite(exact) && exact > 0) return exact;
  if (ytPlaybackIntent && ytPlaybackStartedAt) return (Date.now() - ytPlaybackStartedAt) / 1000;
  return ytLastKnownTime;
}
function refreshYtFeed(ev) {
  if (ev) ev.stopPropagation();
  try { localStorage.removeItem('flux_yt_cache'); } catch(e) {}
  loadYouTube(true);
}
function mergeSplitLayouts(container) {
  if (!container) return;
  container.querySelectorAll('.yt-section-divider').forEach(el => el.remove());
  ['grid-layout', 'list-layout', 'reader-layout'].forEach(cls => {
    const nodes = [...container.children].filter(el => el.classList && el.classList.contains(cls));
    if (nodes.length < 2) return;
    const first = nodes[0];
    nodes.slice(1).forEach(node => {
      while (node.firstChild) first.appendChild(node.firstChild);
      node.remove();
    });
  });
}
function removeYtSidebar() {
  const content = $('content');
  if (!content) return;
  destroyYtPlayer();
  content.querySelectorAll('.yt-wrap').forEach(wrap => {
    const parent = wrap.parentElement;
    const mainDiv = wrap.firstElementChild;
    if (mainDiv && (parent === content || parent?.classList.contains('magazine-layout'))) {
      while (mainDiv.firstChild) parent.insertBefore(mainDiv.firstChild, wrap);
    }
    wrap.remove();
  });
  content.querySelectorAll('.yt-sidebar').forEach(sidebar => {
    sidebar.remove();
  });
  mergeSplitLayouts(content);
}
function placeYtSidebar(content, sidebar) {
  const magLayout = content.querySelector('.magazine-layout');
  const heroCluster = magLayout?.querySelector('.ix-hero-cluster');
  if (magLayout && heroCluster) {
    const afterHero = heroCluster.nextElementSibling;
    magLayout.insertBefore(sidebar, afterHero?.classList.contains('ix-hero-separator') ? afterHero.nextSibling : heroCluster.nextSibling);
    return;
  }
  content.appendChild(sidebar);
}
function initYtPager(sidebar) {
  const row = sidebar.querySelector('.yt-scroll-row');
  if (!row) return;
  const pages = [...row.querySelectorAll('.yt-page')];
  const pageLeft = index => pages[index] ? pages[index].offsetLeft - row.offsetLeft : 0;
  const currentPage = () => {
    if (!pages.length) return 0;
    return pages.reduce((best, page, i) => (
      Math.abs(pageLeft(i) - row.scrollLeft) < Math.abs(pageLeft(best) - row.scrollLeft) ? i : best
    ), 0);
  };
  const syncEdges = () => {
    const index = currentPage();
    sidebar.classList.toggle('has-left', index > 0);
    sidebar.classList.toggle('has-right', index < pages.length - 1);
  };
  row.onscroll = syncEdges;
  requestAnimationFrame(syncEdges);
  sidebar.querySelectorAll('.yt-page-btn').forEach(btn => {
    btn.onclick = () => {
      const dir = Number(btn.dataset.dir) || 0;
      const next = Math.max(0, Math.min(pages.length - 1, currentPage() + dir));
      row.scrollTo({ left: pageLeft(next), behavior: 'smooth' });
      requestAnimationFrame(syncEdges);
    };
  });
}
function bindYtSidebarClicks(sidebar) {
  sidebar.onpointerdown = ev => {
    const drag = ev.target.closest('[data-yt-drag]');
    if (drag) {
      startYtMiniDrag(ev, sidebar);
    }
  };
  sidebar.onclick = ev => {
    if (ev.target.closest('[data-yt-drag]')) return;
    if (ev.target.closest('[data-yt-size]')) {
      ev.preventDefault();
      cycleYtMiniSize();
      return;
    }
    if (ev.target.closest('[data-yt-collapse]')) {
      ev.preventDefault();
      toggleYtMiniCollapsed();
      return;
    }
    if (ev.target.closest('[data-yt-sort-toggle]')) {
      S.ytSortMode = S.ytSortMode === 'time' ? 'channel' : 'time';
      saveSettings();
      injectYtSidebar();
      return;
    }
    if (ev.target.closest('.yt-page-btn')) return;
    if (ev.target.closest('[data-yt-close]')) {
      ev.preventDefault();
      ev.stopPropagation();
      closeYtPlayer();
      return;
    }
    const external = ev.target.closest('.yt-player-external');
    if (external) {
      const seconds = Math.max(0, Math.floor(getYtPlaybackTime()));
      const videoId = ytActiveVideoId;
      if (videoId) external.href = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${seconds ? `&t=${seconds}s` : ''}`;
      try { ytPlayer?.pauseVideo?.(); } catch(e) {}
      return;
    }
    const card = ev.target.closest('[data-yt-video-id]');
    if (card && sidebar.contains(card)) {
      ev.preventDefault();
      ev.stopPropagation();
      const video = ytVideoById(card.dataset.ytVideoId);
      if (!video) return;
      ytReturnScrollLeft = sidebar.querySelector('.yt-scroll-row')?.scrollLeft || 0;
      animateYtOpen(card, video);
    }
  };
}
function preserveActiveYtPlayer(render) {
  const content = $('content');
  const player = content?.querySelector('.yt-sidebar.yt-player-active');
  if (player) player.remove();
  render();
  if (!player || !content) return;
  content.querySelectorAll('.yt-sidebar').forEach(sidebar => sidebar.remove());
  placeYtSidebar(content, player);
  requestAnimationFrame(syncYtMiniPlayer);
}
function requestYtAutoplay(sidebar) {
  const frame = sidebar.querySelector('.yt-player-frame');
  if (!frame) return;
  const play = () => {
    try {
      frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), 'https://www.youtube.com');
    } catch(e) {}
  };
  frame.addEventListener('load', () => setTimeout(play, 80), { once: true });
  setTimeout(play, 350);
  setTimeout(play, 900);
}
function injectYtSidebar() {
  const content = $('content');
  if (!content) return;
  if (!S.showYoutube) {
    removeYtSidebar();
    return;
  }
  if (!S.ytChannels.length) {
    removeYtSidebar();
    return;
  }
  if (content.querySelector('.spinner')) return;
  const existing = content.querySelector('.yt-sidebar');
  if (existing) {
    destroyYtPlayer();
    existing.style.pointerEvents = '';
    existing.classList.remove('yt-player-opening');
    existing.classList.toggle('yt-player-active', !!ytActiveVideoId);
    applyYtMiniPreferences(existing);
    existing.innerHTML = buildYtSidebarHtml();
    placeYtSidebar(content, existing);
    initYtPager(existing);
    bindYtSidebarClicks(existing);
    setupYtPlayer(existing);
    return;
  }
  const sidebar = document.createElement('aside');
  sidebar.className = 'yt-sidebar';
  sidebar.classList.toggle('yt-player-active', !!ytActiveVideoId);
  applyYtMiniPreferences(sidebar);
  sidebar.style.pointerEvents = '';
  sidebar.innerHTML = buildYtSidebarHtml();
  placeYtSidebar(content, sidebar);
  initYtPager(sidebar);
  bindYtSidebarClicks(sidebar);
  setupYtPlayer(sidebar);
}
function openYtVideo(videoId) {
  if (!videoId) return;
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  window.open(url, '_blank', 'noopener');
}
function renderSYtChannels() {
  const c = $('sYtList');
  if (!c) return;
  if (!S.ytChannels.length) {
    destroySortableList(c);
    c.innerHTML = '<div style="font-size:.78rem;color:var(--muted);padding:4px 0">Nincs csatorna.</div>';
    return;
  }
  c.innerHTML = S.ytChannels.map((ch, i) => settingsRow({
    kind: 'yt', id: ch.id, i, total: S.ytChannels.length,
    name: ch.name || ch.id, url: ch.id, title: 'Csatorna handle / ID — kattints a szerkesztéshez',
    placeholder: '@handle vagy channel ID'
  })).join('');
  bindSortableList(c, S.ytChannels, () => { saveYtChannels(); renderSYtChannels(); injectYtSidebar(); });
}
function deleteYtChannel(id) {
  const ch = S.ytChannels.find(c => c.id === id);
  confirmDialog(`"${ch?.name || id}" csatorna törlése visszavonhatatlan.`, () => {
    S.ytChannels = S.ytChannels.filter(c => c.id !== id);
    saveYtChannels();
    ytVideos = ytVideos.filter(v => v.channelId !== id);
    try { localStorage.removeItem('flux_yt_cache'); } catch(e) {}
    renderSYtChannels();
    injectYtSidebar();
    toast('Csatorna törölve.');
  }, null, { title: 'Csatorna törlése', okLabel: 'Törlés' });
}
function openAddYtModal() {
  $('ytChannelInput').value = '';
  $('ytErr').classList.remove('show');
  clearYtChoices();
  $('confirmYt').disabled = false;
  $('confirmYt').textContent = 'Hozzáadás';
  $('addYtModal').classList.add('open');
  $('overlay').classList.add('open');
  setTimeout(() => $('ytChannelInput').focus(), 80);
}
function closeAddYtModal() {
  $('addYtModal').classList.remove('open');
  $('overlay').classList.remove('open');
  clearYtChoices();
}
function clearYtChoices() {
  const list = $('ytChoiceList');
  if (!list) return;
  list.innerHTML = '';
  list.classList.remove('show');
}
function renderYtChoices(results) {
  const list = $('ytChoiceList');
  if (!list) return;
  list.innerHTML = results.map(r => `<button class="yt-choice" type="button" data-id="${e(r.id)}">
    <span class="yt-choice-mark">YT</span>
    <span class="yt-choice-main">
      <span class="yt-choice-name">${e(r.name)}</span>
      <span class="yt-choice-meta">${e(r.handle || r.id)}</span>
    </span>
  </button>`).join('');
  list.classList.toggle('show', results.length > 0);
}
async function submitAddYt(forcedInput) {
  const input = (typeof forcedInput === 'string' ? forcedInput : $('ytChannelInput').value).trim();
  if (!input) return;
  const parsed = extractYtChannelId(input);
  const debug = [];
  const btn = $('confirmYt');
  btn.disabled = true; btn.textContent = 'Betöltés...';
  $('ytErr').classList.remove('show');
  clearYtChoices();
  const lookup = await fetchYtLookup(input).catch(() => null);
  debug.push(`api:${lookup ? 'ok' : 'no'}`);
  if (lookup?.results) {
    if (!lookup.results.length && /^[A-Za-z0-9._-]{2,}$/.test(input)) {
      const handleLookup = await fetchYtLookup('@' + input).catch(() => null);
      if (handleLookup?.id) {
        renderYtChoices([{
          id: handleLookup.id,
          idType: 'id',
          name: handleLookup.name || input,
          handle: '@' + input
        }]);
        btn.disabled = false;
        btn.textContent = 'Hozzáadás';
        return;
      }
    }
    if (!lookup.results.length) {
      $('ytErr').textContent = 'Nem találtam csatornát. Próbálj pontosabb nevet, @handle-t, URL-t vagy videó linket.';
      $('ytErr').classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Hozzáadás';
      return;
    }
    renderYtChoices(lookup.results);
    btn.disabled = false;
    btn.textContent = 'Hozzáadás';
    return;
  }
  if (!parsed && !lookup) {
    $('ytErr').textContent = 'Nem találtam csatornát. Próbálj pontosabb nevet, @handle-t, URL-t vagy videó linket.';
    $('ytErr').classList.add('show');
    btn.disabled = false; btn.textContent = 'Hozzáadás';
    return;
  }
  const resolved = lookup || await resolveYtInputToChannel(parsed).catch(() => null);
  if (parsed) debug.push(`parsed:${parsed.type}`);
  debug.push(`resolved:${resolved ? resolved.idType : 'no'}`);
  let idType = resolved?.idType || (
    parsed?.type === 'id' ? 'id' :
    parsed?.type === 'user' ? 'user' :
    parsed?.type === 'handle' ? 'handle' :
    parsed?.type === 'video' ? resolved?.idType || null :
    parsed?.type === 'url' ? 'url' :
    null
  );
  let chId = resolved?.id || parsed?.value;
  let presetName = resolved?.name || '';
  if (S.ytChannels.find(ch => ch.id === chId)) {
    toast('Ez a csatorna már hozzáadva.'); closeAddYtModal(); return;
  }
  let videos = [];
  let channelName = '';
  if (lookup?.videos?.length) {
    videos = lookup.videos;
    channelName = lookup.name || presetName;
    debug.push(`apiFeed:${videos.length}`);
  } else if (idType) {
    const tempCh = { id: chId, name: chId, idType };
    const feedResult = await fetchYtChannelVideos(tempCh).catch(() => ({ videos: [], channelName: '' }));
    videos = feedResult.videos;
    channelName = feedResult.channelName || presetName;
    debug.push(`feed:${videos.length}`);
  }
  if (!videos.length && parsed?.type === 'handle') {
    const pageResult = await fetchYtVideosFromChannelPage(`https://www.youtube.com/@${parsed.value}/videos`, chId, channelName || chId).catch(() => ({ videos: [], channelName: '' }));
    videos = pageResult.videos;
    channelName = pageResult.channelName || channelName;
    debug.push(`handlePage:${videos.length}`);
  }
  if (!videos.length && parsed?.type === 'url') {
    const pageResult = await fetchYtVideosFromChannelPage(parsed.value.replace(/\/+$/, '') + '/videos', chId, channelName || chId).catch(() => ({ videos: [], channelName: '' }));
    videos = pageResult.videos;
    channelName = pageResult.channelName || channelName;
    debug.push(`urlPage:${videos.length}`);
  }
  if (!videos.length) {
    $('ytErr').textContent = `Nem sikerült betölteni. Debug: ${debug.join(', ')}`;
    $('ytErr').classList.add('show');
    btn.disabled = false; btn.textContent = 'Hozzáadás';
    return;
  }
  const ch = { id: chId, name: channelName || presetName || chId, idType };
  S.ytChannels.push(ch);
  saveYtChannels();
  videos.forEach(v => { ytVideoMap[v.videoId] = v; });
  ytVideos = [...ytVideos, ...videos].sort((a, b) => b.date - a.date);
  try {
    localStorage.setItem('flux_yt_cache', JSON.stringify({
      ts: Date.now(),
      sig: ytCacheSignature(),
      videos: ytVideos
    }));
  } catch(e) {}
  renderSYtChannels();
  closeAddYtModal();
  injectYtSidebar();
  toast(`"${ch.name}" csatorna hozzáadva!`);
}
const F1_HU = ['jan','feb','már','ápr','máj','jún','júl','aug','szep','okt','nov','dec'];
const F1_DATA_BASE = 'https://elijahcreative.github.io/F1/2023/Data';
const F1_TTL  = 30 * 60 * 1000;
const F1_COUNTRY_HU = {
  Australia: 'Ausztrália',
  China: 'Kína',
  Japan: 'Japán',
  Bahrain: 'Bahrein',
  USA: 'USA',
  Italy: 'Olaszország',
  Monaco: 'Monaco',
  Spain: 'Spanyolország',
  Canada: 'Kanada',
  Austria: 'Ausztria',
  UK: 'Nagy-Britannia',
  'Great Britain': 'Nagy-Britannia',
  Hungary: 'Magyarország',
  Belgium: 'Belgium',
  Netherlands: 'Hollandia',
  Azerbaijan: 'Azerbajdzsán',
  Singapore: 'Szingapúr',
  Mexico: 'Mexikó',
  Brazil: 'Brazília',
  Qatar: 'Katar',
  UAE: 'Abu-Dzabi'
};
const F1_FLAG_MAP = {
  Bahrain: 'https://img.icons8.com/color/96/bahrain-circular.png',
  'Saudi Arabia': 'https://img.icons8.com/color/96/saudi-arabia-circular.png',
  Australia: 'https://img.icons8.com/color/96/australia-circular.png',
  Japan: 'https://img.icons8.com/color/96/japan-circular.png',
  China: 'https://img.icons8.com/color/96/china-circular.png',
  USA: 'https://img.icons8.com/color/96/usa-circular.png',
  Italy: 'https://img.icons8.com/color/96/italy-circular.png',
  Monaco: 'https://img.icons8.com/color/96/monaco-circular.png',
  Canada: 'https://img.icons8.com/color/96/canada-circular.png',
  Spain: 'https://img.icons8.com/color/96/spain-circular.png',
  Austria: 'https://img.icons8.com/color/96/austria-circular.png',
  UK: 'https://img.icons8.com/color/96/great-britain-circular.png',
  'Great Britain': 'https://img.icons8.com/color/96/great-britain-circular.png',
  Belgium: 'https://img.icons8.com/color/96/belgium-circular.png',
  Hungary: 'https://img.icons8.com/color/96/hungary-circular.png',
  Netherlands: 'https://img.icons8.com/color/96/netherlands-circular.png',
  Azerbaijan: 'https://img.icons8.com/color/96/azerbaijan-circular.png',
  Singapore: 'https://img.icons8.com/color/96/singapore-circular.png',
  Mexico: 'https://img.icons8.com/color/96/mexico-circular.png',
  Brazil: 'https://img.icons8.com/color/96/brazil-circular.png',
  Qatar: 'https://img.icons8.com/color/96/qatar-circular.png',
  'U.A. Emirates': 'https://img.icons8.com/color/96/united-arab-emirates-circular.png',
  UAE: 'https://img.icons8.com/color/96/united-arab-emirates-circular.png'
};
const F1_FLAG_EMOJI_MAP = {
  '🇦🇺': F1_FLAG_MAP.Australia,
  '🇦🇿': F1_FLAG_MAP.Azerbaijan,
  '🇧🇭': F1_FLAG_MAP.Bahrain,
  '🇧🇪': F1_FLAG_MAP.Belgium,
  '🇧🇷': F1_FLAG_MAP.Brazil,
  '🇨🇦': F1_FLAG_MAP.Canada,
  '🇨🇳': F1_FLAG_MAP.China,
  '🇭🇺': F1_FLAG_MAP.Hungary,
  '🇮🇹': F1_FLAG_MAP.Italy,
  '🇯🇵': F1_FLAG_MAP.Japan,
  '🇲🇽': F1_FLAG_MAP.Mexico,
  '🇲🇨': F1_FLAG_MAP.Monaco,
  '🇳🇱': F1_FLAG_MAP.Netherlands,
  '🇦🇹': F1_FLAG_MAP.Austria,
  '🇶🇦': F1_FLAG_MAP.Qatar,
  '🇸🇦': F1_FLAG_MAP['Saudi Arabia'],
  '🇸🇬': F1_FLAG_MAP.Singapore,
  '🇪🇸': F1_FLAG_MAP.Spain,
  '🇦🇪': F1_FLAG_MAP.UAE,
  '🇬🇧': F1_FLAG_MAP.UK,
  '🇺🇸': F1_FLAG_MAP.USA
};
const F1_WEEKDAYS = ['V','H','K','SZE','CS','P','SZO'];
function parseF1Date(value) {
  return value ? new Date(value) : null;
}
function stripF1Country(country) {
  return String(country || '').replace(/^[^A-Za-zÀ-ž]+/, '').trim();
}
function f1CountryHu(countryEn) {
  return F1_COUNTRY_HU[countryEn] || countryEn;
}
function f1FlagEmoji(country) {
  return String(country || '').match(/[\u{1F1E6}-\u{1F1FF}]{2}/u)?.[0] || '';
}
function f1FlagUrl(countryRaw, countryEn) {
  return F1_FLAG_EMOJI_MAP[f1FlagEmoji(countryRaw)] || F1_FLAG_MAP[countryEn] || '';
}
function f1DateLabel(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((dayStart(date) - dayStart(today)) / 86400000);
  if (dayDiff === 0) return 'MA';
  if (dayDiff === 1) return 'HOLNAP';
  return `${F1_HU[date.getMonth()].toUpperCase()}. ${date.getDate()}`;
}
function f1TimeLabel(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${F1_WEEKDAYS[date.getDay()]} ${date.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}`;
}
function f1ShortDate(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}.${date.getDate()}`;
}
function f1CountdownTo(date, nowMs) {
  const diff = date ? date.getTime() - nowMs : 0;
  if (diff <= 0) return 'Ma';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  return d > 0 ? `${d} nap` : h > 0 ? `${h} ó` : 'Ma';
}
function f1EventSpecs(race) {
  const sprint = Boolean(race.Sprint || race.Sprintqual);
  const raw = sprint
    ? [
        ['FP1', 'FP1', 'practice'],
        ['Sprintqual', 'SQ', 'practice'],
        ['Sprint', 'SPRINT', 'practice'],
        ['Qual', 'QUAL', 'qual'],
        ['Race', 'RACE', 'race']
      ]
    : [
        ['FP1', 'FP1', 'practice'],
        ['FP2', 'FP2', 'practice'],
        ['FP3', 'FP3', 'practice'],
        ['Qual', 'QUAL', 'qual'],
        ['Race', 'RACE', 'race']
      ];
  return raw.map(([key, label, kind]) => ({
    key,
    label,
    kind,
    start: parseF1Date(race[key])
  }));
}
function f1RaceSelectionEnd(race) {
  const raceStart = parseF1Date(race.Race);
  if (raceStart && !Number.isNaN(raceStart.getTime())) return raceStart.getTime() + 3 * 3600000;
  const starts = f1EventSpecs(race).map(ev => ev.start?.getTime()).filter(Boolean);
  return starts.length ? Math.max(...starts) + 3600000 : 0;
}
function buildF1Model(races, standingsRaw) {
  const nowMs = Date.now();
  const futureIndex = races.findIndex(race => f1RaceSelectionEnd(race) > nowMs);
  const selectedIndex = futureIndex >= 0 ? futureIndex : Math.max(0, races.length - 1);
  const race = races[selectedIndex] || races[0] || {};
  const countryEn = stripF1Country(race.Country);
  const countryHu = f1CountryHu(countryEn);
  const flagUrl = f1FlagUrl(race.Country, countryEn);
  const city = race.City || countryEn || 'F1';
  const specs = f1EventSpecs(race);
  let liveIndex = -1;
  let nextIndex = -1;
  let progress = -1;
  const events = specs.map((ev, i) => {
    const startMs = ev.start?.getTime();
    const liveEndMs = startMs ? startMs + (ev.kind === 'race' ? 2 : 1) * 3600000 : 0;
    let state = '';
    if (startMs && nowMs >= startMs && nowMs < liveEndMs) {
      state = 'live';
      liveIndex = i;
      progress = Math.max(progress, i);
    } else if (startMs && nowMs >= liveEndMs) {
      state = 'done';
      progress = Math.max(progress, i);
    } else if (startMs && nextIndex < 0) {
      state = 'next';
      nextIndex = i;
    }
    return {
      ...ev,
      state,
      statusLabel: '',
      isCurrent: false,
      dateLabel: f1DateLabel(ev.start),
      timeLabel: f1TimeLabel(ev.start)
    };
  });
  const currentIndex = liveIndex >= 0 ? liveIndex : nextIndex;
  if (currentIndex >= 0) events[currentIndex].isCurrent = true;
  if (liveIndex >= 0) events[liveIndex].statusLabel = 'Élő';
  else if (nextIndex >= 0) events[nextIndex].statusLabel = 'Következő';
  const standingsTop5 = standingsRaw
    .filter(s => s.Name && s.Points)
    .slice(0, 5)
    .map(s => ({ name: s.Name, points: s.Points }));
  const upcoming = races
    .slice(selectedIndex + 1, selectedIndex + 5)
    .map(r => ({ city: r.City || stripF1Country(r.Country), dateLabel: f1ShortDate(parseF1Date(r.Race)) }));
  return {
    version: 5,
    city,
    countryEn,
    countryHu,
    flagUrl,
    events,
    progress: Math.max(progress, 0),
    activeProgress: Math.max(progress, currentIndex, 0),
    liveEvent: liveIndex >= 0 ? events[liveIndex] : null,
    nextEvent: nextIndex >= 0 ? events[nextIndex] : null,
    countdown: nextIndex >= 0 ? f1CountdownTo(events[nextIndex].start, nowMs) : '',
    standingsTop5,
    upcoming,
    ts: Date.now()
  };
}
function renderF1(f1) {
  const el = document.getElementById('navF1');
  if (!el) return;
  if (!S.showF1) { clearWidget('navF1'); return; }
  el.style.display = '';
  const ticker = f1.standingsTop5.map(s => `<span>${e(s.name)} ${e(s.points)}</span>`).join('');
  const eventHtml = f1.events.map(ev => `
    <div class="f1-event ${ev.state} ${ev.kind}${ev.isCurrent ? ' current' : ''}">
      <div class="f1-event-status">${ev.statusLabel}</div>
      <div class="f1-event-dot"></div>
      <div class="f1-event-label">${e(ev.label)}</div>
      <div class="f1-event-date">${e(ev.dateLabel)}</div>
      <div class="f1-event-time">${e(ev.timeLabel)}</div>
    </div>`).join('');
  const upcoming = f1.upcoming.map(r => `<span>${e(r.city.toUpperCase())} ${e(r.dateLabel)}</span>`).join('');
  const navStatus = f1.liveEvent ? 'Élő' : f1.nextEvent ? f1.countdown : 'Vége';
  const navEvent = f1.liveEvent?.label || f1.nextEvent?.label || f1.city;
  const progress = Math.min(Math.max(Number(f1.activeProgress ?? f1.progress) || 0, 0), 4);
  const progressHtml = [1, 2, 3, 4].map(i => `<span class="f1-track-seg f1-track-seg-${i}${i <= progress ? ' active' : ''}"></span>`).join('');
  const flag = f1.flagUrl ? `<span class="f1-flag"><img src="${e(f1.flagUrl)}" alt=""></span>` : '<span class="f1-flag is-empty"></span>';
  el.innerHTML = `
    <span class="f1-badge">
      ${flag}
      <span class="f1-badge-city f1-badge-place">${e(f1.city)}</span>
      <span class="f1-badge-city f1-badge-event">${e(navEvent)}</span>
      <span class="f1-badge-countdown">${e(navStatus)}</span>
    </span>
    <div class="f1-popup" id="f1Popup">
      <div class="f1-card">
        <div class="f1-ticker">${ticker}</div>
        <div class="f1-title">
          <span class="f1-title-city">${e(f1.city)}</span>
          ${flag}
          <strong class="f1-title-country">${e(f1.countryHu || f1.countryEn)}</strong>
        </div>
        <div class="f1-track">
          <div class="f1-trackline">${progressHtml}</div>
          <div class="f1-events">${eventHtml}</div>
        </div>
        <div class="f1-upcoming">${upcoming}</div>
      </div>
    </div>`;
  setupHoverTapPopup(el, document.getElementById('f1Popup'), 'f1-open');
}
async function loadF1() {
  if (!S.showF1) { clearWidget('navF1'); return; }
  try {
    const cached = JSON.parse(localStorage.getItem('flux_f1') || 'null');
    if (cached?.version === 5 && Date.now() - cached.ts < F1_TTL) { renderF1(cached); return; }
  } catch(e) {}
  try {
    const [racesJ, standingsJ] = await Promise.all([
      fetch(`${F1_DATA_BASE}/races-new.json`, { cache: 'no-store' }).then(r=>r.json()),
      fetch(`${F1_DATA_BASE}/standings.json`, { cache: 'no-store' }).then(r=>r.json())
    ]);
    const f1 = buildF1Model(racesJ.Races || [], standingsJ.Standings || []);
    localStorage.setItem('flux_f1', JSON.stringify(f1));
    renderF1(f1);
  } catch(e) { console.warn('F1 load error', e); }
}
const Config = {
  keys: SETTINGS_KEYS.filter(k => k !== 'activeUrl'),
  _toJSON() {
    return JSON.stringify({
      version: 1,
      settings: Object.fromEntries(this.keys.map(k => [k, S[k]])),
      feeds: S.feeds,
      ytChannels: S.ytChannels,
      readLater: S.readLater
    }, null, 2);
  },
  _apply(data) {
    if (!data || typeof data !== 'object') return;
    if (data.settings) this.keys.forEach(k => { if (data.settings[k] !== undefined) S[k] = data.settings[k]; });
    if (Array.isArray(data.feeds) && data.feeds.length) S.feeds = data.feeds;
    if (Array.isArray(data.ytChannels)) S.ytChannels = data.ytChannels;
    if (Array.isArray(data.readLater)) S.readLater = data.readLater.map(item => ({
      ...item,
      article: item.article ? { ...item.article, date: new Date(item.article.date) } : null
    })).filter(item => item.id && item.article);
  },
  save() {
    const blob = new Blob([this._toJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'flux-config.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Config letöltve');
  },
  load() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async () => {
      try {
        const text = await input.files[0].text();
        this._apply(JSON.parse(text));
        saveSettings(); saveFeeds(); saveYtChannels(); saveReadLater();
        Theme.apply(); renderSidebar(); renderSFeeds(); renderSYtChannels(); renderArticles();
        refreshAll();
        toast('Config betöltve');
      } catch(e) { toast('Hibás config fájl'); }
    };
    input.click();
  }
};
(async function init() {
  loadStorage();
  try { history.replaceState({ flux: 'home' }, '', location.href); } catch(e) {}
  Theme.apply();
  buildSettingsUI();
  renderSidebar();
  bindEvents();
  setupArticlePrefetch();
  updateLayoutBtns();
  syncWidgets();
  loadYouTube();
  const contentEl = document.getElementById('content');
  const navbar = document.getElementById('navbar');
  contentEl.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', contentEl.scrollTop > 10);
    syncYtMiniPlayer();
  }, { passive: true });
  window.addEventListener('resize', syncYtMiniPlayer, { passive: true });
  const initialOpenUrl = openUrlParam();
  if (S.feeds.length) {
    renderArticles(); // azonnali megjelenítés cache-ből
    const refreshPromise = refreshAll(); // háttérben frissítés, nem blokkol
    if (initialOpenUrl) refreshPromise.finally(() => openArticleUrl(initialOpenUrl));
  } else if (initialOpenUrl) {
    openArticleUrl(initialOpenUrl);
  }
})();
