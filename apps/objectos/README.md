# ObjectOS

ObjectOS is the ObjectStack runtime — a metadata-driven backend that loads object definitions from app bundles and auto-generates REST APIs. This directory is the reference host configuration for running ObjectOS.

## Run Modes

ObjectOS supports four run modes, controlled by the `OS_CLOUD_URL` environment variable.

### 1. Local (Default)

Single-project, fully self-contained. No control plane, no network dependency. Data is stored in a local SQLite file at `.objectstack/data/app.db`.

```bash
pnpm dev
# Server → http://localhost:3000
# DB     → .objectstack/data/app.db (auto-created)
```

Best for: local development, quick prototyping, CI.

#### Serving a compiled app bundle locally

Point ObjectOS at a third-party app bundle compiled by `objectstack build` (e.g. `examples/app-crm`). The bundle is a JSON file plus a sibling `objectstack-runtime.<hash>.mjs` that carries the compiled hook handlers; both are loaded automatically.

> **Tip:** for a pure single-bundle host you do **not** need `apps/objectos` at all
> — just run `objectstack start` from any directory that contains a
> `dist/objectstack.json` (or set `OS_ARTIFACT_PATH` to a file path or
> `https://` URL). The framework now ships the standalone host as
> `createDefaultHostConfig()` in `@objectstack/runtime`. Use `apps/objectos`
> when you need cloud / multi-project / control-plane features on top.

```bash
# Build the example app once
pnpm --filter @objectstack/app-crm build

# Boot ObjectOS pointing at the bundle
cd apps/objectos
OS_ARTIFACT_PATH=$PWD/../../examples/app-crm/dist/objectstack.json \
  PORT=3000 pnpm start

# All three URL shapes resolve to the same project kernel:
curl -X POST http://localhost:3000/api/v1/data/account \
  -H 'Content-Type: application/json' \
  -d '{"name":"Acme","website":"bogus"}'
# → 400 Website must start with http:// or https://  (CRM hook fired)

curl -X POST http://localhost:3000/api/v1/projects/proj_local/data/account \
  -H 'Content-Type: application/json' \
  -d '{"name":"Acme","website":"https://acme.com","account_number":"abc-9"}'
# → 200 with record.account_number === "ABC-9"  (uppercase hook fired)
```

The bare `/api/v1/data/...` URL is routed to the default project (`proj_local`) by `createSingleProjectPlugin`. Tables are auto-created by the SQL driver on first access; the bundle's seed data (e.g. `Acme Corporation`) is upserted on boot.

#### Hosting multiple compiled bundles

Two bundles can share a single ObjectOS host. Each bundle gets its own
project kernel; isolation is enforced at the kernel boundary (separate
SQLite file per project, separate object registry, separate hooks).

There are three binding mechanisms, evaluated in this order at request
time (first hit wins):

| Priority | Source | Scope | Best for |
|:---|:---|:---|:---|
| 1 | `OS_PROJECT_ARTIFACTS` env | per-project, ephemeral | Local dev, CI |
| 2 | `sys_project.metadata.artifact_path` (DB row) | per-project, persisted | Production, control-plane managed |
| 3 | `OS_ARTIFACT_PATH` env | shared default for unbound projects | Single-bundle hosts |

**Mode 1 — env-driven (recommended for local multi-bundle):**

```bash
# Build both bundles once
pnpm --filter @objectstack/app-crm build
pnpm --filter @example/app-todo build

cd apps/objectos
OS_PROJECT_ARTIFACTS="proj_crm:$PWD/../../examples/app-crm/dist/objectstack.json,proj_todo:$PWD/../../examples/app-todo/dist/objectstack.json" \
  PORT=3000 pnpm start

# Address each project explicitly via scoped URL
curl -X POST http://localhost:3000/api/v1/projects/proj_crm/data/account \
  -H 'Content-Type: application/json' \
  -d '{"name":"Acme","website":"https://acme.com","account_number":"abc-9"}'

curl -X POST http://localhost:3000/api/v1/projects/proj_todo/data/todo_task \
  -H 'Content-Type: application/json' \
  -d '{"title":"Buy Milk","priority":"high"}'

# Or use the X-Project-Id header on a bare URL — equivalent
curl -X POST http://localhost:3000/api/v1/data/account \
  -H 'X-Project-Id: proj_crm' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Beta","website":"https://beta.io"}'
```

