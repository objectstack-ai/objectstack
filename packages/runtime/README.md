# @objectstack/runtime

ObjectStack Standard System Library

## Overview

The runtime package provides the **Standard Library** for the ObjectStack Operating System. It bridges the pure **ObjectKernel** (from `@objectstack/core`) with the **Data Engine** (`@objectstack/objectql`) and provides essential infrastructure adapters.

### Architecture Highlights

- **Standard Library**: Contains essential plugins (`AppPlugin`, `DriverPlugin`)
- **Core Integration**: Re-exports `ObjectKernel` for convenience
- **Capability Contracts**: Abstract interfaces for HTTP server and data persistence

## 🤖 AI Development Context

**Role**: Server Runtime & REST API
**Usage**:
- Use `RestServer` to spawn HTTP endpoints.
- Configures the HTTP layer.

**Key Concepts**:
- `RestServer`: Generates `/api/*` endpoints from ObjectQL schemas.

## Installation

```bash
npm install @objectstack/runtime
```

## Quick Start

### Basic Setup (Recommended)

```typescript
import { ObjectKernel } from '@objectstack/core';
import { DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { InMemoryDriver } from '@objectstack/driver-memory';

const kernel = new ObjectKernel();

kernel
  // Register ObjectQL engine
  .use(new ObjectQLPlugin())
  
  // Add database driver
  .use(new DriverPlugin(new InMemoryDriver(), 'memory'))
  
  // Add your app configurations
  // .use(new AppPlugin(appConfig));

await kernel.bootstrap();
```

### Custom ObjectQL Instance

If you have a separate ObjectQL implementation or need custom configuration:

```typescript
import { ObjectKernel, DriverPlugin } from '@objectstack/runtime';
import { ObjectQLPlugin, ObjectQL } from '@objectstack/objectql';

// Create custom ObjectQL instance
const customQL = new ObjectQL({
  env: 'production',
  customConfig: true
});

// Pre-configure with custom hooks
customQL.registerHook('beforeInsert', async (ctx) => {
  console.log(`Inserting into ${ctx.object}`);
});

const kernel = new ObjectKernel();

kernel
  // Use your custom ObjectQL instance
  .use(new ObjectQLPlugin(customQL))
  
  // Add driver
  .use(new DriverPlugin(new InMemoryDriver(), 'memory'));

await kernel.bootstrap();

// Access ObjectQL via service registry
const objectql = kernel.getService('objectql');
```

## Architecture

### ObjectKernel (MiniKernel)

The kernel provides:
- **Plugin Lifecycle Management**: init → start → destroy phases
- **Service Registry**: Dependency injection container
- **Event/Hook System**: Inter-plugin communication
- **Dependency Resolution**: Topological sort for plugin dependencies

### Built-in Plugins

#### ObjectQLPlugin
Registers the ObjectQL data engine as a service.

```typescript
new ObjectQLPlugin()                           // Default instance
new ObjectQLPlugin(customQL)                   // Custom instance
new ObjectQLPlugin(undefined, { env: 'prod' }) // With context
```

**Services**: `'objectql'`

#### DriverPlugin
Registers a data driver with ObjectQL.

```typescript
new DriverPlugin(driver, 'driver-name')
```

**Dependencies**: `['com.objectstack.engine.objectql']`

#### AppPlugin
Wraps ObjectStack app manifests (objectstack.config.ts) as plugins.

```typescript
new AppPlugin(appConfig)
```

**Services**: `'app.{id}'`

## API Reference

### Capability Contract Interfaces

#### IHttpServer

Abstract interface for HTTP server capabilities. Allows plugins to work with any HTTP framework (e.g. Hono) without tight coupling.

```typescript
import { IHttpServer, IHttpRequest, IHttpResponse } from '@objectstack/runtime';

// In your HTTP server plugin
class MyHttpServerPlugin implements Plugin {
  name = 'http-server';
  
  async init(ctx: PluginContext) {
    const server: IHttpServer = createMyServer(); // Hono, or any framework via IHttpServer
    ctx.registerService('http-server', server);
  }
}

// In your API plugin
class MyApiPlugin implements Plugin {
  name = 'api';
  dependencies = ['http-server'];
  
  async start(ctx: PluginContext) {
    const server = ctx.getService<IHttpServer>('http-server');
    
    // Register routes - works with any HTTP framework
    server.get('/api/users', async (req, res) => {
      res.json({ users: [] });
    });
  }
}
```

