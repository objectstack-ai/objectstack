# @objectstack/plugin-dev

> Development Mode Plugin for ObjectStack — auto-enables **all 17+ kernel services** for a full-featured API development environment.

## Overview

Instead of manually wiring up ObjectQL, drivers, auth, HTTP server, REST endpoints, dispatcher, security, and metadata for local development, use `DevPlugin` to get a fully functional stack in one line.

The dev environment simulates **all kernel services** so you can:
- CRUD business objects via REST API
- Read, modify, and save views/apps/dashboards via metadata API (`PUT /api/v1/meta/:type/:name`)
- Use GraphQL, analytics, storage, and automation endpoints
- Authenticate with dev credentials (no real auth provider needed)
- Test UI permissions, workflows, and notifications with dev stubs

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
      auth: false,        // Skip auth for quick prototyping
      dispatcher: false,  // Skip extended API routes
    },
  }),
]
```

## What it auto-configures

### Real plugin implementations

| Service | Package | Description |
|---------|---------|-------------|
| ObjectQL | `@objectstack/objectql` | Data engine (query, CRUD, hooks, metadata) |
| InMemoryDriver | `@objectstack/driver-memory` | In-memory database (no DB install) |
| App/Metadata | `@objectstack/runtime` | Project metadata (objects, views, apps, dashboards) |
| Auth | `@objectstack/plugin-auth` | Authentication with dev credentials |
| Security | `@objectstack/plugin-security` | RBAC, RLS, field-level masking |
| Hono Server | `@objectstack/plugin-hono-server` | HTTP server on configured port |
| REST API | `@objectstack/rest` | Auto-generated CRUD + metadata endpoints |
| Dispatcher | `@objectstack/runtime` | Auth routes, GraphQL, analytics, packages, storage |

### ⛔ Local development only

`DevPlugin.init()` **throws under `NODE_ENV=production`**. It fills unclaimed service slots with fakes — some of which report success for work they never did — so a production process must not load it. Remove it from that deployment's plugin list and install the real services. `OS_ALLOW_DEV_PLUGIN=1` overrides the refusal if you deliberately want the dev slate under a production `NODE_ENV` (a staging box mimicking prod, a smoke test that pins the variable).

### Dev stubs (in-memory / no-op)

Most core kernel services not provided by a real plugin are registered as a dev stub, so the kernel service map is populated and callers get correct return types instead of `undefined`. Each one declares what kind of fake it is (`__serviceInfo`, ADR-0076 D12) — consumers, the dispatcher included, gate on that:

| Class | Slots | Meaning |
|:---|:---|:---|
| `degraded` | `cache`, `queue`, `job`, `file-storage`, `search`, `realtime`, `i18n`, `workflow`, `metadata` | Really does the work, in memory only. Served normally over HTTP. |
| `stub` | `data`, `auth`, plus `ui` (placeholder with no implementation) | Fabricates its answer. Reported as a stub in discovery, and every dispatcher-owned domain answers it exactly as it answers an empty slot. |

**Never stubbed** — these slots stay empty on purpose, which is what production has when the real plugin isn't installed:

- `analytics` (#4000). Install `@objectstack/service-analytics` (it runs an InMemory strategy).
- `security.permissions`, `security.rls`, `security.fieldMasker` (#4093). The former stubs answered "allowed" for every permission check, compiled no row-level filter, and returned rows unmasked — inverting the decisions they stood in for. ADR-0076 D12's rule is that a fallback may degrade features, **never security semantics**. Without `@objectstack/plugin-security` nothing enforces RBAC, RLS or field masking, and the boot log says so rather than a fake quietly saying yes.

All services are **optional** — if a peer package isn't installed it is skipped, and for the slots above a stub takes its place.

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
| `services` | `Record<string, boolean>` | all `true` | Enable/disable individual services |
| `extraPlugins` | `Plugin[]` | `[]` | Additional plugins to load |
| `stack` | `object` | — | Stack definition to load as project metadata |

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
