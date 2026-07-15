const pug = require('pug');
const express = require('express');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');
const fs = require("fs");
const assert = require('assert');
const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const archiver = require('archiver');
const tar = require('tar-stream');
const config = require('../config');
const eventBus = require('./eventBus');
const tusboy = require('./tusboy');
const Store = require('./store');
const tusMeta = require('./tusboy/tus-metadata');
const utils = require('./utils');
const debug = require('debug')('psitransfer:main');
const { hashPassword, verifyPassword } = require('./passwordHash');
const activityLog = require('./activityLog');
const oidc = require('./oidc');

function toAsciiFallbackFilename(name, fallback = 'file') {
  const safe = utils.toSafeBasename(name, fallback);
  const normalized = safe.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const ascii = normalized.replace(/[^\x20-\x7E]+/g, '').trim();
  const cleaned = ascii.replace(/["\\]/g, '_');
  if (cleaned) return cleaned;
  const fallbackSafe = utils.toSafeBasename(fallback, 'file');
  return fallbackSafe.replace(/[^\x20-\x7E]+/g, '').trim() || 'file';
}

function contentDispositionUtf8Filename(name, fallback = 'file') {
  const safe = utils.toSafeBasename(name, fallback);
  const asciiFallback = toAsciiFallbackFilename(safe, fallback);
  const encoded = encodeURIComponent(safe)
    .replace(/['()]/g, c => `%${ c.charCodeAt(0).toString(16).toUpperCase() }`)
    .replace(/\*/g, '%2A');
  return `attachment; filename="${ asciiFallback }"; filename*=UTF-8''${ encoded }`;
}

function md5Hex(input) {
  return createHash('md5').update(input).digest('hex');
}

// Constant-time string compare via fixed-length digests
function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

/** Decoded path segment under the /files mount (must match req.params used by tusboy). */
function decodedUploadPathSegment(req) {
  const raw = req.path.startsWith('/') ? req.path.slice(1) : req.path;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

const appVersion = process.env.BUILD_VERSION || require('../package.json').version;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || config.adminPass || '';
// The admin panel is enabled when a password or OIDC is configured
const ADMIN_ENABLED = !!ADMIN_PASSWORD || oidc.enabled;
const SECRET_KEY = (() => {
  if (process.env.SECRET_KEY) return process.env.SECRET_KEY;
  const keyFile = path.join(config.uploadDir, '.secret_key');
  try {
    return fs.readFileSync(keyFile, 'utf8').trim();
  } catch {
    const key = require('crypto').randomBytes(32).toString('hex');
    fs.writeFileSync(keyFile, key, { mode: 0o600 });
    return key;
  }
})();

const pugVars = {
  baseUrl: config.baseUrl,
  appVersion,
};

const errorPage = pug.compileFile(path.join(__dirname, '../public/pug/error.pug'), { pretty: true });
const adminPage = pug.compileFile(path.join(__dirname, '../public/pug/admin.pug'), { pretty: true });
const loginPage = pug.compileFile(path.join(__dirname, '../public/pug/login.pug'), { pretty: true });
const uploadPage = pug.compileFile(path.join(__dirname, '../public/pug/upload.pug'), { pretty: true });
const downloadPage = pug.compileFile(path.join(__dirname, '../public/pug/download.pug'), { pretty: true });

const store = new Store(config.uploadDir);
const Db = require('./db');
const { createGzip } = require("zlib");
const httpErrors = require("http-errors");
const db = new Db(config.uploadDir, store);
db.init();
activityLog.compact();

// Activity feed for the admin page
eventBus.on('fileUploaded', upload => activityLog.record('upload', {
  sid: upload.metadata.sid,
  file: upload.metadata.name,
  size: upload.size,
  ip: upload.metadata.clientIp,
}));
eventBus.on('fileDownloaded', e => activityLog.record('download', { sid: e.sid, file: e.file, ip: e.ip }));
eventBus.on('archiveDownloaded', e => activityLog.record('archive', { sid: e.sid, file: e.file, ip: e.ip }));
eventBus.on('fileExpired', e => activityLog.record('expired', { sid: e.sid, file: e.file }));

const app = express();

app.disable('x-powered-by');
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(require('express-session')({
  secret: SECRET_KEY,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' },
}));

if (config.accessLog) {
  // keep static asset noise out of the access log
  app.use(morgan(config.accessLog, {
    skip: req => /^\/(app|assets)\//.test(req.url) || req.url === '/favicon.ico',
  }));
}

if (config.trustProxy) {
  app.set('trust proxy', config.trustProxy);
}

if (config.forceHttps) {
  app.enable('trust proxy');
  app.use(function(req, res, next) {
    if (req.secure) return next();
    const target = config.forceHttps === 'true' ? 'https://' + req.headers.host : config.forceHttps;
    res.redirect(target + req.url);
  });
}

// Static files
app.use(`${ config.baseUrl }app`, express.static(path.join(__dirname, '../public/app')));
app.use(`${ config.baseUrl }assets`, express.static(path.join(__dirname, '../public/assets')));

// Resolve language
app.use((req, res, next) => {
  const lang = req.acceptsLanguages(...Object.keys(config.languages)) || config.defaultLanguage;
  req.translations = config.languages[lang];
  next();
});

// robots.txt
app.get(`${ config.baseUrl }robots.txt`, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/robots.txt'));
});

// Init plugins
config.plugins.forEach(pluginName => {
  require('../plugins/' + pluginName)(eventBus, app, config, db);
});

// Upload App
app.get(config.uploadAppPath, (req, res) => {
  res.send(uploadPage({
    ...pugVars,
    baseUrl: config.baseUrl,
    uploadAppPath: config.uploadAppPath,
    lang: req.translations
  }));
});

// Return translations
app.get(`${ config.baseUrl }lang.json`, (req, res) => {
  eventBus.emit('getLang', req.translations);
  res.json(req.translations);
});

// Config
app.get(`${ config.baseUrl }config.json`, (req, res) => {
  // Upload password protection
  if (config.uploadPass) {
    const bfTimeout = 200;
    if (!req.get('x-passwd')) {
      setTimeout(() => res.status(401).send('Unauthorized'), bfTimeout);
      return;
    }
    if (req.get('x-passwd') !== config.uploadPass) {
      setTimeout(() => res.status(403).send('Forbidden'), bfTimeout);
      return;
    }
  }

  const frontendConfig = {
    retentions: config.retentions,
    defaultRetention: config.defaultRetention,
    mailTemplate: config.mailTemplate,
    requireBucketPassword: config.requireBucketPassword,
    maxFileSize: config.maxFileSize,
    maxBucketSize: config.maxBucketSize,
    disableQrCode: config.disableQrCode,
  };

  eventBus.emit('getFrontendConfig', frontendConfig);

  res.json(frontendConfig);
});

const loginVars = error => ({
  ...pugVars,
  error,
  passwordEnabled: !!ADMIN_PASSWORD,
  oidcEnabled: oidc.enabled,
});

// Regenerate the session on login so a pre-auth session id is never promoted
function createAdminSession(req, res, next, user) {
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.adminAuthenticated = true;
    req.session.adminUser = user;
    res.redirect(`${ config.baseUrl }admin`);
  });
}

app.get(`${ config.baseUrl }admin/login`, (req, res, next) => {
  if (!ADMIN_ENABLED) return next();
  if (req.session.adminAuthenticated) return res.redirect(`${ config.baseUrl }admin`);
  res.send(loginPage(loginVars(null)));
});

app.post(`${ config.baseUrl }admin/login`, (req, res, next) => {
  if (!ADMIN_ENABLED) return next();
  const { username, password } = req.body || {};
  if (ADMIN_PASSWORD && safeEqual(username, ADMIN_USERNAME) && safeEqual(password, ADMIN_PASSWORD)) {
    return createAdminSession(req, res, next, String(username));
  }
  res.status(401).send(loginPage(loginVars('Invalid credentials')));
});

const oidcCallbackUri = req =>
  `${ req.protocol }://${ req.get('host') }${ config.baseUrl }admin/oidc/callback`;

app.get(`${ config.baseUrl }admin/oidc/login`, async (req, res, next) => {
  if (!oidc.enabled) return res.redirect(`${ config.baseUrl }admin/login`);
  if (req.session.adminAuthenticated) return res.redirect(`${ config.baseUrl }admin`);
  try {
    await oidc.authorizeRedirect(req, res, oidcCallbackUri(req));
  } catch (e) {
    console.error('OIDC login failed:', e.message);
    res.status(502).send(loginPage(loginVars('OpenID Connect sign-in failed')));
  }
});

app.get(`${ config.baseUrl }admin/oidc/callback`, async (req, res, next) => {
  if (!oidc.enabled) return res.redirect(`${ config.baseUrl }admin/login`);
  try {
    const user = await oidc.handleCallback(req, oidcCallbackUri(req));
    createAdminSession(req, res, next, user.name);
  } catch (e) {
    console.error('OIDC callback failed:', e.message);
    res.status(401).send(loginPage(loginVars('OpenID Connect sign-in failed')));
  }
});

app.post(`${ config.baseUrl }admin/logout`, (req, res) => {
  req.session.destroy(() => res.redirect(config.baseUrl));
});

app.get(`${ config.baseUrl }admin`, (req, res, next) => {
  if (!ADMIN_ENABLED) return next();
  if (!req.session.adminAuthenticated) return res.redirect(`${ config.baseUrl }admin/login`);
  res.send(adminPage({ ...pugVars, lang: req.translations }));
});

function adminApi(req, res, next) {
  if (!ADMIN_ENABLED) return next(httpErrors.NotFound());
  if (!req.session.adminAuthenticated) {
    return res.status(401).send('Unauthorized');
  }
  res.header('Cache-control', 'no-store');
  next();
}

app.get(`${ config.baseUrl }admin/data.json`, adminApi, (req, res) => {
  // deep clone: the password hash is stripped from the copy, not the live db
  let result = JSON.parse(JSON.stringify(db.db));
  Object.values(result).forEach(bucket => {
    bucket.forEach(file => {
      if (file.metadata.password) {
        file.metadata._password = true;
        delete file.metadata.password;
      }
    });
  });

  res.json(result);
});

app.get(`${ config.baseUrl }admin/activity.json`, adminApi, (req, res) => {
  res.json({ events: activityLog.tail(200) });
});

app.delete(`${ config.baseUrl }admin/files/:sid/:key`, adminApi, async (req, res) => {
  const { sid, key } = req.params;
  const bucket = db.get(sid);
  const file = bucket && bucket.find(f => f.key === key);
  if (!file) return res.status(404).end();
  try {
    await db.remove(sid, key);
    activityLog.record('deleted', { sid, file: file.metadata.name, ip: req.ip });
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

app.delete(`${ config.baseUrl }admin/files/:sid`, adminApi, async (req, res) => {
  const sid = req.params.sid;
  const bucket = db.get(sid);
  if (!bucket) return res.status(404).end();
  const count = bucket.length;
  try {
    // copy: db.remove() splices the same array bucket points to
    for (const file of [...bucket]) {
      await db.remove(sid, file.key);
    }
    activityLog.record('deleted', { sid, files: count, ip: req.ip });
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});


// List files / Download App
app.get(`${ config.baseUrl }:sid`, async (req, res, next) => {
  if (req.url.endsWith('.json')) {
    const sid = req.params.sid.substr(0, req.params.sid.length - 5);
    if (!db.get(sid)) return res.status(404).end();

    const downloadPassword = req.get('x-download-pass');
    const items = db.get(sid).map(item => ({
      ...item,
      url: `${ config.baseUrl }files/${ sid }++${ item.key }`
    }));

    res.header('Cache-control', 'private, max-age=0, no-cache, no-store, must-revalidate');

    // Currently, every item in a bucket must have the same password
    try {
      const pass = downloadPassword || '';
      for (const item of items) {
        if (!item.metadata.password) continue;
        const ok = await verifyPassword(item.metadata.password, pass);
        if (!ok) {
          setTimeout(() => res.status(401).send('Unauthorized'), 500);
          return;
        }
      }
    } catch (e) {
      console.error(e);
      setTimeout(() => res.status(401).send('Unauthorized'), 500);
      return;
    }

    const keyList = items.map(item => item.key).join();
    const archiveToken = sha256Hex(keyList).slice(0, 32);

    res.json({
      items,
      archiveToken,
      config: {
        maxPreviewSize: config.maxPreviewSize
      }
    });
  } else {
    if (!db.get(req.params.sid)) return next();
    res.send(downloadPage({ ...pugVars, lang: req.translations }));
  }
});


// Download files
app.get(`${ config.baseUrl }files/:fid`, async (req, res, next) => {
  // let tusboy handle HEAD requests with Tus Header
  if (req.method === 'HEAD' && req.get('Tus-Resumable')) return next();

  // Disable HTTP transport compression for file downloads.
  // Archives already handle their own compression (zip/gzip), and for single
  // files this preserves Content-Length and Range request support needed for
  // resumable downloads of large files.
  res.set('Cache-Control', 'no-transform');

  const sid = req.params.fid.split('++')[0];

  // Download all files
  if (req.params.fid.match(/^[a-z0-9+]+\.(tar\.gz|zip)$/)) {
    const format = req.params.fid.endsWith('.zip') ? 'zip' : 'tar.gz';
    const bucket = db.get(sid);

    if (!bucket) return res.status(404).send(errorPage({
        ...pugVars,
        error: 'Download bucket not found.',
        lang: req.translations,
        uploadAppPath: config.uploadAppPath || config.baseUrl,
      }));

    const keyList = bucket.map(f => f.key).join();
    const legacyMd5 = md5Hex(keyList);
    const newSha256 = sha256Hex(keyList).slice(0, 32);
    const expectedLegacy = `${ sid }++${ legacyMd5 }.${ format }`;
    const expectedNew = `${ sid }++${ newSha256 }.${ format }`;

    if (req.params.fid !== expectedLegacy && req.params.fid !== expectedNew) {
      res.status(404).send(errorPage({
        ...pugVars,
        error: 'Invalid link',
        uploadAppPath: config.uploadAppPath || config.baseUrl,
        lang: req.translations,
      }));
      return;
    }
    debug(`Download Bucket ${ sid }`);

    const filename = `${ sid }.${ format }`;
    res.header('Content-Disposition', `attachment; filename="${ filename }"`);

    res.on('finish', async () => {
      try {
        // copy: db.remove() splices the same array bucket points to
        for (const info of [...bucket]) {
          if (info.metadata.retention === 'one-time') {
            await db.remove(info.metadata.sid, info.metadata.key);
          } else {
            await db.updateLastDownload(info.metadata.sid, info.metadata.key);
          }
        }

        eventBus.emit('archiveDownloaded', {
          sid,
          file: filename,
          metadata: bucket[0].metadata,
          bucket,
          ip: req.ip,
          url: req.protocol + '://' + req.get('host') + req.originalUrl,
        });
      }
      catch (e) {
        console.error(e);
      }
    });

    const usedNames = new Map();
    const uniqueName = (rawName, fallback) => {
      const base = utils.toSafeBasename(rawName, fallback);
      const prev = usedNames.get(base) || 0;
      usedNames.set(base, prev + 1);
      if (prev === 0) return base;
      const ext = path.extname(base);
      const stem = ext ? base.slice(0, -ext.length) : base;
      return `${ stem } (${ prev + 1 })${ ext }`;
    };

    if(format === 'zip') {
      res.header('Content-Type', 'application/zip');
      const archive = archiver('zip');
      archive.on('error', function(err) {
        console.error(err);
        res.destroy();
      });
      archive.pipe(res);

      for (const info of bucket) {
        await new Promise((resolve, reject) => {
          const stream = fs.createReadStream(store.getFilename(info.metadata.sid + '++' + info.key));
          stream.on('end', resolve);
          stream.on('error', reject);
          archive.append(stream, { name: uniqueName(info.metadata.name, info.key) });
        });
      }

      await archive.finalize();
    } else {
      res.header('Content-Type', 'application/x-gtar');
      const pack = tar.pack();
      pack.pipe(createGzip()).pipe(res);

      for (const info of bucket) {
        await new Promise((resolve, reject) => {
          const readStream = fs.createReadStream(store.getFilename(info.metadata.sid + '++' + info.key));
          const entry = pack.entry({ name: uniqueName(info.metadata.name, info.key), size: info.size });
          readStream.on('error', reject);
          entry.on('error', reject);
          entry.on('finish',resolve);
          readStream.pipe(entry);
        });
      }
      pack.finalize();
    }

    return;
  }

  // Download single file
  debug(`Download ${ req.params.fid }`);
  try {
    if (req.params.fid.includes('++') && !utils.isSafeTusUploadId(req.params.fid)) {
      return res.status(404).send(errorPage({
        ...pugVars,
        error: 'Invalid link',
        lang: req.translations,
        uploadAppPath: config.uploadAppPath || config.baseUrl,
      }));
    }
    const info = await store.info(req.params.fid); // throws on 404
    const safeName = utils.toSafeBasename(info.metadata.name, info.key);
    res.set('Content-Disposition', contentDispositionUtf8Filename(safeName, info.key));
    res.sendFile(store.getFilename(req.params.fid));

    // remove one-time files after download
    res.on('finish', async () => {
      try {
        if (info.metadata.retention === 'one-time') {
          await db.remove(info.metadata.sid, info.metadata.key);
        } else {
          await db.updateLastDownload(info.metadata.sid, info.metadata.key);
        }

        eventBus.emit('fileDownloaded', {
          sid,
          file: info.metadata.name,
          metadata: info.metadata,
          ip: req.ip,
          url: req.protocol + '://' + req.get('host') + req.originalUrl,
        });
      }
      catch (e) {
        console.error(e);
      }
    });
  }
  catch (e) {
    res.status(404).send(errorPage({
      ...pugVars,
      error: e.message,
      lang: req.translations,
      uploadAppPath: config.uploadAppPath || config.baseUrl,
    }));
  }
});


// Upload file
app.use(`${ config.uploadAppPath }files`,
  async function(req, res, next) {
    // Upload password protection
    if (config.uploadPass) {
      const bfTimeout = 500;
      if (!req.get('x-passwd')) {
        setTimeout(() => res.status(401).send('Unauthorized'), bfTimeout);
        return;
      }
      if (req.get('x-passwd') !== config.uploadPass) {
        setTimeout(() => res.status(403).send('Forbidden'), bfTimeout);
        return;
      }
    }

    if (req.method === 'GET') return res.status(405).end();

    const fid = decodedUploadPathSegment(req);
    if (fid === null) {
      return res.status(400).end('Invalid path encoding');
    }

    // Lock bucket by PATCH /files/:sid?lock=yes
    if (fid && !fid.includes('++') && req.method === 'PATCH' && req.query.lock) {
      if (!utils.isSafeBucketFid(fid)) {
        return res.status(400).end('Invalid bucket id');
      }
      await db.lock(fid);
      return res.status(204).end('Bucket locked');
    }

    if (['POST', 'PATCH'].includes(req.method)) {
      if (fid && !fid.includes('++') && !utils.isSafeBucketFid(fid)) {
        return res.status(400).end('Invalid bucket id');
      }
      if (fid && !fid.includes('++') && db.isLocked(fid)) {
        return res.status(400).end('Bucket locked');
      }
      if (fid) {
        if (fid.includes('++') && !utils.isSafeTusUploadId(fid)) {
          return res.status(400).end('Invalid upload id');
        }
        try {
          const info = await store.info(fid);
          if (info.metadata.buckedLocked) {
            return res.status(400).end('Bucket locked');
          }
          if (!info.isPartial) {
            return res.status(400).end('Upload already completed');
          }
        } catch (e) {
          if (!(e instanceof httpErrors.NotFound)) {
            console.error(e);
            return next(e);
          }
        }
      }
    }

    if (req.method === 'POST') {
      // validate meta-data
      // !! tusMeta.encode supports only strings !!
      const meta = tusMeta.decode(req.get('Upload-Metadata'));

      try {
        assert(meta.name, 'tus meta prop missing: name');
        assert(meta.sid, 'tus meta prop missing: sid');
        if (!utils.isSafeBasename(meta.sid)) {
          return res.status(400).end('Invalid bucket id');
        }
        assert(meta.retention, 'tus meta prop missing: retention');
        assert(Object.keys(config.retentions).indexOf(meta.retention) >= 0,
          `invalid tus meta prop retention. Value ${ meta.retention } not in [${ Object.keys(config.retentions).join(',') }]`);

        // Prevent ZipSlip/tar path traversal by requiring a safe basename at upload time.
        // Policy (flat archive): no directories, no absolute paths, no traversal, no control chars.
        if (!utils.isSafeBasename(meta.name)) {
          return res.status(400).end('Invalid file name');
        }

        const uploadLength = req.get('Upload-Length');
        assert(uploadLength, 'missing Upload-Length header');

        // Restrict creating new files for locked buckets
        if(db.isLocked(meta.sid)) {
          return res.status(400).end('Bucket locked');
        }

        meta.uploadLength = uploadLength;
        meta.key = randomUUID();
        meta.createdAt = Date.now().toString();
        meta.clientIp = req.ip || '';

        // limit file and bucket size
        if (config.maxFileSize && config.maxFileSize < +uploadLength) {
          return res
            .status(413)
            .json({ message: `File exceeds maximum upload size ${ config.maxFileSize }.` });
        } else if (config.maxBucketSize && db.bucketSize(meta.sid) + +uploadLength > config.maxBucketSize) {
          return res
            .status(413)
            .json({ message: `Bucket exceeds maximum upload size ${ config.maxBucketSize }.` });
        }

        // store changed metadata for tusboy
        if (typeof meta.password === 'string' && meta.password.length > 0) {
          meta.password = await hashPassword(meta.password);
        } else {
          delete meta.password;
        }
        req.headers['upload-metadata'] = tusMeta.encode(meta);
        // for tusboy getKey()
        req.FID = meta.sid + '++' + meta.key;

        db.add(meta.sid, meta.key, {
          "isPartial": true,
          metadata: meta
        });
      }
      catch (e) {
        console.error(e);
        return res.status(400).end(e.message);
      }
    }

    next();
  },

  // let tusboy handle the upload
  tusboy(store, {
    getKey: req => req.FID,
    maxUploadLength: config.maxFileSize || Infinity,
    afterComplete: (req, upload, fid) => {
      db.add(upload.metadata.sid, upload.metadata.key, upload);
      debug(`Completed upload ${ fid }, size=${ upload.size } name=${ upload.metadata.name }`);
      eventBus.emit('fileUploaded', upload);
    },
  })
);

app.use((req, res, next) => {
  if (req.url === config.baseUrl) {
    return res.redirect(config.uploadAppPath);
  }

  res.status(404).send(errorPage({
    ...pugVars,
    error: 'Download bucket not found.',
    uploadAppPath: config.uploadAppPath || config.baseUrl,
    lang: req.translations
  }));
});

module.exports = app;
