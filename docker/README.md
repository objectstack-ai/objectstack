# ObjectStack Official Runtime Image

`ghcr.io/objectstack-ai/objectstack` — the official production runtime for
standalone ObjectStack apps. It packages Node 22 and `@objectstack/cli`
(`os start`) and nothing else: **your compiled artifact is the app**, the
image is the runtime.

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

**Extend it** (the usual path — see [`examples/docker`](../examples/docker)):

```dockerfile
FROM ghcr.io/objectstack-ai/objectstack:14.8.0
COPY --chown=node:node dist/objectstack.json /srv/app/objectstack.json
```

**Or run it directly** with a mounted or remote artifact — no image build:

```bash
docker run -p 8080:8080 \
  -v "$PWD/dist/objectstack.json:/srv/app/objectstack.json:ro" \
  -e OS_DATABASE_URL="postgres://user:pass@db-host:5432/myapp" \
  -e OS_AUTH_SECRET -e OS_SECRET_KEY \
  ghcr.io/objectstack-ai/objectstack:14.8.0
```

`OS_ARTIFACT_PATH` also accepts an `https://` URL, so the artifact can come
straight from your release storage.

## What the image presets

- `OS_ARTIFACT_PATH=/srv/app/objectstack.json`, `OS_PORT=8080`,
  `NODE_ENV=production`
- Runs as the non-root `node` user
- `HEALTHCHECK` on `/api/v1/health` (liveness); use `/api/v1/ready` as the
  readiness probe in orchestrators

**You must inject at runtime:** `OS_DATABASE_URL`, `OS_AUTH_SECRET`,
`OS_SECRET_KEY` — never bake them into an image. Full variable catalog and
reverse-proxy / multi-node guidance:
[Self-Hosted Deployment](https://objectstack.ai/docs/deployment/self-hosting).

## Local build of this image

```bash
docker build -t objectstack:dev --build-arg OS_CLI_VERSION=14.8.0 docker/
```