**Interface Methods:**
- `get(path, handler)` - Register GET route
- `post(path, handler)` - Register POST route  
- `put(path, handler)` - Register PUT route
- `delete(path, handler)` - Register DELETE route
- `patch(path, handler)` - Register PATCH route
- `use(path, handler?)` - Register middleware
- `listen(port)` - Start server
- `close()` - Stop server (optional)

#### IDataEngine

Abstract interface for data persistence. Allows plugins to work with any data layer (ObjectQL, Prisma, TypeORM, etc.) without tight coupling.

```typescript
import { IDataEngine } from '@objectstack/runtime';

// In your data plugin
class MyDataPlugin implements Plugin {
  name = 'data';
  
  async init(ctx: PluginContext) {
    const engine: IDataEngine = createMyDataEngine(); // ObjectQL, Prisma, etc.
    ctx.registerService('data-engine', engine);
  }
}

// In your business logic plugin
class MyBusinessPlugin implements Plugin {
  name = 'business';
  dependencies = ['data'];
  
  async start(ctx: PluginContext) {
    const engine = ctx.getService<IDataEngine>('data-engine');
    
    // CRUD operations - works with any data layer
    const user = await engine.insert('user', { name: 'John' });
    const users = await engine.find('user', { filter: { active: true } });
    await engine.update('user', user.id, { name: 'Jane' });
    await engine.delete('user', user.id);
  }
}
```

**Interface Methods:**
- `insert(objectName, data)` - Create a record
- `find(objectName, query?)` - Query records
- `update(objectName, id, data)` - Update a record
- `delete(objectName, id)` - Delete a record

### ObjectKernel

#### Methods
- `use(plugin: Plugin)`: Register a plugin
- `bootstrap()`: Initialize and start all plugins
- `shutdown()`: Stop all plugins in reverse order
- `getService<T>(name: string)`: Get a service from registry
- `isRunning()`: Check if kernel is running
- `getState()`: Get current kernel state

### Plugin Interface

```typescript
interface Plugin {
  name: string;                              // Unique identifier
  version?: string;                          // Plugin version
  dependencies?: string[];                   // Required plugin names
  
  init(ctx: PluginContext): Promise<void>;   // Register services
  start?(ctx: PluginContext): Promise<void>; // Execute business logic
  destroy?(): Promise<void>;                  // Cleanup
}
```

### PluginContext

```typescript
interface PluginContext {
  registerService(name: string, service: any): void;
  getService<T>(name: string): T;
  hook(name: string, handler: Function): void;
  trigger(name: string, ...args: any[]): Promise<void>;
  logger: Console;
  getKernel?(): any;
}
```

## Examples

See the `examples/` directory for complete examples:
- `examples/host/` - Full server setup with Hono
- `examples/msw-react-crud/` - Browser-based setup with MSW
- `test-mini-kernel.ts` - Comprehensive kernel test suite
- `packages/runtime/src/

## Benefits of MiniKernel

1. **True Modularity**: Each plugin is independent and reusable
2. **Capability Contracts**: Plugins depend on interfaces, not implementations
3. **Testability**: Mock services easily in tests
4. **Flexibility**: Load plugins conditionally, swap implementations
5. **Extensibility**: Add new plugins without modifying kernel
6. **Clear Dependencies**: Explicit dependency declarations
7. **Better Architecture**: Separation of concerns with Dependency Inversion

## Best Practices

1. **Keep plugins focused**: One responsibility per plugin
2. **Use services**: Share functionality via service registry
3. **Declare dependencies**: Make plugin requirements explicit
4. **Use hooks**: Decouple plugins with event system
5. **Handle errors**: Implement proper error handling in lifecycle methods

## Common Plugin Patterns

### Service Provider Pattern

```typescript
import { Plugin, PluginContext } from '@objectstack/core';

export class DatabasePlugin implements Plugin {
  name = 'database';
  private connection: any;
  
  async init(ctx: PluginContext) {
    // Initialize connection
    this.connection = await createConnection({
      host: 'localhost',
      database: 'myapp'
    });
    
    // Register as service
    ctx.registerService('database', this.connection);
    
    ctx.logger.info('Database connected');
  }
  
