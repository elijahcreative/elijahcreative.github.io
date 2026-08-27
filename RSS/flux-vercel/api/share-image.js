const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const sharp = require('sharp');

const CACHE_SECONDS = 31536000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 6000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const imageUrl = safeHttpUrl(queryValue(req, 'image'));
  if (!imageUrl) {
    res.status(400).send('Invalid image URL');
    return;
  }

  res.setHeader('Cache-Control', `public, s-maxage=${CACHE_SECONDS}, immutable`);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'HEAD') {
    res.setHeader('Content-Type', 'image/jpeg');
    res.status(200).send('');
    return;
  }

  try {
    const allowLocal = process.env.VERCEL !== '1' && isSameHost(imageUrl, req.headers?.host);
    const source = await fetchImage(imageUrl, allowLocal);
    const branded = await renderBrandedImage(source);

    res.setHeader('Content-Type', 'image/jpeg');
    res.status(200).send(branded);
  } catch (error) {
    console.error('Share preview image failed:', error.message);
    res.statusCode = 302;
    res.setHeader('Location', '/icons/pwa-512.png');
    res.end();
  }
};

async function renderBrandedImage(source) {
  const normalized = await sharp(source, {
    failOn: 'error',
    limitInputPixels: 40_000_000
  }).rotate().toBuffer({ resolveWithObject: true });

  const sourceWidth = normalized.info.width;
  const sourceHeight = normalized.info.height;
  const upscale = sourceWidth < 900 ? 900 / sourceWidth : 1;
  const scale = Math.min(upscale, 1600 / sourceWidth, 1600 / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const padding = clamp(Math.round(width * 0.045), 28, 64);
  const fontSize = clamp(Math.round(width * 0.045), 32, 56);
  const dotRadius = Math.round(fontSize * 0.11);
  const baseline = height - padding;
  const dotX = padding + dotRadius;
  const dotY = Math.round(baseline - fontSize * 0.34);
  const textX = dotX + dotRadius + Math.round(fontSize * 0.27);
  const overlay = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="48%" stop-color="#000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000" stop-opacity="0.72"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#shade)"/>
      <circle cx="${dotX}" cy="${dotY}" r="${dotRadius}" fill="#0891b2"/>
      <text x="${textX}" y="${baseline}" fill="#fff" font-family="Inter, Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="800" letter-spacing="-1">Flux</text>
    </svg>`);

  return sharp(normalized.data)
    .resize(width, height)
    .composite([{ input: overlay }])
    .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

function fetchImage(value, allowLocal, redirects = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(value);
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(url, {
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
        'User-Agent': 'FluxReader/1.0 share preview'
      },
      lookup: allowLocal ? undefined : safeLookup
    }, response => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error('Too many image redirects'));
          return;
        }
        const target = new URL(response.headers.location, url).href;
        fetchImage(target, allowLocal, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`Image request returned ${status}`));
        return;
      }
      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      if (!/^image\/(?:avif|gif|jpeg|png|webp)(?:;|$)/.test(contentType)) {
        response.resume();
        reject(new Error('Image response has an invalid content type'));
        return;
      }

      const declaredSize = Number(response.headers['content-length'] || 0);
      if (declaredSize > MAX_IMAGE_BYTES) {
        response.destroy();
        reject(new Error('Image response is too large'));
        return;
      }

      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) {
          response.destroy(new Error('Image response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });

    request.setTimeout(FETCH_TIMEOUT_MS, () => request.destroy(new Error('Image request timed out')));
    request.on('error', reject);
  });
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error);
      return;
    }
    const publicAddresses = addresses.filter(item => !isPrivateAddress(item.address));
    if (!publicAddresses.length) {
      callback(new Error('Private image hosts are not allowed'));
      return;
    }
    if (options?.all) callback(null, publicAddresses);
    else callback(null, publicAddresses[0].address, publicAddresses[0].family);
  });
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 0) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19) || parts[0] >= 224;
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) {
      const mapped = mappedIpv4(normalized.slice(7));
      return !mapped || isPrivateAddress(mapped);
    }
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') ||
      normalized.startsWith('fd') || normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') || normalized.startsWith('fea') ||
      normalized.startsWith('feb') || normalized.startsWith('ff') || normalized.startsWith('2001:db8:');
  }
  return true;
}

function mappedIpv4(value) {
  if (net.isIPv4(value)) return value;
  const parts = value.split(':');
  if (parts.length !== 2 || parts.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return '';
  const high = parseInt(parts[0], 16);
  const low = parseInt(parts[1], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isSameHost(value, requestHost) {
  try {
    return new URL(value).host === String(requestHost || '');
  } catch {
    return false;
  }
}

function queryValue(req, key) {
  const value = req.query?.[key];
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
