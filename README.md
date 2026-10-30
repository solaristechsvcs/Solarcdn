# SolarCDN
Self-hosted CDN origin MVP (Node.js, MySQL, Wisp/Docker). This is an initial backend, not yet a distributed CDN.

## Setup
1. Install Node.js 20+ and MySQL 8. Run `npm install`.
2. Import `schema.sql` into the database.
3. Set database credentials, publicBaseUrl and a strong 32+ character JWT secret in `config.js`. Do not commit real credentials: use a private config.local.js or mounted secret file and import it from config.js.
4. Create the first account manually using a bcrypt password hash and an INSERT into the users table. No open registration endpoint exists.
5. Run `npm start`. Wisp: entrypoint `src/server.js`, bind 0.0.0.0, port via PORT. Persist `storage/` across deployments.

## API
- GET /health
- POST /api/auth/login — JSON email/password; returns bearer JWT
- POST /api/assets — authenticated multipart field file
- GET /api/assets — authenticated list of owned files
- GET /assets/:id — public asset delivery
- DELETE /api/assets/:id — authenticated delete of owned file

## Production gaps
Client-declared MIME types are not trustworthy; implement file-signature validation, malware scanning, per-user quotas, stronger upload throttling, audit logging, token revocation, dashboard, API keys, and Cloudflare cache configuration before public launch. Uploads currently use memory buffering, limited to 25 MiB. Local storage is single-origin, not distributed. The config includes placeholder secrets and must not be deployed unchanged.
