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
    expect(tier.ttlSeconds).toBe(300);
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
      ttlSeconds: 600,
      strategy: 'lfu',
      warmup: true,
    });

    expect(tier.maxSize).toBe(512);
    expect(tier.ttlSeconds).toBe(600);
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
        { name: 'l2', type: 'redis', maxSize: 1024, ttlSeconds: 600 },
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
      circuitBreaker: { enabled: true, failureThreshold: 10, resetTimeoutSeconds: 60 },
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
        { name: 'l1', type: 'memory', maxSize: 100, ttlSeconds: 60, strategy: 'lru' },
        { name: 'l2', type: 'redis', maxSize: 1000, ttlSeconds: 300, strategy: 'lru' },
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

// #15679 (stack card 4/6 of #14478) — ruling B: the unit of a duration-shaped
// number lives in the key NAME. Both old spellings are `retiredKey()` tombstones,
// so each refusal carries the RENAME rather than a bare unrecognized-key error.
// Asserted on the issue CODE and the prescription text, never on "it threw":
// a bare `toThrow()` would stay green against a schema that rejected for any
// other reason, which is the failure this pin exists to catch.
describe('cache duration keys carry their unit (#15679)', () => {
  it('REFUSES the retired `CacheTier.ttl` with the rename in the message', () => {
    const result = CacheTierSchema.safeParse({ name: 'l1', type: 'memory', ttl: 600 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'ttl');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('`CacheTier.ttl` was renamed to `ttlSeconds`');
  });

  it('accepts `ttlSeconds` at the same magnitude and keeps the 300 default', () => {
    expect(CacheTierSchema.parse({ name: 'l1', type: 'memory', ttlSeconds: 600 }).ttlSeconds).toBe(600);
    expect(CacheTierSchema.parse({ name: 'l1', type: 'memory' }).ttlSeconds).toBe(300);
  });

  it('REFUSES the retired `circuitBreaker.resetTimeout` with the rename in the message', () => {
    const result = CacheAvalanchePreventionSchema.safeParse({
      circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeout: 30 },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'circuitBreaker.resetTimeout');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain(
      '`CacheAvalanchePrevention.circuitBreaker.resetTimeout` was renamed to',
    );
  });

  it('accepts `resetTimeoutSeconds` and keeps the 30 default', () => {
    const parsed = CacheAvalanchePreventionSchema.parse({
      circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeoutSeconds: 60 },
    });
    expect(parsed.circuitBreaker?.resetTimeoutSeconds).toBe(60);
    expect(CacheAvalanchePreventionSchema.parse({ circuitBreaker: { enabled: true } })
      .circuitBreaker?.resetTimeoutSeconds).toBe(30);
  });

  it('leaves `lockout.lockTimeoutMs` alone — it was already correct, and it is a DIFFERENT unit', () => {
    const parsed = CacheAvalanchePreventionSchema.parse({ lockout: { enabled: true } });
    expect(parsed.lockout?.lockTimeoutMs).toBe(5000);
  });
});
