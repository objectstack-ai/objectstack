# Reference Dockerfile for a standalone ObjectStack app.
#
# Copy this file (plus .dockerignore and docker-compose.yml) into the root of
# a project scaffolded with `npm create objectstack@latest`, then:
#
#   docker build -t my-app .
#   docker run -p 8080:8080 \
#     -e OS_DATABASE_URL="postgres://user:pass@db-host:5432/myapp" \
#     -e OS_AUTH_SECRET -e OS_SECRET_KEY \
#     my-app
#
# Docs: https://docs.objectstack.ai/docs/deployment/self-hosting

# ── Build stage: compile TypeScript metadata to the artifact ─────────
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx os build              # → dist/objectstack.json

# ── Runtime stage: CLI + artifact only ───────────────────────────────
FROM node:22-slim
WORKDIR /srv/app
RUN npm install -g @objectstack/cli
COPY --from=build /app/dist/objectstack.json ./objectstack.json

ENV NODE_ENV=production \
    OS_ARTIFACT_PATH=/srv/app/objectstack.json \
    OS_PORT=8080
EXPOSE 8080

# Liveness: /api/v1/health. For orchestrated readiness use /api/v1/ready.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://localhost:8080/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# OS_DATABASE_URL, OS_AUTH_SECRET, and OS_SECRET_KEY are injected at runtime —
# never bake them into the image.
CMD ["os", "start"]
