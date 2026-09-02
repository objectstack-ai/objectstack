# Hook & Event System

Complete guide for using kernel hooks and events in ObjectStack plugins.

> **Scope.** The kernel hook bus carries **platform lifecycle** events only.
> Record-level data lifecycle (`beforeInsert` / `afterUpdate` / …) is a
> different system — see [Data lifecycle hooks live elsewhere](#data-lifecycle-hooks-live-elsewhere).

## Hook Registration

Register hook handlers in `init()` or `start()`:

```typescript
async init(ctx: PluginContext) {
  // Register a kernel hook handler
  ctx.hook('kernel:ready', async () => {
    ctx.logger.info('System is ready!');
  });

  // React to a metadata hot-reload / publish
  ctx.hook('metadata:reloaded', async (payload?: { changed?: string[] }) => {
    ctx.logger.info('Metadata reloaded', { changed: payload?.changed });
  });
}
```

## Triggering Events

Trigger custom hooks to notify other plugins:

```typescript
async start(ctx: PluginContext) {
  // Trigger a custom event
  await ctx.trigger('my-plugin:initialized', { version: '1.0.0' });
}
```

## Built-in Kernel Events

These are the events the open framework actually fires (trigger sites:
`@objectstack/core` kernels, `@objectstack/runtime` AppPlugin / dispatcher /
external-validation plugin, `@objectstack/metadata` plugin; typed in
`packages/spec/src/contracts/plugin-lifecycle-events.ts`):

| Event | Triggered When | Handler Arguments |
|:------|:---------------|:------------------|
| `kernel:ready` | All plugins started; route/middleware registration phase | (none) |
| `kernel:bootstrapped` | After **every** `kernel:ready` handler has settled — the "synchronous bootstrap has settled" anchor for reconcile/backfill work. Does NOT guarantee background app seed data has settled — subscribe `app:seeded` for that | (none) |
| `kernel:listening` | After `kernel:ready` + `kernel:bootstrapped` handlers complete — the cue for HTTP server plugins to open the listening socket | (none) |
| `kernel:shutdown` | Shutdown begins (before plugin `destroy()` calls) | (none) |
| `app:seeded` | An app's inline seed attempt has settled (fires during plugin start when within the seed budget; after boot when it overran it) | `({ appId: string, overBudget: boolean })` |
| `metadata:reloaded` | Metadata hot-reload or publish announcement (dev artifact reload, `POST /packages/:id/publish-drafts`) | `({ changed: string[], metadata? })` — `changed` entries are `'{type}/{name}'` strings, e.g. `'flow/ticket_closed'` |
| `external.schema.drift` | Background drift checker found a federated object whose external schema drifted (one event per drifted object) | `({ datasource, object, diffs })` |

Service plugins additionally announce readiness with a `{service}:ready`
convention — e.g. `analytics:ready`, `automation:ready`, `mcp:ready` — passing
the service instance. `plugin-auth` fires `auth:configure` while assembling
its config.

> There is **no** `metadata:changed` event — the real name is
> `metadata:reloaded`, and its payload is an object, not `(type, name, metadata)`.

## Data Lifecycle Hooks Live Elsewhere

**There are no `data:*` kernel events.** Record lifecycle logic runs on the
**ObjectQL engine** with a single `HookContext` argument and *unprefixed*
event names (`beforeFind`, `afterFind`, `beforeInsert`, `afterInsert`,
`beforeUpdate`, `afterUpdate`, `beforeDelete`, `afterDelete`). Author it via:

- the declarative `hooks:` collection in `defineStack()`, or
- the engine API: `ql.on('beforeInsert', 'task', async (hookCtx) => { … })`
  where `ql = ctx.getService('objectql')`.

Because `ctx.hook()` accepts any string, a handler registered for
`'data:beforeInsert'` on the kernel bus registers "successfully" and then
**silently never fires**. If you need per-record validation, defaults, or
audit trails, go to the **objectstack-data** skill (`rules/hooks.md`,
`references/data-hooks.md`).

## Custom Hooks

Create your own hooks following the convention: `{plugin-namespace}:{event-name}`
— namespace required, lower-case: `auth:user-login`, `billing:invoice-paid`;
never `userLogin` (no namespace) or `auth:USER_LOGIN`.

```typescript
// In your plugin
async start(ctx: PluginContext) {
  await ctx.trigger('analytics:pageview', {
    path: '/dashboard',
    userId: '123',
  });
}

// In another plugin
async init(ctx: PluginContext) {
  ctx.hook('analytics:pageview', async (data) => {
    console.log('Page viewed:', data.path);
  });
}
```

## Hook Handler Patterns

### Simple Handler

```typescript
ctx.hook('kernel:ready', async () => {
  console.log('System ready');
});
```

### Handler with Payload

```typescript
ctx.hook('app:seeded', async (payload: { appId: string; overBudget: boolean }) => {
  console.log(`Seed settled for ${payload.appId} (overBudget: ${payload.overBudget})`);
});
```

### Deferred Setup on kernel:ready

Plugins that need a service which may be registered by a *later* plugin
(e.g. i18n) defer that wiring to `kernel:ready`:

```typescript
async init(ctx: PluginContext) {
  ctx.hook('kernel:ready', async () => {
    try {
      const i18n = ctx.getService<any>('i18n');
      await i18n.loadTranslations(myBundle);
    } catch {
      ctx.logger.debug('i18n service not available — skipping translations');
    }
  });
}
```

### Rebinding on metadata:reloaded

Anything cached from boot-time metadata must re-sync when metadata reloads:

```typescript
ctx.hook('metadata:reloaded', async (payload?: { changed?: string[] }) => {
  await this.rebuildDerivedState(payload?.changed ?? []);
});
```

### Error Handling

Handlers run **sequentially** and errors propagate to the `trigger()` call
site — a throwing `kernel:ready` handler fails the whole bootstrap. Catch
and log unless you *want* to abort:

```typescript
ctx.hook('kernel:ready', async () => {
  try {
    await warmCache();
  } catch (error) {
    ctx.logger.error('Cache warm-up failed', error);
    // Don't rethrow — let boot continue
  }
});
```

## Incorrect vs Correct

### ❌ Incorrect — Subscribing to Phantom `data:*` Kernel Events

```typescript
ctx.hook('data:beforeInsert', async (objectName, record) => {
  record.created_at = new Date().toISOString();  // ❌ NEVER fires
});
```

### ✅ Correct — Engine Hook for Record Lifecycle

```typescript
async start(ctx: PluginContext) {
  const ql = ctx.getService<any>('objectql');
  ql.on('beforeInsert', 'task', async (hookCtx: any) => {
    // ✅ Real engine hook — single HookContext argument
    // (see objectstack-data for the HookContext contract)
  });
}
```

### ❌ Incorrect — Reconcile Work in kernel:ready That Reads Other Plugins' Boot Data

```typescript
ctx.hook('kernel:ready', async () => {
  await backfillFromSeededRows();  // ❌ Races the producer's own kernel:ready handler
});
```

### ✅ Correct — Use kernel:bootstrapped (or app:seeded for seed rows)

```typescript
ctx.hook('kernel:bootstrapped', async () => {
  await backfillFromSeededRows();  // ✅ Every kernel:ready handler has settled
});
// For rows written by an over-budget background seed, subscribe app:seeded.
```

### ❌ Incorrect — Server listen() in kernel:ready

```typescript
ctx.hook('kernel:ready', async () => {
  await server.listen(port);  // ❌ Sibling plugins may still be adding routes
});
```

### ✅ Correct — listen() in kernel:listening

```typescript
ctx.hook('kernel:listening', async () => {
  await server.listen(port);  // ✅ All route registration has completed
});
```

## Hook Execution Order

Hooks are executed in **registration order** within each event — and since
plugins register during `init()` in dependency order, that means plugin
initialization order overall.

```typescript
// Plugin A (depends on nothing)
ctx.hook('kernel:ready', () => console.log('A'));

// Plugin B (depends on A)
ctx.hook('kernel:ready', () => console.log('B'));

// Output: A, B
```

Handlers for one event run **sequentially and are awaited**; the next
lifecycle phase does not begin until every handler settles.

## Testing Hooks

`kernel.context` is **protected** — tests cannot call
`kernel.context.trigger(...)`. Capture a `PluginContext` from a probe plugin
and trigger through it:

```typescript
import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';

describe('Hook System', () => {
  it('executes hook handler', async () => {
    const kernel = new LiteKernel({ logger: { level: 'silent' } });
    let hookCalled = false;
    let probe!: PluginContext;

    kernel.use({
      name: 'test-plugin',
      async init(ctx) {
        probe = ctx;
        ctx.hook('test:event', async () => {
          hookCalled = true;
        });
      },
    });

    await kernel.bootstrap();
    await probe.trigger('test:event');

    expect(hookCalled).toBe(true);

    await kernel.shutdown();
  });
});
```

## Rules of thumb

✅ Kernel hooks carry **platform lifecycle only**; record lifecycle is an
engine hook (objectstack-data).
✅ Pick the anchor by what must already have happened: route/service
registration → `kernel:ready`; reconcile/backfill → `kernel:bootstrapped`;
socket `listen()` → `kernel:listening`; seed-dependent (idempotent) work →
`app:seeded`.
✅ Catch handler errors unless you want to abort boot — they propagate.
✅ Rebind anything derived from boot-time metadata on `metadata:reloaded`.

❌ Never subscribe to a `data:*` kernel event — it registers and never fires.
❌ Never `kernel.context.trigger(...)` in a test — `context` is protected;
trigger through a probe plugin's `PluginContext`.
❌ Never create a circular plugin dependency — both kernels throw.
