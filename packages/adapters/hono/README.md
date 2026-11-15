# @objectstack/hono

> Hono adapter for ObjectStack — edge-compatible REST API server for Cloudflare Workers, Deno, Bun, Vercel Edge, and Node.

[![npm](https://img.shields.io/npm/v/@objectstack/hono.svg)](https://www.npmjs.com/package/@objectstack/hono)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Overview

Creates a ready-to-serve Hono app that routes all ObjectStack traffic through `HttpDispatcher`. Built-in CORS with wildcard origin pattern support (`https://*.example.com`, `http://localhost:*`), compatible with better-auth bearer token rotation (automatically exposes `set-auth-token`).

## Installation

```bash
pnpm add @objectstack/hono hono
```

## Quick Start

```typescript
import { createHonoApp } from '@objectstack/hono';
import { kernel } from './my-kernel';

const app = createHonoApp({
  kernel,
  prefix: '/api',
  cors: {
    origin: ['https://app.example.com', 'https://*.example.com'],
    credentials: true,
  },
});

export default app; // Cloudflare Workers / Bun / Deno / Vercel Edge
```

### CORS

`createHonoApp` admits by the same rule as `@objectstack/plugin-hono-server`'s
`HonoServerPlugin` (`resolveCorsAdmission`), so one configuration gets one answer at
both: a list admits what it names; no list admits no cross-origin caller; a loopback
origin is admitted, beside a list or without one, on a development boot only
(`NODE_ENV=development`). `'*'`, or a pattern whose host part is the bare `*`
(`https://*`), while credentials are on is refused when the app is created; turn
credentials off to serve it to callers that send no cookies.

### Embed into an existing Hono app

```typescript
import { Hono } from 'hono';
import { objectStackMiddleware } from '@objectstack/hono';

const app = new Hono();
app.use('/api/*', objectStackMiddleware(kernel));
```

## Key Exports

| Export | Kind | Description |
|:---|:---|:---|
| `createHonoApp(options)` | function | New `Hono` instance with dispatcher + CORS installed. |
| `objectStackMiddleware(kernel)` | function | Reusable middleware for existing Hono apps. |
| `ObjectStackHonoOptions` | interface | Root options with `kernel`, `prefix`, `cors`. |
| `ObjectStackHonoCorsOptions` | interface | CORS configuration. |

## Configuration

| Option | Type | Default | Notes |
|:---|:---|:---|:---|
| `kernel` | `ObjectKernel` | — | Bootstrapped kernel. |
| `prefix` | `string` | `'/api'` | Base path. |
| `cors` | `ObjectStackHonoCorsOptions \| false` | Enabled | Set to `false` to disable. |
| `cors.origin` | `string \| string[]` | env `OS_CORS_ORIGIN`, else no list | Supports wildcard patterns. With no list, no cross-origin caller is admitted. |
| `cors.credentials` | `boolean` | env `OS_CORS_CREDENTIALS !== 'false'` (on) | Required for cookie sessions. |
| `cors.exposeHeaders` | `string[]` | `['set-auth-token']` merged | Always includes `set-auth-token` for better-auth. |

## Edge runtime notes

- Hono adapter is the **preferred** adapter for Cloudflare Workers, Deno Deploy, Bun, and Vercel Edge.
- Drivers differ by runtime: use [`@objectstack/driver-sql`](../../drivers/driver-sql) on Node. (Edge/multi-tenant turso driver ships in ObjectOS Cloud.)
- Persist no long-lived state in module scope beyond the `kernel` instance.

## Response compression

`createHonoApp` does not compress responses. It sends no `Content-Encoding` and adds no
`Vary: Accept-Encoding`. On this door, compression is the job of the platform or CDN in
front of the app, and the application does not compress there. The edge runtimes this
adapter targets do not all offer `node:zlib`, and the edge already does this work.

- Check that your host compresses JSON, JavaScript and CSS responses. If it does not,
  turn it on there, not in the app. A runtime you serve yourself may not compress at
  all; put a proxy or CDN in front of it.
- Keep the `ETag` unchanged when the host compresses. Saves send it back as `If-Match`
  and the server compares it strongly, so a host that rewrites it to a weak `W/` tag
  makes those saves fail their precondition.

The self-hosted server, [`@objectstack/plugin-hono-server`](../../plugins/plugin-hono-server)
(what `os dev` and `os start` run), does compress responses itself; its README says
which ones.

## When to use

- ✅ Edge, serverless, and multi-runtime deployments.
- ✅ Projects wanting built-in CORS with wildcard patterns.

## Related Packages

- [`@objectstack/plugin-hono-server`](../../plugins/plugin-hono-server) — optional plugin that hosts a Hono server inside the kernel.
- [`@objectstack/runtime`](../../runtime), [`@objectstack/rest`](../../rest).

## Links

- 📖 Docs: <https://objectstack.ai/docs>
- 📚 API Reference: <https://objectstack.ai/docs/references>

## License

Apache-2.0 © ObjectStack
