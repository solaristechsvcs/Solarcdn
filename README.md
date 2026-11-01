# SolarCDN

Node.js 22+, MySQL 8 and persistent local storage. GET / serves the administration dashboard. Only database accounts with role `admin` can log in or manage files. Files are public to anyone with their URL. This is a single-origin file server, not a distributed CDN.

## Configuration and first deployment

1. Run `npm ci`. Import `schema.sql` into your MySQL database (back up an existing database first). No schema changes are required for an existing installation.
2. Set these environment variables in the hosting panel or secret manager:

| Variable | Value |
| --- | --- |
| `JWT_SECRET` | Random secret, at least 32 characters; generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PUBLIC_BASE_URL` | `https://cdn.solaristechsvcs.com` |
| `DB_HOST`, `DB_PORT` | MySQL address and port (default 3306); a container's localhost is not the host machine |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Existing database name and private credentials |
| `PORT` | The port assigned by Wisp (default 3000) |
| `STORAGE_DIR` | Persistent writable storage path (default `./storage`) |
| `TRUST_PROXY` | Set to `1` only when exactly one trusted reverse proxy is between clients and Node, and direct access is blocked |

The server reads process environment variables. It does **not** automatically load a `.env` file when started with `npm start`. Docker Compose loads the ignored `.env` file and passes the declared variables. Old private `config.local.js` files are no longer imported: migrate their values to environment variables before restarting. The MySQL config now correctly uses `database`, not `name`.

3. Create an administrator if needed. On a trusted Linux shell, use the following to avoid recording the password in shell history or command arguments:

```sh
read -r -s -p 'New admin password: ' ADMIN_PASSWORD; echo
printf '%s\n' "$ADMIN_PASSWORD" | npm run create-admin -- admin@example.com
unset ADMIN_PASSWORD
```

Use a password of at least 12 characters and at most 72 UTF-8 bytes. The script inserts a new account with a bcrypt hash; it does not overwrite an existing user. Existing admin accounts continue working. To promote an existing account, an authorized database operator can run `UPDATE users SET role='admin' WHERE email='your-existing-email';`.

4. Run `npm run build` and `npm test`, then `npm start`. There is no frontend compilation step: the build command checks server and browser JavaScript syntax.

## Wisp deployment and restart

For a Wisp Node server, stop the application in its Console, back up MySQL and the persistent storage directory, then update the server files from this repository's `main` branch. In a Git checkout use `git pull --ff-only origin main`. Keep private credentials in hosting environment settings. Select a Node 22 runtime, install with `npm ci --omit=dev`, and set the application startup command to `npm start` (or `node src/server.js`) with the repository as the working directory. Configure the variables above and the assigned `PORT`. The application binds to `0.0.0.0`.

Preserve `storage/` across reinstall/update operations and ensure the runtime user can write it. Point the HTTPS reverse proxy for cdn.solaristechsvcs.com to the application's assigned port. Forward the original client address correctly if enabling `TRUST_PROXY`. Start/restart the **application server** from Console after updating code or environment. Restarting the Wisp daemon is not needed for application code changes. Exact panel labels depend on the installed Wisp version/egg.

If using the repository's Docker Compose on the host instead, create an ignored `.env` containing the variables, then run:

```sh
docker compose up -d --build solarcdn
docker compose logs --tail=100 solarcdn
```

Compose preserves the named storage volume. Never run `docker compose down -v` unless intentionally deleting stored files. MySQL is external to this Compose file. The image runs as the `node` user; mounted directories must be writable by it.

Verify `GET /health` returns JSON and `GET /` returns the SolarCDN login page. Log in, upload a supported image, copy/open its public URL, check usage, delete it, and sign out. If `Cannot GET /` persists, confirm the running checkout/container contains `public/index.html` and the new `src/app.js`, restart the application, check logs, and confirm the domain proxy points to this server rather than an older instance. Bypass/purge any cached root-page response at your proxy if necessary.

## Behavior and security

- HttpOnly, SameSite=Strict session cookie; Secure when PUBLIC_BASE_URL uses HTTPS; two-hour expiry. Browser mutations require a same-origin custom header. Tokens are not stored in browser local storage. Sign-out clears the browser cookie; a stolen token remains valid until expiry or JWT_SECRET rotation. Role checks consult the database on every authenticated request.
- Ten login attempts per IP per 15 minutes. Limits are in memory; use an edge rate limiter for multiple processes and persistency across restarts.
- Admin files are scoped to the signed-in owner. Pagination is 50 files; usage counts the complete owned library, not just the current page. No nonfunctional user-management or API-key controls are shown.
- Uploads are limited to 25 MiB, buffered in memory, with signature and declared MIME matching for PNG/JPEG/GIF/WebP/PDF. Signatures are a first filter, not full file decoding or malware scanning. Add scanning, quotas and edge request/concurrency limits before accepting untrusted uploads. Use a separate asset origin for broader untrusted content hosting.
- Public files have a restrictive sandbox CSP and nosniff. Deletion removes metadata and origin content; existing public caches can retain copies for up to one hour. Back up MySQL and storage together. Disk/database failures can leave orphaned disk files and should be monitored.
- Health is a process liveness check, not a database readiness check. Automated HTTP tests use an injected database double; validate actual MySQL connectivity in the deployed environment.

## Routes

`GET /`, `GET /health`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `GET /api/assets?page=1`, `POST /api/assets` (multipart `file`), `DELETE /api/assets/:id`, `GET /assets/:id` (public). Existing bearer authentication is accepted for valid signed tokens, but only admins can manage files; login now returns an HttpOnly cookie rather than a JSON bearer token.
