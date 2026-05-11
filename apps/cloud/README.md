# @objectstack/cloud

Cloud-mode host for ObjectStack — multi-project, control-plane connected,
deployed as a Vercel serverless function.

This app is the cloud counterpart to [`@objectstack/objectos`](../objectos),
which hosts local single-project / standalone deployments.

## Modes

This config is **cloud-only**. Boot orchestration lives in
`@objectstack/service-cloud`; this package only supplies the
cloud-specific knobs:

- **`templates`** — Studio's template registry (Blank / CRM / Todo).
- **`appBundles`** — filesystem-backed app bundle resolver.

Set `OS_MODE=cloud` (default for this app) to boot the
multi-project plugin stack.

## Local development

```bash
# From repo root
pnpm install
pnpm --filter @objectstack/cloud dev
```

## Build

```bash
pnpm --filter @objectstack/cloud build
```

Produces `dist/objectstack.config.js`, consumed by
`objectstack serve --prebuilt`.

## Vercel deployment

`vercel.json` and `scripts/build-vercel.sh` mirror the apps/objectos
deployment recipe — bundle `server/index.ts` with esbuild, copy Studio +
Account SPAs into `public/`, and ship `api/[[...route]].js` as the
catch-all serverless function.

## Cloudflare Containers deployment

`apps/cloud` runs the multi-project control plane as a long-lived Node.js
process (Hono + better-sqlite3 + `child_process`) and is **not**
Workers-compatible. It can, however, run on **Cloudflare Containers**
(GA 2025) using the bundled `Dockerfile`.

Files:

- `Dockerfile` — production image (Node 22, port 4000).
- `.dockerignore` — slims the workspace tree shipped to the builder.
- `wrangler.toml` — Worker + Container binding.
- `cloudflare/worker.ts` — fetch handler that proxies HTTP into the
  `CloudContainer` Durable Object.
- `scripts/deploy-cloudflare.sh` — `build → push → deploy` pipeline.
- `scripts/setup-cloudflare-secrets.sh` — bulk `wrangler secret put` from
  a local env file.

### Quickstart (automated)

```bash
# One-time setup
npx wrangler login
cp apps/cloud/.env.cloudflare.example          apps/cloud/.env.cloudflare
cp apps/cloud/.env.cloudflare.secrets.example  apps/cloud/.env.cloudflare.secrets
# Fill in CF_ACCOUNT_ID + secrets (see comments inside each file)

# Push secrets (once, or any time they change)
pnpm --filter @objectstack/cloud cf:secrets

# Build → push → deploy
pnpm --filter @objectstack/cloud cf:deploy

# Live tail
pnpm --filter @objectstack/cloud cf:tail
```

Useful flags on `cf:deploy`: `--tag <name>`, `--skip-build`, `--skip-push`,
`--dry-run`.

### Manual (if you don't want the script)

```bash
# Build from repo root (Dockerfile expects the full pnpm workspace)
docker buildx build --platform linux/amd64 \
  -f apps/cloud/Dockerfile \
  -t registry.cloudflare.com/<account-id>/objectstack-cloud:latest .

wrangler containers push \
  registry.cloudflare.com/<account-id>/objectstack-cloud:latest

# Secrets — the control plane MUST be on a remote database. The container
# filesystem is wiped on cold-start, so file:/... will lose all data.
# For production, Postgres is recommended:
#   postgres://user:pass@host:5432/db
# libSQL/Turso also works:
#   libsql://<db>.turso.io  +  OS_DATABASE_AUTH_TOKEN
wrangler secret put OS_DATABASE_URL        --config apps/cloud/wrangler.toml
wrangler secret put OS_DATABASE_AUTH_TOKEN --config apps/cloud/wrangler.toml   # libSQL only
wrangler secret put AUTH_SECRET            --config apps/cloud/wrangler.toml
wrangler secret put TURSO_API_TOKEN        --config apps/cloud/wrangler.toml
wrangler secret put TURSO_ORG_NAME         --config apps/cloud/wrangler.toml

wrangler deploy --config apps/cloud/wrangler.toml
```

Required runtime env vars (set as Cloudflare secrets, **not** in
`wrangler.toml`):

| Var | Purpose |
|---|---|
| `OS_DATABASE_URL` | Control-plane DB URL. Supports `postgres://…`, `postgresql://…`, `libsql://…`, `https://…` (Turso), or `file:/…` (local Docker only). |
| `OS_CONTROL_DATABASE_URL` | Optional override for the control DB when it differs from `OS_DATABASE_URL`. Takes priority when both are set. |
| `OS_DATABASE_AUTH_TOKEN` | Auth token for libSQL/Turso. Unused for Postgres (put the password in the URL). |
| `OS_CONTROL_PG_POOL_MIN` / `OS_CONTROL_PG_POOL_MAX` | Postgres pool sizing (default `0` / `10`). |
| `AUTH_SECRET` | Cookie/session signing secret. |
| `TURSO_API_TOKEN` / `TURSO_ORG_NAME` | Used by the provisioning workflow to create per-project Turso DBs. |

### Postgres in production

`apps/cloud` ships with the `pg` driver included. To run the control plane
on Postgres (Neon / Supabase / RDS / Cloudflare Hyperdrive / self-hosted):

```bash
export OS_DATABASE_URL='postgres://user:pass@host:5432/objectstack_cloud'
# Optional fine-tuning:
export OS_CONTROL_PG_POOL_MAX=20
```

Schema migrations are applied automatically on first boot by the
`@objectstack/driver-sql` engine using knex. The cloud control plane
expects a database it can DDL freely — point it at a dedicated database
(not one shared with unrelated tables).

> **Hyperdrive note**: Cloudflare Hyperdrive accelerates Postgres
> connections from Workers, not Containers. For Containers, point
> `OS_DATABASE_URL` directly at your Postgres instance.

Pair this with an `apps/objectos` deployment (see its README) and set
`OS_CLOUD_URL=https://<cloud-worker>.<account>.workers.dev` on the
runtime node so it talks to this control plane.
