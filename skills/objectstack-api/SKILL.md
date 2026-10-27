---
name: objectstack-api
description: >
  Design the server-side API surface that an ObjectStack runtime exposes —
  REST endpoints, auth providers, realtime channels, error envelopes,
  batch contracts. Use when the user is adding `*.endpoint.ts`,
  configuring auth providers, defining custom routes, or extending the
  REST generator. Do not use for: consuming an ObjectStack API from
  a client (that is just standard HTTP — no skill needed); the auto-generated
  CRUD endpoints (those follow from objectstack-data); request-side query
  syntax (see objectstack-query). CEL expressions in route guards or auth
  predicates: load objectstack-formula alongside.
license: Apache-2.0
compatibility: Requires @objectstack/spec 18.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "18.1.0"
  domain: api
  tags: rest, endpoint, auth, realtime, server
---

# API Design — ObjectStack API Protocol

## Skill Boundaries

| Need | Use instead |
|:-----|:------------|
| Model objects, fields, permissions, or datasources | **objectstack-data** |
| Filter, sort, paginate, or aggregate a request | **objectstack-query** |
| Register a kernel service, or read one from a plugin | **objectstack-platform** |
| CEL in a route guard or auth predicate | **objectstack-formula** |

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

> **Key rule:** If your object defines `apiMethods`, only those operations (and
> what derives from them) are exposed; `[]` means deny-all. The authorable
> values are the six primitives — see **API Methods (Operations)**.

### Metadata API (`/meta`)

The metadata read surface lives under `/api/v1/meta` (separate from the data
CRUD routes above):

```
GET /api/v1/meta/:type            # List metadata items of a type (object, view, flow, doc, …)
GET /api/v1/meta/:type/:name      # Read a single metadata item
```

The read-side query params (`?preview=draft`, `?package=`, `?include=content`)
are **client** contracts — nothing in a stack declares them.

### Public (anonymous) Form Endpoints

A `FormView` is served by the anonymous form endpoints only when its
`sharing` declares all three: `enabled: true` (the schema default is
`false`), `allowAnonymous: true` and a `publicLink` slug. Miss any one and
both endpoints answer `404 FORM_NOT_FOUND`. The form is then mounted at:

```
GET  /api/v1/forms/:slug         # returns form spec + restricted objectSchema
POST /api/v1/forms/:slug/submit  # whitelist-filtered INSERT, no auth header
```

These bypass `enforceAuth` (Web-to-Lead / Web-to-Case flows). The form's own
declaration authorizes the submit: a `publicFormGrant` on its target object
(create and read-back of its new row, nothing else), decided before any permission
set resolves. The submit context's `guest_portal` name admits nothing and needs
no set; a set so named only feeds the grant's result masker. The framework
strips fields outside the form's `sections[].fields[]` list; a
`beforeInsert` hook on the target object should stamp safe defaults
(`status='new'`, `lead_source='web'`, …) and `delete` privileged keys
(`owner`, `internal_notes`, …). On a walled posture (`group`/`isolated`), a
form on an object walled by an organization column is withheld too — both
endpoints `404`, and save / publish warn `public-form-intake-unavailable`;
declare `tenancy: { enabled: false }` on an object whose rows belong to no
organization to offer it again. For the full contract, read
`node_modules/@objectstack/spec/src/ui/view.zod.ts` (`FormViewSchema`) and
`node_modules/@objectstack/spec/src/ui/sharing.zod.ts` (`SharingConfigSchema`
with `enabled` / `allowAnonymous` / `publicLink`).

A form open to anonymous intake declares no file field. A section field whose
object type is in `FILE_REFERENCE_TYPES` (`image`, `file`, `avatar`, `video`,
`audio`) is refused by the gating lint rule `public-form-file-field` — at
`os validate` / `os build` / `os lint`, and at the view's publish — because a
visitor has no upload door to mint a `sys_file` id. A form published before that
rule meets the same refusal at submit: a file value answers the flat `400
VALIDATION_FAILED` with `fields[].code: 'invalid_value'`. Collect the file on a
signed-in form instead.

---

## Declarative Endpoints (`apis:`) — no handler code

`defineStack({ apis })` declares an HTTP endpoint as **metadata**. Declared
endpoints are **live from protocol 17**: the runtime matches
`METHOD` + `path`, runs the endpoint's policy keys, and delegates to the *same*
pipelines the built-in routes use — `object_operation` to the data pipeline
behind `/api/v1/data/{object}`, `flow` to the automation pipeline behind
`POST /api/v1/automation/{name}/trigger`. An endpoint is a stable URL plus a
policy layer over an existing pipeline, never a second execution dialect.

