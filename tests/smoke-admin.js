'use strict';
// Manual smoke test for the admin API. Not part of npm test.
// Run: PSITRANSFER_UPLOAD_DIR=/tmp/data node tests/smoke-admin.js
const { spawn } = require('child_process');

const base = 'http://127.0.0.1:3000';

function startServer(extraEnv) {
  const srv = spawn('node', ['app.js'], {
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // The credentials banner prints at startup, before the server listens
  return new Promise(resolve => {
    let out = '';
    let password = null;
    srv.stdout.on('data', chunk => {
      out += chunk.toString();
      const m = out.match(/Password: (\S+)/);
      if (m) password = m[1];
      if (out.includes('listening on')) resolve({ srv, password });
    });
    setTimeout(() => resolve({ srv, password }), 5000);
  });
}

async function login(username, password) {
  return fetch(base + '/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }).toString(),
    redirect: 'manual',
  });
}

function saveCfg(cookie, overrides) {
  return fetch(base + '/admin/auth-config.json', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      enabled: false, discovery_url: '', client_id: '', client_secret: '',
      session_lifetime_days: 7, external_url: '', password_login: true,
      admin_username: 'admin', new_password: '',
      ...overrides,
    }),
  });
}

async function main() {
  let { srv, password: generated } = await startServer();
  try {
    console.log('GENERATED-PW:', generated ? 'captured' : 'MISSING');

    const bad = await login('admin', 'wrong');
    console.log('BAD-LOGIN:', bad.status, bad.status === 401 ? 'rejected' : 'FAIL');

    const good = await login('admin', generated);
    const cookie = good.headers.get('set-cookie');
    console.log('GENERATED-LOGIN:', good.status, good.status === 302 && cookie ? 'OK' : 'FAIL');
    const h = { cookie };

    const cfg = await (await fetch(base + '/admin/auth-config.json', { headers: h })).json();
    console.log('MUST-CHANGE-FLAG:', cfg.must_change_password === true && cfg.password_set === true ? 'OK' : JSON.stringify(cfg));
    console.log('SECRETS-HIDDEN:', cfg.client_secret === undefined && cfg.admin_password_hash === undefined ? 'OK' : 'LEAKED');

    let r = await saveCfg(cookie, { new_password: 'short' });
    console.log('SHORT-PASSWORD:', r.status, r.status === 400 ? 'OK' : 'FAIL');

    r = await saveCfg(cookie, { enabled: false, password_login: false });
    console.log('BOTH-DISABLED:', r.status, r.status === 400 ? 'OK' : 'FAIL');

    r = await saveCfg(cookie, {
      password_login: false, enabled: true,
      discovery_url: 'https://idp.example/.wk', client_id: 'cid', client_secret: 'sec',
    });
    console.log('LOCKOUT-GUARD:', r.status, r.status === 400 ? 'OK' : 'FAIL');

    r = await saveCfg(cookie, { new_password: 'newpassword123', admin_username: 'boss' });
    console.log('CHANGE-CREDS:', r.status, r.status === 200 ? 'OK' : await r.text());

    const oldCreds = await login('admin', generated);
    console.log('OLD-CREDS-REJECTED:', oldCreds.status, oldCreds.status === 401 ? 'OK' : 'FAIL');
    const newCreds = await login('boss', 'newpassword123');
    console.log('NEW-CREDS-LOGIN:', newCreds.status, newCreds.status === 302 ? 'OK' : 'FAIL');

    const cfg2 = await (await fetch(base + '/admin/auth-config.json', { headers: h })).json();
    console.log('FLAG-CLEARED:', cfg2.must_change_password === false && cfg2.admin_username === 'boss' ? 'OK' : JSON.stringify(cfg2));

    const data = await fetch(base + '/admin/data.json', { headers: h });
    console.log('API-AUTHED:', data.status, data.status === 200 ? 'OK' : 'FAIL');
  } finally {
    srv.kill();
    await new Promise(r => srv.on('exit', r));
  }

  // Second boot: no regeneration expected (credentials already stored)
  ({ srv, password: generated } = await startServer());
  try {
    console.log('SECOND-BOOT-NO-REGEN:', generated === null ? 'OK' : 'REGENERATED-FAIL');
    const r = await login('boss', 'newpassword123');
    console.log('PERSISTED-LOGIN:', r.status, r.status === 302 ? 'OK' : 'FAIL');
  } finally {
    srv.kill();
    await new Promise(r => srv.on('exit', r));
  }

  // AUTH_RESET boot: fresh credentials, OIDC disabled
  ({ srv, password: generated } = await startServer({ AUTH_RESET: '1' }));
  try {
    console.log('RESET-PW:', generated ? 'captured' : 'MISSING');
    const r = await login('admin', generated);
    const cookie = r.headers.get('set-cookie');
    console.log('RESET-LOGIN:', r.status, r.status === 302 ? 'OK' : 'FAIL');
    const cfg = await (await fetch(base + '/admin/auth-config.json', { headers: { cookie } })).json();
    console.log('RESET-STATE:', cfg.enabled === false && cfg.must_change_password === true ? 'OK' : JSON.stringify(cfg));
  } finally {
    srv.kill();
    await new Promise(r => srv.on('exit', r));
  }

  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
