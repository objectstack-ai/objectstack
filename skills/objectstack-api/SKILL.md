---
name: objectstack-api
description: >
  Design the server-side API surface that an ObjectStack runtime exposes —
  REST/GraphQL endpoints, auth providers, realtime channels, error envelopes,
  batch/versioning contracts. Use when the user is adding `*.endpoint.ts`,
  configuring auth providers, defining custom routes, or extending the
  REST/GraphQL generator. Do not use for: consuming an ObjectStack API from
  a client (that is just standard HTTP — no skill needed); the auto-generated
  CRUD endpoints (those follow from objectstack-data); request-side query
  syntax (see objectstack-query). CEL expressions in route guards or auth
  predicates: load objectstack-formula alongside.
license: Apache-2.0
compatibility: Requires @objectstack/spec 16.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "1.2"
  domain: api
  tags: rest, graphql, endpoint, auth, realtime, server
---

# API Design — ObjectStack API Protocol

Expert instructions for designing REST APIs, service contracts, and
integration protocols using the ObjectStack specification. This skill covers
endpoint definitions, API discovery, authentication, dispatcher configuration,
and inter-service communication patterns.

---

## When to Use This Skill

- You are defining **custom REST API endpoints** beyond auto-generated CRUD.
- You need to configure **API authentication and authorization**.
- You are setting up **service discovery** and health checks.
- You are designing **inter-service communication** (service-to-service calls).
- You need to understand the **dispatcher routing** system.
- You are integrating **external APIs** via datasource connectors.

---

## Auto-Generated vs Custom APIs

### Auto-Generated APIs

Every ObjectStack object with `apiEnabled: true` (the default) automatically
gets a full REST API:

```
GET    /api/v1/data/{object}          # List records (with filter, sort, pagination)
GET    /api/v1/data/{object}/:id      # Get single record
POST   /api/v1/data/{object}          # Create record
PATCH  /api/v1/data/{object}/:id      # Update record
DELETE /api/v1/data/{object}/:id      # Delete record (hard delete)
POST   /api/v1/data/{object}/query    # Complex queries + aggregation (QueryAST in body)
POST   /api/v1/data/{object}/batch    # Per-object batch operations
POST   /api/v1/batch                  # Cross-object atomic batch
```

Data CRUD lives under the `/data` prefix. There is no `/bulk` route and no
`GET .../aggregate` route — batch writes go through the `batch` endpoints, and
aggregation goes through `POST /api/v1/data/{object}/query` with
`groupBy`/`aggregations` in the body.

> **Key rule:** If your object defines `apiMethods`, only those operations are
> exposed. For example, `apiMethods: ['get', 'list']` creates a read-only API.

### Metadata API (`/meta`)

The metadata read surface lives under `/api/v1/meta` (separate from the data
CRUD routes above):

```
GET /api/v1/meta/:type            # List metadata items of a type (object, view, flow, doc, …)
GET /api/v1/meta/:type/:name      # Read a single metadata item
```

Three query-param contracts:

- **`?preview=draft`** — overlay pending **draft** metadata instead of the
  published copy, on both list and get. The draft path is **cache-bypassed**, so
  it always reflects the latest unpublished edit (the authoring loop).
- **`?package=<packageId>`** — **package-scope** a read so
  two installed packages that share a bare metadata name disambiguate by owning
  package; prefer-local resolution. A package-scoped read **bypasses the meta
  cache**. The layered / Studio-editor read is package-scoped the same way.
- **`/meta/doc`** — docs-as-metadata. The **list** response omits
  each doc's `content` by default (use `?include=content` to include it); the
  **single-item** `GET /meta/doc/:name` always returns the full body.

### Public (anonymous) Form Endpoints

Any `FormView` declared with `sharing.allowAnonymous: true` and a
`publicLink` slug is auto-mounted at:

```
GET  /api/v1/forms/:slug         # returns form spec + restricted objectSchema
POST /api/v1/forms/:slug/submit  # whitelist-filtered INSERT, no auth header
```

These bypass `enforceAuth`, run under a synthetic
`{ permissions: ['guest_portal'], anonymous: true }` execution context, and
are intended for Web-to-Lead / Web-to-Case style flows. The framework
strips fields outside the form's `sections[].fields[]` list; a
`beforeInsert` hook on the target object should stamp safe defaults
(`status='new'`, `lead_source='web'`, …) and `delete` privileged keys
(`owner`, `internal_notes`, …). For the full contract, read
`node_modules/@objectstack/spec/src/ui/view.zod.ts` (`FormViewSchema`) and
`node_modules/@objectstack/spec/src/ui/sharing.zod.ts` (`SharingConfigSchema`
with `allowAnonymous` / `publicLink`).

