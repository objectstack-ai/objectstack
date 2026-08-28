# ObjectKernel - Advanced Plugin Features

This document describes the advanced features of ObjectKernel for production-grade plugin management.

## Overview

The `ObjectKernel` (formerly `EnhancedObjectKernel`) provides enterprise-grade features for plugin lifecycle management, dependency injection, and operational resilience.

## Features

### 1. Enhanced Plugin Loading

Async plugin loading with comprehensive validation:

```typescript
import { ObjectKernel, PluginMetadata } from '@objectstack/core';

const kernel = new ObjectKernel({
  logger: { level: 'info' },
  defaultStartupTimeout: 30000,  // 30 seconds
  gracefulShutdown: true,
  shutdownTimeout: 60000,        // 60 seconds
  rollbackOnFailure: true,       // Rollback on startup failure
});

// Plugin with version and timeout
const myPlugin: PluginMetadata = {
  name: 'my-plugin',
  version: '1.2.3',              // Semantic version required
  startupTimeout: 10000,         // Override default timeout
  
  async init(ctx) {
    // Register services
    ctx.registerService('my-service', serviceInstance);
  },
  
  async start(ctx) {
    // Start business logic
  },
  
  async destroy() {
    // Cleanup resources
  },
  
  // Optional: Health check
  async healthCheck() {
    return {
      healthy: true,
      message: 'Service is running',
      details: { connections: 10 }
    };
  }
};

await kernel.use(myPlugin);
await kernel.bootstrap();
```

### 2. Advanced Dependency Injection

Factory-based service registration with lifecycle management:

```typescript
import { ServiceLifecycle } from '@objectstack/core';

// Singleton: Created once, shared across all requests
kernel.registerServiceFactory(
  'database',
  async (ctx) => {
    const db = await connectToDatabase();
    return db;
  },
  ServiceLifecycle.SINGLETON
);

// Transient: New instance on every request
kernel.registerServiceFactory(
  'request-id',
  () => generateUUID(),
  ServiceLifecycle.TRANSIENT
);

// Scoped: One instance per scope (e.g., per HTTP request)
kernel.registerServiceFactory(
  'user-session',
  async (ctx) => {
    return new UserSession();
  },
  ServiceLifecycle.SCOPED
);

// Get service (async)
const db = await kernel.getServiceAsync('database');

// Get scoped service
const session = await kernel.getServiceAsync('user-session', 'request-123');
```

### 3. Service Dependencies

Declare service dependencies for proper initialization order:

```typescript
kernel.registerServiceFactory(
  'api-client',
  async (ctx) => {
    const auth = await ctx.getService('auth-service');
    return new ApiClient(auth);
  },
  ServiceLifecycle.SINGLETON,
  ['auth-service']  // Dependencies
);

// Detect circular dependencies
const cycles = kernel['pluginLoader'].detectCircularDependencies();
if (cycles.length > 0) {
  console.error('Circular dependencies detected:', cycles);
}
```

### 4. Plugin Timeout Control

Prevent plugins from hanging during startup:

```typescript
const plugin: PluginMetadata = {
  name: 'slow-plugin',
  version: '1.0.0',
  startupTimeout: 5000,  // 5 second timeout
  
  async init(ctx) {
    // If this takes longer than 5s, it will timeout
    await slowInitialization();
  }
};

await kernel.use(plugin);

try {
  await kernel.bootstrap();
} catch (error) {
  // Error: Plugin slow-plugin init timeout after 5000ms
}
```

### 5. Startup Failure Rollback

Automatically rollback started plugins if any plugin fails:

```typescript
const plugin1: Plugin = {
  name: 'plugin-1',
  version: '1.0.0',
  async init() {},
  async start() {
    // Starts successfully
  },
  async destroy() {
    console.log('Rolling back plugin-1');
  }
};

const plugin2: Plugin = {
  name: 'plugin-2',
  version: '1.0.0',
  async init() {},
  async start() {
    throw new Error('Startup failed!');
  }
};

await kernel.use(plugin1);
await kernel.use(plugin2);

try {
  await kernel.bootstrap();
} catch (error) {
  // plugin-1 will be automatically destroyed (rolled back)
  // Error: Plugin plugin-2 failed to start - rollback complete
}
```

### 6. Plugin Health Checks

Monitor plugin health at runtime:

