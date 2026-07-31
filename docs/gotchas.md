# Decisions and gotchas

Fork-specific divergences from upstream PsiTransfer, plus workarounds that look wrong until you know why.

## Fork maintenance

Upstream changes from `psi-4ward/psitransfer` must be reviewed and cherry-picked manually. Do not blindly `git merge upstream/master`. The upstream `.github/workflows/` files are not used; they reference the original author's GHCR and Docker Hub accounts and can be deleted or replaced.

## Admin auth: unified with multi-downloader

The admin auth stack is deliberately identical to multi-downloader's admin: the routes (`admin/login`, `admin/oidc/login`, `admin/oidc/callback`, `admin/logout`), the oauth.json schema (`enabled`, `discovery_url`, `client_id`, `client_secret`, `session_lifetime_days`, `external_url`, `password_login`, `admin_username`, `admin_password_hash`, `must_change_password`), the Authentication settings UI semantics (secret write-only, restart-required banner, `AUTH_RESET=1` as the lockout hatch, generated first-launch credentials printed to the container output, at-least-one-method validation, password login only disableable while OIDC is running), the enable rule (at least one usable method), and the login page layout. Change one, change both.

OIDC is configured from the admin panel and stored in `oauth.json` in the upload dir; `lib/oidc.js` reads it once at startup, so a restart applies changes. The flow is hand-rolled on global fetch (discovery, PKCE S256, state check; no new dependency), ported from social-downloader's authlib implementation. The ID token signature is not re-verified: it arrives over the client-authenticated token-endpoint TLS channel. IdP front-channel logout was dropped on purpose.

The upstream `adminPass` key in config.js is dead: nothing reads it anymore, admin access is oauth.json-based.

## Activity log

Admin activity events (upload, download, archive, expired, deleted, each with client IP) are appended to `.activity.jsonl` in the upload dir, capped to the newest 1000 entries at startup (`lib/activityLog.js`). Events flow through the existing eventBus; a new event type just needs an `eventBus.on` subscription in `lib/endpoints.js` and a verb/icon entry in `Admin.vue`.

## Client IPs behind Caddy

`req.ip` is the Docker network address unless `PSITRANSFER_TRUST_PROXY` is set. The value is passed to Express `trust proxy` as a string, so use proxy-addr values like `uniquelocal` (private subnets, set in docker-compose.yml), not `1` or `true`.

## Bucket lock metadata key: `buckedLocked`

The lock flag is stored as `buckedLocked` (upstream misspelling of "bucketLocked") in each file's `.json` metadata on disk. Do not rename it; existing stored files would silently lose their lock. Both `lib/db.js` and the resume check in `lib/endpoints.js` read this exact key.

## SID alphabet

Share link IDs use a custom 30-char alphabet (`abcdefghjkmnpqrstvwxyz23456789`) rather than hex, to avoid visually ambiguous characters (0/o, 1/i/l). Generated in `app/src/Upload/store/upload.js`. Server-side validation (`lib/utils.js` `isSafeBucketFid`) does not restrict the character set beyond safe-basename checks, so no server change was needed.

## Vue 3 migration

Upgraded from Vue 2 + Webpack to Vue 3 + Vite. What that changed:

- Vue filters were removed in Vue 3; the date formatting the Admin page used them for is now a component method in Admin.vue
- The `$root` pattern still works: all components access translations via `this.$root.lang` and config state via `this.$root.configFetched`, since `$root` refers to the root component instance
- `Vue.set()` and `this.$set()` are gone; Vue 3 makes all objects reactive via Proxy, so direct assignment (`this.obj[key] = val`) is reactive
- Icon names follow the `oh-vue-icons` convention: solid icons prefixed `fa-` (`name="fa-check"`), regular icons prefixed `fa-reg-` (`name="fa-reg-file"`). Registration happens in `app/src/icons.js`
- vue-awesome's `spin=""` / `:spin="true"` becomes `animation="spin"` in oh-vue-icons
- The deprecated `slot="name"` attribute is replaced with `v-slot:name` on `<template>` (affects PreviewModal.vue)

## `:disabled` on `<a>` elements

Vue 3 only treats `disabled` as a boolean attribute on form elements. On `<a>` tags, `:disabled="false"` sets the attribute to the string `"false"` rather than removing it. The CSS rule uses `[disabled="true"]` (not `[disabled]`) so it only applies when the value is explicitly true.

## Frontend build output and lock file

`public/app/` is gitignored; the Docker build always compiles it fresh. For local backend dev (`npm run dev`), either run `cd app && npm run dev` for the proxied Vite dev server, or run `cd app && npm run build` first.

After changing `app/package.json`, run `cd app && npm install` to regenerate `app/package-lock.json` before building the Docker image; the Dockerfile uses `npm ci`.

## Known constraints

- No end-to-end payload encryption (upstream limitation)
- "Download all as ZIP" does not support resuming
