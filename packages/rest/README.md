# @objectstack/rest

> Auto-generated REST API layer for ObjectStack — turns protocol metadata into CRUD, batch, metadata, and discovery endpoints with zero boilerplate.

[![npm](https://img.shields.io/npm/v/@objectstack/rest.svg)](https://www.npmjs.com/package/@objectstack/rest)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../../LICENSING.md)

## Overview

`@objectstack/rest` is registered as a kernel plugin and emits HTTP routes for every object defined in the protocol metadata. The Hono framework adapter (`@objectstack/hono`) invokes these routes through `HttpDispatcher` from `@objectstack/runtime`.

## Installation

```bash
pnpm add @objectstack/rest
```

## Quick Start

```typescript
import { ObjectKernel } from '@objectstack/core';
import { createRestApiPlugin } from '@objectstack/rest';

const kernel = new ObjectKernel();

kernel.use(createRestApiPlugin({
  api: {
    version: 'v1',
    basePath: '/api',
  },
}));

await kernel.bootstrap();
```

### Standalone `RestServer`

```typescript
import { RestServer } from '@objectstack/rest';

const server = new RestServer(protocol, config);
server.registerRoutes(dispatcher);
```

### Custom routes via `RouteManager`

```typescript
import { RouteManager } from '@objectstack/rest';

const routes = new RouteManager();
routes.register({ method: 'GET', path: '/custom', handler });
```

## Generated endpoints

For every object `Project` defined in metadata, the plugin exposes:

| Method | Path | Purpose |
|:---|:---|:---|
| `GET` | `/api/v1/projects` | List with `filter`, `sort`, `top`, `skip`, `select`, `groupBy`, `aggregations`. |
| `GET` | `/api/v1/projects/:id` | Single record (with ETag / Last-Modified). |
| `POST` | `/api/v1/projects` | Create. |
| `PATCH` | `/api/v1/projects/:id` | Partial update. |
| `PUT` | `/api/v1/projects/:id` | Full replacement. |
| `DELETE` | `/api/v1/projects/:id` | Delete. |
| `POST` | `/api/v1/projects/createMany` | Batch create. |
| `POST` | `/api/v1/projects/updateMany` | Batch update. |
| `POST` | `/api/v1/projects/deleteMany` | Batch delete. |
| `POST` | `/api/v1/projects/batch` | Mixed batch. |

Plus metadata and discovery routes:

| Path | Description |
|:---|:---|
| `/api/v1/meta` | All metadata types. |
| `/api/v1/meta/:type` | Objects, views, apps, flows, agents, tools, translations. |
| `/api/v1/meta/:type/:name` | Single metadata resource. |
| `/api/v1` and `/.well-known/objectstack` | Discovery / service manifest. |

## Key Exports

| Export | Kind | Description |
|:---|:---|:---|
| `createRestApiPlugin(config)` | function | Kernel plugin factory. |
| `RestApiPluginConfig` | type | `{ api: { version, basePath }, ... }`. |
| `RestServer` | class | Direct instantiation for adapters that need it. |
| `RouteManager`, `RouteGroupBuilder` | classes | Register and group custom routes. |
| `RouteEntry` | type | Route definition shape. |

## Configuration

| Option | Type | Default | Notes |
|:---|:---|:---|:---|
| `api.version` | `string` | `'v1'` | Embedded in the route prefix. |
| `api.basePath` | `string` | `'/api'` | Root path for the API. |
| `paths.pathTransform` | `'plural' \| 'kebab' \| 'camel'` | `'plural'` | Object → URL segment transform. |
| `caching.etag` | `boolean` | `true` | Emits `ETag` header. |
| `caching.lastModified` | `boolean` | `true` | Emits `Last-Modified`. |

### Environment

| Variable | Values | Default | Notes |
|:---|:---|:---|:---|
| `OS_REST_LOG` | `debug` \| `info` \| `warn` \| `error` \| `silent` | `info` | Level for this package's own fault logging. |

`OS_REST_LOG` declares how loud the REST layer is about faults **it reports
itself** — the `[REST] …` lines written when a request fails. It is the same
vocabulary, and the same shipped default, as `@objectstack/objectql`'s
`OS_REGISTRY_LOG`; an unrecognised value falls back to the default rather than
silencing anything.

At the default a reported fault prints the **whole** `Error`: its message, its
`cause` chain and its stack frames. That is deliberate and it is the reason to
leave it alone. When a 5xx is withheld from the client, the log is the only
place the underlying driver text exists, and that text travels on `error.cause`
— it is printed only because a whole `Error`, not a summary, reaches the
console. Lowering the level to `error` or `silent` discards diagnostics that
have no second copy anywhere.

⇒ Prefer declaring a quieter level in a **test harness** (`vitest.config.ts`'s
`env` block) over exporting it for a running server.

## HTTP semantics

- JSON envelope: `{ success, data, error?, meta? }`.
- Validation errors: HTTP 400 with Zod issue list.
- Auth/permission failures: HTTP 401/403 emitted by `@objectstack/plugin-auth` and `@objectstack/plugin-security`.
- `If-None-Match` / `If-Modified-Since` honored for GET.

## When to use

- ✅ Every runtime that exposes ObjectStack data over HTTP.

## When not to use

- ❌ RPC-only or GraphQL-only deployments — use a custom `@objectstack/runtime` consumer.

## Related Packages

- [`@objectstack/runtime`](../runtime) — `HttpDispatcher` that invokes routes.
- Framework adapters under [`packages/adapters/*`](../adapters).

## Links

- 📖 Docs: <https://objectstack.ai/docs>
- 📚 API Reference: <https://objectstack.ai/docs/references/api>
- 🤖 Skill: [`skills/objectstack-api/SKILL.md`](../../skills/objectstack-api/SKILL.md)

## License

Apache-2.0. See [LICENSING.md](../../LICENSING.md).
