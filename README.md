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

## Discord sign-in and owner administration

Create an application in the Discord Developer Portal. Under OAuth2, register this exact redirect URL:

```text
https://cdn.solaristechsvcs.com/api/auth/discord/callback
```

Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and comma-separated `DISCORD_OWNER_IDS` in the hosting environment, and ensure `PUBLIC_BASE_URL` is `https://cdn.solaristechsvcs.com`. No bot token or bot invitation is required: sign-in requests only the `identify` scope. Keep the client secret private. Discord's OAuth documentation: https://docs.discord.com/developers/topics/oauth2.

Alternatively, enter the values directly in your private server copy of `config.js`:

```js
discord: {
 clientId: process.env.DISCORD_CLIENT_ID || '',
 clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
 ownerIds: ['YOUR_DISCORD_USER_ID', 'ANOTHER_OWNER_DISCORD_USER_ID']
},
```

Replace the owner placeholders with actual Discord user IDs, keeping the quotes. IDs are strings, never JavaScript numbers. Enable Developer Mode in Discord and use Copy User ID on the intended account. Do not commit your private client secret or server configuration.

Before starting the updated app, run `npm run migrate`. This creates two additional tables without modifying existing users or assets; the database account needs CREATE TABLE permission for this step. New installations still import `schema.sql` first. In Wisp with only a running-app console, temporarily use the startup command below (it is also safe on subsequent starts):

```sh
cd /home/container && npm ci --omit=dev && npm run migrate && node src/server.js
```

After migration you can restore `cd /home/container && node src/server.js`. If running Docker Compose, migrate with `docker compose run --rm solarcdn npm run migrate` before starting the updated container. Restart after changing configuration. Keep your existing database/JWT settings when updating your private config.js.

Configured owners sign in through **Continue with Discord** and see the **Administrators** section below the file manager. Enter another person's Discord user ID to grant access before their first sign-in. Revoke access in the same section. Only configured owners can manage these grants; password admins and delegated Discord admins cannot appoint admins or modify owners. Owner IDs are changed only in configuration, followed by an application restart. Removing a configured owner removes owner access; if that ID also has an explicit admin grant, it retains ordinary admin access until that grant is revoked.

Unapproved Discord accounts receive an access-denied message and are not provisioned. Approved accounts receive separate internal user records, preserving file ownership across sign-ins. They are never automatically linked to existing password accounts by email. Existing password accounts and their admin privileges are managed separately using the database procedure above. The owner section manages Discord access only.

OAuth state is short-lived, browser-bound and single-use. Discord tokens are exchanged on the server and are not returned to the browser or stored in the database. The local session lasts two hours, and every request checks current grants and owner configuration. Revoking a grant blocks an existing session on its next request; it does not delete uploaded files. OAuth state is in process memory: use a single Node process or sticky routing, and retry sign-in after a restart during authorization. Discord sign-in controls are hidden until both client ID and secret are configured. The tests mock Discord and MySQL; the real developer application and database migration must be verified on deployment.
