'use strict';
// Manual smoke test for the admin API. Not part of npm test.
// Run: ADMIN_PASSWORD=test123 PSITRANSFER_UPLOAD_DIR=/tmp/data node tests/smoke-admin.js
const { spawn } = require('child_process');

const srv = spawn('node', ['app.js'], { stdio: 'inherit' });
const base = 'http://127.0.0.1:3000';

async function main() {
  await new Promise(r => setTimeout(r, 1500));

  const login = await fetch(base + '/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=test123',
    redirect: 'manual',
  });
  const cookie = login.headers.get('set-cookie');
  console.log('LOGIN:', login.status, cookie ? 'cookie set' : 'NO COOKIE');
  const h = { cookie };

  const data = await fetch(base + '/admin/data.json', { headers: h });
  console.log('DATA:', data.status, JSON.stringify(await data.json()));

  const act = await fetch(base + '/admin/activity.json', { headers: h });
  console.log('ACTIVITY:', act.status, JSON.stringify(await act.json()));

  const noauth = await fetch(base + '/admin/data.json');
  console.log('NOAUTH:', noauth.status);

  const del = await fetch(base + '/admin/files/zzzzzzz', { method: 'DELETE', headers: h });
  console.log('DEL-MISSING:', del.status);

  const badlogin = await fetch(base + '/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=wrong',
    redirect: 'manual',
  });
  const badBody = await badlogin.text();
  console.log('BADLOGIN:', badlogin.status, badBody.includes('Invalid credentials') ? 'rejected' : 'CHECK');

  const pageRes = await fetch(base + '/admin/login');
  const page = await pageRes.text();
  console.log('LOGIN-PAGE:', pageRes.status,
    page.includes('Sign in') ? 'password-form' : 'no-password-form',
    page.includes('admin/oidc/login') ? 'oidc-visible' : 'oidc-hidden');

  const oidcRes = await fetch(base + '/admin/oidc/login', { redirect: 'manual' });
  const oidcBody = oidcRes.headers.get('location') || ((await oidcRes.text()).includes('sign-in failed') ? 'graceful-error' : 'CHECK');
  console.log('OIDC-LOGIN:', oidcRes.status, oidcBody);

  // full round trip: tus upload, download, check admin data + activity
  const b64 = s => Buffer.from(s).toString('base64');
  const body = Buffer.from('hello smoke test');
  const create = await fetch(base + '/files', {
    method: 'POST',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(body.length),
      'Upload-Metadata': `name ${b64('smoke.txt')},sid ${b64('smoketst')},retention ${b64('3600')}`,
    },
  });
  const loc = create.headers.get('location');
  console.log('TUS-CREATE:', create.status, loc);
  const patch = await fetch(base + loc, {
    method: 'PATCH',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Offset': '0',
      'Content-Type': 'application/offset+octet-stream',
    },
    body,
  });
  console.log('TUS-PATCH:', patch.status);

  const dl = await fetch(base + loc.replace('/files/', '/files/'), { headers: {} });
  console.log('DOWNLOAD:', dl.status, (await dl.text()) === 'hello smoke test' ? 'content ok' : 'CONTENT MISMATCH');

  const data2 = await (await fetch(base + '/admin/data.json', { headers: h })).json();
  const file = data2.smoketst && data2.smoketst[0];
  console.log('ADMIN-FILE:', file
    ? `downloads=${file.metadata.downloads} clientIp=${file.metadata.clientIp} key=${!!file.key}`
    : 'MISSING');

  const act2 = await (await fetch(base + '/admin/activity.json', { headers: h })).json();
  console.log('EVENTS:', act2.events.map(e => `${e.type}:${e.file}@${e.ip}`).join(' | '));

  const delFile = await fetch(base + `/admin/files/smoketst/${file.key}`, { method: 'DELETE', headers: h });
  console.log('DEL-FILE:', delFile.status);
  const act3 = await (await fetch(base + '/admin/activity.json', { headers: h })).json();
  console.log('EVENTS-AFTER-DELETE:', act3.events[0] && act3.events[0].type);

  srv.kill();
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  srv.kill();
  process.exit(1);
});