**Mode 2 — DB-persisted (recommended for production):**

```bash
# Bind once via CLI; the path is stored in sys_project.metadata.artifact_path
pnpm exec objectstack projects bind proj_crm \
  $PWD/examples/app-crm/dist/objectstack.json

# Subsequent boots load the binding from the control plane DB
pnpm --filter @objectstack/objectos start
```

**Routing rules:**

- A scoped URL `/api/v1/projects/<id>/...` always targets the named
  project (assuming it's bound).
- A bare URL `/api/v1/data/...` resolves a project via this chain:
  hostname → `X-Project-Id` header → `defaultProjectId` (set by
  `createSingleProjectPlugin` in single-project mode). Multi-bundle
  hosts should not rely on the default fallback — always specify the
  project via URL or header.
- `OS_ARTIFACT_PATH` is **only** the default fallback for projects with
  no other binding. In multi-bundle mode, leave it unset so each
  project picks up its own bundle from `OS_PROJECT_ARTIFACTS` or DB.

---

### 2. Local + External Control Plane

ObjectOS runtime connects to a locally-running `apps/cloud` instance as the control plane. Studio shows the full org / project / branch picker.

```bash
# Terminal 1 — start the control plane
pnpm --filter @objectstack/cloud dev

# Terminal 2 — start ObjectOS, pointing at local cloud
OS_CLOUD_URL=http://localhost:4000 pnpm dev
```

Best for: end-to-end multi-project development.

---

### 3. Cloud (Hosted Control Plane)

ObjectOS runtime connects to the hosted ObjectStack Cloud control plane. Projects, credentials, and artifact resolution are all managed remotely.

```bash
OS_CLOUD_URL=https://cloud.objectstack.ai \
OS_CLOUD_API_KEY=osk_... \
pnpm dev
```

Best for: production deployments, staging environments.

---

### 4. Preview / Demo Mode

Bypass login entirely — the runtime auto-simulates an admin session. Designed for demos and marketplace previews. **Never use in production.**

```bash
OS_MODE=preview pnpm dev
```

Behavior:
- Login / registration pages are hidden
- Admin session is created automatically
- A preview banner is shown in the UI

---

## Environment Variables

### Runtime

| Variable | Default | Description |
|:---|:---|:---|
| `OS_CLOUD_URL` | `local` | `local` = standalone; URL = connect to that control plane |
| `OS_CLOUD_API_KEY` | — | API key when connecting to a remote control plane |
| `OS_ARTIFACT_PATH` | `dist/objectstack.json` | Path to the compiled app artifact (single-bundle default) |
| `OS_PROJECT_ARTIFACTS` | — | Comma list of `<projectId>:<path>` pairs for multi-bundle hosting |
| `OS_MODE` | — | `standalone` (default), `runtime`, `cloud`, or `preview` |

### Database (Local / Standalone mode)

ObjectOS in single-project local mode uses **two** databases:

| DB | Purpose | Env var | Default |
|:---|:---|:---|:---|
| **Project DB** | Your business data (records served at `/api/v1/data/*`) | `OS_DATABASE_URL` / `OS_DATABASE_DRIVER` | local SQLite at `.objectstack/data/proj_local.db` |
| **Control DB** | Framework bookkeeping (`sys_organization`, `sys_project`, `sys_user`, …) | `OS_CONTROL_DATABASE_URL` | local SQLite at `.objectstack/data/control.db` |

Other variables:

| Variable | Default | Description |
|:---|:---|:---|
| `OS_DATABASE_AUTH_TOKEN` | — | Auth token for libSQL / Turso |
| `OS_DATABASE_DRIVER` | inferred from URL scheme | Explicit override: `mongodb`, `postgres`, `mysql`, `sqlite`, `turso`, `memory` |

The driver is **inferred from the URL scheme** of `OS_DATABASE_URL`
(and `OS_CONTROL_DATABASE_URL`). You almost never need to set
`OS_DATABASE_DRIVER` explicitly.

| `OS_DATABASE_URL` value | Driver |
|:---|:---|
| unset | SQLite — `.objectstack/data/proj_local.db` |
| `file:<path>` / `<path>.db` / `<path>.sqlite` | SQLite at that path |
| `:memory:` | SQLite in-memory |
| `mongodb://…` / `mongodb+srv://…` | **MongoDB** (`@objectstack/driver-mongodb`) |
| `postgres://…` / `postgresql://…` | PostgreSQL (`@objectstack/driver-sql`) |
| `mysql://…` / `mysql2://…` | MySQL (`@objectstack/driver-sql`) |
| `libsql://…` / `https://*.turso.…` | libSQL / Turso (`@objectstack/driver-turso`) |

Examples:

```bash
# Project DB on MongoDB (control DB stays on local SQLite)
OS_DATABASE_URL=mongodb://localhost:27017/objectos pnpm dev

# Project DB on Postgres
OS_DATABASE_URL=postgres://user:pass@host:5432/myapp pnpm dev

# Pin both DBs explicitly (Postgres for project, Turso for control plane)
OS_DATABASE_URL=postgres://user:pass@host/myapp \
OS_CONTROL_DATABASE_URL=libsql://control.turso.io \
OS_DATABASE_AUTH_TOKEN=$TURSO_TOKEN \
pnpm dev
```

For backward compatibility, `OS_DATABASE_URL` is also accepted as a
fallback for the control DB when neither `OS_CONTROL_DATABASE_URL` nor
an explicit programmatic value is set.

### Kernel Tuning

| Variable | Default | Description |
|:---|:---|:---|
| `OS_KERNEL_CACHE_SIZE` | `32` | LRU size for per-project kernel instances |
| `OS_KERNEL_TTL_MS` | `900000` | Idle eviction TTL (ms) |
| `AUTH_SECRET` | — | Better Auth session secret (≥ 32 chars, required in production) |

---

## Quick Start

```bash
# Install workspace dependencies (run once from repo root)
corepack enable && pnpm install

# Start in local mode (default)
pnpm dev

# Start with Turso as the control-plane database
OS_DATABASE_URL=libsql://your-db.turso.io \
OS_DATABASE_AUTH_TOKEN=your-token \
AUTH_SECRET=$(openssl rand -hex 32) \
pnpm dev
```

---

## Build & Deploy

```bash
# Build the compiled artifact
pnpm build

# Serve the pre-built artifact (production)
pnpm start
```

### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/objectstack-ai/framework/tree/main/apps/objectos&project-name=objectos&repository-name=objectos)

The `api/` directory contains the Vercel serverless handler. Set the environment variables above in the Vercel project settings.

---

## API

### Metadata

```bash
# List all loaded objects
curl http://localhost:3000/api/v1/meta/objects
```

### Data (CRUD)

```bash
# Create
curl -X POST http://localhost:3000/api/v1/data/todo_task \
  -H "Content-Type: application/json" \
  -d '{"title": "Buy Milk", "priority": "high"}'

# List
curl http://localhost:3000/api/v1/data/todo_task

# Get one
curl http://localhost:3000/api/v1/data/todo_task/<id>

# Update
curl -X PATCH http://localhost:3000/api/v1/data/todo_task/<id> \
  -H "Content-Type: application/json" \
  -d '{"priority": "low"}'

# Delete
curl -X DELETE http://localhost:3000/api/v1/data/todo_task/<id>
```

---

## Production-shape verification (cloud + hostname routing)

The full production deployment shape — `apps/cloud` as the control plane,
`apps/objectos` as a runtime node, vanity hostnames routed by
`EnvironmentRegistry.resolveByHostname` to per-project kernels — is
covered end-to-end by an in-process test that exercises the same code
paths a 2-process deployment would (the only difference is HTTP vs
in-memory transport between the registry and the control-plane SQL
driver).

```bash
# from repo root
pnpm --filter @objectstack/cloud build
pnpm --filter @objectstack/cloud test:production-flow
```

What it verifies (6 steps, all in one process):

1. Boot `apps/cloud` in `OS_MODE=cloud` (control plane + runtime node).
2. Seed an organization via the control-plane `objectql` engine.
3. `GET /api/v1/cloud/templates` returns `crm` in the catalog.
4. `POST /api/v1/cloud/projects` with `template_id=crm` + `hostname=<vanity>`
   provisions a project. The provisioning workflow:
   1. Create the project SQLite file (or Turso DB).
   2. Persist `database_url` so kernel-factory can resolve the DB.
   3. Run the template seeder — registers metadata, binds hooks,
      `initObjects` to create physical tables, loads seed data.
   4. Flip `status` to `active` (so `waitForActive` clients only see
      the project as ready *after* schema + seed data are queryable).
5. `POST /api/v1/data/account` with `Host: <vanity>` and `website: bogus`
   → routed to the project kernel by hostname → CRM hook returns
   `400 Website must start with http:// or https://`.
6. `POST /api/v1/data/account` with a valid payload → 2xx, and the
   `account_number` is uppercased by the `account_protection` hook;
   subsequent `GET /api/v1/data/account` returns the row through the
   same hostname-routed kernel.

For a true 2-process verification, run `apps/cloud` and `apps/objectos`
on separate ports with `OS_CLOUD_URL=http://<cloud-host>:<port>` on the
runtime node. Browser users add `127.0.0.1 crm.localhost` to `/etc/hosts`
and visit `http://crm.localhost:<runtime-port>/`. The framework code
paths exercised are identical to the in-process test above.

## Cloudflare Containers deployment

ObjectOS runs as a long-lived Node.js process and is **not** Workers-compatible
(better-sqlite3 native bindings, `node:fs`, `node:child_process`). It can,
however, run on **Cloudflare Containers** (GA 2025) using the existing
`Dockerfile`.

Files:

- `Dockerfile` — production image (Node 22, port 3000).
- `wrangler.toml` — Worker + Container binding.
- `cloudflare/worker.ts` — fetch handler that proxies HTTP into the
  `ObjectOSContainer` Durable Object.
- `scripts/deploy-cloudflare.sh` — `build → push → deploy` pipeline.
- `scripts/setup-cloudflare-secrets.sh` — bulk `wrangler secret put` from
  a local env file.

### Quickstart (automated)

```bash
# One-time setup
npx wrangler login
cp apps/objectos/.env.cloudflare.example          apps/objectos/.env.cloudflare
cp apps/objectos/.env.cloudflare.secrets.example  apps/objectos/.env.cloudflare.secrets
# Fill in CF_ACCOUNT_ID + secrets (see comments inside each file)

# Push secrets (once, or any time they change)
pnpm --filter @objectstack/objectos cf:secrets

# Build → push → deploy (run as often as you ship)
pnpm --filter @objectstack/objectos cf:deploy

# Live tail
pnpm --filter @objectstack/objectos cf:tail
```

Useful flags on `cf:deploy`:

| Flag | Effect |
|---|---|
| `--tag v2` | Override image tag (default = current git short SHA). |
| `--skip-build` | Reuse the last-built image (just push + deploy). |
| `--skip-push` | Already pushed; just deploy current `wrangler.toml`. |
| `--dry-run` | Print every step without executing it. |

### Manual (if you don't want the script)

```bash
# Build from repo root (Dockerfile expects the full pnpm workspace)
docker buildx build --platform linux/amd64 \
  -f apps/objectos/Dockerfile \
  -t registry.cloudflare.com/<account-id>/objectos:latest .

wrangler containers push registry.cloudflare.com/<account-id>/objectos:latest

# Push secrets — control plane MUST point at remote libSQL/Turso, the
# container filesystem is wiped on cold-start.
wrangler secret put OS_DATABASE_URL --config apps/objectos/wrangler.toml
wrangler secret put OS_DATABASE_AUTH_TOKEN --config apps/objectos/wrangler.toml
wrangler secret put AUTH_SECRET --config apps/objectos/wrangler.toml

wrangler deploy --config apps/objectos/wrangler.toml
```

Required runtime env vars (set as Cloudflare secrets, not in `wrangler.toml`):

| Var | Purpose |
|---|---|
| `OS_DATABASE_URL` | `libsql://<db>.turso.io` — control DB. Do **not** use `file:/data/...` on Containers; the local disk is wiped on cold-start. |
| `OS_DATABASE_AUTH_TOKEN` | Turso auth token. |
| `AUTH_SECRET` | Cookie/session signing secret. |
| `OS_CLOUD_URL` *(optional)* | Point at an `apps/cloud` deployment for multi-project mode. Omit for single-project local mode. |

## Default per-project plugin slate

ObjectOS keeps the **host kernel intentionally bare** (stateless
routing shell). All tenant-data plugins live on **per-project kernels**,
mounted on first-hit and cached by `ArtifactKernelFactory` /
`DefaultProjectKernelFactory`.

Every per-project kernel automatically gets the following default
plugins (in this order) via `mountDefaultProjectPlugins()`:

1. `QueueServicePlugin` (in-memory)
2. `JobServicePlugin`
3. `CacheServicePlugin` (in-memory)
4. `SettingsServicePlugin` — `sys_setting` / `sys_secret` /
   `sys_setting_audit` rows live in the **project's own driver**, so
   tenants are fully isolated
5. `EmailServicePlugin` — each tenant configures its own provider /
   api_key via Settings; api_key is stored encrypted in `sys_secret`
6. `StorageServicePlugin` — see below. Adapter + credentials are
   live-configurable per tenant via the `storage` Settings namespace;
   the plugin swaps the inner adapter on every change.

### Storage adapter selection

- `OS_STORAGE_ADAPTER=s3` + `OS_S3_*` env → shared S3 bucket with
  `pathStylePrefix: projects/<projectId>` so tenant prefixes never
  collide. Per-project Settings can still override the bucket /
  credentials at runtime.
- otherwise → local driver under
  `<dataRoot>/projects/<projectId>/uploads/`; a single boot warning
  fires in non-dev mode.

Tenant admins can switch adapter from the Settings hub
(`namespace=storage`) — the `SwappableStorageService` proxy rebuilds
the inner adapter without restarting the kernel. ⚠ Existing files are
**not** migrated; a warning is logged on every swap. The
`storage/test` action uploads → reads → deletes a probe blob to
validate the new configuration before users start uploading.

### Ops overrides

The factory accepts `basePluginsExtra({ projectId, kernel })` which can
return `{ caps?: {…: false}, extraPlugins?: [...] }` to:

- inject a **shared Redis-backed queue** so retries survive kernel
  eviction (set `caps.queue=false` and push your custom plugin in
  `extraPlugins`)
- skip storage when the host worker mounts a shared S3 instance
  out-of-band
- mount tenant-specific audit/automation/analytics plugins

### Caveats

- **In-memory queue eviction** — when a per-project kernel is LRU-
  evicted, queued retries are dropped. Use the `basePluginsExtra`
  hook above to inject a Redis-backed queue for SLA-bound workloads.
- **InMemoryCryptoProvider is per-process** — the default AES key is
  regenerated on every restart, so encrypted `sys_secret` rows cannot
  be decrypted after a redeploy. Ship `KmsCryptoProvider` (AWS KMS
  envelope) before enabling encrypted settings on hosted objectos.
