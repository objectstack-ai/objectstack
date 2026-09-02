# Plugin Lifecycle

Complete guide for implementing plugin lifecycle phases in ObjectStack.

## Three-Phase Lifecycle

```
kernel.bootstrap()
│
├── Phase 1: INIT (register services)
│   ├── PluginA.init(ctx)    → ctx.registerService('db', dbInstance)
│   ├── PluginB.init(ctx)    → ctx.registerService('cache', cacheInstance)
│   └── PluginC.init(ctx)    → ctx.registerService('http', httpServer)
│   │
│   └── [Core fallback injection — auto-fills missing 'core' services]
│
├── Phase 2: START (business logic)
│   ├── PluginA.start(ctx)   → connect to database
│   ├── PluginB.start(ctx)   → warm cache
│   └── PluginC.start(ctx)   → bind routes, listen on port
│
└── Phase 3: READY
    ├── trigger('kernel:ready')          → route/service registration handlers
    ├── trigger('kernel:bootstrapped')   → after EVERY kernel:ready handler settles
    └── trigger('kernel:listening')      → HTTP servers open their socket here

kernel.shutdown()
│
├── ctx.trigger('kernel:shutdown')
├── PluginC.destroy()   → close server
├── PluginB.destroy()   → flush cache
└── PluginA.destroy()   → disconnect DB
```

## Plugin Interface

```typescript
import type { Plugin, PluginContext } from '@objectstack/core';

export interface Plugin {
  /** Unique name (reverse domain recommended) */
  name: string;

  /** Semantic version */
  version?: string;

  /** Plugin type */
  type?: string;  // standard|ui|driver|server|app|theme|agent|objectql

  /** Plugins that must init before this one */
  dependencies?: string[];

  /** Phase 1: Register services — called during kernel init */
  init(ctx: PluginContext): Promise<void> | void;

  /** Phase 2: Execute business logic — called after ALL plugins init */
  start?(ctx: PluginContext): Promise<void> | void;

  /** Phase 3: Cleanup — called during kernel shutdown */
  destroy?(): Promise<void> | void;
}
```

## Key Rules

1. **`init()` is required** — This is where you register services
2. **`start()` is optional** — Only needed if your plugin has active behavior
3. **`destroy()` is optional** — Only needed if you hold resources to release
4. **Plugins init in dependency order** — Topological sort on `dependencies`
5. **Plugins destroy in reverse order** — LIFO cleanup
6. **Each phase completes for ALL plugins before the next phase begins**

## Phase 1: init() — Service Registration

**Purpose:** Register services in the DI container.

**When to use:**
- Register database connections
- Register cache instances
- Register HTTP servers
- Register hook handlers
- Register factories

**Do NOT:**
- Connect to databases (do in `start()`)
- Listen on ports (do in `start()`)
- Make external API calls

### Example

```typescript
async init(ctx: PluginContext) {
  // Register a service
  const pool = createPool({ /* config */ });
  ctx.registerService('db-pool', pool);

  // Register kernel hook handlers
  ctx.hook('kernel:ready', async () => {
    ctx.logger.info('System ready');
  });

  ctx.hook('metadata:reloaded', async (payload?: { changed?: string[] }) => {
    ctx.logger.info('Metadata reloaded', { changed: payload?.changed });
  });

  ctx.logger.info('Plugin initialized');
}
```

## Phase 2: start() — Active Behavior

**Purpose:** Execute business logic that requires all services to be available.

**When to use:**
- Connect to databases
- Listen on HTTP ports
- Start background workers
- Warm caches
- Register routes

**Safe to:**
- Call `ctx.getService()` — all services are registered
- Trigger events via `ctx.trigger()`
- Make external API calls

### Example

```typescript
async start(ctx: PluginContext) {
  // All services are now available
  const pool = ctx.getService('db-pool');
  await pool.connect();

  const server = ctx.getService('http-server');
  await server.listen(3000);

  ctx.logger.info('Plugin started');
}
```

## Phase 3: destroy() — Cleanup

**Purpose:** Release resources held by the plugin.

**When to use:**
- Close database connections
- Stop HTTP servers
- Flush caches
- Cancel background workers
- Release file handles

**Runs in reverse order** — Last plugin to start is first to destroy.

### Example

```typescript
async destroy() {
  if (this.pool) {
    await this.pool.close();
  }

  if (this.server) {
    await this.server.close();
  }

  console.log('Plugin destroyed');
}
```

## Incorrect vs Correct

### ❌ Incorrect — Connecting in init()

```typescript
async init(ctx: PluginContext) {
  const pool = createPool({ /* config */ });
  await pool.connect();  // ❌ Don't connect in init()
  ctx.registerService('db-pool', pool);
}
```

### ✅ Correct — Connecting in start()

```typescript
async init(ctx: PluginContext) {
  const pool = createPool({ /* config */ });
  ctx.registerService('db-pool', pool);  // ✅ Just register
}

async start(ctx: PluginContext) {
  const pool = ctx.getService('db-pool');
  await pool.connect();  // ✅ Connect in start()
}
```

### Declaring a dependency before `getService()` in `init()`

`getService()` in `init()` is safe only for a plugin named in
`dependencies`. The worked ❌/✅ pair, and why `null` is never a valid
placeholder, are in
[service-registry.md](./service-registry.md#incorrect-vs-correct).

### ❌ Incorrect — Missing destroy()

```typescript
// Plugin opens file handles, database connections, but no destroy()
async start(ctx: PluginContext) {
  this.db = await connectDatabase();
  this.fileHandle = fs.openSync('/tmp/data.log');
  // ❌ No cleanup — resources leak
}
```

### ✅ Correct — Implementing destroy()

```typescript
async start(ctx: PluginContext) {
  this.db = await connectDatabase();
  this.fileHandle = fs.openSync('/tmp/data.log');
}

async destroy() {
  if (this.db) {
    await this.db.close();  // ✅ Close connection
  }
  if (this.fileHandle) {
    fs.closeSync(this.fileHandle);  // ✅ Close file
  }
}
```

## Dependency Management

Declare dependencies to control initialization order:

```typescript
const MyPlugin: Plugin = {
  name: 'com.example.analytics',
  version: '1.0.0',
  dependencies: ['com.objectstack.engine.objectql'],  // Must init first

  async init(ctx) {
    // Safe to call — ObjectQL is guaranteed to be initialized
    const engine = ctx.getService<IDataEngine>('objectql');
    ctx.registerService('analytics', new AnalyticsService(engine));
  },
};
```

The kernel performs **topological sort** on the dependency graph. Circular
**plugin** dependencies make **both** kernels throw
(`Circular dependency detected`). The warning-only path exists solely for
circular **service-factory** dependency graphs in ObjectKernel
(`registerServiceFactory` dependency cycles).

## Complete Plugin Example

See the **Complete Plugin Example** (AuditPlugin) in
[../SKILL.md](../SKILL.md#complete-plugin-example) — a full three-phase
plugin that registers a service in `init()`, subscribes to the
`kernel:ready` / `metadata:reloaded` kernel events, and cleans up in
`destroy()`.
