const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 6000;

function fetchImage(value, allowLocal, redirects = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (url.protocol !== 'https:' || url.username || url.password ||
        (url.port && url.port !== '443') || (net.isIP(host) && isPrivateAddress(host))) {
      reject(new Error('Invalid image destination'));
      return;
    }
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


module.exports = { fetchImage };
