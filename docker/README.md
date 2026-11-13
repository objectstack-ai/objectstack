# ObjectStack Official Runtime Image

`ghcr.io/objectstack-ai/objectstack` — the official production runtime for
standalone ObjectStack apps. It packages Node 22, `@objectstack/cli`
(`os start`) and the SQL drivers listed below — and no application code:
**your compiled artifact is the app**, the image is the runtime.

```
objectstack.config.ts ──(os build, CI)──▶ dist/objectstack.json ──(this image)──▶ running app
```

## Tags

Published by [`docker-publish.yml`](../.github/workflows/docker-publish.yml)
on every framework release. The image tag always equals the
`@objectstack/cli` version inside the image:

| Tag | Meaning |
|:---|:---|
| `X.Y.Z` | Exact release — **pin this in production** |
| `X.Y`, `X` | Rolling minor / major |
| `latest` | Latest release — quick starts only |

Multi-arch: `linux/amd64` + `linux/arm64`.

## Usage

**Extend it** (the usual path — the full walkthrough lives in
[Self-Hosted Deployment](https://objectstack.ai/docs/deployment/self-hosting)):

```dockerfile
FROM ghcr.io/objectstack-ai/objectstack:18.4.0
COPY --chown=node:node dist/objectstack.json /srv/app/objectstack.json
```

**Or run it directly** with a mounted or remote artifact — no image build:

```bash
docker run -p 8080:8080 \
  -v "$PWD/dist/objectstack.json:/srv/app/objectstack.json:ro" \
  -e OS_DATABASE_URL="postgres://user:pass@db-host:5432/myapp" \
  -e OS_AUTH_SECRET -e OS_SECRET_KEY \
  ghcr.io/objectstack-ai/objectstack:18.4.0
```

`OS_ARTIFACT_PATH` also accepts an `https://` URL, so the artifact can come
straight from your release storage.

## Database drivers in the image

**This list is a public promise.** The dialects below need nothing installed —
their driver is already in the image, which is why the `postgres://` invocation
above works exactly as written.

| `OS_DATABASE_URL` scheme | Driver package installed in the image |
|:---|:---|
| `postgres://`, `postgresql://` | `pg@^8.0.0` |
| `mysql://`, `mysql2://` | `mysql2@^3.0.0` |

The ranges are `@objectstack/driver-sql`'s own optional-peer ranges, so the
image satisfies the driver's contract rather than a second one. Both packages
are pure JavaScript — they add no native build step and no compiler to the
image.

Two more dialects work without appearing above, because they arrive with
`@objectstack/cli` rather than from that install line: SQLite (`better-sqlite3`,
for a `file:…` path — one box only, wrong for multi-node) and MongoDB
(`mongodb://…`, **single-tenant only**; see
[Drivers](https://objectstack.ai/docs/data-modeling/drivers)).

**Not in the image:** `tedious` (SQL Server) and `@objectstack/driver-turso`
(`libsql://…` / Turso). Add one by extending the image:

```dockerfile
FROM ghcr.io/objectstack-ai/objectstack:18.4.0
USER root
RUN npm install -g tedious
USER node
COPY --chown=node:node dist/objectstack.json /srv/app/objectstack.json
```

Changing this table is a change to what deployments can connect to, so it does
not move on its own: `pnpm check:docs-image-tag` compares it against
[`Dockerfile`](./Dockerfile)'s install line and fails if the two disagree on the
package set or on a version range.

## What the image presets

- `OS_ARTIFACT_PATH=/srv/app/objectstack.json`, `OS_PORT=8080`,
  `NODE_ENV=production`, `OS_DEPLOYMENT_DURABILITY_CHECK_ENABLED=true`
- Runs as the non-root `node` user
- `HEALTHCHECK` on `/api/v1/health` (liveness); use `/api/v1/ready` as the
  readiness probe in orchestrators

**You must inject at runtime:** `OS_DATABASE_URL`, `OS_AUTH_SECRET`,
`OS_SECRET_KEY` — never bake them into an image. **The image refuses to start
without all three** (`OS_DEPLOYMENT_DURABILITY_CHECK_ENABLED=true`): it exits
naming the missing ones, because without them the data would be a SQLite file in
the container layer and both secrets would be generated there, all lost when the
container is replaced. An explicit `OS_DATABASE_URL=file:/path/on/a/volume/app.db`
passes, so SQLite on a mounted volume still works.

Upgrading a container that ran on values the image generated? Carry them over
first, from the old container's `/home/node/.objectstack`: `OS_AUTH_SECRET` is
the contents of `auth-secret`, `OS_SECRET_KEY` the contents of `dev-crypto-key`,
and the data is `data/objectstack.db`. The refusal prints these paths.

Full variable catalog and reverse-proxy / multi-node guidance:
[Self-Hosted Deployment](https://objectstack.ai/docs/deployment/self-hosting#when-the-three-are-not-set).

## Local build of this image

```bash
docker build -t objectstack:dev --build-arg OS_CLI_VERSION=18.4.0 docker/
```