### Custom Endpoints

For business logic beyond CRUD, define custom endpoints via the REST API
plugin (`RestApiEndpointSchema`):

<!-- os:check -->
```typescript
import { RestApiEndpointSchema, type RestApiEndpoint } from '@objectstack/spec/api';

export const closeCase: RestApiEndpoint = RestApiEndpointSchema.parse({
  method: 'POST',
  path: '/api/v1/cases/:id/close',
  handler: 'closeCase',              // protocol method / handler identifier
  category: 'data',
  description: 'Close a support case with resolution notes.',
  public: false,                     // auth required (the default)
  permissions: ['support_agent'],
  requestSchema: 'CloseCaseRequest', // schema *name* reference, not an inline shape
  responseSchema: 'SupportCase',
  handlerStatus: 'implemented',
});
```

There is no `name`, `request`, `response`, or `auth` field on this schema —
request/response schemas are referenced **by name** (`requestSchema` /
`responseSchema`), and auth is the flat `public` + `permissions` pair. The
alternative declarative surface is `ApiEndpointSchema` (`endpoint.zod.ts`):
`type: 'flow' | 'script' | 'object_operation' | 'proxy'` plus a `target`
(Flow ID, script name, or proxy URL) and `authRequired: boolean`.

---

## Endpoint Naming Conventions

| Pattern | Use Case | Example |
|:--------|:---------|:--------|
| `/api/v1/data/{object}` | Auto-generated collection | `/api/v1/data/accounts` |
| `/api/v1/data/{object}/:id` | Auto-generated record | `/api/v1/data/accounts/abc123` |
| `/api/v1/{object}/:id/{action}` | Custom action on record | `/api/v1/cases/:id/close` |
| `/api/v1/{domain}/{action}` | Domain-level action | `/api/v1/ai/chat` |

**Rules:**

- Always use **plural nouns** for collection paths (`accounts`, not `account`).
- Use **snake_case** for multi-word paths (`project_tasks`, not `projectTasks`).
- Use **verbs** only for actions, not for CRUD (`/close`, `/approve`).
- Always prefix with `/api/v1/` for versioning.

Depending on deployment configuration, routes may also be mounted
**environment-scoped** under `/api/v1/environments/:environmentId/...`
(project scoping in the REST server). With `projectResolution: 'required'`
only the scoped routes are registered; with `optional`/`auto` the bare
`/api/v1/...` routes remain available alongside them.

---

## API Methods (Operations)

The full set of operations an object can expose (the `ApiMethod` enum, 14
values). Not every enum value has its own generated route — some only gate
access:

| Method | HTTP surface today | Purpose |
|:-------|:-------------------|:--------|
| `get` | `GET /data/{object}/:id` | Retrieve a single record |
| `list` | `GET /data/{object}` | List records with filter/sort/pagination |
| `create` | `POST /data/{object}` | Create a new record |
| `update` | `PATCH /data/{object}/:id` | Update an existing record |
| `delete` | `DELETE /data/{object}/:id` | Delete a record |
| `upsert` | Enum value gating access — no dedicated generated route in `@objectstack/rest` today | Create or update by external ID |
| `bulk` | `POST /data/{object}/batch` | Batch create/update/delete |
| `aggregate` | No dedicated route — use `POST /data/{object}/query` with `groupBy`/`aggregations` | Count, sum, avg, min, max |
| `history` | Enum value gating access — no dedicated generated route today | Audit trail access |
| `search` | Global `GET /api/v1/search` (cross-object), not per-object | Full-text search |
| `restore` | Enum value gating access — no dedicated generated route today | Restore a soft-deleted record (reserved — platform deletes are hard today) |
| `purge` | Enum value gating access — no dedicated generated route today | Permanent deletion |
| `import` | `POST /data/{object}/import` | Bulk data import |
| `export` | `GET /data/{object}/export` | Data export |

---

## Service Discovery

ObjectStack services register themselves with the kernel and expose discovery
metadata.

### Service Info Schema

The discovery response (`GET /api/v1/discovery`) reports each registered
service in a `services` **record** — the record key is the service name, and
there is no `endpoints` array on a service entry:

<!-- os:check -->
```typescript
import type { ServiceInfo } from '@objectstack/spec/api';

// In the discovery response: services: { data: { ... }, ... }
const dataService: ServiceInfo = {
  enabled: true,          // required
  status: 'available',    // 'available' | 'registered' | 'unavailable' | 'degraded' | 'stub'
  handlerReady: true,     // HTTP handler verified mounted (omitted = unknown)
  route: '/api/v1/data',
  provider: 'objectql',
  version: '1.0.0',
};
```