### Choosing between `apis:` and a code handler

| Use | When |
|:---|:---|
| **`defineStack({ apis })`** | The endpoint is a *projection* of something the platform already executes: query/return records, or trigger a flow. No code, no deploy artifact, publish-gated. **Prefer this.** |
| **A flow that runs your code** | The endpoint needs real handler CODE: point a `type: 'flow'` endpoint at a flow whose `script` node names a stack function (`defineStack({ functions })`), or whose `connector_action` node calls a declared connector (outbound). The URL stays declarative; the code runs where the automation surface already runs it. |

An inbound webhook from a sender you control is a `type: 'api'` flow
(objectstack-automation → **Inbound webhook (`api`) triggers**): it verifies
ObjectStack's own `x-objectstack-signature`, enqueues, and answers `202`.
**An app never mounts on `http.server`** — that service is the platform
plugins' own door-building primitive, and a code-mounted route gets no caller
identity, auth gate, rate limit, namespace carve-out or OpenAPI entry. Three
cases have no app surface today; say so rather than invent one: a third-party
callback verified by its own signature over the raw body (the hook checks only
`x-objectstack-signature`), a streaming response (a declared endpoint answers
one JSON envelope), and a protocol the platform does not speak.

<!-- os:check -->
```typescript
import type { ApiEndpoint } from '@objectstack/spec/api';

// The stack declares `manifest: { namespace: 'acme', … }` — required, see below.
export const leadFeed: ApiEndpoint = {
  name: 'acme_lead_feed',
  path: '/api/v1/apps/acme/leads',      // /api/v1/apps/<namespace>/<subpath>
  method: 'GET',
  summary: 'Lead feed',
  type: 'object_operation',
  objectParams: { object: 'acme_lead', operation: 'find' },
  // `authRequired` omitted → defaults to `true`. Omission is SAFE.
  cacheTtlSeconds: 30,                   // GET-only; rides success answers only
};
```

### The path carve-out (ADR-0121 D1/D2)

A declared path must be `/api/v1/apps/<manifest.namespace>/<subpath>`. Only the
subpath is yours to name, and the ordinary naming rules below apply inside it.
`manifest.namespace` must be declared **explicitly** — it is never derived from
`manifest.id`. A path outside the carve-out is rejected at publish.

### Five publish gates, each with a prescription

A declaration this runtime cannot serve is **rejected at publish**, one gate at
a time. Do not memorise the gate texts; **read the rejection**, it carries the
fix. The five: **namespace** (the carve-out above), **supported target**
(`script` / `proxy` do not execute in 17.x; an `object_operation` needs both
`objectParams.object` and `.operation`; a `flow` needs a `target`),
**mapping** (below), **policy** (below), and **uniqueness** (one `METHOD` +
path claim per stack).

### `authRequired` and the D6 pairing

`authRequired` defaults to `true`, so **omitting it is safe**. An explicit
`false` is the only thing that opens an anonymous, unauthenticated execution
entry point — and ADR-0121 **D6** pairs it with an *armed* budget:

```typescript
authRequired: false,
rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 100 },
```

The gate's predicate is `rateLimit.enabled === true`, **not** the key's presence:
`RateLimitConfigSchema.enabled` itself defaults to `false`, so writing only
`windowMs` / `maxRequests` declares a budget that meters nothing. Endpoint
budgets are metered independently of the server-level `server.security.rateLimit`.

### Mapping keys: projection only

`inputMapping` / `outputMapping` **move and rename fields by dot path, and
nothing more**. `inputMapping` maps the REQUEST BODY, applied after the policy
chain and before delegation (so a mapping can never buy a caller past
`authRequired` or the rate limiter); `outputMapping` is applied to a **successful**
response body only. Three consequences worth knowing before you author one:

- `transform` is rejected — there is no transformation-function registry.
  Compute the value where it is produced (a flow, or a formula field).
- `inputMapping` is rejected on a `find` / `get` / `delete` `object_operation`,
  which never reads a request body.
- Two entries cannot write the same target path, nor one inside the other
  (`x` and `x.y`).

### Upgrading a pre-17 stack