  async destroy() {
    // Cleanup
    await this.connection.close();
  }
}
```

### Service Consumer Pattern

```typescript
import { Plugin, PluginContext } from '@objectstack/core';

export class RepositoryPlugin implements Plugin {
  name = 'repository';
  dependencies = ['database']; // Ensure database loads first
  
  async init(ctx: PluginContext) {
    // Get dependency
    const db = ctx.getService('database');
    
    // Create and register repository
    const repo = new UserRepository(db);
    ctx.registerService('user-repository', repo);
  }
}
```

### Event-Driven Pattern

```typescript
import { Plugin, PluginContext } from '@objectstack/core';

// Publisher
export class DataPlugin implements Plugin {
  name = 'data';
  
  async init(ctx: PluginContext) {
    const service = {
      async create(entity: string, data: any) {
        const result = await db.insert(entity, data);
        
        // Trigger event
        await ctx.trigger('data:created', { entity, data: result });
        
        return result;
      }
    };
    
    ctx.registerService('data', service);
  }
}

// Subscriber
export class AuditPlugin implements Plugin {
  name = 'audit';
  dependencies = ['data'];
  
  async init(ctx: PluginContext) {
    // Listen to events
    ctx.hook('data:created', async ({ entity, data }) => {
      ctx.logger.info(`Audit: ${entity} created`, { id: data.id });
      
      await auditLog.write({
        action: 'create',
        entity,
        entityId: data.id,
        timestamp: new Date()
      });
    });
  }
}
```

### Configuration Pattern

```typescript
import { Plugin, PluginContext } from '@objectstack/core';
import { z } from 'zod';

const ConfigSchema = z.object({
  apiKey: z.string(),
  endpoint: z.string().url(),
  timeout: z.number().default(5000)
});

export class ApiPlugin implements Plugin {
  name = 'api-client';
  
  constructor(private config: z.infer<typeof ConfigSchema>) {
    // Validate config
    ConfigSchema.parse(config);
  }
  
  async init(ctx: PluginContext) {
    const client = new ApiClient({
      apiKey: this.config.apiKey,
      endpoint: this.config.endpoint,
      timeout: this.config.timeout
    });
    
    ctx.registerService('api-client', client);
  }
}

// Usage
kernel.use(new ApiPlugin({
  apiKey: process.env.API_KEY,
  endpoint: 'https://api.example.com',
  timeout: 10000
}));
```

### Factory Pattern

```typescript
import { Plugin, PluginContext } from '@objectstack/core';

export class ConnectionPoolPlugin implements Plugin {
  name = 'connection-pool';
  private pool: any;
  
  async init(ctx: PluginContext) {
    this.pool = {
      connections: new Map(),
      
      getConnection(name: string) {
        if (!this.connections.has(name)) {
          this.connections.set(name, createConnection(name));
        }
        return this.connections.get(name);
      },
      
      closeAll() {
        for (const conn of this.connections.values()) {
          conn.close();
        }
        this.connections.clear();
      }
    };
    
    ctx.registerService('connection-pool', this.pool);
  }
  
  async destroy() {
    // Use stored reference from init phase
    if (this.pool) {
      this.pool.closeAll();
    }
  }
}
```

### Middleware Pattern

```typescript
import { Plugin, PluginContext } from '@objectstack/core';

export class LoggingMiddleware implements Plugin {
  name = 'logging-middleware';
  dependencies = ['http-server'];
  
  async start(ctx: PluginContext) {
    const server = ctx.getService('http-server');
    
    // Register middleware
    server.use(async (req, res, next) => {
      const start = Date.now();
      
      ctx.logger.info('Request', {
        method: req.method,
        path: req.path
      });
      
      await next();
      
      const duration = Date.now() - start;
      ctx.logger.info('Response', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration
      });
    });
  }
}
```

### Lazy Loading Pattern

```typescript
import { Plugin, PluginContext } from '@objectstack/core';

export class HeavyServicePlugin implements Plugin {
  name = 'heavy-service';
  private instance: any = null;
  
