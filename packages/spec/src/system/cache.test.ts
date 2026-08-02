import { describe, it, expect } from 'vitest';
import {
  CacheStrategySchema,
  CacheTierSchema,
  CacheInvalidationSchema,
  CacheConfigSchema,
  CacheConsistencySchema,
  CacheAvalanchePreventionSchema,
  CacheWarmupSchema,
  DistributedCacheConfigSchema,
} from './cache.zod';

describe('CacheStrategySchema', () => {
  it('should accept valid strategies', () => {
    const strategies = ['lru', 'lfu', 'fifo', 'ttl'];

    strategies.forEach((strategy) => {
      expect(() => CacheStrategySchema.parse(strategy)).not.toThrow();
    });
  });

  it('should reject invalid strategies', () => {
    expect(() => CacheStrategySchema.parse('invalid')).toThrow();
    expect(() => CacheStrategySchema.parse('random')).toThrow();
  });

  // Pin (#4537): 'adaptive' was declared with zero producers (three-repo scan)
  // and removed when the shared/system declarations converged. It must stay
  // rejected so a declared-but-unimplemented strategy cannot silently return.
  it('should reject the retired adaptive strategy', () => {
    expect(() => CacheStrategySchema.parse('adaptive')).toThrow();
  });
});

describe('CacheTierSchema', () => {
  it('should accept valid tier with defaults', () => {
    const tier = CacheTierSchema.parse({
      name: 'memory_cache',
      type: 'memory',
    });

    expect(tier.name).toBe('memory_cache');
    expect(tier.type).toBe('memory');
    expect(tier.ttl).toBe(300);
    expect(tier.strategy).toBe('lru');
    expect(tier.warmup).toBe(false);
  });

  it('should accept all backend types', () => {
    const types = ['memory', 'redis', 'memcached', 'cdn'];

    types.forEach((type) => {
      expect(() => CacheTierSchema.parse({ name: 'test', type })).not.toThrow();
    });
  });

  it('should accept full configuration', () => {
    const tier = CacheTierSchema.parse({
      name: 'redis_tier',
      type: 'redis',
      maxSize: 512,
      ttl: 600,
      strategy: 'lfu',
      warmup: true,
    });

    expect(tier.maxSize).toBe(512);
    expect(tier.ttl).toBe(600);
    expect(tier.strategy).toBe('lfu');
    expect(tier.warmup).toBe(true);
  });

  it('should reject invalid type', () => {
    expect(() => CacheTierSchema.parse({ name: 'test', type: 'invalid' })).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => CacheTierSchema.parse({})).toThrow();
    expect(() => CacheTierSchema.parse({ name: 'test' })).toThrow();
  });
});

describe('CacheInvalidationSchema', () => {
  it('should accept valid invalidation rule', () => {
    const rule = CacheInvalidationSchema.parse({
      trigger: 'update',
      scope: 'key',
    });

    expect(rule.trigger).toBe('update');
    expect(rule.scope).toBe('key');
  });

  it('should accept all trigger types', () => {
    const triggers = ['create', 'update', 'delete', 'manual'];

    triggers.forEach((trigger) => {
      expect(() => CacheInvalidationSchema.parse({ trigger, scope: 'key' })).not.toThrow();
    });
  });

  it('should accept all scope types', () => {
    const scopes = ['key', 'pattern', 'tag', 'all'];

    scopes.forEach((scope) => {
      expect(() => CacheInvalidationSchema.parse({ trigger: 'update', scope })).not.toThrow();
    });
  });

  it('should accept optional pattern and tags', () => {
    const rule = CacheInvalidationSchema.parse({
      trigger: 'update',
      scope: 'pattern',
      pattern: 'user:*',
      tags: ['users', 'profiles'],
    });

    expect(rule.pattern).toBe('user:*');
    expect(rule.tags).toEqual(['users', 'profiles']);
  });

  it('should reject missing required fields', () => {
    expect(() => CacheInvalidationSchema.parse({})).toThrow();
    expect(() => CacheInvalidationSchema.parse({ trigger: 'update' })).toThrow();
  });
});

describe('CacheConfigSchema', () => {
  it('should accept valid configuration with defaults', () => {
    const config = CacheConfigSchema.parse({
      tiers: [{ name: 'memory', type: 'memory' }],
      invalidation: [{ trigger: 'update', scope: 'key' }],
    });

    expect(config.enabled).toBe(false);
    expect(config.prefetch).toBe(false);
    expect(config.compression).toBe(false);
    expect(config.encryption).toBe(false);
    expect(config.tiers).toHaveLength(1);
    expect(config.invalidation).toHaveLength(1);
  });

  it('should accept full configuration', () => {
    const config = CacheConfigSchema.parse({
      enabled: true,
      tiers: [
        { name: 'l1', type: 'memory', maxSize: 128 },
        { name: 'l2', type: 'redis', maxSize: 1024, ttl: 600 },
      ],
      invalidation: [
        { trigger: 'update', scope: 'pattern', pattern: '*' },
        { trigger: 'delete', scope: 'all' },
      ],
      prefetch: true,
      compression: true,
      encryption: true,
    });

    expect(config.enabled).toBe(true);
    expect(config.tiers).toHaveLength(2);
    expect(config.invalidation).toHaveLength(2);
    expect(config.prefetch).toBe(true);
    expect(config.compression).toBe(true);
    expect(config.encryption).toBe(true);
  });

  it('should reject missing required fields', () => {
    expect(() => CacheConfigSchema.parse({})).toThrow();
    expect(() => CacheConfigSchema.parse({ tiers: [] })).toThrow();
  });
});

