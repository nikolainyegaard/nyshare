'use strict';
// OIDC authorization code flow for the admin panel, same logic as
// multi-downloader's app/auth.py (ported from social-downloader):
// discovery URL, PKCE S256, state check, openid profile email scopes.
// Hand-rolled on global fetch instead of a client library; the ID token
// arrives over the authenticated token-endpoint TLS channel, so its
// signature is not re-verified here.
//
// Config lives in oauth.json in the upload dir, edited from the admin
// panel's Authentication section. Read once at startup; restart to apply.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { hashPasswordSync } = require('./passwordHash');

const AUTH_RESET = ['1', 'true', 'yes'].includes(String(process.env.AUTH_RESET || '').toLowerCase());

const OAUTH_FILE = path.join(config.uploadDir, 'oauth.json');
const OAUTH_DEFAULTS = {
  enabled: false,
  client_id: '',
  client_secret: '',
  discovery_url: '',
  session_lifetime_days: 7,
  // Public base URL of this service (e.g. https://share.example.com); used
  // for the OIDC redirect URL and available for future external links
  external_url: '',
  password_login: true,
  admin_username: 'admin',
  admin_password_hash: '',
  must_change_password: false,
};

function readConfig() {
  try {
    return { ...OAUTH_DEFAULTS, ...JSON.parse(fs.readFileSync(OAUTH_FILE, 'utf8')) };
  } catch (e) {
    return { ...OAUTH_DEFAULTS };
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(OAUTH_FILE), { recursive: true });
  fs.writeFileSync(OAUTH_FILE + '.tmp', JSON.stringify(cfg, null, 2));
  fs.renameSync(OAUTH_FILE + '.tmp', OAUTH_FILE);
}

function printCredentials(title, password, footer) {
  console.log('='.repeat(54));
  console.log(title);
  console.log('  Username: admin');
  console.log(`  Password: ${ password }`);
  console.log(footer);
  console.log('='.repeat(54));
}

// Startup: read the config once (OIDC settings need a restart to apply) and
// generate admin credentials when none exist or AUTH_RESET is set.
const runtime = readConfig();

if (AUTH_RESET) {
  runtime.enabled = false;
  runtime.password_login = true;
  const pw = crypto.randomBytes(12).toString('base64url');
  runtime.admin_username = 'admin';
  runtime.admin_password_hash = hashPasswordSync(pw);
  runtime.must_change_password = true;
  saveConfig(runtime);
  printCredentials(
    'AUTH_RESET is set: OIDC disabled, admin credentials reset',
    pw,
    'Remove AUTH_RESET from the environment after signing in.'
  );
} else if (runtime.password_login && !runtime.admin_password_hash) {
  const pw = crypto.randomBytes(12).toString('base64url');
  runtime.admin_password_hash = hashPasswordSync(pw);
  runtime.must_change_password = true;
  saveConfig(runtime);
  printCredentials(
    'Admin credentials generated (first launch)',
    pw,
    'Sign in at /admin/login and set a new password in the Authentication section.'
  );
}

const enabled = !!(runtime.enabled && runtime.discovery_url && runtime.client_id && runtime.client_secret);
const sessionDays = Math.max(1, Math.min(365, +runtime.session_lifetime_days || 7));

/** Read fresh: password and username changes apply without a restart */
function passwordLoginEnabled() {
  const cfg = readConfig();
  return !!(cfg.password_login && cfg.admin_password_hash);
}

let metadataPromise = null;
function metadata() {
  if (!metadataPromise) {
    metadataPromise = fetch(runtime.discovery_url).then(r => {
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
    client_id: runtime.client_id,
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
    `${ encodeURIComponent(runtime.client_id) }:${ encodeURIComponent(runtime.client_secret) }`
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

module.exports = { enabled, sessionDays, passwordLoginEnabled, readConfig, saveConfig, authorizeRedirect, handleCallback };