```typescript
const plugin: PluginMetadata = {
  name: 'database-plugin',
  version: '1.0.0',
  
  async init(ctx) {
    // Initialize database connection
  },
  
  async healthCheck() {
    const isConnected = await checkDatabaseConnection();
    return {
      healthy: isConnected,
      message: isConnected ? 'Connected' : 'Disconnected',
      details: {
        connections: 10,
        responseTime: 50
      }
    };
  }
};

await kernel.use(plugin);
await kernel.bootstrap();

// Check individual plugin health
const health = await kernel.checkPluginHealth('database-plugin');
console.log(health);
// { healthy: true, message: 'Connected', details: {...}, lastCheck: Date }

// Check all plugins health
const allHealth = await kernel.checkAllPluginsHealth();
for (const [pluginName, health] of allHealth) {
  console.log(`${pluginName}: ${health.healthy ? '✅' : '❌'}`);
}
```

### 7. Performance Metrics

Track plugin startup times:

```typescript
await kernel.bootstrap();

const metrics = kernel.getPluginMetrics();
for (const [pluginName, startTime] of metrics) {
  console.log(`${pluginName}: ${startTime}ms`);
}
// plugin-1: 150ms
// plugin-2: 320ms
// plugin-3: 45ms
```

### 8. Graceful Shutdown

Properly cleanup resources on shutdown:

```typescript
const kernel = new ObjectKernel({
  gracefulShutdown: true,
  shutdownTimeout: 60000  // 60 second timeout
});

// Register custom shutdown handler
kernel.onShutdown(async () => {
  console.log('Closing database connections...');
  await db.close();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await kernel.shutdown();
  process.exit(0);
});

// Manual shutdown
await kernel.shutdown();
// Triggers:
// 1. kernel:shutdown hook
// 2. Plugin destroy() in reverse order
// 3. Custom shutdown handlers
// 4. Logger cleanup
```

### 9. Version Compatibility

Plugins must use semantic versioning:

```typescript
// Valid versions
'1.0.0'
'2.3.4'
'1.0.0-alpha.1'
'1.0.0+20230101'

// Invalid versions (will be rejected)
'1.0'
'v1.0.0'
'latest'
```

## Migration from LiteKernel

To migrate from `LiteKernel` to `ObjectKernel`:

```typescript
// Before
import { LiteKernel } from '@objectstack/core';
const kernel = new LiteKernel();

// After
import { ObjectKernel } from '@objectstack/core';
const kernel = new ObjectKernel({
  logger: { level: 'info' },
  gracefulShutdown: true,
  rollbackOnFailure: true
});
```

Both kernels adhere to the same `Plugin` interface, but `ObjectKernel` supports advanced features like Rollback, Sandbox, and Hot Reload.

## Best Practices

1. **Always set timeouts**: Configure `startupTimeout` to prevent hanging plugins
2. **Implement health checks**: Monitor plugin health at runtime
3. **Use semantic versioning**: Ensures compatibility and proper dependency resolution
4. **Enable rollback**: Set `rollbackOnFailure: true` to prevent partial startup states
5. **Handle shutdown**: Implement `destroy()` to cleanup resources properly
6. **Monitor metrics**: Track startup times to identify slow plugins
7. **Use service factories**: Prefer factories over static instances for better control
8. **Declare dependencies**: Use the dependencies array for proper initialization order

## API Reference

### EnhancedObjectKernel

- `constructor(config: EnhancedKernelConfig)`
- `async use(plugin: Plugin): Promise<this>`
- `registerServiceFactory<T>(name, factory, lifecycle, dependencies?): this`
- `async bootstrap(): Promise<void>`
- `async shutdown(): Promise<void>`
- `async checkPluginHealth(pluginName: string): Promise<PluginHealthStatus>`
- `async checkAllPluginsHealth(): Promise<Map<string, PluginHealthStatus>>`
- `getPluginMetrics(): Map<string, number>`
- `async getServiceAsync<T>(name: string, scopeId?: string): Promise<T>`
- `onShutdown(handler: () => Promise<void>): void`
- `getState(): string`
- `isRunning(): boolean`

### ServiceLifecycle

- `SINGLETON`: Single instance shared across all requests
- `TRANSIENT`: New instance created for each request
- `SCOPED`: New instance per scope (e.g., per HTTP request)

### PluginMetadata

Extended `Plugin` interface with:
- `version: string` - Semantic version
- `signature?: string` - Plugin signature for verification
- `healthCheck?(): Promise<PluginHealthStatus>` - Health check function
- `startupTimeout?: number` - Startup timeout in milliseconds

## Examples

See the test files for comprehensive examples:
- `packages/core/src/enhanced-kernel.test.ts`
- `packages/core/src/plugin-loader.test.ts`
