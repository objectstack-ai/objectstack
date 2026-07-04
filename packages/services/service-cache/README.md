# @objectstack/service-cache

Cache Service for ObjectStack — implements `ICacheService` with in-memory and Redis adapters.

## Features

- **Multiple Adapters**: In-memory (development) and Redis (production) support
- **Type-Safe**: Full TypeScript support with generic value types
- **TTL Support**: Automatic expiration with time-to-live
- **Namespace Support**: Organize cache keys by namespace
- **Pattern Matching**: Delete keys by pattern (e.g., `user:*`)
- **Statistics**: Track hit/miss rates and memory usage
- **JSON Serialization**: Automatic serialization of complex objects

## Installation

```bash
pnpm add @objectstack/service-cache
```

For Redis adapter:
```bash
pnpm add ioredis
```

## Basic Usage

```typescript
import { defineStack } from '@objectstack/spec';
import { ServiceCache } from '@objectstack/service-cache';

const stack = defineStack({
  services: [
    ServiceCache.configure({
      adapter: 'memory', // or 'redis'
      defaultTTL: 300, // 5 minutes
    }),
  ],
});
```

## Configuration

### In-Memory Adapter (Development)

```typescript
ServiceCache.configure({
  adapter: 'memory',
  defaultTTL: 300,
  maxSize: 1000, // Maximum number of entries
});
```

### Redis Adapter (Production)

```typescript
ServiceCache.configure({
  adapter: 'redis',
  redis: {
    host: 'localhost',
    port: 6379,
    password: process.env.REDIS_PASSWORD,
    db: 0,
  },
  defaultTTL: 600,
});
```

## Service API

```typescript
// Get cache service
const cache = kernel.getService<ICacheService>('cache');
```

### Set/Get Operations

```typescript
// Set a value
await cache.set('user:123', { name: 'John', email: 'john@example.com' });

// Set with custom TTL (in seconds)
await cache.set('session:abc', sessionData, { ttl: 3600 }); // 1 hour

// Get a value
const user = await cache.get('user:123');

// Get with type safety
const user = await cache.get<User>('user:123');

// Get multiple keys
const users = await cache.mget(['user:123', 'user:456']);
```

### Existence & Deletion

```typescript
// Check if key exists
const exists = await cache.has('user:123');

// Delete a key
await cache.del('user:123');

// Delete multiple keys
await cache.del(['session:abc', 'session:def']);

// Delete by pattern
await cache.delPattern('user:*');
```

### Namespaced Operations

```typescript
// Create a namespaced cache instance
const userCache = cache.namespace('user');

// Set in namespace (key becomes 'user:123')
await userCache.set('123', userData);

// Get from namespace
const user = await userCache.get('123');

// Clear entire namespace
await userCache.clear();
```

### TTL Management

```typescript
// Get remaining TTL (in seconds)
const ttl = await cache.ttl('session:abc');

// Update TTL
await cache.expire('session:abc', 7200); // 2 hours

// Make key permanent (remove expiration)
await cache.persist('user:123');
```

### Atomic Operations

```typescript
// Increment (useful for counters)
await cache.incr('page:views:123'); // Returns new value

// Increment by amount
await cache.incrby('score:user:123', 10);

// Decrement
await cache.decr('inventory:product:456');
```

### Batch Operations

```typescript
// Set multiple keys at once
await cache.mset({
  'user:123': user1Data,
  'user:456': user2Data,
  'user:789': user3Data,
});

// Get multiple keys
const users = await cache.mget(['user:123', 'user:456', 'user:789']);
```

## Advanced Features

### Cache Aside Pattern

```typescript
async function getUser(id: string): Promise<User> {
  // Try cache first
  const cached = await cache.get<User>(`user:${id}`);
  if (cached) return cached;

  // Load from database
  const user = await db.findUser(id);

  // Store in cache
  await cache.set(`user:${id}`, user, { ttl: 600 });

  return user;
}
```

### Cache-Through Pattern

```typescript
async function getUserCacheThrough(id: string): Promise<User> {
  return cache.getOrSet(`user:${id}`, async () => {
    return await db.findUser(id);
  }, { ttl: 600 });
}
```

### Invalidation on Write

```typescript
async function updateUser(id: string, data: Partial<User>) {
  // Update database
  await db.updateUser(id, data);

  // Invalidate cache
  await cache.del(`user:${id}`);

  // Or update cache immediately
  const updated = await db.findUser(id);
  await cache.set(`user:${id}`, updated);
}
```

### Tagging & Invalidation

```typescript
// Tag cache entries
await cache.set('product:123', productData, {
  ttl: 600,
  tags: ['products', 'category:electronics'],
});

// Invalidate by tag
await cache.invalidateTag('category:electronics');
```

## Statistics & Monitoring

```typescript
// Get cache statistics
const stats = await cache.stats();
// {
//   hits: 1250,
//   misses: 325,
//   hitRate: 0.794,
//   keys: 450,
//   memoryUsage: 1024000 // bytes
// }

// Reset statistics
await cache.resetStats();
```

## REST API Endpoints

```
GET    /api/v1/cache/stats               # Get cache statistics
POST   /api/v1/cache/clear                # Clear cache
DELETE /api/v1/cache/:key                 # Delete specific key
DELETE /api/v1/cache/pattern/:pattern     # Delete by pattern
```

## Best Practices

1. **Use Namespaces**: Organize cache keys with namespaces
2. **Set Appropriate TTLs**: Don't cache data longer than necessary
3. **Handle Misses**: Always have fallback logic when cache misses
4. **Invalidate on Write**: Clear stale cache after updates
5. **Monitor Hit Rates**: Track cache effectiveness with statistics
6. **Serialize Carefully**: Be mindful of what you serialize (avoid circular references)
7. **Use Redis in Production**: In-memory adapter is for development only

## Performance Considerations

- **In-Memory Adapter**: Fast but limited by server memory, not shared across instances
- **Redis Adapter**: Shared across instances, persistent, but network latency
- **TTL Strategy**: Balance between freshness and cache hit rate
- **Key Patterns**: Use consistent naming conventions for easier invalidation

## Contract Implementation

Implements `ICacheService` from `@objectstack/spec/contracts`:

```typescript
interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: CacheOptions): Promise<void>;
  del(key: string | string[]): Promise<void>;
  has(key: string): Promise<boolean>;
  ttl(key: string): Promise<number>;
  expire(key: string, ttl: number): Promise<void>;
  clear(): Promise<void>;
  namespace(name: string): ICacheService;
}
```

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [Redis Documentation](https://redis.io/documentation)
- [@objectstack/spec/contracts](../../spec/src/contracts/)
- [Caching Best Practices](/content/docs/kernel/contracts/cache-service.mdx)
