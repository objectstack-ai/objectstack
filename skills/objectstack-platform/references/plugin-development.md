# Part 2 — Plugin Development & Kernel Extension


## Quick Reference — Detailed Rules

For comprehensive documentation with incorrect/correct examples:

- **[Plugin Lifecycle](../rules/plugin-lifecycle.md)** — 3-phase lifecycle (init/start/destroy), execution order, complete examples
- **[Service Registry](../rules/service-registry.md)** — DI container, factories, lifecycles (singleton/transient/scoped), core fallbacks
- **[Hooks & Events](./plugin-hooks.md)** — Kernel hooks & events reference (record-level lifecycle hooks → [objectstack-data](../../objectstack-data/SKILL.md))

---

## ObjectKernel vs LiteKernel

| Feature | ObjectKernel | LiteKernel |
|:--------|:-------------|:-----------|
| **Use case** | Production servers, full applications | Serverless, edge, unit tests |
| **Package** | `@objectstack/core` | `@objectstack/core` |
| **Plugin loading** | Async with validation & metadata | Synchronous `use()` |
| **Service factories** | Singleton / Transient / Scoped | Direct instances only |
| **Health monitoring** | Built-in per-plugin health checks | Not available |
| **Graceful shutdown** | Timeout + rollback on failure | Basic destroy phase |
| **Dependency resolution** | Topological sort + circular detection (throws) | Topological sort (throws on cycles) |
| **Core fallbacks** | Auto-injects in-memory fallbacks | Not available |
| **Config validation** | Zod schema validation per plugin | Not available |

### A third answer: no kernel at all

If the host only needs the **data engine** — query / CRUD / hooks / validation —
neither kernel is the answer. Import `ObjectQL` from
`@objectstack/objectql/core` (ADR-0076): no kernel, no `ObjectQLPlugin`, no
metadata-management layer, and the *same* `ObjectSchema.create({ … })`
definitions a full backend ships. `examples/embed-objectql` is the worked
example; it is the right shape for a thin, latency-sensitive host such as a
gateway.

### ObjectKernel Configuration

```typescript
import { ObjectKernel } from '@objectstack/core';

const kernel = new ObjectKernel({
  logger: {
    level: 'info',      // debug|info|warn|error|fatal|silent
    format: 'json',          // 'json' | 'text' | 'pretty'
  },
  defaultStartupTimeout: 30000,   // Per plugin (ms)
  gracefulShutdown: true,         // Register SIGINT/SIGTERM handlers
  shutdownTimeout: 60000,         // Total shutdown timeout (ms)
  rollbackOnFailure: true,        // Rollback all plugins if one fails
  skipSystemValidation: false,    // Skip system checks (useful for tests)
});
```

### LiteKernel Configuration

```typescript
import { LiteKernel } from '@objectstack/core';

const kernel = new LiteKernel({
  logger: { level: 'warn' },
});
```

---

## Plugin Interface — Quick Overview

```typescript
import type { Plugin, PluginContext } from '@objectstack/core';

export interface Plugin {
  name: string;               // Unique identifier (reverse domain recommended)
  version?: string;           // Semantic version
  type?: PluginType;          // closed set exported by @objectstack/core
  dependencies?: string[];    // Plugins that must init before this one

  // Phase 1: Register services
  init(ctx: PluginContext): Promise<void> | void;

  // Phase 2: Execute business logic (optional)
  start?(ctx: PluginContext): Promise<void> | void;

  // Phase 3: Cleanup (optional)
  destroy?(): Promise<void> | void;
}
```

See [rules/plugin-lifecycle.md](../rules/plugin-lifecycle.md) for complete examples.

---

## PluginContext API

### Service Registry

```typescript
// Register a service (in init phase)
ctx.registerService('my-service', myServiceInstance);

// Get a service (in start phase)
const db = ctx.getService<IDataEngine>('objectql');

// Replace a service
ctx.replaceService('cache', new InstrumentedCache(existingCache));

// Get all services
const allServices: Map<string, any> = ctx.getServices();
```

See [rules/service-registry.md](../rules/service-registry.md) for factories and lifecycles.

### Hook / Event System

