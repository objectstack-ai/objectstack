---
title: Deployment
description: "Deploy ObjectUI applications to Docker, Vercel, Railway, Netlify, and other platforms with production-ready configurations."
---

# Deployment

ObjectUI apps are standard Vite + React applications, so they can be deployed anywhere that serves static files or runs Node.js containers. This guide provides copy-paste-ready configurations for the most popular platforms.

## Prerequisites

- A production build: `pnpm build` (runs `turbo run build` across all packages)
- The build output lives in `apps/console/dist/` (or your app's `dist/` folder)
- Environment variables configured for your target environment

`pnpm build` also writes `apps/console/dist/sdui.manifest.json`, the SDUI component manifest of the console it built. An ObjectStack host serving this `dist` registers that file under `@objectstack/metadata-protocol`'s `SDUI_MANIFEST_SERVICE`, and its metadata save door validates page sources against it. The console package's `build` script writes it after `vite build`, so a caller that runs `vite build` directly gets the bundle without the manifest.

## Docker

Create a multi-stage `Dockerfile` at the project root:

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ packages/
COPY apps/ apps/
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Stage 2: Serve
FROM nginx:alpine AS runner
COPY --from=builder /app/apps/console/dist /usr/share/nginx/html
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
}
EOF

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Build and run:

```bash
docker build -t objectui-app .
docker run -p 3000:80 objectui-app
```

## Vercel

Create `vercel.json` in the project root:

```json
{
  "buildCommand": "pnpm build",
  "outputDirectory": "apps/console/dist",
  "installCommand": "pnpm install --frozen-lockfile",
  "framework": "vite",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    }
  ]
}
```

Deploy with the Vercel CLI:

```bash
npx vercel --prod
```

> **Note:** Set the **Root Directory** to the repository root so the monorepo workspace resolves correctly.

## Railway

Create `railway.json` in the project root:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "corepack enable && pnpm install --frozen-lockfile && pnpm build"
  },
  "deploy": {
    "startCommand": "npx serve apps/console/dist -s -l tcp://0.0.0.0:$PORT",
    "healthcheckPath": "/",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

Push to your linked Railway project:

```bash
railway up
```

## Netlify

Create `netlify.toml` in the project root:

```toml
[build]
  command = "pnpm install --frozen-lockfile && pnpm build"
  publish = "apps/console/dist"

[build.environment]
  NODE_VERSION = "22"
  PNPM_VERSION = "10"

# SPA fallback — redirect all routes to index.html
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```

Deploy with the Netlify CLI:

```bash
npx netlify deploy --prod
```

## Environment Variables

ObjectUI uses Vite's `import.meta.env` for build-time configuration. Prefix all custom variables with `VITE_`.

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_SERVER_URL` | `""` (same origin) | Absolute origin of the ObjectStack backend, e.g. `https://demo.objectstack.ai`. The one setting that matters — the data adapter, auth, i18n and action endpoints all hang off it. An empty value means same-origin, which is correct when the ObjectStack server serves the console itself; on a static host with no backend behind it, every `/api/v1/*` request then 404s. |
| `NODE_ENV` | `"development"` | Set automatically to `"production"` by `vite build`. |

Because Vite inlines `import.meta.env` at **build time**, `VITE_SERVER_URL` has to be present when the build runs. Setting it only in a static host's runtime environment changes nothing — the value is already baked into the bundle.

Create a `.env.production` file for production defaults:

```bash
# Leave empty for same-origin; set an absolute origin for a split-origin deploy.
VITE_SERVER_URL=https://demo.objectstack.ai
```

For platform-specific configuration, set environment variables in each platform's dashboard or CLI:

```bash
# Vercel
vercel env add VITE_SERVER_URL production

# Railway
railway variables set VITE_SERVER_URL=https://demo.objectstack.ai

# Netlify
netlify env:set VITE_SERVER_URL https://demo.objectstack.ai
```

> **Tip:** A split-origin deployment (console and backend on different origins) needs two things from the backend: CORS for the SPA origin (`Access-Control-Allow-Origin: <spa-origin>`, `Access-Control-Allow-Credentials: true`), and auth cookies marked `SameSite=None; Secure` so they survive cross-site requests.

## Build Optimization

### Gzip and Brotli Compression

Add the `vite-plugin-compression` plugin for pre-compressed assets:

```bash
pnpm add -D vite-plugin-compression
```

<!-- doc-snippet: fragment — a vite.config.ts for the reader's own project: `defineConfig`, `react()`, `tailwindcss()` and `vite-plugin-compression` are the reader's dependencies and imports, not this repository's, so they cannot resolve here -->

```ts
// vite.config.ts
import compression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    compression({ algorithm: 'gzip' }),       // .gz files
    compression({ algorithm: 'brotliCompress', ext: '.br' }),  // .br files
  ],
});
```

### Code Splitting

Vite splits chunks automatically. For ObjectUI plugins, use dynamic imports to keep the initial bundle small:

```tsx
import { createLazyPlugin } from '@object-ui/react';

const ObjectGrid = createLazyPlugin(
  // The plugin package has no default export — name the component you want.
  async () => ({ default: (await import('@object-ui/plugin-grid')).ObjectGrid }),
  { fallback: <div>Loading grid...</div> }
);
```

### Bundle Analysis

Visualize your bundle to find optimization opportunities:

```bash
pnpm add -D rollup-plugin-visualizer
```

<!-- doc-snippet: fragment — a vite.config.ts for the reader's own project: `defineConfig`, `react()`, `tailwindcss()` and `rollup-plugin-visualizer` are the reader's dependencies and imports, not this repository's, so they cannot resolve here -->

```ts
// vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    visualizer({ open: true, gzipSize: true }),
  ],
});
```

### Production Build Command

Bake the backend origin into the bundle and verify the output:

```bash
VITE_SERVER_URL=https://demo.objectstack.ai pnpm build
```

`pnpm build` runs `turbo run build` across the workspace. Turbo runs in strict env mode, but it detects the console as a Vite package and passes `VITE_*` through automatically, so an inline `VITE_SERVER_URL` does reach the build. To build the console alone, use `pnpm build:console`.

## Health Checks

For containerized deployments, add a lightweight health check endpoint. Create `public/health.json` in your app:

```json
{ "status": "ok" }
```

This file is copied to the build output as-is by Vite. Point your health check to `/health.json`:

```dockerfile
# Docker HEALTHCHECK
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:80/health.json || exit 1
```

```jsonc
// railway.json (excerpt)
{
  "deploy": {
    "healthcheckPath": "/health.json"
  }
}
```

For platforms that expect an HTTP 200 on `/`, the SPA `index.html` fallback already handles this.

## Next Steps

- [CI/CD Pipeline](/docs/guide/ci-cd-pipeline) — Understand the automated build and release workflows
- [Architecture Overview](/docs/guide/architecture) — How ObjectUI packages fit together
- [Quick Start](/docs/guide/quick-start) — Set up a new ObjectUI project from scratch
- [Theming](/docs/guide/theming) — Customize the look-and-feel before deploying