Optional fields also include `message` (human-readable reason if unavailable)
and `rateLimit` (per-service quota info). There is no `healthy`/`unhealthy`
status — `available` is the fully-operational state.

### Health Endpoint

Every ObjectStack deployment exposes `GET /api/v1/health`, which returns the
standard success envelope (no per-service map):

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-07-20T12:00:00.000Z",
    "version": "1.0.0",
    "uptime": 42.7
  }
}
```

A readiness probe also exists at `GET /ready` on the same base path — it
returns 200 only when the kernel is fully running, and 503 while booting or
shutting down. For per-service status, use `GET /api/v1/discovery` (the
`services` record above).

---

## Dispatcher & Routing

The **HttpDispatcher** is the central request router in ObjectStack.

### Dispatcher Error Codes

| HTTP Status | Error Type | When |
|:------------|:-----------|:-----|
| 404 | `ROUTE_NOT_FOUND` | No route matches the path |
| 405 | `METHOD_NOT_ALLOWED` | Route exists but method not supported |
| 501 | `NOT_IMPLEMENTED` | Route declared but handler is a stub |
| 503 | `SERVICE_UNAVAILABLE` | Service is registered but not ready |

### Handler Status

Every endpoint has a handler status:

| Status | Meaning |
|:-------|:--------|
| `implemented` | Handler is fully functional |
| `stub` | Handler exists but returns mock data |
| `planned` | Handler is defined in the spec but not yet coded |

> **Best practice:** Always set `handlerStatus` explicitly. The dispatcher
> returns `501 NOT_IMPLEMENTED` for `stub` and `planned` handlers, giving
> clear feedback to API consumers.

---

## Realtime Subscriptions

Realtime contracts are pointer-style — read the spec source for exact shapes:

- `node_modules/@objectstack/spec/src/api/realtime.zod.ts` — `TransportProtocol`
  (`websocket` | `sse` | `polling`), `SubscriptionSchema` (`id`, `events[]`,
  `transport`, optional `channel`), `RealtimeEventSchema`, and
  `RealtimeConfigSchema`. Note: the `RealtimeEventType` enum is declared but
  not yet enforced — the runtime emits `data.record.*` event names instead.
- `node_modules/@objectstack/spec/src/api/websocket.zod.ts` — the WebSocket
  message protocol: subscribe/unsubscribe messages, event delivery with
  filters, presence, cursor and collaborative-edit messages, and
  ack/error/ping/pong frames.

---

## Authentication & Authorization

### Auth Configuration

There is no nested `auth` block on endpoints. Auth is declared with flat
fields on the endpoint itself:

```typescript
// RestApiEndpointSchema (plugin-rest-api) endpoints:
{
  public: false,                  // false (the default) = auth required
  permissions: ['admin'],         // required permissions
  rateLimit: 'default',           // named rate-limit policy (a string reference)
}
```

Declarative `ApiEndpointSchema` endpoints (and the dispatcher) instead use
`authRequired: boolean` (default `true`). Rate-limit policies themselves are
shaped by `RateLimitConfigSchema`:

<!-- os:check -->
```typescript
import { RateLimitConfigSchema, type RateLimitConfig } from '@objectstack/spec/shared';

const limit: RateLimitConfig = RateLimitConfigSchema.parse({
  enabled: true,
  windowMs: 60_000,     // time window in milliseconds
  maxRequests: 100,     // max requests per window
});
```

### Auth Providers

Provider and login contracts live in
`node_modules/@objectstack/spec/src/api/auth.zod.ts`: `AuthProvider` is
`'local' | 'google' | 'github' | 'microsoft' | 'ldap' | 'saml'`, and
`LoginRequestSchema` carries `type` (login method), plus optional `email`,
`username`, `password`, `provider`, and `redirectTo`. Read that file for the
session and token response shapes before wiring an auth flow.

### Security Layers

| Layer | Scope | Description |
|:------|:------|:------------|
| **Authentication** | Request | Who is the caller? (JWT, API key, OAuth) |
| **RBAC** | Object | Role-based access control (profile → permissions) |
| **RLS** | Record | Row-level security (visibility rules per record) |
| **FLS** | Field | Field-level security (hide/mask sensitive fields) |

> **Key rule:** RBAC controls what objects/operations a user can access.
> RLS controls which records within those objects are visible. FLS controls
> which fields are readable/writable.

---

## Datasource Configuration

Connect to external data sources for virtualised data access.
`DatasourceSchema` has no `type`, `connection`, or `readOnly` fields — the
connection settings live in the driver-specific `config` record, and
read-only safety comes from `schemaMode` plus the `external` write gate:

<!-- os:check -->
```typescript
import { defineDatasource } from '@objectstack/spec';

