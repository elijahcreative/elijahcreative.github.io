'use strict';

const { createHash, randomBytes } = require('node:crypto');
const { component, createSignature } = require('http-message-sig');
const { generateNonce, sign } = require('web-bot-auth');
const { signerFromJWK, verifierFromJWK } = require('web-bot-auth/crypto');

const DIRECTORY_PATH = '/.well-known/http-message-signatures-directory';
const DIRECTORY_CONTENT_TYPE = 'application/http-message-signatures-directory+json';
const SIGNATURE_AGENT = '"https://fluxreader.vercel.app"';
const SIGNATURE_TTL_SECONDS = 60;
const DIRECTORY_SIGNATURE_TTL_SECONDS = 300;
const DIRECTORY_CACHE_SECONDS = 60;

function isWebBotAuthEnabled(env = process.env) {
  return env.WEB_BOT_AUTH_ENABLED === 'true';
}

function isWebBotAuthDirectoryEnabled(env = process.env) {
  return env.WEB_BOT_AUTH_DIRECTORY_ENABLED === 'true';
}

async function createWebBotAuthDirectoryResponse({ requestUrl, env = process.env, now } = {}) {
  if (!isWebBotAuthDirectoryEnabled(env)) return null;

  const directoryUrl = parseDirectoryRequestUrl(requestUrl, env);
  const { publicJwk, signer } = await configuredSigner(env);
  const created = unixSeconds(now);
  const expires = created + DIRECTORY_SIGNATURE_TTL_SECONDS;
  const body = JSON.stringify({ keys: [publicJwk] });
  const contentDigest = `sha-256=:${createHash('sha256').update(body, 'utf8').digest('base64')}:`;
  const cacheControl = `public, max-age=${DIRECTORY_CACHE_SECONDS}, s-maxage=${DIRECTORY_CACHE_SECONDS}`;

  const signature = await createSignature({
    kind: 'response',
    status: 200,
    fields: [
      { name: 'content-type', value: DIRECTORY_CONTENT_TYPE },
      { name: 'content-digest', value: contentDigest },
      { name: 'cache-control', value: cacheControl }
    ],
    request: {
      kind: 'request',
      method: 'GET',
      targetUri: directoryUrl.href,
      fields: []
    }
  }, {
    label: 'sig1',
    components: [component('@authority', { req: true }), 'content-digest'],
    parameters: {
      created,
      keyid: signer.keyid,
      alg: signer.algorithm,
      expires,
      nonce: generateNonce(),
      tag: 'http-message-signatures-directory'
    },
    signer
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': DIRECTORY_CONTENT_TYPE,
      'Content-Digest': contentDigest,
      'Cache-Control': cacheControl,
      Signature: signature.signature,
      'Signature-Input': signature.signatureInput
    },
    body
  };
}

async function signTelexRequest({ targetUrl, env = process.env, now } = {}) {
  if (!isWebBotAuthEnabled(env)) return null;

  const canonicalTargetUrl = normalizeTelexTargetUrl(targetUrl);
  const { signer } = await configuredSigner(env);
  const created = unixSeconds(now);
  const request = new Request(canonicalTargetUrl, {
    method: 'GET',
    headers: { 'Signature-Agent': SIGNATURE_AGENT }
  });
  const signature = await sign(request, {
    signer,
    created: new Date(created * 1000),
    expires: new Date((created + SIGNATURE_TTL_SECONDS) * 1000),
    nonce: generateNonce(),
    additionalComponents: ['@method', '@path']
  });

  return {
    targetUrl: canonicalTargetUrl,
    headers: {
      'Signature-Agent': SIGNATURE_AGENT,
      Signature: signature.signature,
      'Signature-Input': signature.signatureInput
    }
  };
}

function normalizeTelexTargetUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Invalid Telex Web Bot Auth target');
  }

  if (url.protocol !== 'https:' || !['telex.hu', 'www.telex.hu'].includes(url.hostname)
    || url.username || url.password || url.port) {
    throw new TypeError('Invalid Telex Web Bot Auth target');
  }

  url.hostname = 'telex.hu';
  url.search = '';
  url.hash = '';
  return url.href;
}

function parseDirectoryRequestUrl(value, env) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Invalid Web Bot Auth directory request URL');
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || url.pathname !== DIRECTORY_PATH || url.search || url.hash
    || !allowedDirectoryHosts(env).has(url.hostname)) {
    throw new TypeError('Invalid Web Bot Auth directory request URL');
  }
  return url;
}

function allowedDirectoryHosts(env) {
  const hosts = new Set(['fluxreader.vercel.app']);
  const deploymentHost = String(env.VERCEL_URL || '').trim().toLowerCase();
  if (!deploymentHost || deploymentHost.includes('://')) return hosts;

  try {
    const url = new URL(`https://${deploymentHost}`);
    if (!url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash
      && url.host === deploymentHost) {
      hosts.add(url.hostname);
    }
  } catch {
    // An invalid VERCEL_URL cannot add another directory authority.
  }
  return hosts;
}

async function configuredSigner(env) {
  let input;
  try {
    input = JSON.parse(env.FLUX_BOT_PRIVATE_KEY_JWK || '');
  } catch {
    throw invalidKeyConfiguration();
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)
    || input.kty !== 'OKP' || input.crv !== 'Ed25519'
    || !isCanonicalEd25519Part(input.x) || !isCanonicalEd25519Part(input.d)
    || (input.alg !== undefined && input.alg !== 'EdDSA')
    || (input.use !== undefined && input.use !== 'sig')
    || (input.key_ops !== undefined && (!Array.isArray(input.key_ops)
      || input.key_ops.length !== 1 || input.key_ops[0] !== 'sign'))) {
    throw invalidKeyConfiguration();
  }

  const privateJwk = { kty: 'OKP', crv: 'Ed25519', x: input.x, d: input.d };
  try {
    if (input.alg !== undefined) privateJwk.alg = input.alg;
    const signer = await signerFromJWK(privateJwk);
    const publicJwk = { kty: 'OKP', crv: 'Ed25519', x: input.x };
    const verifier = await verifierFromJWK(publicJwk);
    const challenge = randomBytes(32);
    const proof = await signer.sign(challenge);
    if (!(await verifier.verify(challenge, proof))) throw invalidKeyConfiguration();
    return { publicJwk, signer };
  } catch {
    throw invalidKeyConfiguration();
  }
}

function isCanonicalEd25519Part(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(value)
    && Buffer.from(value, 'base64url').length === 32
    && Buffer.from(value, 'base64url').toString('base64url') === value;
}

function unixSeconds(value) {
  const milliseconds = value === undefined
    ? Date.now()
    : value instanceof Date ? value.getTime() : value;
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) {
    throw new TypeError('Invalid Web Bot Auth signing time');
  }
  return Math.floor(milliseconds / 1000);
}

function invalidKeyConfiguration() {
  return new Error('Web Bot Auth is enabled but FLUX_BOT_PRIVATE_KEY_JWK is invalid');
}

module.exports = {
  createWebBotAuthDirectoryResponse,
  isWebBotAuthDirectoryEnabled,
  isWebBotAuthEnabled,
  normalizeTelexTargetUrl,
  signTelexRequest
};
