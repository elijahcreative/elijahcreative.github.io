'use strict';

const assert = require('node:assert/strict');
const { createHash, createPublicKey, generateKeyPairSync, verify } = require('node:crypto');
const test = require('node:test');
const {
  createWebBotAuthDirectoryResponse,
  isWebBotAuthDirectoryEnabled,
  isWebBotAuthEnabled,
  normalizeTelexTargetUrl,
  signTelexRequest
} = require('../lib/web-bot-auth');

const NOW = new Date('2026-10-26T12:00:00.000Z');
const DIRECTORY_PATH = '/.well-known/http-message-signatures-directory';
const DIRECTORY_CONTENT_TYPE = 'application/http-message-signatures-directory+json';
const { privateKey } = generateKeyPairSync('ed25519');
const privateJwk = privateKey.export({ format: 'jwk' });
const publicJwk = { kty: 'OKP', crv: 'Ed25519', x: privateJwk.x };
const baseEnv = Object.freeze({
  FLUX_BOT_PRIVATE_KEY_JWK: JSON.stringify(privateJwk),
  VERCEL_URL: 'flux-preview-abc.vercel.app'
});

test('directory and outbound activation flags stay independent', async () => {
  const directoryOnly = {
    ...baseEnv,
    WEB_BOT_AUTH_DIRECTORY_ENABLED: 'true',
    WEB_BOT_AUTH_ENABLED: 'false'
  };
  assert.equal(isWebBotAuthDirectoryEnabled(directoryOnly), true);
  assert.equal(isWebBotAuthEnabled(directoryOnly), false);
  assert.ok(await createWebBotAuthDirectoryResponse({
    requestUrl: `https://flux-preview-abc.vercel.app${DIRECTORY_PATH}`,
    env: directoryOnly,
    now: NOW
  }));
  assert.equal(await signTelexRequest({
    targetUrl: 'https://telex.hu/a',
    env: directoryOnly,
    now: NOW
  }), null);

  const outboundOnly = {
    ...baseEnv,
    WEB_BOT_AUTH_DIRECTORY_ENABLED: 'false',
    WEB_BOT_AUTH_ENABLED: 'true'
  };
  assert.equal(isWebBotAuthDirectoryEnabled(outboundOnly), false);
  assert.equal(isWebBotAuthEnabled(outboundOnly), true);
  assert.equal(await createWebBotAuthDirectoryResponse({
    requestUrl: `https://flux-preview-abc.vercel.app${DIRECTORY_PATH}`,
    env: outboundOnly,
    now: NOW
  }), null);
  assert.ok(await signTelexRequest({
    targetUrl: 'https://telex.hu/a',
    env: outboundOnly,
    now: NOW
  }));
});

test('directory is a public-only JWKS with a valid Content-Digest and independently verifiable signature', async () => {
  const requestUrl = `https://flux-preview-abc.vercel.app${DIRECTORY_PATH}`;
  const result = await createWebBotAuthDirectoryResponse({
    requestUrl,
    env: { ...baseEnv, WEB_BOT_AUTH_DIRECTORY_ENABLED: 'true' },
    now: NOW
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['Content-Type'], DIRECTORY_CONTENT_TYPE);
  const directory = JSON.parse(result.body);
  assert.deepEqual(directory.keys, [publicJwk]);
  assert.deepEqual(Object.keys(directory.keys[0]).sort(), ['crv', 'kty', 'x']);
  assert.equal('d' in directory.keys[0], false);
  assert.equal(result.body.includes(privateJwk.d), false);
  assert.equal(result.headers['Content-Digest'], contentDigest(result.body));

  const expectedKeyId = createHash('sha256')
    .update(JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x: publicJwk.x }))
    .digest('base64url');
  const parameters = signatureParameters(result.headers['Signature-Input']);
  assert.match(parameters, /;tag="http-message-signatures-directory"/);
  assert.match(parameters, /;alg="ed25519"/);
  assert.match(parameters, new RegExp(`;keyid="${expectedKeyId}"`));
  assert.match(parameters, /;created=1793016000/);
  assert.match(parameters, /;expires=1793016300/);

  const signatureBase = [
    `"@authority";req: ${new URL(requestUrl).host}`,
    `"content-digest": ${result.headers['Content-Digest']}`,
    `"@signature-params": ${parameters}`
  ].join('\n');
  const publicKey = createPublicKey({ key: publicJwk, format: 'jwk' });
  const signatureBytes = decodeSignature(result.headers.Signature);
  assert.equal(verify(
    null,
    Buffer.from(signatureBase, 'utf8'),
    publicKey,
    signatureBytes
  ), true);
  const tamperedSignature = Buffer.from(signatureBytes);
  tamperedSignature[0] ^= 1;
  assert.equal(verify(null, Buffer.from(signatureBase, 'utf8'), publicKey, tamperedSignature), false);
});

