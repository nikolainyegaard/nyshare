# Architecture

Self-hosted, WeTransfer-style ephemeral file sharing. A personal fork of [PsiTransfer](https://github.com/psi-4ward/psitransfer); the fork customizes the UI and behavior and adds an admin dashboard with password/OIDC login. Ships as a Docker image: `ghcr.io/nikolainyegaard/nyshare`, deployed on a Proxmox/Primergy server behind Caddy on an external Docker network (see [config.md](config.md)).

The backend is a single Express process serving Pug page shells; a Vue app mounts into each shell (upload, download, admin). Uploads use the tus protocol via the vendored `lib/tusboy/` handler. There is no database: shares live as directories of files plus `.json` metadata under the upload dir, indexed in memory by `lib/db.js`.

The other files in `docs/` (configuration.md, deployment-docker.md, deployment-systemd.md, layout-customization.md, nginx-ssl-example.conf, psitransfer.service) are upstream PsiTransfer docs kept for reference. The fork's own reference docs are this file, [config.md](config.md), and [gotchas.md](gotchas.md).

## File structure

```
nyshare/
├── app.js                Express entry point; write-tests the upload dir, starts HTTP/HTTPS
├── cli.js                bin wrapper around app.js
├── config.js             default config; do not edit, override via config.<NODE_ENV>.js or PSITRANSFER_* env vars
├── config.dev.js         dev overrides, loaded by npm run dev
├── lib/
│   ├── endpoints.js      all Express routes: pages, admin API, downloads, tus mount
│   ├── db.js             in-memory bucket index over the stored .json metadata
│   ├── store.js          file storage in the upload dir
│   ├── tusboy/           vendored tus resumable-upload protocol handler
│   ├── jsonlLog.js       append-only JSONL log factory (activity and audit logs)
│   ├── activityLog.js    share activity feed, .activity.jsonl in the upload dir
│   ├── auditLog.js       admin audit trail, .audit.jsonl in the upload dir
│   ├── oidc.js           admin auth: oauth.json store, credential generation, OIDC code flow
│   ├── passwordHash.js   argon2 hash and verify helpers
│   ├── eventBus.js       process-wide event emitter (plugins, activity log)
│   └── utils.js          safe-basename and id validation helpers
├── plugins/              webhook plugins (file-uploaded, file-downloaded)
├── lang/                 translation modules (en.js, de.js, fr.js, ...)
├── public/
│   ├── app/              Vite build output (currently tracked; the Docker build regenerates it)
│   ├── assets/           favicons, global styles.css, fonts/ (self-hosted JetBrains Mono)
│   ├── pug/              page shells: upload, download, admin, login, error + partials/
│   └── robots.txt
├── app/                  frontend source (own package.json and lock file)
│   ├── src/
│   │   ├── upload.js download.js admin.js      entry points, one per page
│   │   ├── Upload.vue Download.vue Admin.vue   root page components
│   │   ├── icons.js      oh-vue-icons registration
│   │   ├── Upload/       Files.vue, Settings.vue, Vuex store modules
│   │   ├── Download/     PreviewModal.vue
│   │   └── common/       Clipboard, FileIcon, Modal, util.js
│   └── vite.config.js
├── tests/                unit/, integration/, e2e/, smoke-admin.js (manual auth smoke test)
├── scripts/              upstream helper scripts (bundle, browserstack, traffic limit); unused
├── docs/                 this documentation plus the upstream PsiTransfer docs
├── Dockerfile
├── entrypoint.sh         chowns /data, then drops to the node user via su-exec
└── docker-compose.yml
```

## Tech stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Backend runtime | Node.js 24 | Required by upstream |
| Backend framework | Express 5 | Upstream choice |
| Server templates | Pug | Page shells rendered server-side; Vue mounts into them |
| Frontend framework | Vue 3 | Upgraded from Vue 2 (EOL); Options API retained |
| Frontend build | Vite | Replaced Webpack 5; faster dev server and simpler config |
| State management | Vuex 4 | Vuex 4 is backwards-compatible with Vuex 3 API |
| Icons | oh-vue-icons | Drop-in Vue 3 replacement for vue-awesome; same `name` prop API |
| File upload protocol | tus.io | Resumable uploads, built into upstream |
| Password hashing | @node-rs/argon2 | Admin credentials and share passwords |
| Container base | node:24-alpine | Small image; tzdata added for correct log timestamps |
| Visual design | archivists-instrument | From the private design-bible repo (`styles/archivists-instrument`); tokens and recipes live in `public/assets/styles.css` |

## Backend API

Mostly upstream, plus fork additions for the admin dashboard. All paths are relative to `baseUrl` (default `/`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/config.json` | Frontend config (retentions, limits, flags) |
| GET | `/lang.json` | Active locale strings |
| POST/PATCH/HEAD | `/files/...` | tus upload protocol: create bucket, upload chunks, resume. `PATCH /files/:sid?lock=yes` locks a bucket. Guarded by `x-passwd` when `uploadPass` is set |
| GET | `/:sid` | Download page |
| GET | `/:sid.json` | Bucket metadata and file list; share password checked via the `x-download-pass` header |
| GET | `/files/:sid++:key` | Download a single file; one-time files are removed afterwards |
| GET | `/files/:sid++:token.zip` | Download all as ZIP |
| GET | `/files/:sid++:token.tar.gz` | Download all as tar.gz |
| GET | `/admin` | Admin dashboard; redirects to login without a session |
| GET/POST | `/admin/login` | Login page and password login |
| GET | `/admin/oidc/login` | Redirect to the OIDC provider |
| GET | `/admin/oidc/callback` | OIDC code exchange, session creation |
| POST | `/admin/logout` | Destroy the admin session |
| GET | `/admin/auth-config.json` | Auth settings (secret write-only, plus runtime flags) |
| POST | `/admin/auth-config.json` | Save auth settings to oauth.json (OIDC changes need a restart) |
| GET | `/admin/data.json` | Admin bucket listing (session auth) |
| GET | `/admin/activity.json` | Activity events, newest first; `?limit=` up to 1000, default 200 (session auth) |
| GET | `/admin/audit.json` | Last 200 audit events (logins, settings changes, admin actions), newest first (session auth) |
| DELETE | `/admin/files/:sid` | Delete a whole share (session auth) |
| DELETE | `/admin/files/:sid/:key` | Delete a single file (session auth) |

Admin session auth: `/admin/data.json`, `/admin/activity.json`, `/admin/audit.json`, `/admin/auth-config.json`, and the DELETE routes share an `adminApi` middleware that 401s without `req.session.adminAuthenticated`.

## Tests

`npm test` runs everything under `tests/` via the built-in Node test runner; `npm run test:unit` and `npm run test:integration` scope it. `tests/e2e/` (BrowserStack) and `tests/smoke-admin.js` (manual auth smoke test against a running instance) are run by hand.