describe('CacheConsistencySchema', () => {
  it('should accept all consistency strategies', () => {
    const strategies = ['write_through', 'write_behind', 'write_around', 'refresh_ahead'] as const;
    strategies.forEach(strategy => {
      expect(() => CacheConsistencySchema.parse(strategy)).not.toThrow();
    });
  });

  it('should reject invalid strategy', () => {
    expect(() => CacheConsistencySchema.parse('read_through')).toThrow();
  });
});

describe('CacheAvalanchePreventionSchema', () => {
  it('should accept empty config', () => {
    expect(() => CacheAvalanchePreventionSchema.parse({})).not.toThrow();
  });

  it('should accept jitter TTL config', () => {
    const result = CacheAvalanchePreventionSchema.parse({
      jitterTtl: { enabled: true, maxJitterSeconds: 30 },
    });
    expect(result.jitterTtl?.enabled).toBe(true);
    expect(result.jitterTtl?.maxJitterSeconds).toBe(30);
  });

  it('should accept circuit breaker config', () => {
    const result = CacheAvalanchePreventionSchema.parse({
      circuitBreaker: { enabled: true, failureThreshold: 10, resetTimeout: 60 },
    });
    expect(result.circuitBreaker?.failureThreshold).toBe(10);
  });

  it('should accept lockout config', () => {
    const result = CacheAvalanchePreventionSchema.parse({
      lockout: { enabled: true, lockTimeoutMs: 3000 },
    });
    expect(result.lockout?.lockTimeoutMs).toBe(3000);
  });

  it('should accept full prevention config', () => {
    expect(() => CacheAvalanchePreventionSchema.parse({
      jitterTtl: { enabled: true },
      circuitBreaker: { enabled: true },
      lockout: { enabled: true },
    })).not.toThrow();
  });
});

describe('CacheWarmupSchema', () => {
  it('should accept minimal warmup config', () => {
    const result = CacheWarmupSchema.parse({});
    expect(result.enabled).toBe(false);
    expect(result.strategy).toBe('lazy');
  });

  it('should accept eager warmup with patterns', () => {
    const result = CacheWarmupSchema.parse({
      enabled: true,
      strategy: 'eager',
      patterns: ['config:*', 'user:*'],
      concurrency: 20,
    });
    expect(result.strategy).toBe('eager');
    expect(result.patterns).toHaveLength(2);
    expect(result.concurrency).toBe(20);
  });

  it('should accept scheduled warmup', () => {
    const result = CacheWarmupSchema.parse({
      enabled: true,
      strategy: 'scheduled',
      schedule: '0 0 * * *',
    });
    expect(result.schedule).toEqual({ dialect: 'cron', source: '0 0 * * *' });
  });
});

describe('DistributedCacheConfigSchema', () => {
  it('should accept basic distributed cache', () => {
    const config = DistributedCacheConfigSchema.parse({
      enabled: true,
      tiers: [
        { name: 'l1', type: 'memory', maxSize: 100 },
        { name: 'l2', type: 'redis', maxSize: 1000 },
      ],
      invalidation: [{ trigger: 'update', scope: 'key' }],
      consistency: 'write_through',
    });

    expect(config.consistency).toBe('write_through');
  });

  it('should accept full distributed cache config', () => {
    const config = DistributedCacheConfigSchema.parse({
      enabled: true,
      tiers: [
        { name: 'l1', type: 'memory', maxSize: 100, ttl: 60, strategy: 'lru' },
        { name: 'l2', type: 'redis', maxSize: 1000, ttl: 300, strategy: 'lru' },
      ],
      invalidation: [{ trigger: 'update', scope: 'key' }],
      consistency: 'write_behind',
      avalanchePrevention: {
        jitterTtl: { enabled: true, maxJitterSeconds: 30 },
        circuitBreaker: { enabled: true, failureThreshold: 5 },
        lockout: { enabled: true },
      },
      warmup: {
        enabled: true,
        strategy: 'eager',
        patterns: ['config:*'],
      },
    });

    expect(config.consistency).toBe('write_behind');
    expect(config.avalanchePrevention?.jitterTtl?.enabled).toBe(true);
    expect(config.warmup?.strategy).toBe('eager');
  });

  it('should extend CacheConfigSchema fields', () => {
    const config = DistributedCacheConfigSchema.parse({
      enabled: true,
      tiers: [{ name: 'test', type: 'memory' }],
      invalidation: [{ trigger: 'update', scope: 'key' }],
      prefetch: true,
      compression: true,
      encryption: true,
    });

    expect(config.prefetch).toBe(true);
    expect(config.compression).toBe(true);
  });
});