An `apis:` block written against an older major **changes meaning without
changing a byte** — inert documentation becomes an execution entry point. Work
through the `declarative-apis-endpoints-live` entry of the protocol upgrade
guide before upgrading; it is a security review, not a rename. Its two
load-bearing steps: move every `path` into the carve-out, and grep every entry
for `authRequired: false`.

---

## Endpoint Naming Conventions

| Pattern | Use Case | Example |
|:--------|:---------|:--------|
| `/api/v1/data/{object}` | Auto-generated collection | `/api/v1/data/accounts` |
| `/api/v1/data/{object}/:id` | Auto-generated record | `/api/v1/data/accounts/abc123` |
| `/api/v1/{object}/:id/{action}` | Custom action on record | `/api/v1/cases/:id/close` |
| `/api/v1/{domain}/{action}` | Domain-level action | `/api/v1/ai/chat` |
| `/api/v1/apps/{namespace}/{subpath}` | Declarative `apis:` endpoint — the carve-out, not a free choice | `/api/v1/apps/acme/leads` |

**Rules:**

- Always use **plural nouns** for collection paths (`accounts`, not `account`).
- Use **snake_case** for multi-word paths (`project_tasks`, not `projectTasks`).
- Use **verbs** only for actions, not for CRUD (`/close`, `/approve`).
- Always prefix with `/api/v1/` for versioning.

---

## API Methods (Operations)

The authorable `ApiMethod` enum is the SIX PRIMITIVES. The wider EFFECTIVE
vocabulary (`ApiOperation`, 14 values) is what gates and responses speak; its
eight extra verbs are never declared in `apiMethods`:

**Authorable primitives:**

| Method | HTTP surface today | Purpose |
|:-------|:-------------------|:--------|
| `get` | `GET /data/{object}/:id` | Retrieve a single record |
| `list` | `GET /data/{object}` | List records with filter/sort/pagination |
| `create` | `POST /data/{object}` | Create a new record |
| `update` | `PATCH /data/{object}/:id` | Update an existing record |
| `delete` | `DELETE /data/{object}/:id` | Delete a record |
| `bulk` | `POST /data/{object}/batch` | Batch create/update/delete (bulk ∧ child op) |

**Derived operations (granted automatically, never authored):**

| Operation | Derives from | HTTP surface today |
|:----------|:-------------|:-------------------|
| `upsert` | `create` ∧ `update` | none generated |
| `aggregate` | `list` | `POST /data/{object}/query` with `groupBy`/`aggregations` |
| `search` | `list` ∧ `searchable` | global `GET /api/v1/search`, not per-object |
| `import` | `create` ∨ `update` (writeMode-precise) | `POST /data/{object}/import` |
| `export` | `list` | `GET /data/{object}/export` |

`history` (from `get` ∧ `trackHistory`) gates only. `restore` / `purge` never
derive — the trash surface is retired. Declaring any derived verb in
`apiMethods` is stripped at parse with a FROM → TO warning.

`POST /data/{object}/import` takes `mapping` as `{ Column: field }` or as
`FieldMappingEntry[]` (`api/export.zod.ts`); only the entry form carries
`applyOn`. `'always'` (default) writes the column on every row the import
creates or updates; `'create'` writes it only when the row is created, so a
re-run `upsert` refreshes the `always` columns and leaves a value an admin set
since (an owner, a stage) as it is. A create-only column is still read for
matching. Any other value is `400 INVALID_REQUEST`.

---

## Discovery & Health

`GET /api/v1/health`, `GET /ready` (200 running / 503 booting) and
`GET /api/v1/discovery` (per-service status) exist on **every** deployment.
All three are **response** surfaces — nothing to author.

---

## Dispatcher Error Codes

The **HttpDispatcher** is the central request router; it answers:

| HTTP Status | Error Code | When |
|:------------|:-----------|:-----|
| 404 | `ROUTE_NOT_FOUND` | No route matches the path |
| 405 | `METHOD_NOT_ALLOWED` | Route exists but method not supported |
| 501 | `NOT_IMPLEMENTED` | Route declared but handler is a stub |
| 503 | `SERVICE_UNAVAILABLE` | Service is registered but not ready |

---

## Realtime Subscriptions

Realtime contracts are pointer-style — read the spec source for exact shapes:

- `node_modules/@objectstack/spec/src/api/realtime.zod.ts` — `TransportProtocol`
  (`websocket` | `sse` | `polling`), `SubscriptionSchema` (`id`, `events[]`,
  `transport`, optional `channel`), `RealtimeEventSchema`, and
  `RealtimeConfigSchema`.
