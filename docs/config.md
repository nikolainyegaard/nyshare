# Configuration, data layout, Docker, Caddy

This covers the fork's deployment. The generic config mechanism (config.`<NODE_ENV>`.js files, `PSITRANSFER_*` overrides for every `config.js` key, SSL, webhooks) is upstream behavior, documented in [configuration.md](configuration.md). [deployment-docker.md](deployment-docker.md) and [deployment-systemd.md](deployment-systemd.md) describe upstream's own image and packaging; the fork deploys with the compose file below.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PSITRANSFER_UPLOAD_DIR` | `/data` | Upload storage path (set in the Dockerfile) |
| `PSITRANSFER_UPLOAD_PASS` | unset | Password required to upload; restricts public uploads |
| `PSITRANSFER_TRUST_PROXY` | unset | Express trust proxy value; `uniquelocal` behind a reverse proxy on a private Docker network (set in docker-compose.yml) |
| `AUTH_RESET` | unset | Set to `1` and restart: disables OIDC, regenerates admin credentials and prints them to the container output. Remove after signing in |
| `SECRET_KEY` | auto | Session signing key; generated once into `data/.secret_key` if unset |
| `TZ` | `UTC` | Timezone for log timestamps, e.g. `Europe/Oslo` |
| `NODE_ENV` | `production` | Set in the Dockerfile; controls Express behavior and which config.`<NODE_ENV>`.js loads |

Every other `config.js` key is overridable the same way (`PSITRANSFER_PORT`, `PSITRANSFER_RETENTIONS`, ...); see [configuration.md](configuration.md).

## Data directory

`./data` on the host, `/data` in the container:

```
data/
  <share-id>/         one directory per share: files plus their .json metadata
  .secret_key         session signing key, created automatically
  .activity.jsonl     admin activity log, capped at 1000 events
  .audit.jsonl        admin audit log (logins, settings changes, admin actions), capped at 1000 events
  oauth.json          admin auth settings, created on first save from the admin panel
```

## Docker and GHCR

**Image:** `ghcr.io/nikolainyegaard/nyshare`. **Base:** `node:24-alpine`. **Port:** 3000, internal only; Caddy terminates TLS.

Build steps (Dockerfile):
- Copies source into `/app`
- Installs frontend deps (`NODE_ENV=dev npm ci`) and runs the Vite build; output lands in `public/app/`
- Removes the `app/` source directory from the image, then installs backend deps (`npm ci`)
- `ARG BUILD_VERSION=dev` / `ENV BUILD_VERSION=${BUILD_VERSION}`; buildx commands pass the real version
- `entrypoint.sh` runs as root, chowns `/data` to the `node` user, then `exec`s the app as `node` via su-exec; host permissions on `./data` do not need manual fixing

Volume: `./data:/data` (all shares and admin state; back this up).

## Reverse proxy (Caddy)

The container joins the external Docker network `proxy-fileshare` with no published ports; Caddy runs in a container on the same network and proxies by container name:

```caddy
nyshare.yourdomain.com {
    reverse_proxy nyshare:3000
}
```

Client IPs in the admin dashboard and activity log require `PSITRANSFER_TRUST_PROXY` (see [gotchas.md](gotchas.md)).
