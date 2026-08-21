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
| `cors.origin` | `string \| string[]` | env `CORS_ORIGIN` or `'*'` | Supports wildcard patterns. |
| `cors.credentials` | `boolean` | `false` | Required for cookie sessions. |
| `cors.exposeHeaders` | `string[]` | `['set-auth-token']` merged | Always includes `set-auth-token` for better-auth. |

## Edge runtime notes

- Hono adapter is the **preferred** adapter for Cloudflare Workers, Deno Deploy, Bun, and Vercel Edge.
- Drivers differ by runtime: use [`@objectstack/driver-sql`](../../drivers/driver-sql) on Node. (Edge/multi-tenant turso driver ships in ObjectStack Cloud.)
- Persist no long-lived state in module scope beyond the `kernel` instance.

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
