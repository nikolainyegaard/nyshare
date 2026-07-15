'use strict';
// OIDC authorization code flow for the admin panel, same logic as
// multi-downloader's app/auth.py (ported from social-downloader):
// discovery URL, PKCE S256, state check, openid profile email scopes.
// Hand-rolled on global fetch instead of a client library; the ID token
// arrives over the authenticated token-endpoint TLS channel, so its
// signature is not re-verified here.
const crypto = require('node:crypto');

const DISCOVERY_URL = process.env.OIDC_DISCOVERY_URL || '';
const CLIENT_ID = process.env.OIDC_CLIENT_ID || '';
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || '';

const enabled = !!(DISCOVERY_URL && CLIENT_ID && CLIENT_SECRET);

let metadataPromise = null;
function metadata() {
  if (!metadataPromise) {
    metadataPromise = fetch(DISCOVERY_URL).then(r => {
      if (!r.ok) throw new Error(`OIDC discovery failed: ${ r.status }`);
      return r.json();
    });
    // failed discovery is retried on the next login attempt
    metadataPromise.catch(() => { metadataPromise = null; });
  }
  return metadataPromise;
}

const b64url = buf => buf.toString('base64url');

async function authorizeRedirect(req, res, redirectUri) {
  const meta = await metadata();
  const state = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  req.session.oidc = { state, verifier };
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  res.redirect(`${ meta.authorization_endpoint }?${ params }`);
}

/** Exchange the callback code for tokens. Returns { sub, name } on success, throws on any failure. */
async function handleCallback(req, redirectUri) {
  const meta = await metadata();
  const { state, verifier } = req.session.oidc || {};
  delete req.session.oidc;
  if (!state || req.query.state !== state) throw new Error('state mismatch');
  if (req.query.error) throw new Error(`provider error: ${ req.query.error }`);
  if (!req.query.code) throw new Error('missing code');

  const basic = Buffer.from(
    `${ encodeURIComponent(CLIENT_ID) }:${ encodeURIComponent(CLIENT_SECRET) }`
  ).toString('base64');
  const resp = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${ basic }`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: req.query.code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!resp.ok) throw new Error(`token exchange failed: ${ resp.status }`);
  const token = await resp.json();
  if (!token.id_token) throw new Error('no id_token in token response');

  const payload = JSON.parse(Buffer.from(token.id_token.split('.')[1], 'base64url').toString());
  return {
    sub: payload.sub || '',
    name: payload.name || payload.preferred_username || payload.email || payload.sub || '',
  };
}

module.exports = { enabled, authorizeRedirect, handleCallback };