  async init(ctx: PluginContext) {
    // Register factory instead of instance
    const factory = {
      async getInstance() {
        if (!this.instance) {
          ctx.logger.info('Lazy loading heavy service...');
          this.instance = await loadHeavyService();
        }
        return this.instance;
      }
    };
    
    ctx.registerService('heavy-service', factory);
  }
}

// Usage
const factory = kernel.getService('heavy-service');
const service = await factory.getInstance(); // Loaded only when needed
```

### Health Check Pattern

```typescript
import { Plugin, PluginContext } from '@objectstack/core';

export class HealthCheckPlugin implements Plugin {
  name = 'health-check';
  dependencies = ['http-server', 'database', 'cache'];
  
  async start(ctx: PluginContext) {
    const server = ctx.getService('http-server');
    
    server.get('/health', async (req, res) => {
      const checks = await Promise.all([
        this.checkDatabase(ctx),
        this.checkCache(ctx),
        this.checkDiskSpace()
      ]);
      
      const healthy = checks.every(c => c.healthy);
      
      res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'unhealthy',
        checks
      });
    });
  }
  
  private async checkDatabase(ctx: PluginContext) {
    try {
      const db = ctx.getService('database');
      await db.ping();
      return { name: 'database', healthy: true };
    } catch (error) {
      return { name: 'database', healthy: false, error: error.message };
    }
  }
  
  private async checkCache(ctx: PluginContext) {
    try {
      const cache = ctx.getService('cache');
      await cache.ping();
      return { name: 'cache', healthy: true };
    } catch (error) {
      return { name: 'cache', healthy: false, error: error.message };
    }
  }
  
  private async checkDiskSpace() {
    // Implementation
    return { name: 'disk', healthy: true };
  }
}
```

## Production Hardening

The runtime ships zero-dependency primitives for production HTTP deployments.
All defaults are safe / no-op so opting in is gradual.

### Security headers (on by default)

`createDispatcherPlugin` adds CSP / X-Content-Type-Options / X-Frame-Options /
Referrer-Policy / Permissions-Policy / Cross-Origin-Resource-Policy to every
response. HSTS is opt-in (only enable once TLS is confirmed). See
[`docs/HARDENING.md`](../../docs/HARDENING.md).

```ts
createDispatcherPlugin({
  securityHeaders: {
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    csp: "default-src 'self'",
  },
});
```

### Rate limiting (primitive — wire per-adapter)

Token-bucket `RateLimiter` with pluggable `RateLimitStore` (in-memory default,
Redis-friendly contract). Curated `DEFAULT_RATE_LIMITS` for auth / write / read
buckets. A Hono recipe in
[`docs/HARDENING.md`](../../docs/HARDENING.md#rate-limiting).

```ts
import { RateLimiter, DEFAULT_RATE_LIMITS } from '@objectstack/runtime';

const limiter = new RateLimiter(DEFAULT_RATE_LIMITS.auth);
const decision = limiter.consume(`ip:${ip}`);
if (!decision.allowed) reply.code(429).send({ retryAfterMs: decision.retryAfterMs });
```

### Observability (opt-in adapters)

`createDispatcherPlugin` instruments every route with request-id propagation,
`http_requests_total{method,route,status}`, `http_request_duration_ms`,
`http_request_errors_total`, and 5xx error reporting. Plug your own
`MetricsRegistry` (Prometheus / OTel) and `ErrorReporter` (Sentry / Datadog).
Adapter recipes + go-live checklist in
[`docs/OBSERVABILITY.md`](../../docs/OBSERVABILITY.md).

```ts
import {
  createDispatcherPlugin,
  type MetricsRegistry,
  type ErrorReporter,
} from '@objectstack/runtime';

createDispatcherPlugin({
  observability: {
    metrics: promMetrics,           // your MetricsRegistry adapter
    errorReporter: sentryReporter,  // your ErrorReporter adapter
  },
});
```

Defaults are noop — zero overhead until you plug an adapter.

## Documentation

- [MiniKernel Guide](../../MINI_KERNEL_GUIDE.md) - Complete API documentation and patterns
- [MiniKernel Architecture](../../MINI_KERNEL_ARCHITECTURE.md) - Architecture diagrams and flows
- [MiniKernel Implementation](../../MINI_KERNEL_IMPLEMENTATION.md) - Implementation details

## License

Apache-2.0. See [LICENSING.md](../../LICENSING.md).
