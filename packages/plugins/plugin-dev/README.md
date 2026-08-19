# @objectstack/plugin-dev

> Development Assembly Plugin for ObjectStack — wires the **real** platform stack for zero-config local development.

## Overview

Instead of manually wiring up ObjectQL, drivers, auth, HTTP server, REST endpoints, dispatcher, security, and metadata for local development, use `DevPlugin` to get a fully functional stack in one line.

Everything it wires is a **real implementation** — there are no simulated services. A capability whose package is not installed is simply absent, exactly as in production: its routes answer 404/501 and discovery reports it `unavailable` (ADR-0115). That keeps "the capability is present" meaning the same thing in dev and production.

## Usage

### Zero-config

```typescript
import { defineStack } from '@objectstack/spec';
import { DevPlugin } from '@objectstack/plugin-dev';

export default defineStack({
  manifest: {
    id: 'com.example.myapp',
    name: 'My App',
    version: '0.1.0',
    type: 'app',
  },
  plugins: [new DevPlugin()],
});
```

### Full-stack dev with project metadata

```typescript
import config from './objectstack.config';
import { DevPlugin } from '@objectstack/plugin-dev';

// Load all project metadata (objects, views, etc.) into the dev server
export default defineStack({
  ...config,
  plugins: [new DevPlugin({ stack: config })],
});
```

### With options

```typescript
plugins: [
  new DevPlugin({
    port: 4000,
    seedAdminUser: true,
    services: {
      dispatcher: false,     // Skip extended API routes
      storage: false,        // Skip the storage service ('file-storage' also accepted as its deprecated v17 alias)
    },
  }),
]
```

## What it assembles (all real implementations)

| Service | Package | Description |
|---------|---------|-------------|
| ObjectQL | `@objectstack/objectql` | Data engine (query, CRUD, hooks, metadata) |
| InMemoryDriver | `@objectstack/driver-memory` | In-memory database (no DB install) |
| App/Metadata | `@objectstack/runtime` | Project metadata (objects, views, apps, dashboards) |
| Auth | `@objectstack/plugin-auth` | Authentication with dev credentials |
| Security | `@objectstack/plugin-security` | RBAC, RLS, field-level masking |
| Hono Server | `@objectstack/plugin-hono-server` | HTTP server on configured port |
| REST API | `@objectstack/rest` | Auto-generated CRUD + metadata endpoints |
| Dispatcher | `@objectstack/runtime` | Auth routes, GraphQL, packages, storage bridges |
| Storage | `@objectstack/service-storage` | `storage` service (local-disk adapter, files under `./storage`; also registered under the deprecated `file-storage` alias) |
| Realtime | `@objectstack/service-realtime` | `realtime` service (in-memory adapter) |
| I18n | `@objectstack/service-i18n` | Auto-registered when the stack declares translations |

Every part is loaded via dynamic import and skipped with a log line when its package is not installed, and each can be disabled via `options.services`.

## Empty slots stay empty

This plugin registers **no service implementations of its own**. The earlier design filled every unoccupied kernel-service slot with a dev stub — fabricated answers such as allow-all permission checks and "sent" notifications that were never delivered. That design is retired (ADR-0115): a slot no real plugin fills stays empty, and consumers handle absence exactly as they already must in production.

To use a capability locally, install its real service — e.g. `@objectstack/service-analytics` for `/analytics` (it runs an InMemory strategy), `@objectstack/service-cache` / `service-queue` / `service-job` for cache/queue/job.

## Production guard

`init()` throws when `NODE_ENV === 'production'`: the assembly is built around a well-known default auth secret and a seeded dev admin. Nothing swallows the throw on a real boot path — `os serve` prints the message and exits `1`.

If you really mean it (a staging box that pins `NODE_ENV=production`, a smoke test), set `OS_ALLOW_DEV_PLUGIN` to a truthy value (`1` / `true` / `on` / `yes`).

Taking that hatch is never silent. The boot log names the hazards that are actually live for your configuration, and the ready banner repeats the brand, so a process running the dev assembly cannot look like an ordinary production start:

```
⚠ DEV ASSEMBLY UNDER NODE_ENV=production (OS_ALLOW_DEV_PLUGIN is set) — the boot guard was
  explicitly overridden. This process is running the DEVELOPMENT assembly, which is not
  hardened for production traffic (ADR-0115 D6).
    • Auth secret is the default published inside @objectstack/plugin-dev. It is public, so
      anyone can mint a session this stack accepts. Pass `authSecret` explicitly.
    • Data goes to the in-memory driver with persistence disabled — every record is lost
      when this process exits.
```

The dev-admin seed is deliberately *not* on that list: `plugin-auth`'s seeding is hard-gated to `NODE_ENV === 'development'`, so it cannot fire on this path.

## API Endpoints (when all services enabled)

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/data/:object` | List records |
| `POST /api/v1/data/:object` | Create record |
| `GET /api/v1/data/:object/:id` | Get record |
| `PUT /api/v1/data/:object/:id` | Update record |
| `DELETE /api/v1/data/:object/:id` | Delete record |
| `GET /api/v1/meta` | List metadata types |
| `GET /api/v1/meta/:type` | List metadata of type |
| `GET /api/v1/meta/:type/:name` | Get metadata item |
| `PUT /api/v1/meta/:type/:name` | Save metadata item |
| `POST /api/v1/graphql` | GraphQL endpoint |
| `GET /.well-known/objectstack` | Service discovery |

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3000` | HTTP server port |
| `seedAdminUser` | `boolean` | `true` | Create `admin@dev.local` on startup |
| `authSecret` | `string` | dev default | JWT secret for auth sessions |
| `authBaseUrl` | `string` | `http://localhost:{port}` | Auth callback URL |
| `verbose` | `boolean` | `true` | Enable verbose logging |
| `services` | `Record<string, boolean>` | all `true` | Enable/disable individual parts of the assembly |
| `extraPlugins` | `Plugin[]` | `[]` | Additional plugins to load |
| `stack` | `object` | — | Stack definition to load as project metadata |

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
