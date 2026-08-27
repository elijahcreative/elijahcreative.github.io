const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const sharp = require('sharp');

const CACHE_SECONDS = 31536000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 6000;
const FLUX_WORD_PATH = 'M92.0888671875 0V1490H1157.4445190429688V1157.6444091796875H499.022216796875V839.2445068359375H1099.3112182617188V516.3555908203125H499.022216796875V0ZM1650.5999755859375 1490V0H1249.0888671875V1490ZM2172.7777099609375 -16.4444580078125Q2055.0221557617188 -16.4444580078125 1969.0999450683594 36.699981689453125Q1883.177734375 89.84442138671875 1837.13330078125 184.35552978515625Q1791.0888671875 278.86663818359375 1791.0888671875 402.0888671875V1102.8443603515625H2192.5999755859375V487.5555419921875Q2192.5999755859375 405.5333251953125 2233.744415283203 359.0111083984375Q2274.8888549804688 312.4888916015625 2349.4221801757812 312.4888916015625Q2398.6888427734375 312.4888916015625 2433.9555053710938 333.6222229003906Q2469.22216796875 354.75555419921875 2488.4888305664062 394.8777770996094Q2507.7554931640625 435 2507.7554931640625 491.4666748046875V1102.8443603515625H2909.2666015625V0H2527.8665771484375L2521.8221435546875 287.22222900390625H2543.5999755859375Q2502.9110717773438 157.5333251953125 2415.699951171875 70.54443359375Q2328.4888305664062 -16.4444580078125 2172.7777099609375 -16.4444580078125ZM2967.3999633789062 0 3389.4666137695312 701.1776123046875 3387.0221557617188 432.1556396484375 2989.5999755859375 1102.8443603515625H3411.8222045898438L3476.177734375 972.0888671875Q3517.9555053710938 887.7555541992188 3554.4888305664062 800.4555969238281Q3591.0221557617188 713.1556396484375 3626.5554809570312 630.2667846679688H3502.3999633789062Q3540.6888427734375 712.4000854492188 3578.7332763671875 800.0778198242188Q3616.7777099609375 887.7555541992188 3661.31103515625 972.0888671875L3729.9332275390625 1102.8443603515625H4144.644348144531L3733.9999389648438 432.91119384765625 3736.4443969726562 701.1776123046875 4159.133239746094 0H3738.4443359375L3657.7332763671875 156.4443359375Q3613.6888427734375 241.0443115234375 3575.1444091796875 329.3664855957031Q3536.5999755859375 417.68865966796875 3498.5555419921875 500.088623046875H3616.5999145507812Q3580.333251953125 417.68865966796875 3543.0443725585938 329.3664855957031Q3505.7554931640625 241.0443115234375 3462.4888305664062 156.4443359375L3383.3110961914062 0Z';

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
  const fontSize = clamp(Math.round(width * 0.075), 52, 92);
  const markSize = Math.round(fontSize * (7 / 18.4));
  const markRadius = Math.round(markSize * (2 / 7));
  const markGap = markSize;
  const baseline = height - padding;
  const markY = Math.round(baseline - fontSize * 0.34 - markSize / 2);
  const textX = padding + markSize + markGap;
  const wordScale = (fontSize / 2048).toFixed(8);
  const overlay = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="42%" stop-color="#000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000" stop-opacity="0.76"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#shade)"/>
      <rect x="${padding}" y="${markY}" width="${markSize}" height="${markSize}" rx="${markRadius}" fill="#0891b2"/>
      <path d="${FLUX_WORD_PATH}" fill="#fff" transform="translate(${textX} ${baseline}) scale(${wordScale} -${wordScale})"/>
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