```typescript
// Register a kernel hook handler
ctx.hook('kernel:ready', async () => {
  ctx.logger.info('System is ready!');
});

// React to a metadata hot-reload / publish
ctx.hook('metadata:reloaded', async (payload?: { changed?: string[] }) => {
  ctx.logger.info('Metadata reloaded', { changed: payload?.changed });
});

// Trigger a custom hook
await ctx.trigger('my-plugin:initialized', { version: '1.0.0' });
```

Built-in kernel events: `kernel:ready`, `kernel:bootstrapped`,
`kernel:listening`, `kernel:shutdown`, `app:seeded`, `metadata:reloaded`,
`external.schema.drift`.

> **⚠️ There are no `data:*` kernel hooks.** Record-level lifecycle logic
> (beforeInsert / afterUpdate / …) runs on the **ObjectQL engine**, not the
> kernel event bus — author it via the `hooks:` collection or
> `ql.on('beforeInsert', 'task', async (ctx) => { … })` (see
> **objectstack-data**). Because `ctx.hook()` accepts any string, a handler
> registered for `'data:beforeInsert'` will register successfully and then
> **silently never fire**. Kernel hooks are for platform lifecycle only.

See [references/plugin-hooks.md](./plugin-hooks.md) for the kernel event list, payloads, and patterns.

### Logger

```typescript
ctx.logger.debug('Detailed trace info', { key: 'value' });
ctx.logger.info('Plugin initialized');
ctx.logger.warn('Cache miss rate high', { rate: 0.45 });
ctx.logger.error('Connection failed', error);
```

### Kernel Access

```typescript
const kernel = ctx.getKernel();
const isRunning = kernel.isRunning();
const state = kernel.getState(); // 'idle' | 'initializing' | 'running' | 'stopping' | 'stopped'
```

---

## Complete Plugin Example

```typescript
// src/plugins/audit.ts
import type { Plugin, PluginContext } from '@objectstack/core';

interface AuditEntry {
  timestamp: string;
  event: string;
  detail?: Record<string, unknown>;
}

class AuditService {
  private log: AuditEntry[] = [];

  record(event: string, detail?: Record<string, unknown>) {
    this.log.push({ timestamp: new Date().toISOString(), event, detail });
  }

  getLog(): AuditEntry[] {
    return [...this.log];
  }
}

const AuditPlugin: Plugin = {
  name: 'com.example.audit',
  version: '1.0.0',
  type: 'plugin',

  async init(ctx: PluginContext) {
    // Phase 1: Register service and kernel hooks
    const auditService = new AuditService();
    ctx.registerService('audit', auditService);

    ctx.hook('kernel:ready', async () => {
      auditService.record('kernel:ready');
    });

    ctx.hook('metadata:reloaded', async (payload?: { changed?: string[] }) => {
      auditService.record('metadata:reloaded', { changed: payload?.changed });
    });

    ctx.logger.info('Audit plugin initialized');
  },

  async start(ctx: PluginContext) {
    // Phase 2: Log that audit is active
    ctx.logger.info('Audit logging active');
  },

  async destroy() {
    // Phase 3: Cleanup
  },
};

export default AuditPlugin;
```

---

## Using Plugins

```typescript
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { DriverPlugin } from '@objectstack/runtime';
import { InMemoryDriver } from '@objectstack/driver-memory';
import AuditPlugin from './plugins/audit';

const kernel = new ObjectKernel();
await kernel.use(new ObjectQLPlugin());
await kernel.use(new DriverPlugin(new InMemoryDriver()));
await kernel.use(AuditPlugin);
await kernel.bootstrap();

// Services are now available
const audit = kernel.getService('audit');
```

---

## Testing Plugins

```typescript
import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import AuditPlugin from './audit';

describe('AuditPlugin', () => {
  it('records kernel lifecycle events', async () => {
    const kernel = new LiteKernel({ logger: { level: 'silent' } });
    kernel.use(AuditPlugin);

    // `kernel.context` is protected — to fire events in a test, capture a
    // PluginContext from a probe plugin instead.
    let probe!: PluginContext;
    kernel.use({ name: 'test.probe', init(ctx) { probe = ctx; } });

    await kernel.bootstrap();   // fires kernel:ready → recorded

    // Simulate a metadata hot-reload announcement
    await probe.trigger('metadata:reloaded', { changed: ['object/task'] });

    const audit = kernel.getService<{ getLog(): { event: string }[] }>('audit');
    const events = audit.getLog().map((e) => e.event);
    expect(events).toContain('kernel:ready');
    expect(events).toContain('metadata:reloaded');

    await kernel.shutdown();
  });
});
```

