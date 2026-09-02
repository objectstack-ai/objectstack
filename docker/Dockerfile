# ObjectStack official runtime image — ghcr.io/objectstack-ai/objectstack
#
# A generic, app-agnostic production runtime: Node + @objectstack/cli + the
# `pg` / `mysql2` SQL drivers + `os start`. It contains NO app — bring your
# compiled artifact (dist/objectstack.json, built by `os build` in CI):
#
#   FROM ghcr.io/objectstack-ai/objectstack:<version>
#   COPY --chown=node:node dist/objectstack.json /srv/app/objectstack.json
#
# or run it without any image build at all:
#
#   docker run -p 8080:8080 \
#     -v "$PWD/dist/objectstack.json:/srv/app/objectstack.json:ro" \
#     -e OS_DATABASE_URL="postgres://user:pass@db-host:5432/myapp" \
#     -e OS_AUTH_SECRET -e OS_SECRET_KEY \
#     ghcr.io/objectstack-ai/objectstack:<version>
#
# OS_ARTIFACT_PATH also accepts an https:// URL, so the artifact can be
# fetched from your release storage instead of copied in.
#
# Or name the artifact BY REFERENCE and skip the image build entirely
# (#8368) — OS_ARTIFACT_URL overrides the OS_ARTIFACT_PATH preset below, so a
# container carrying no app boots the referenced one:
#
#   docker run -p 8080:8080 \
#     -e OS_ARTIFACT_URL="https://releases.example.com/hotcrm-2.2.2.json#sha256=<64 hex chars>" \
#     -e OS_DATABASE_URL=... -e OS_AUTH_SECRET -e OS_SECRET_KEY \
#     ghcr.io/objectstack-ai/objectstack:<version>
#
# The `#sha256=` fragment is an optional SRI-style integrity pin, verified
# before boot; a mismatch refuses to boot. Docs:
# https://objectstack.ai/docs/deployment/self-hosting#artifact-pinned-boot-os_artifact_url
#
# Published by .github/workflows/docker-publish.yml on every framework
# release; the image tag always matches the @objectstack/cli version inside.
# Docs: https://objectstack.ai/docs/deployment/self-hosting

FROM node:22-slim

# Pinned by CI to the @objectstack/cli release that triggered the publish.
# `latest` is only the fallback for ad-hoc local builds of this file.
ARG OS_CLI_VERSION=latest

# The SQL drivers ship WITH the image, not with the app (#14510).
#
# `@objectstack/driver-sql` declares `pg`, `mysql2` and `tedious` as OPTIONAL
# peer dependencies. npm 7+ installs peer dependencies automatically but SKIPS
# the optional ones, so `npm install -g @objectstack/cli` on its own produced a
# tree with no `pg` in it -- while the header of this very file, README.md, and
# the `docker-compose.yml` that `npm create objectstack` generates (whose `db`
# service is `postgres:17`) all hand this image a `postgres://` URL. Every one
# of those paths died at boot on `Cannot find module 'pg'`, with the loud
# fail-fast ADR-0062 D5 requires but nothing documented to act on. Installing
# the drivers here is the "whoever makes the promise installs it" half of the
# fix; the other half is that README.md publishes the list.
#
# The ranges are copied VERBATIM from driver-sql's `peerDependencies`, so the
# image satisfies the driver's own contract rather than a second one invented
# here. Both packages are pure JavaScript with no native build step, which is
# why they are affordable for every user of the image. `tedious` (SQL Server)
# and `@objectstack/driver-turso` are deliberately NOT installed -- extend the
# image when you need one, as README.md shows.
#
# This install line is a PUBLIC PROMISE, published as the driver table in
# ./README.md. Adding or removing a package here changes which databases a
# deployment can reach, so the two files must move in the same commit:
# `pnpm check:docs-image-tag` fails when the install line and that table
# disagree on the package set or on a version range.
RUN npm install -g \
      @objectstack/cli@${OS_CLI_VERSION} \
      "pg@^8.0.0" \
      "mysql2@^3.0.0" \
 && npm cache clean --force

LABEL org.opencontainers.image.source="https://github.com/objectstack-ai/objectstack" \
      org.opencontainers.image.title="ObjectStack" \
      org.opencontainers.image.description="Official ObjectStack runtime: os start + your compiled objectstack.json artifact" \
      org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /srv/app
RUN chown node:node /srv/app
USER node

ENV NODE_ENV=production \
    OS_ARTIFACT_PATH=/srv/app/objectstack.json \
    OS_PORT=8080
EXPOSE 8080

# Liveness: /api/v1/health. For orchestrated readiness use /api/v1/ready.
# No backticks/$ in the -e script — this CMD runs under `/bin/sh -c`.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://localhost:'+(process.env.OS_PORT||8080)+'/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# OS_DATABASE_URL, OS_AUTH_SECRET, and OS_SECRET_KEY are injected at runtime —
# never bake them into an image.
CMD ["os", "start"]
