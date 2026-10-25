# Console Production Deployment Guide

## Cache-Control Headers

ObjectUI Console uses content-hashed filenames for all generated assets. This means every unique build produces unique filenames, enabling aggressive immutable caching for maximum performance.

### Recommended Cache-Control Configuration

#### Static Assets (JS, CSS, images in `/assets/`)

All Vite-generated assets include a content hash in their filename (e.g., `vendor-react-B4x7kL2q.js`). These files are safe to cache indefinitely:

```
Cache-Control: public, max-age=31536000, immutable
```

#### HTML (`index.html`)

The HTML entry point must always be revalidated so browsers pick up new asset references on each deployment:

```
Cache-Control: no-cache
```

#### Pre-compressed Assets (`.gz`, `.br`)

Serve the pre-compressed variants when the client supports them. Configure your server to prefer Brotli (`.br`) over Gzip (`.gz`):

```
# If the client sends Accept-Encoding: br
# Serve the .br file with: Content-Encoding: br

# If the client sends Accept-Encoding: gzip
# Serve the .gz file with: Content-Encoding: gzip
```

### Server Configuration Examples

#### Nginx

```nginx
server {
    listen 80;
    root /var/www/console/dist;
    index index.html;

    # HTML — always revalidate
    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    # Hashed assets — cache forever
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";

        # Brotli pre-compressed
        location ~* \.js$|\.css$ {
            gzip_static on;
            brotli_static on;
        }
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

#### Caddy

```caddyfile
:80 {
    root * /var/www/console/dist
    encode br gzip

    header /assets/* Cache-Control "public, max-age=31536000, immutable"
    header /index.html Cache-Control "no-cache"

    try_files {path} /index.html
    file_server
}
```

#### Vercel (`vercel.json`)

The console already ships a `vercel.json` — ensure it includes:

```json
{
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/index.html",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache" }
      ]
    }
  ]
}
```

#### AWS CloudFront / S3

| Path Pattern | Cache-Control | TTL |
|---|---|---|
| `/assets/*` | `public, max-age=31536000, immutable` | 365 days |
| `/index.html` | `no-cache` | 0 (always revalidate) |
| `/*.svg`, `/*.ico` | `public, max-age=86400` | 1 day |

### Chunk Architecture

The console build produces 17+ named chunks via `manualChunks`:

| Chunk | Contents | Update Frequency |
|---|---|---|
| `vendor-react` | React, ReactDOM, React Router | Rare (major upgrades) |
| `vendor-radix` | Radix UI primitives | Rare |
| `vendor-icons` | Lucide icons | Rare |
| `vendor-ui-utils` | cva, clsx, tailwind-merge | Rare |
| `vendor-objectstack` | @objectstack/spec, client | Moderate |
| `vendor-zod` | Zod validation | Rare |
| `vendor-msw` | MSW (demo mode only) | Rare |
| `vendor-charts` | Recharts, D3 | Rare |
| `vendor-dndkit` | @dnd-kit | Rare |
| `vendor-i18n` | i18next | Rare |
| `framework` | @object-ui/core, react, types | Moderate |
| `ui-components` | @object-ui/components, fields | Moderate |
| `ui-layout` | @object-ui/layout | Moderate |
| `infrastructure` | auth, permissions, tenant, i18n | Moderate |
| `plugins-core` | grid, form, view | Moderate |
| `plugins-views` | detail, list, dashboard, report | Moderate |
| `data-adapter` | @object-ui/data-objectstack | Moderate |

Because each chunk has a content hash, updated chunks get new filenames automatically, while unchanged chunks continue to be served from the browser cache.

### Performance Targets

| Metric | Target | Notes |
|---|---|---|
| Main entry (gzip) | < 60 KB | CI enforced |
| Main entry (brotli) | < 50 KB | |
| Initial load (gzip) | < 350 KB | Framework + React + entry |
| LCP | < 0.6s | On 4G connection |
| FCP | < 0.3s | |
