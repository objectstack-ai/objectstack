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
compatibility: Requires @objectstack/spec Zod schemas (v4+)
metadata:
  author: objectstack-ai
  version: "1.1"
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
GET    /api/v1/{object}          # List records (with filter, sort, pagination)
GET    /api/v1/{object}/:id      # Get single record
POST   /api/v1/{object}          # Create record
PATCH  /api/v1/{object}/:id      # Update record
DELETE /api/v1/{object}/:id      # Delete record (soft-delete if trash enabled)
POST   /api/v1/{object}/bulk     # Bulk operations
GET    /api/v1/{object}/aggregate # Aggregation queries
```

> **Key rule:** If your object defines `apiMethods`, only those operations are
> exposed. For example, `apiMethods: ['get', 'list']` creates a read-only API.

### Metadata API (`/meta`)

The metadata read surface lives under `/api/v1/meta` (separate from the data
CRUD routes above):

```
GET /api/v1/meta/:type            # List metadata items of a type (object, view, flow, doc, …)
GET /api/v1/meta/:type/:name      # Read a single metadata item
```

Three query-param contracts gained in 9.x:

- **`?preview=draft`** (#1763) — overlay pending **draft** metadata instead of the
  published copy, on both list and get. The draft path is **cache-bypassed**, so
  it always reflects the latest unpublished edit (ADR-0033/0037 authoring loop).
- **`?package=<packageId>`** (ADR-0048, #1816/#1819) — **package-scope** a read so
  two installed packages that share a bare metadata name disambiguate by owning
  package; prefer-local resolution. A package-scoped read **bypasses the meta
  cache**. The layered / Studio-editor read is package-scoped the same way.
- **`/meta/doc`** (ADR-0046, #1790) — docs-as-metadata. The **list** response omits
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
(`owner`, `internal_notes`, …). See `content/docs/ui/forms.mdx`
for the full contract.

### Custom Endpoints

For business logic beyond CRUD, define custom endpoints via the REST API
plugin:

```typescript
{
  name: 'close_case',
  path: '/api/v1/cases/:id/close',
  method: 'POST',
  description: 'Close a support case with resolution notes.',
  handlerStatus: 'implemented',
  request: {
    params: { id: { type: 'string', required: true } },
    body: {
      resolution: { type: 'string', required: true },
      satisfaction: { type: 'number', min: 1, max: 5 },
    },
  },
  response: {
    200: { description: 'Case closed successfully', schema: 'SupportCase' },
    404: { description: 'Case not found' },
    409: { description: 'Case already closed' },
  },
  auth: { required: true, permissions: ['support_agent'] },
}
```

---

## Endpoint Naming Conventions

| Pattern | Use Case | Example |
|:--------|:---------|:--------|
| `/api/v1/{object}` | Auto-generated collection | `/api/v1/accounts` |
| `/api/v1/{object}/:id` | Auto-generated record | `/api/v1/accounts/abc123` |
| `/api/v1/{object}/:id/{action}` | Custom action on record | `/api/v1/cases/:id/close` |
| `/api/v1/{domain}/{action}` | Domain-level action | `/api/v1/ai/chat` |

**Rules:**

- Always use **plural nouns** for collection paths (`accounts`, not `account`).
- Use **snake_case** for multi-word paths (`project_tasks`, not `projectTasks`).
- Use **verbs** only for actions, not for CRUD (`/close`, `/approve`).
- Always prefix with `/api/v1/` for versioning.

---

## API Methods (Operations)

The full set of operations an object can expose:

| Method | HTTP | Purpose |
|:-------|:-----|:--------|
| `get` | `GET /:id` | Retrieve a single record |
| `list` | `GET /` | List records with filter/sort/pagination |
| `create` | `POST /` | Create a new record |
| `update` | `PATCH /:id` | Update an existing record |
| `delete` | `DELETE /:id` | Delete a record |
| `upsert` | `PUT /` | Create or update by external ID |
| `bulk` | `POST /bulk` | Batch create/update/delete |
| `aggregate` | `GET /aggregate` | Count, sum, avg, min, max |
| `history` | `GET /:id/history` | Audit trail access |
| `search` | `GET /search` | Full-text search |
| `restore` | `POST /:id/restore` | Restore from trash |
| `purge` | `DELETE /:id/purge` | Permanent deletion |
| `import` | `POST /import` | Bulk data import |
| `export` | `GET /export` | Data export |

---

## Service Discovery

ObjectStack services register themselves with the kernel and expose discovery
metadata.

### Service Info Schema

```typescript
{
  name: 'service-rest-api',
  version: '1.0.0',
  status: 'healthy',       // 'healthy' | 'degraded' | 'unhealthy' | 'registered'
  handlerReady: true,       // HTTP handler verified and operational
  endpoints: [
    { path: '/api/v1/accounts', methods: ['GET', 'POST'] },
    { path: '/api/v1/accounts/:id', methods: ['GET', 'PATCH', 'DELETE'] },
  ],
}
```

### Health Endpoint

Every ObjectStack deployment exposes `/health`:

```json
{
  "status": "healthy",
  "version": "4.0.1",
  "services": {
    "objectql": { "status": "healthy" },
    "rest-api": { "status": "healthy" },
    "auth": { "status": "healthy" }
  }
}
```

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

## Authentication & Authorization

### Auth Configuration

```typescript
{
  auth: {
    required: true,            // Require authentication
    permissions: ['admin'],    // Required permission profiles
    rateLimit: {
      requests: 100,
      window: '1m',           // per minute
    },
  },
}
```

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

Connect to external data sources for virtualised data access:

```typescript
{
  name: 'legacy_erp',
  type: 'sql',
  driver: 'postgresql',
  connection: {
    host: 'erp.internal.example.com',
    port: 5432,
    database: 'erp_production',
    ssl: true,
  },
  readOnly: true,      // Safety for legacy systems
}
```

### Supported Drivers

| Driver | Use Case |
|:-------|:---------|
| `postgresql` | Primary production database |
| `mysql` | Legacy systems, WordPress integration |
| `sqlite` | Local development, embedded apps |
| `turso` | Edge SQLite (Turso/libSQL) — serverless |
| `memory` | Unit tests, development |

---

## Inter-Service Communication

### Service Contracts

ObjectStack uses typed service contracts defined in `@objectstack/spec/contracts`:

```typescript
// Service contract interface
interface DataService {
  find(object: string, query: QueryOptions): Promise<Record[]>;
  findOne(object: string, id: string): Promise<Record>;
  create(object: string, data: object): Promise<Record>;
  update(object: string, id: string, data: object): Promise<Record>;
  delete(object: string, id: string): Promise<void>;
}
```

### Kernel Service Resolution

Services are resolved through the microkernel:

```typescript
const dataService = kernel.resolve<DataService>('data');
const authService = kernel.resolve<AuthService>('auth');
const aiService = kernel.resolve<AIService>('ai');
```

---

## Best Practices

1. **Version your APIs** — always use `/api/v1/` prefix. Breaking changes get
   a new version (`v2`).
2. **Use auto-generated APIs** whenever possible. Only create custom endpoints
   for business logic that cannot be expressed through CRUD + triggers.
3. **Return consistent error shapes.** Use the `DispatcherErrorResponseSchema`
   format with `type`, `message`, and `hint`.
4. **Document every endpoint** with `description` and response schemas.
5. **Set `handlerStatus`** to communicate implementation progress to consumers.
6. **Apply least-privilege auth.** Every endpoint should declare its required
   permissions explicitly.
7. **Use `upsert` for idempotent writes.** External integrations should prefer
   `upsert` over `create` to avoid duplicates.

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
5. **Using `DELETE` for soft-delete.** ObjectStack `DELETE` performs soft-delete
   when `trash: true` is enabled on the object. Do not implement soft-delete
   logic in custom endpoints — use the built-in mechanism.

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

