import { describe, it, expect } from 'vitest';
import {
  MetadataFallbackStrategySchema,
  MetadataManagerConfigSchema,
  type MetadataManagerConfig,
} from './metadata-loader.zod';

// The loader/persistence envelope vocabulary this file used to also cover
// (`MetadataFormat`, `MetadataStats`, `MetadataLoad*`, `MetadataSave*`,
// `MetadataExport/ImportOptions`, `MetadataWatchEvent`,
// `MetadataCollectionInfo`, `MetadataLoaderContract`) was a zero-consumer
// duplicate of `system/metadata-persistence.zod`, removed in #4411. Its tests
// live with the surviving source: `../system/metadata-persistence.test.ts`.
describe('MetadataManagerConfig', () => {
  describe('MetadataFallbackStrategySchema', () => {
    it('should accept every fallback strategy', () => {
      for (const strategy of ['filesystem', 'memory', 'none'] as const) {
        expect(MetadataFallbackStrategySchema.parse(strategy)).toBe(strategy);
      }
    });

    it('should reject an unknown strategy', () => {
      expect(() => MetadataFallbackStrategySchema.parse('redis')).toThrow();
    });
  });

  describe('MetadataManagerConfigSchema', () => {
    it('should apply defaults', () => {
      const config = {};
      const validated = MetadataManagerConfigSchema.parse(config);

      expect(validated.formats).toEqual(['typescript', 'json', 'yaml']);
      expect(validated.watch).toBe(false);
      expect(validated.tableName).toBe('sys_metadata');
      expect(validated.fallback).toBe('none');
    });

    it('should accept datasource-backed configuration', () => {
      const config = {
        datasource: 'default',
        tableName: 'custom_metadata',
        fallback: 'filesystem' as const,
        rootDir: '/metadata',
      };

      const validated = MetadataManagerConfigSchema.parse(config);
      expect(validated.datasource).toBe('default');
      expect(validated.tableName).toBe('custom_metadata');
      expect(validated.fallback).toBe('filesystem');
    });

    it('should validate complete configuration', () => {
      const config = {
        datasource: 'postgres_main',
        tableName: 'sys_metadata',
        fallback: 'memory' as const,
        rootDir: '/metadata',
        formats: ['typescript', 'json'] as const,
        cache: {
          enabled: true,
          ttlSeconds: 7200,
          maxSize: 10485760, // 10MB
        },
        watch: true,
        watchOptions: {
          ignored: ['**/node_modules/**', '**/*.test.ts'],
          persistent: true,
          ignoreInitial: true,
        },
        validation: {
          strict: true,
          throwOnError: true,
        },
        loaderOptions: {
          encoding: 'utf-8',
        },
      };

      const validated = MetadataManagerConfigSchema.parse(config);
      expect(validated.datasource).toBe('postgres_main');
      expect(validated.rootDir).toBe('/metadata');
      expect(validated.cache?.ttlSeconds).toBe(7200);
      expect(validated.watchOptions?.ignored).toHaveLength(2);
      expect(validated.loaderOptions?.encoding).toBe('utf-8');
    });

    it('should accept all fallback strategies', () => {
      const strategies = ['filesystem', 'memory', 'none'] as const;
      strategies.forEach((fallback) => {
        const validated = MetadataManagerConfigSchema.parse({ fallback });
        expect(validated.fallback).toBe(fallback);
      });
    });

    it('should reject invalid fallback strategy', () => {
      expect(() => MetadataManagerConfigSchema.parse({ fallback: 'redis' })).toThrow();
    });

    it('should reject negative TTL', () => {
      const config = {
        cache: { enabled: true, ttlSeconds: -100 },
      };

      expect(() => MetadataManagerConfigSchema.parse(config)).toThrow();
    });
  });
});

// #14478 — the founding specimen of the duration-unit rule: two keys spelled
// `ttl` fourteen lines apart, the outer in SECONDS and the nested
// DatabaseLoader one in MILLISECONDS, each unit named only in prose. Both are
// retiredKey tombstones now; the unit lives in the key name.
describe('cache.ttl → cache.ttlSeconds, cache.databaseLoader.ttl → ttlMs (#14478)', () => {
  it('REFUSES the outer `cache.ttl` with a rename naming `ttlSeconds`', () => {
    const result = MetadataManagerConfigSchema.safeParse({ cache: { ttl: 3600 } });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'cache.ttl');
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/`cache\.ttl` was removed.*Rename the key to `ttlSeconds`/s);
  });

  it('REFUSES the nested `cache.databaseLoader.ttl` with a rename naming `ttlMs`', () => {
    const result = MetadataManagerConfigSchema.safeParse({ cache: { databaseLoader: { ttl: 60_000 } } });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'cache.databaseLoader.ttl');
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/`cache\.databaseLoader\.ttl` was removed.*Rename the key to `ttlMs`/s);
  });

  it('accepts both suffixed keys at the magnitudes the retired keys carried, and keeps the 1000× defaults apart', () => {
    const parsed = MetadataManagerConfigSchema.parse({
      cache: { ttlSeconds: 7200, databaseLoader: { ttlMs: 30_000 } },
    });
    expect(parsed.cache?.ttlSeconds).toBe(7200);
    expect(parsed.cache?.databaseLoader?.ttlMs).toBe(30_000);
    expect(parsed.cache).not.toHaveProperty('ttl');
    expect(parsed.cache?.databaseLoader).not.toHaveProperty('ttl');

    const defaults = MetadataManagerConfigSchema.parse({ cache: { databaseLoader: {} } });
    expect(defaults.cache?.ttlSeconds).toBe(3600);
    expect(defaults.cache?.databaseLoader?.ttlMs).toBe(60_000);
  });

  it('tsc channel: both retired spellings are unwritable on the input type', () => {
    // @ts-expect-error — `cache.ttl` is a tombstone (input type `never`); the key is `ttlSeconds`
    const outer: MetadataManagerConfig = { cache: { ttl: 3600 } };
    // @ts-expect-error — `cache.databaseLoader.ttl` is a tombstone; the key is `ttlMs`
    const inner: MetadataManagerConfig = { cache: { databaseLoader: { ttl: 60_000 } } };
    const good: MetadataManagerConfig = { cache: { ttlSeconds: 3600, databaseLoader: { ttlMs: 60_000 } } };
    expect([outer, inner, good]).toHaveLength(3);
  });
});
