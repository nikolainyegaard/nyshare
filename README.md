# nyshare

Self-hosted, WeTransfer-style ephemeral file sharing. A personal fork of [PsiTransfer](https://github.com/psi-4ward/psitransfer).

Drop files on the page, get a short share link, send it. Files expire on a schedule or after a single download.

## Features

- Resumable uploads (tus.io), drag and drop, per-file comments and live upload speed
- Short unambiguous share links (7 chars, no 0/o or 1/i/l lookalikes)
- Retention from 1 hour to 8 weeks, plus one-time downloads
- Optional password protection per share
- Download all as zip or tar.gz; QR code, mailto and copy buttons for sharing
- Admin dashboard at `/admin`: storage stats, active shares with uploader IPs and download counts, per-file and per-share delete and download, live activity feed
- Admin login via username/password and/or any OpenID Connect provider
- Dark UI, image previews, text file previews

## Setup

Create a folder on your server with a `docker-compose.yml` (see the one in this repo). Minimal version:

```yaml
services:
  nyshare:
    image: ghcr.io/nikolainyegaard/nyshare:latest
    container_name: nyshare
    environment:
      - PSITRANSFER_TRUST_PROXY=uniquelocal
      - TZ=Europe/Oslo
    volumes:
      - ./data:/data
    networks:
      - proxy-fileshare
    restart: unless-stopped

networks:
  proxy-fileshare:
    external: true
```

The `./data` volume must be writable by UID 1000. Caddy (on the same Docker network) proxies to the container:

```caddy
nyshare.yourdomain.com {
    reverse_proxy nyshare:3000
}
```

Then `docker compose up -d`.

## Admin panel

Lives at `/admin`. It shows storage and download stats, every active share (created, expiry, size, uploader IP, download counts, password and one-time badges), and a recent activity feed of uploads, downloads, expiries and deletions with client IPs. Shares and single files can be deleted or downloaded from the panel.

### Signing in

Two login methods, either or both, managed in the admin panel's Authentication section:

- **Username/password**: credentials are generated on first launch and printed to the container output (`docker logs nyshare`). Sign in with them and set your own password when prompted. Username and password changes apply immediately.
- **OpenID Connect**: discovery URL, client ID and client secret, stored in `data/oauth.json`. Works with any OIDC provider (Authentik, Keycloak, Pocket ID, and others). Register the redirect URL `https://your-domain/admin/oidc/callback` with the provider (shown live in the settings when the external URL is set). Changes apply after restarting the container.

At least one method must stay enabled; disabling password login requires OIDC to be enabled and already running. Session lifetime is set in the Authentication section (default 7 days).

**Locked out?** Set `AUTH_RESET=1` in the environment and restart: OIDC is disabled and fresh admin credentials are printed to the container output. Sign in, fix the settings, then remove the variable.

Client IPs in the dashboard and activity log require `PSITRANSFER_TRUST_PROXY=uniquelocal` (or another [Express trust proxy value](https://expressjs.com/en/guide/behind-proxies.html)) so the app trusts the reverse proxy's forwarded headers.

## Data directory

```
./data/
  <share-id>/            # One directory per share: files plus their .json metadata
  .secret_key            # Session signing key; created automatically
  .activity.jsonl        # Admin activity log, capped at 1000 events
  oauth.json             # OIDC login settings; created on first save from the admin panel
```

## Configuration

Environment variables in `docker-compose.yml`:

| Variable | Default | Description |
|---|---|---|
| `PSITRANSFER_UPLOAD_DIR` | `/data` | Upload storage path inside the container. |
| `AUTH_RESET` | unset | Set to `1` and restart to disable OIDC and regenerate admin credentials (printed to the container output). Remove after signing in. |
| `PSITRANSFER_UPLOAD_PASS` | unset | Password required to upload; restricts public uploads. |
| `PSITRANSFER_TRUST_PROXY` | unset | Express trust proxy value; use `uniquelocal` behind a reverse proxy on a private Docker network. |
| `SECRET_KEY` | auto | Session signing key; generated once into `data/.secret_key` if unset. |
| `TZ` | `UTC` | Container timezone for log timestamps, e.g. `Europe/Oslo`. |

Full config options are in `config.js` and documented in `docs/configuration.md`.

## Local development

Requires Node.js 24+.

```bash
npm install && npm run dev
```

In a second terminal:

```bash
cd app && npm install && npm run dev
```

Open `http://localhost:5173` (Vite dev server, proxies to the backend on port 3000).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

BSD-2-Clause, same as upstream PsiTransfer.