---

## Well-Known Plugin Names & Services

| Plugin Name | Service Key | Package |
|:------------|:------------|:--------|
| `com.objectstack.engine.objectql` | `objectql` (also `data`) | `@objectstack/objectql` |
| `com.objectstack.driver.*` | `driver.{name}` | `@objectstack/driver-*` |
| `com.objectstack.auth` | `auth` | `@objectstack/plugin-auth` |
| `com.objectstack.rest.api` | — (registers no service) | `@objectstack/rest` |
| `com.objectstack.metadata` | `metadata` | `@objectstack/metadata` |
| `com.objectstack.service.realtime` | `realtime` | `@objectstack/service-realtime` |
| `com.objectstack.service.cache` | `cache` | `@objectstack/service-cache` |
| `com.objectstack.server.hono` | — | `@objectstack/plugin-hono-server` → `HonoServerPlugin` |
| `com.objectstack.setup` | — | `@objectstack/setup` → `createSetupAppPlugin` (ADR-0048 one-app pkg) |
| `com.objectstack.studio` | — | `@objectstack/studio` → `createStudioAppPlugin` |
| `com.objectstack.account` | — | `@objectstack/account` → `createAccountAppPlugin` |
| `com.objectstack.cloud.connection` | — | `@objectstack/cloud-connection` → `createCloudConnectionPlugin` |

---

## MetadataPlugin Runtime Boundary

`MetadataPlugin` is the `IMetadataService` provider for the ObjectStack runtime, but runtime
metadata is read-only and artifact/file backed:

- Do **not** register `sys_metadata` or `sys_metadata_history` from an ObjectStack
  runtime plugin. Those persistence tables belong to the control plane.
  (Exception: an *isolated environment kernel* may opt into `sys_metadata`
  hydration from its own DB — the general boundary otherwise stands.)
- Do **not** call `MetadataManager.setDataEngine()` automatically from
  `MetadataPlugin.start()`. Project databases must contain business rows only.
- Use `artifactSource: { mode: 'local-file', path: './dist/objectstack.json' }`
  for local artifact boot; production should use the Artifact API loader once
  wired.
- `DatabaseLoader`, `setDatabaseDriver()`, and `setDataEngine()` remain valid for
  control-plane services that explicitly own metadata revisions, history, or
  overlays.

```typescript
import { MetadataPlugin } from '@objectstack/metadata';

await kernel.use(new MetadataPlugin({
  watch: false,
  artifactSource: { mode: 'local-file', path: './dist/objectstack.json' },
}));
```

---

## Health Monitoring (ObjectKernel Only)

A plugin opts in by adding an `async healthCheck()` returning
`{ healthy: boolean; message?: string; details?: Record<string, unknown> }`
(`PluginHealthStatus`, importable from `@objectstack/core`). Return `healthy:
false` rather than throwing. The kernel side is three calls:

```typescript
const health = await kernel.checkPluginHealth('com.example.db');
const allHealth = await kernel.checkAllPluginsHealth();
const metrics = kernel.getPluginMetrics();  // Map<name, startup ms>
```

---

## Feature Flags

Feature flags are **not a spec/metadata concept**. There is no `featureFlags:` /
`features:` key on `defineStack` (writing one is refused at load, not stripped), and the
former `FeatureFlagSchema` (`@objectstack/spec/kernel`) was removed — it had zero runtime
consumers, and its only protocol home (the static `ObjectStackCapabilities.system.features`
descriptor) was itself dead: no endpoint ever served it. Runtime capability discovery is
`GET /api/v1/discovery`.

The live toggle surfaces are runtime configuration, not authored metadata:

- **`feature_flags` settings manifest** (`@objectstack/service-settings`) — org-tunable
  toggles like `ai_enabled` / `beta_*`, resolvable at runtime and env-overridable via
  `OS_FEATURE_FLAGS_*` (ADR-0007 settings cascade).
- **Auth capability gates** — `requiresFeature` on actions/params lowers to the
  `PUBLIC_AUTH_FEATURES` registry (`kernel/public-auth-features.ts`), the fixed
  deployment-level flags plugin-auth advertises to anonymous clients.
