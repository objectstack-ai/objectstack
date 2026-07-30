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

### Dev stubs (in-memory / no-op)

Most core kernel services not provided by a real plugin are automatically registered as a dev stub, so the **kernel service map** is populated and callers get correct return types instead of `undefined`.

Each stub declares what kind of fake it is (`__serviceInfo`, ADR-0076 D12), because consumers gate on the difference:

| Class | Slots | Meaning |
|:---|:---|:---|
| `degraded` | `cache`, `queue`, `job`, `file-storage`, `search`, `realtime`, `i18n`, `workflow`, `metadata` | Really does the work, in memory only — nothing persists, nothing crosses a process boundary. Served normally over HTTP. |
| `stub` | `data`, `auth`, `security.permissions`, `security.rls`, `security.fieldMasker`, plus `ui` (placeholder) | Fabricates its answers (allow-all permissions, discarded writes). Reported as a stub in discovery; consumers that honour `handlerReady` treat the slot as empty. |

**Not stubbed at all** — `analytics`, `automation`, `notification`, `ai`. These fakes reported success for work that never happened (a flow "executed" without running, a notification "sent" to nobody, a placeholder AI answer), and the dispatcher served that as a 200. The slots stay **empty**, exactly as in production without the plugin: `/api/v1/{analytics,automation,notifications,ai}/*` answer 404 and discovery reports `unavailable`. Install the real service to use the capability locally — `@objectstack/service-analytics`, `@objectstack/service-automation`, `@objectstack/service-messaging`, or an AI service. (#4000, #4058)

All services are **optional** — if a peer package isn't installed, it is silently skipped and, for the slots above, a stub takes its place.

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