- `node_modules/@objectstack/spec/src/api/websocket.zod.ts` — the WebSocket
  message protocol: subscribe/unsubscribe messages, event delivery, presence,
  cursor and collaborative-edit messages, and ack/error/ping/pong frames.

---

## Authentication & Authorization

RBAC (`definePermissionSet`) and RLS are objectstack-data's surface, not this
one; this section is the endpoint's own auth keys.

### Auth Configuration

There is no nested `auth` block on an endpoint, and no `name` / `request` /
`response` field: auth is the flat `public` + `permissions` pair on
`RestApiEndpointSchema`, and declarative `ApiEndpointSchema` endpoints (and the
dispatcher) use `authRequired: boolean` (default `true`) — setting it `false`
obliges you to arm a `rateLimit` (ADR-0121 D6 — see **Declarative Endpoints →
`authRequired` and the D6 pairing** above). Rate-limit policies themselves are
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

---

## Datasources

`defineDatasource`, `schemaMode`, the `external` write gate and
`credentialsRef` are objectstack-data → `rules/datasources.md`; driver packages
and the Turso Cloud/EE caveat are objectstack-platform → **Driver Selection
Guide**; the `driver` id vocabulary is `data/driver/config-registry.zod.ts`.

---

## Error Envelopes & the Code Ledger (ADR-0112)

`error.code` is **two-tier**: the closed `StandardErrorCode` catalog plus the
codes registered per owning package in `api/error-code-ledger.zod.ts`.
`ApiErrorSchema.code` validates the union, so an **unregistered code fails
parse → fails the envelope conformance suites → fails CI**.

That ledger takes **framework packages only**. A downstream repo keeps its OWN
ledger and composes the two checks itself — `envelopeViolations(body)` for the
SHAPE, `makeApiErrorSchema(yourCodes)` for the VOCABULARY (both in
`api/contract.zod.ts`). What no repo may do is emit a code in no ledger at all.

A flow door — `POST /api/v1/automation/{name}/trigger`, resume, `/actions`, a
declared `type: 'flow'` endpoint — answers a failed run with `400 FLOW_FAILED`;
its `error.details` is `FlowFailureDetailsSchema` (`api/automation-api.zod.ts`):
`errorMessage?` (the flow author's text), `summary?` (which node failed) and
`innerRefusal?`, the `{ code, message }` a node's write was refused with, `code`
in its wire spelling (`UNIQUE_VIOLATION`, `VALIDATION_FAILED`,
`PERMISSION_DENIED`). Render it as a record form renders a refused save:
top-level `userMessage`, then `details.innerRefusal`, then `message`. Absent
keys mean the run produced none — never invent an empty.

---

## Best Practices

1. **Use auto-generated APIs** whenever possible. Only create custom endpoints
   for business logic that cannot be expressed through CRUD + triggers.
2. **Return consistent error shapes.** The dispatcher envelope is
   `DispatcherErrorResponseSchema`: `{ success: false, error: { code, message,
   httpStatus?, route?, service?, hint? } }`, where `code` is the **semantic**
   string and `code`/`message` are required. General API errors use
   `ErrorResponseSchema` (`errors.zod.ts`). Be aware the shipped data routes
   return flat `{ error, code }` bodies instead (e.g. `CONCURRENT_UPDATE` →
   409, `VALIDATION_FAILED` → 400) — do not assume every error arrives in the
   `success: false` envelope.
3. **Apply least-privilege auth.** Every endpoint should declare its required
   permissions explicitly.
4. **Design idempotent writes deliberately.** No upsert route is generated, so
   an external integration queries by its unique external ID and branches to
   create or update — group those writes through
   `POST /api/v1/data/{object}/batch`.

---

## Common Pitfalls

1. **Not handling 409 Conflict.** The generated `PATCH /api/v1/data/{object}/:id`
   route does optimistic concurrency with two spellings: the `If-Match` header
   **or** an `expectedVersion` field in the JSON body — **the body wins** when
   both are sent, and the token is typically the `updated_at` value the client
   read. Sending neither skips the check; a mismatch answers **409
   `CONCURRENT_UPDATE`**; the quoted-empty entity-tag (`""`) is refused **400
   `VALIDATION_FAILED`**, not treated as omitted.
2. **Assuming `DELETE` is recoverable.** ObjectStack `DELETE` is a hard
   delete — there is no recycle bin (the dead `enable.trash` flag was removed
   in 16.x). For recoverability, use per-field `trackHistory` (audit
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

