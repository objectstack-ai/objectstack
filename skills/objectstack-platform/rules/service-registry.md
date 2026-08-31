# Service Registry

Guide for registering and consuming services via the kernel DI container.

## Service Registry API

The `PluginContext` provides three core methods:

```typescript
// Register a service
ctx.registerService(name: string, instance: any): void;

// Get a service (throws if not found)
ctx.getService<T>(name: string): T;

// Replace an existing service
ctx.replaceService(name: string, instance: any): void;

// Get all services
ctx.getServices(): Map<string, any>;
```

## Registration Patterns

### Direct Registration

Pass an already-created instance:

```typescript
async init(ctx: PluginContext) {
  const config = { apiKey: process.env.API_KEY };
  ctx.registerService('config', config);
}
```

**Best for:**
- Simple config objects
- Pre-existing instances
- No lazy initialization needed

### Factory Registration (ObjectKernel Only)

Let the kernel manage creation and lifecycle:

```typescript
import { ServiceLifecycle } from '@objectstack/core';

async init(ctx: PluginContext) {
  const kernel = ctx.getKernel();

  kernel.registerServiceFactory(
    'db-pool',
    (ctx) => createPool({ connectionString: process.env.DATABASE_URL }),
    ServiceLifecycle.SINGLETON,
  );
}
```

**Best for:**
- Lazy initialization (created on first use)
- Lifecycle management
- Dependency injection between services

## Service Lifecycles (ObjectKernel Only)

| Lifecycle | Behavior | Use Case |
|:----------|:---------|:---------|
| `SINGLETON` | One instance shared app-wide | Database connections, caches |
| `TRANSIENT` | New instance per `getService()` call | Stateless utilities, formatters |
| `SCOPED` | One instance per scope (e.g., per request) | Request-scoped contexts, transactions |

### Singleton Factory

```typescript
kernel.registerServiceFactory(
  'db-pool',
  (ctx) => createPool({ connectionString: process.env.DATABASE_URL }),
  ServiceLifecycle.SINGLETON,
);
```

### Transient Factory

```typescript
kernel.registerServiceFactory(
  'request-logger',
  (ctx) => new RequestLogger(ctx.logger),
  ServiceLifecycle.TRANSIENT,
);
```

### Scoped Factory

```typescript
kernel.registerServiceFactory(
  'unit-of-work',
  (ctx) => new UnitOfWork(ctx.getService('db-pool')),
  ServiceLifecycle.SCOPED,
  ['db-pool'],  // Dependencies — resolved before factory executes
);
```

## Service Consumption

### Basic Usage

```typescript
async start(ctx: PluginContext) {
  const db = ctx.getService<IDataEngine>('objectql');
  const cache = ctx.getService<ICacheService>('cache');

  // Use services
  const result = await db.object('account').find();
  await cache.set('accounts', result);
}
```

### Optional Services

Check availability before calling:

```typescript
async start(ctx: PluginContext) {
  try {
    const realtime = ctx.getService<IRealtimeService>('realtime');
    realtime.publish('my-event', data);
  } catch {
    ctx.logger.debug('Realtime service not available — skipping');
  }
}
```

### Service Replacement

Wrap an existing service with instrumentation:

```typescript
async start(ctx: PluginContext) {
  const existingCache = ctx.getService('cache');
  const instrumentedCache = new InstrumentedCache(existingCache);
  ctx.replaceService('cache', instrumentedCache);
}
```

## Well-Known Service Keys

| Service Key | Plugin Name | Package |
|:------------|:------------|:--------|
| `objectql` (also `data`) | `com.objectstack.engine.objectql` | `@objectstack/objectql` |
| `driver.*` | `com.objectstack.driver.*` | `@objectstack/driver-*` |
| `auth` | `com.objectstack.auth` | `@objectstack/plugin-auth` |
| `metadata` | `com.objectstack.metadata` | `@objectstack/metadata` |
| `realtime` | `com.objectstack.service.realtime` | `@objectstack/service-realtime` |
| `cache` | `com.objectstack.service.cache` | `@objectstack/service-cache` |

The REST plugin (`com.objectstack.rest.api`, `@objectstack/rest`) registers
**no** service — there is no `rest` service key.

## Core Fallback Injection

ObjectKernel auto-injects an in-memory fallback for each `core` service that has one and no plugin registered in Phase 1.

