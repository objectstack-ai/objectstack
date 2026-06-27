# Upgrading to ObjectStack 11

ObjectStack 11 is a focused breaking release: it sharpens the **open edition** down
to what is actually shipped and dogfooded, and removes a batch of long-deprecated
APIs. This guide lists every breaking change from **10.x → 11.x** with a concrete
migration for each.

> The breaking changes are spread across the 11 line (11.0.0 + 11.1.0). There is
> one migration target: **the latest 11.x**. Pin `@objectstack/*` to `^11`.

## Quick checklist

- [ ] AI authoring service is no longer bundled in the open edition → see [MCP-only](#open-edition-is-mcp-only).
- [ ] Using a non-Hono HTTP adapter (Express/Fastify/Next/Nest/Nuxt/SvelteKit) or `@objectstack/plugin-msw`? → [Adapters](#http-adapters-hono-only).
- [ ] Flow nodes typed `http_request` / `http_call` / `webhook` → rename to `http`.
- [ ] `@objectstack/client-react` `useQuery` using `select`/`filters`/`sort`/`top`/`skip` → canonical names.
- [ ] Code referencing `IUIService` → `IMetadataService`.
- [ ] Driver code typed `DriverInterface` (the alias) → `IDataDriver`.
- [ ] `.env` using `OS_MULTI_TENANT` / `OBJECTSTACK_METADATA_WRITABLE` / `AUTH_BASE_URL` → rename.
- [ ] Stack `policies` / `definePolicy` → removed (was never enforced).

---

## Open edition is MCP-only

The bundled AI authoring service (`@objectstack/service-ai`) is **no longer part of
the open distribution** (ADR-0025). AI integrates through MCP (`@objectstack/mcp`)
plus the documented opt-in seam.

**Migration**
- If you don't use AI authoring: nothing to do.
- If you do: declare `@objectstack/service-ai` / `@objectstack/service-ai-studio`
  as an app dependency (the CLI auto-registers the service only when the host app
  declares it), or run on the commercial distribution. MCP tooling is unaffected.

## HTTP adapters: Hono only

The open edition now ships **only the Hono adapter** (`@objectstack/hono`). These
packages were removed (zero internal consumers, not dogfooded):
`@objectstack/express`, `@objectstack/fastify`, `@objectstack/nextjs`,
`@objectstack/nestjs`, `@objectstack/nuxt`, `@objectstack/sveltekit`, and
`@objectstack/plugin-msw`.

**Migration**
- **On Hono already** → no change.
- **On another framework** → either move to Hono (`createHonoApp` / `objectStackMiddleware`,
  runs on Node/Bun/Deno/Workers), or build a thin adapter on the public
  `HttpDispatcher` API / `createDispatcherPlugin` (the removed adapters were ~50-line
  wrappers; you can vendor one out-of-tree).
- **Used `@objectstack/plugin-msw`** for test mocking → use `msw` directly, or
  drive the kernel via `@objectstack/hono` in tests.

```ts
// before: import { objectStackPlugin } from '@objectstack/fastify';
import { createHonoApp } from '@objectstack/hono';
const app = createHonoApp({ kernel, prefix: '/api/v1' });
```

## Flow node type: `http`

The deprecated flow-node aliases `http_request` / `http_call` / `webhook` are
removed; the canonical type is **`http`** (same behavior — durable outbox when
`config.durable`, inline fetch otherwise). Authoring a removed type now fails fast
at parse instead of silently resolving.

```ts
// before: { id: 'call', type: 'http_request', config: { url, method } }
{ id: 'call', type: 'http', config: { url, method } }
```

> The trigger `eventType: 'webhook'` and the `webhook` resume event are unchanged —
> only the HTTP **node** aliases were removed.

## `@objectstack/client-react`: canonical query fields

`useQuery` / `useInfiniteQuery` no longer accept the legacy aliases:

| removed | use |
|---|---|
| `select`  | `fields`  |
| `filters` | `where`   |
| `sort`    | `orderBy` |
| `top`     | `limit`   |
| `skip`    | `offset`  |

```ts
// before: useQuery('account', { select: ['name'], filters, sort, top: 20, skip: 40 })
useQuery('account', { fields: ['name'], where, orderBy, limit: 20, offset: 40 });
```

## `IUIService` → `IMetadataService`

The deprecated `IUIService` contract is removed. Views and dashboards are metadata:

```ts
// before: ui.getView(name) / ui.registerView(name, def)
metadata.get('view', name);
metadata.register('view', name, def);
```

## `DriverInterface` (alias) → `IDataDriver`

The deprecated `DriverInterface` type alias (`= IDataDriver`) is removed. Use
`IDataDriver` — the shape is identical.

```ts
// before: import { DriverInterface } from '@objectstack/runtime';
import type { IDataDriver } from '@objectstack/spec/contracts';
```

> Unrelated and unchanged: the live `IDataEngine` (engine-layer contract) and the
> zod-derived `DriverInterface` / `DriverInterfaceSchema` in `@objectstack/spec/data`.

## Environment variables: ObjectStack's own renames removed

The framework's **own** legacy env names are removed — rename them:

| removed | use |
|---|---|
| `OS_MULTI_TENANT` | `OS_MULTI_ORG_ENABLED` |
| `OBJECTSTACK_METADATA_WRITABLE` | `OS_METADATA_WRITABLE` |
| `OS_AUTH_BASE_URL`, `AUTH_BASE_URL` | `OS_AUTH_URL` |

**Ecosystem-standard names still work** (and no longer warn): `DATABASE_URL`,
`AUTH_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PORT`, `CORS_*`,
`LOG_LEVEL`, `ROOT_DOMAIN`, `MCP_SERVER_*`.

## `PolicySchema` / `definePolicy` removed

The "org security policy" schema (`PolicySchema`, `definePolicy`, and the stack
`policies` collection) is removed — it was parsed but **never enforced** at runtime
(ADR-0049). `better-auth` governs session/password behavior; there is no functional
loss.

**Migration**: delete `policies: [...]` from `defineStack(...)` and any
`definePolicy(...)` definitions. For real password/session policy, configure
`@objectstack/plugin-auth`. `SharingRule` / `PermissionSet` / RLS are unaffected.

---

## Behavioral changes to be aware of (not API-breaking)

11 also hardens authentication (ADR-0069). These don't change your code but can
change runtime behavior for end users:

- Breached passwords are rejected (HIBP).
- Account lockout + login rate-limiting.
- Optional password expiry, history/no-reuse, complexity, and enforced MFA
  (per-org). Review your `@objectstack/plugin-auth` configuration before rollout.

## Getting help

If a removed adapter or API blocks you, open an issue — thin adapters and the
`HttpDispatcher` API are public, so out-of-tree maintenance is straightforward.
