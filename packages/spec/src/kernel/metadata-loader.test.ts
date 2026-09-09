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
          databaseLoader: { enabled: true, maxSize: 250, ttlMs: 30_000 },
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
      expect(validated.cache?.databaseLoader?.ttlMs).toBe(30_000);
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

    it('should reject a negative DatabaseLoader TTL', () => {
      const config = {
        cache: { databaseLoader: { ttlMs: -100 } },
      };

      expect(() => MetadataManagerConfigSchema.parse(config)).toThrow();
    });
  });
});

// #14478 — the founding specimen of the duration-unit rule: two keys spelled
// `ttl` fourteen lines apart, the outer in SECONDS and the nested
// DatabaseLoader one in MILLISECONDS, each unit named only in prose. Both are
// retiredKey tombstones; the nested one renames to `ttlMs`. The outer one no
// longer renames: #15624 retired its respelling `ttlSeconds` before it shipped
// (nothing read the outer block), so `cache.ttl` now prescribes deletion — an
// author upgrading from a published 17.x sees ONE hop, never a rename to a key
// that is itself a tombstone.
describe('cache.ttl → deleted (absorbed by #15624), cache.databaseLoader.ttl → ttlMs (#14478)', () => {
  it('REFUSES the outer `cache.ttl` with a DELETION naming the live `cache.databaseLoader.ttlMs` — not a rename to the retired `ttlSeconds`', () => {
    const result = MetadataManagerConfigSchema.safeParse({ cache: { ttl: 3600 } });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'cache.ttl');
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/`cache\.ttl` was removed.*Delete the key.*`cache\.databaseLoader\.ttlMs`/s);
    expect(issue!.message).not.toMatch(/Rename the key to `ttlSeconds`/);
  });

  it('REFUSES the nested `cache.databaseLoader.ttl` with a rename naming `ttlMs`', () => {
    const result = MetadataManagerConfigSchema.safeParse({ cache: { databaseLoader: { ttl: 60_000 } } });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'cache.databaseLoader.ttl');
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/`cache\.databaseLoader\.ttl` was removed.*Rename the key to `ttlMs`/s);
  });

  it('accepts the nested `ttlMs` at the magnitude the retired key carried, and keeps its 60000 default', () => {
    const parsed = MetadataManagerConfigSchema.parse({
      cache: { databaseLoader: { ttlMs: 30_000 } },
    });
    expect(parsed.cache?.databaseLoader?.ttlMs).toBe(30_000);
    expect(parsed.cache).not.toHaveProperty('ttl');
    expect(parsed.cache?.databaseLoader).not.toHaveProperty('ttl');

    const defaults = MetadataManagerConfigSchema.parse({ cache: { databaseLoader: {} } });
    expect(defaults.cache?.databaseLoader?.ttlMs).toBe(60_000);
  });

  it('tsc channel: both retired spellings are unwritable on the input type', () => {
    // @ts-expect-error — `cache.ttl` is a tombstone (input type `never`); the outer block is retired whole
    const outer: MetadataManagerConfig = { cache: { ttl: 3600 } };
    // @ts-expect-error — `cache.databaseLoader.ttl` is a tombstone; the key is `ttlMs`
    const inner: MetadataManagerConfig = { cache: { databaseLoader: { ttl: 60_000 } } };
    const good: MetadataManagerConfig = { cache: { databaseLoader: { ttlMs: 60_000 } } };
    expect([outer, inner, good]).toHaveLength(3);
  });
});

// #15624 — ADR-0049 enforce-or-remove. The outer `cache` block advertised three
// knobs (`enabled`, `ttlSeconds`, `maxSize`) that no runtime read: the only
// consumer of the block is `MetadataManager`, which hands `cache.databaseLoader`
// and nothing else to `new DatabaseLoader({ cache })`. All three are retiredKey
// tombstones; the prescription names the live nested half. Nothing in the
// runtime changed — the pins below are about the ACCEPT face only.
describe('cache.{enabled, ttlSeconds, maxSize} are retired; cache.databaseLoader is the only live half (#15624)', () => {
  const RETIRED = [
    { key: 'enabled', value: false, live: /`cache\.databaseLoader`; its `enabled` is the switch that is honoured/s },
    { key: 'ttlSeconds', value: 60, live: /`cache\.databaseLoader\.ttlMs` \(milliseconds, default 60000\)/s },
    { key: 'maxSize', value: 10_485_760, live: /`cache\.databaseLoader\.maxSize` \(an entry count, default 500\)/s },
  ] as const;

  for (const { key, value, live } of RETIRED) {
    it(`REFUSES \`cache.${key}\` with the prescription — removed, delete the key, and the live nested knob named`, () => {
      const result = MetadataManagerConfigSchema.safeParse({ cache: { [key]: value } });
      expect(result.success).toBe(false);
      const issue = result.error!.issues.find((i) => i.path.join('.') === `cache.${key}`);
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(new RegExp(`\`cache\\.${key}\` was removed.*ADR-0049.*Delete the key`, 's'));
      expect(issue!.message).toMatch(live);
    });
  }

  it('the parse output no longer materializes the two former defaults (`enabled: true`, `ttlSeconds: 3600`) — the only cache output is the nested half', () => {
    const parsed = MetadataManagerConfigSchema.parse({ cache: { databaseLoader: {} } });
    expect(parsed.cache).not.toHaveProperty('enabled');
    expect(parsed.cache).not.toHaveProperty('ttlSeconds');
    expect(parsed.cache).not.toHaveProperty('maxSize');
    expect(parsed.cache).not.toHaveProperty('ttl');
    // The live half is byte-for-byte what it was: its defaults are untouched.
    expect(parsed.cache?.databaseLoader).toEqual({ enabled: true, maxSize: 500, ttlMs: 60_000 });
  });

  it('a config that never wrote the outer keys parses exactly as before, and an EMPTY cache block is still accepted', () => {
    expect(MetadataManagerConfigSchema.parse({ cache: {} }).cache).toEqual({});
    expect(MetadataManagerConfigSchema.parse({}).cache).toBeUndefined();
  });

  it('tsc channel: every retired outer key is unwritable on the input type, and the nested half still is', () => {
    // @ts-expect-error — `cache.enabled` is a tombstone (input type `never`); the switch is `cache.databaseLoader.enabled`
    const enabled: MetadataManagerConfig = { cache: { enabled: false } };
    // @ts-expect-error — `cache.ttlSeconds` is a tombstone; the TTL is `cache.databaseLoader.ttlMs`
    const ttlSeconds: MetadataManagerConfig = { cache: { ttlSeconds: 60 } };
    // @ts-expect-error — `cache.maxSize` is a tombstone; the cap is `cache.databaseLoader.maxSize`
    const maxSize: MetadataManagerConfig = { cache: { maxSize: 1 } };
    const good: MetadataManagerConfig = { cache: { databaseLoader: { enabled: false, maxSize: 1, ttlMs: 1 } } };
    expect([enabled, ttlSeconds, maxSize, good]).toHaveLength(4);
  });
});