```
Phase 1: init() completes for all plugins
    ↓
Kernel checks ServiceRequirementDef (@objectstack/spec/system):
  'data'      → required → ERROR if missing (ObjectQLPlugin registers it)
  'metadata'  → core    → auto-inject createMemoryMetadata() if missing
  'cache'     → core    → auto-inject createMemoryCache() if missing
  'queue'     → core    → auto-inject createMemoryQueue() if missing
  'job'       → core    → NO fallback — warns; getService throws if missing
  'i18n'      → core    → auto-inject createMemoryI18n() if missing
  'auth'      → core    → NO fallback — warns; getService throws if missing
  'realtime'  → optional → skip, plugins should check availability
    ↓
Phase 2: start() begins — all core services available
```

The fallbacks are **factories** exported from `@objectstack/core`
(`createMemoryCache`, `createMemoryMetadata`, `createMemoryQueue`,
`createMemoryI18n`) — not classes; `job`/`auth` have none.

### Service Criticality Levels

| Level | Behavior |
|:------|:---------|
| `required` | Kernel throws if missing — system cannot start |
| `core` | In-memory fallback auto-injected where one exists, else warn |
| `optional` | Silently skipped — plugins must check before use |

## Incorrect vs Correct

### ❌ Incorrect — Getting Service in init() Without a Declared Dependency

```typescript
const AnalyticsPlugin: Plugin = {
  name: 'com.example.analytics',

  async init(ctx: PluginContext) {
    const db = ctx.getService('objectql');  // ❌ May not exist yet
    ctx.registerService('analytics', new Analytics(db));
  },
};
```

### ✅ Correct — Declare the Dependency So init() Order Is Guaranteed

```typescript
const AnalyticsPlugin: Plugin = {
  name: 'com.example.analytics',
  dependencies: ['com.objectstack.engine.objectql'],  // ✅ inits first

  async init(ctx: PluginContext) {
    const db = ctx.getService('objectql');  // ✅ Guaranteed registered
    ctx.registerService('analytics', new Analytics(db));
  },
};
```

Never register `null` as a placeholder: `registerService` **throws** on a
duplicate key (so you cannot register the real instance later without
`replaceService`), and `getService()` treats a falsy value as missing and
throws — so consumers break either way.

### ❌ Incorrect — No Error Handling for Optional Service

```typescript
async start(ctx: PluginContext) {
  const realtime = ctx.getService('realtime');  // ❌ Throws if not available
  realtime.publish('event', data);
}
```

### ✅ Correct — Error Handling for Optional Service

```typescript
async start(ctx: PluginContext) {
  try {
    const realtime = ctx.getService('realtime');
    realtime.publish('event', data);
  } catch {
    ctx.logger.debug('Realtime service not available');  // ✅ Graceful fallback
  }
}
```

### ❌ Incorrect — Duplicate Registration

```typescript
async init(ctx: PluginContext) {
  ctx.registerService('cache', new MemoryCache());
  ctx.registerService('cache', new RedisCache());
  // ❌ THROWS: "[Kernel] Service 'cache' already registered"
}
```

### ✅ Correct — Use replaceService() for Updates

```typescript
async init(ctx: PluginContext) {
  ctx.registerService('cache', new MemoryCache());
}

async start(ctx: PluginContext) {
  const oldCache = ctx.getService('cache');
  ctx.replaceService('cache', new RedisCache(oldCache));  // ✅ Explicit replacement
}
```

## Service Naming Conventions

1. **Use lowercase, hyphen-separated names** — e.g., `db-pool`, `request-logger`
2. **Use namespaces for multiple instances** — e.g., `driver.postgres`, `driver.mysql`
3. **Use descriptive names** — e.g., `auth-service` not `as`
4. **Avoid abbreviations** — e.g., `database` not `db` (unless well-known like `db-pool`)

## Testing Service Registration

```typescript
import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import MyPlugin from './plugin';

describe('Service Registration', () => {
  it('registers service in init phase', async () => {
    const kernel = new LiteKernel();
    kernel.use(MyPlugin);
    await kernel.bootstrap();

    const service = kernel.getService('my-service');
    expect(service).toBeDefined();
    expect(service.name).toBe('MyService');

    await kernel.shutdown();
  });

  it('throws when service not found', async () => {
    const kernel = new LiteKernel();
    await kernel.bootstrap();

    expect(() => kernel.getService('non-existent')).toThrow();

    await kernel.shutdown();
  });
});
```

## Best Practices

1. **Register in init()** — All service registration in Phase 1
2. **Consume in start()** — Use getService() only in Phase 2
3. **Use try/catch for optional services** — Don't assume availability
4. **Use descriptive service keys** — Clear, namespaced names
5. **Declare dependencies** — Let kernel handle initialization order
6. **Use factories for lazy init** — Defer expensive creation
7. **Use scoped services for requests** — Request-specific contexts
8. **Don't register null** — Register a real instance or factory
9. **Use replaceService() explicitly** — Don't re-register
10. **Document your services** — What they do, what they depend on