export const legacyErp = defineDatasource({
  name: 'legacy_erp',
  driver: 'postgres',
  config: {
    host: 'erp.internal.example.com',
    port: 5432,
    database: 'erp_production',
  },
  ssl: { enabled: true },
  schemaMode: 'external',              // DDL forbidden; schema mismatch fails boot
  external: { allowWrites: false },    // required when schemaMode != 'managed'
});
```

### Supported Drivers

Registered driver ids in the datasource driver catalog:

| Driver | Use Case |
|:-------|:---------|
| `postgres` | Primary production database |
| `mysql` | Legacy systems, WordPress integration |
| `mongo` | Document store (MongoDB) |
| `sqlite` | Local development, embedded apps |
| `memory` | Unit tests, development |

Edge SQLite (Turso/libSQL) is available via the separate
`@objectstack/driver-turso` package (driver name `turso`).

---

## Inter-Service Communication

### Service Contracts

ObjectStack uses typed service contracts defined in `@objectstack/spec/contracts`.
The data contract is `IDataEngine` (`find(objectName, query?: EngineQueryOptions)`,
`findOne`, `insert`, `update`, `delete`, `count`, `aggregate`, plus optional
`vectorFind`/`batch`/`execute`) — there is no `DataService` contract.

### Kernel Service Resolution

Services are resolved through the microkernel with `kernel.getService<T>(name)`
(there is no `kernel.resolve()`); an async variant `kernel.getServiceAsync`
supports factory-created services:

<!-- os:check -->
```typescript
import type { IDataEngine } from '@objectstack/spec/contracts';

declare const kernel: { getService<T>(name: string): T };

async function firstTenAccounts() {
  const data = kernel.getService<IDataEngine>('data');
  return data.find('account', { limit: 10 });
}
```

---

## Best Practices

1. **Version your APIs** — always use `/api/v1/` prefix. Breaking changes get
   a new version (`v2`).
2. **Use auto-generated APIs** whenever possible. Only create custom endpoints
   for business logic that cannot be expressed through CRUD + triggers.
3. **Return consistent error shapes.** The dispatcher envelope is
   `DispatcherErrorResponseSchema`: `{ success: false, error: { code, message,
   type?, route?, service?, hint? } }`, where `code` is the **numeric** HTTP
   status and `code`/`message` are required. General API errors use
   `ErrorResponseSchema` (`errors.zod.ts`). Be aware the shipped data routes
   return flat `{ error, code }` bodies instead (e.g. `CONCURRENT_UPDATE` →
   409, `VALIDATION_FAILED` → 400) — do not assume every error arrives in the
   `success: false` envelope.
4. **Document every endpoint** with `description` and response schemas.
5. **Set `handlerStatus`** to communicate implementation progress to consumers.
6. **Apply least-privilege auth.** Every endpoint should declare its required
   permissions explicitly.
7. **Design idempotent writes deliberately.** `upsert` exists as an
   `apiMethods` enum value, but `@objectstack/rest` generates no upsert route
   today. External integrations should query by a unique external ID and then
   branch to create or update (the per-object
   `POST /api/v1/data/{object}/batch` endpoint can group those writes).

---

## Common Pitfalls

1. **Exposing internal fields via API.** Use FLS (field-level security) or
   explicit `apiMethods` to restrict what is visible.
2. **Missing pagination.** Always paginate list endpoints. Default page size
   should be 20–50, with a max of 200.
3. **Not handling 409 Conflict.** Concurrent updates should use optimistic
   locking (version field) and return `409` on conflict.
4. **Ignoring rate limiting.** Always configure rate limits for public and
   external-facing APIs.
5. **Assuming `DELETE` is recoverable.** ObjectStack `DELETE` is a hard
   delete — there is no recycle bin (the dead `enable.trash` flag was removed
   in 16.x, #2377). For recoverability, use per-field `trackHistory` (audit
   trail) or a `lifecycle` archive policy instead of custom soft-delete logic.

---

## Verify your work

After adding a `*.endpoint.ts`, a custom route, or an auth provider, run the
author-time gate before reporting done:

```bash
os validate     # Zod schema + CEL predicate validation + bindings (no artifact)
# or: os build  # the same gates, plus emits dist/
```

Route-guard and auth predicates are CEL; the gate parses them and fails
non-zero with a located message instead of letting a malformed guard fall
through at runtime. In a scaffolded project the gate is `npm run validate`. See
objectstack-platform → **Verify your work** for the full gate list.

---

## References

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.