test('directory rejects any authority outside production and the exact Vercel deployment host', async () => {
  const env = { ...baseEnv, WEB_BOT_AUTH_DIRECTORY_ENABLED: 'true' };
  await assert.rejects(
    createWebBotAuthDirectoryResponse({
      requestUrl: `https://attacker.example${DIRECTORY_PATH}`,
      env,
      now: NOW
    }),
    /Invalid Web Bot Auth directory request URL/
  );
  await assert.rejects(
    createWebBotAuthDirectoryResponse({
      requestUrl: 'http://fluxreader.vercel.app/.well-known/http-message-signatures-directory',
      env,
      now: NOW
    }),
    /Invalid Web Bot Auth directory request URL/
  );
  await assert.rejects(
    createWebBotAuthDirectoryResponse({
      requestUrl: 'https://fluxreader.vercel.app/.well-known/other',
      env,
      now: NOW
    }),
    /Invalid Web Bot Auth directory request URL/
  );
});

test('outbound signing canonicalizes Telex host and removes query/fragment before signing', async () => {
  const result = await signTelexRequest({
    targetUrl: 'https://www.telex.hu/belfold/cikk?utm_source=feed#story',
    env: { ...baseEnv, WEB_BOT_AUTH_ENABLED: 'true' },
    now: NOW
  });

  assert.equal(result.targetUrl, 'https://telex.hu/belfold/cikk');
  assert.equal(result.headers['Signature-Agent'], '"https://fluxreader.vercel.app"');
  assert.deepEqual(Object.keys(result.headers).sort(), ['Signature', 'Signature-Agent', 'Signature-Input'].sort());
  const parameters = signatureParameters(result.headers['Signature-Input']);
  assert.match(parameters, /;tag="web-bot-auth"/);
  assert.match(parameters, /;alg="ed25519"/);
  assert.match(parameters, /;nonce="[^"]+"/);
  assert.match(parameters, /;expires=1793016060/);
  assert.match(parameters, /"@method"/);
  assert.match(parameters, /"@path"/);

  const signatureBase = [
    `"@authority": ${new URL(result.targetUrl).host}`,
    `"signature-agent": ${result.headers['Signature-Agent']}`,
    '"@method": GET',
    `"@path": ${new URL(result.targetUrl).pathname}`,
    `"@signature-params": ${parameters}`
  ].join('\n');
  const publicKey = createPublicKey({ key: publicJwk, format: 'jwk' });
  const signatureBytes = decodeSignature(result.headers.Signature);
  assert.equal(verify(
    null,
    Buffer.from(signatureBase, 'utf8'),
    publicKey,
    signatureBytes
  ), true);
  const tamperedAgentBase = signatureBase.replace(result.headers['Signature-Agent'], '"https://attacker.example"');
  assert.equal(verify(null, Buffer.from(tamperedAgentBase, 'utf8'), publicKey, signatureBytes), false);
  const tamperedPathBase = signatureBase.replace('/belfold/cikk', '/another-article');
  assert.equal(verify(null, Buffer.from(tamperedPathBase, 'utf8'), publicKey, signatureBytes), false);
});

test('outbound signer rejects non-Telex targets and unsafe URL authorities', async () => {
  const env = { ...baseEnv, WEB_BOT_AUTH_ENABLED: 'true' };
  for (const targetUrl of [
    'https://example.com/article',
    'https://telex.hu.attacker.example/article',
    'https://telex.hu@attacker.example/article',
    'http://telex.hu/article',
    'https://telex.hu:8443/article'
  ]) {
    await assert.rejects(signTelexRequest({ targetUrl, env, now: NOW }), /Invalid Telex Web Bot Auth target/);
  }
  assert.equal(normalizeTelexTargetUrl('https://telex.hu/a?x=1#b'), 'https://telex.hu/a');
});

test('explicitly enabled signing fails closed for missing or malformed key configuration', async () => {
  await assert.rejects(
    signTelexRequest({ targetUrl: 'https://telex.hu/a', env: { WEB_BOT_AUTH_ENABLED: 'true' }, now: NOW }),
    /FLUX_BOT_PRIVATE_KEY_JWK is invalid/
  );
  await assert.rejects(
    createWebBotAuthDirectoryResponse({
      requestUrl: `https://flux-preview-abc.vercel.app${DIRECTORY_PATH}`,
      env: {
        ...baseEnv,
        WEB_BOT_AUTH_DIRECTORY_ENABLED: 'true',
        FLUX_BOT_PRIVATE_KEY_JWK: '{bad json'
      },
      now: NOW
    }),
    /FLUX_BOT_PRIVATE_KEY_JWK is invalid/
  );

  const secondKey = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  await assert.rejects(
    signTelexRequest({
      targetUrl: 'https://telex.hu/a',
      env: {
        WEB_BOT_AUTH_ENABLED: 'true',
        FLUX_BOT_PRIVATE_KEY_JWK: JSON.stringify({ ...privateJwk, x: secondKey.x })
      },
      now: NOW
    }),
    /FLUX_BOT_PRIVATE_KEY_JWK is invalid/
  );
});

function signatureParameters(value) {
  const match = /^sig1=(\([^)]*\)(?:;.*))$/.exec(value || '');
  assert.ok(match, `expected one sig1 Signature-Input value, received ${value}`);
  return match[1];
}

function decodeSignature(value) {
  const match = /^sig1=:([A-Za-z0-9+/]+={0,2}):$/.exec(value || '');
  assert.ok(match, `expected one sig1 Signature value, received ${value}`);
  return Buffer.from(match[1], 'base64');
}

function contentDigest(body) {
  return `sha-256=:${createHash('sha256').update(body, 'utf8').digest('base64')}:`;
}
