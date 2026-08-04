import { describe, it, expect } from 'vitest';
import {
  OfflineStrategySchema,
  ConflictResolutionSchema,
  SyncConfigSchema,
  PersistStorageSchema,
  EvictionPolicySchema,
  OfflineCacheConfigSchema,
  OfflineConfigSchema,
  type OfflineStrategy,
  type ConflictResolution,
  type SyncConfig,
  type PersistStorage,
  type EvictionPolicy,
  type OfflineCacheConfig,
  type OfflineConfig,
} from './offline.zod';

describe('OfflineStrategySchema', () => {
  it('should accept all valid strategies', () => {
    const strategies = ['cache_first', 'network_first', 'stale_while_revalidate', 'network_only', 'cache_only'] as const;
    strategies.forEach(s => {
      expect(() => OfflineStrategySchema.parse(s)).not.toThrow();
    });
  });

  it('should reject invalid strategies', () => {
    expect(() => OfflineStrategySchema.parse('offline_first')).toThrow();
    expect(() => OfflineStrategySchema.parse('')).toThrow();
  });
});

describe('ConflictResolutionSchema', () => {
  it('should accept all valid resolutions', () => {
    const resolutions = ['client_wins', 'server_wins', 'manual', 'last_write_wins'] as const;
    resolutions.forEach(r => {
      expect(() => ConflictResolutionSchema.parse(r)).not.toThrow();
    });
  });
});

describe('SyncConfigSchema', () => {
  it('should apply defaults for strategy and conflictResolution', () => {
    const result = SyncConfigSchema.parse({});
    expect(result.strategy).toBe('network_first');
    expect(result.conflictResolution).toBe('last_write_wins');
  });

  it('should accept full sync config', () => {
    const config: SyncConfig = {
      strategy: 'cache_first',
      conflictResolution: 'manual',
      retryInterval: 5000,
      maxRetries: 3,
      batchSize: 10,
    };
    const result = SyncConfigSchema.parse(config);
    expect(result.retryInterval).toBe(5000);
    expect(result.maxRetries).toBe(3);
    expect(result.batchSize).toBe(10);
  });
});

describe('OfflineCacheConfigSchema', () => {
  it('should apply default storage and eviction policy', () => {
    const result = OfflineCacheConfigSchema.parse({});
    expect(result.persistStorage).toBe('indexeddb');
    expect(result.evictionPolicy).toBe('lru');
  });

  it('should accept all storage backends', () => {
    const backends = ['indexeddb', 'localstorage', 'sqlite'] as const;
    backends.forEach(b => {
      expect(() => OfflineCacheConfigSchema.parse({ persistStorage: b })).not.toThrow();
    });
  });

  it('should accept all eviction policies', () => {
    const policies = ['lru', 'lfu', 'fifo'] as const;
    policies.forEach(p => {
      expect(() => OfflineCacheConfigSchema.parse({ evictionPolicy: p })).not.toThrow();
    });
  });

  it('should accept maxSize and ttl', () => {
    const config: OfflineCacheConfig = {
      maxSize: 50_000_000,
      ttl: 86400000,
      persistStorage: 'sqlite',
      evictionPolicy: 'fifo',
    };
    const result = OfflineCacheConfigSchema.parse(config);
    expect(result.maxSize).toBe(50_000_000);
    expect(result.ttl).toBe(86400000);
  });

  it('should reject invalid storage backend', () => {
    expect(() => OfflineCacheConfigSchema.parse({ persistStorage: 'redis' })).toThrow();
  });
});

describe('OfflineConfigSchema', () => {
  it('should accept minimal config (just enabled)', () => {
    const result = OfflineConfigSchema.parse({ enabled: true });
    expect(result.enabled).toBe(true);
    expect(result.strategy).toBe('network_first');
    expect(result.offlineIndicator).toBe(true);
  });

  it('should apply defaults for empty object', () => {
    const result = OfflineConfigSchema.parse({});
    expect(result.enabled).toBe(false);
    expect(result.offlineIndicator).toBe(true);
  });

  it('should accept full offline config', () => {
    const config: OfflineConfig = {
      enabled: true,
      strategy: 'cache_first',
      cache: {
        maxSize: 10_000_000,
        ttl: 3600000,
        persistStorage: 'indexeddb',
        evictionPolicy: 'lru',
      },
      sync: {
        strategy: 'stale_while_revalidate',
        conflictResolution: 'server_wins',
        retryInterval: 10000,
        maxRetries: 5,
      },
      offlineIndicator: false,
      queueMaxSize: 100,
    };
    const result = OfflineConfigSchema.parse(config);
    expect(result.cache?.maxSize).toBe(10_000_000);
    expect(result.sync?.conflictResolution).toBe('server_wins');
    expect(result.queueMaxSize).toBe(100);
  });

  it('should reject invalid strategy in offline config', () => {
    expect(() => OfflineConfigSchema.parse({ strategy: 'bad' })).toThrow();
  });
});

describe('Type exports', () => {
  it('should have valid type exports', () => {
    const strategy: OfflineStrategy = 'cache_first';
    const conflict: ConflictResolution = 'manual';
    const sync: SyncConfig = { strategy: 'network_first', conflictResolution: 'last_write_wins' };
    const storage: PersistStorage = 'indexeddb';
    const eviction: EvictionPolicy = 'lru';
    const cache: OfflineCacheConfig = { persistStorage: 'indexeddb', evictionPolicy: 'lru' };
    const config: OfflineConfig = { enabled: true, strategy: 'network_first', offlineIndicator: true };
    expect(strategy).toBeDefined();
    expect(conflict).toBeDefined();
    expect(sync).toBeDefined();
    expect(storage).toBeDefined();
    expect(eviction).toBeDefined();
    expect(cache).toBeDefined();
    expect(config).toBeDefined();
  });
});

describe('I18n integration', () => {
  it('should reject I18n offlineMessage on OfflineConfigSchema', () => {
    expect(() => OfflineConfigSchema.parse({
      offlineMessage: { key: 'offline.status', defaultValue: 'You are offline' },
    })).toThrow();
  });

  it('should accept plain string offlineMessage', () => {
    const result = OfflineConfigSchema.parse({ offlineMessage: 'No internet connection' });
    expect(result.offlineMessage).toBe('No internet connection');
  });

  it('should leave offlineMessage undefined when not provided', () => {
    const result = OfflineConfigSchema.parse({});
    expect(result.offlineMessage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #4001 batch 13 -- THIS FILE IS DELIBERATELY NOT `.strict()`, on a measurement.
//
// The strictness ledger scheduled these 3 sites as `authorable (p)`. Resolving
// the `(p)` found no authoring door at all: nothing under `packages/spec/src`
// imports this module except the `ui/index.ts` barrel, a BFS from all 24
// metadata-type roots plus `defineStack`'s `ObjectStackSchema` never reaches
// these schemas (`PageSchema` / `WebhookSchema` / `StateMachineSchema` pass as
// positive controls in the same run), and no `.parse()` on any of them exists
// in `objectstack`, `objectui` or the example apps outside this test file.
// `.strict()` is a property of a PARSE, and there is no parse to gate.
//
// So the strip pinned below is not an unfinished row -- it is the recorded
// verdict. The open question is ADR-0049 enforce-or-remove, filed as #4988.
// These assertions exist so the next sweep stops and reads instead of reaching
// for `strictObject` and shipping a precisely-validated dead slot (#4583). The
// header comment in `offline.zod.ts` and this file's ledger row carry the same verdict.
// ---------------------------------------------------------------------------
describe('unknown-key posture is an open question, not an omission (#4001 batch 13 -> #4988)', () => {
  it('SyncConfigSchema still strips rather than rejecting -- deliberate, pending #4988', () => {
    const parsed = SyncConfigSchema.parse({ aKeyThisShapeDoesNotDeclare: 1 }) as Record<string, unknown>;
    expect(parsed.aKeyThisShapeDoesNotDeclare).toBeUndefined();
  });

  it('OfflineCacheConfigSchema still strips rather than rejecting -- deliberate, pending #4988', () => {
    const parsed = OfflineCacheConfigSchema.parse({ aKeyThisShapeDoesNotDeclare: 1 }) as Record<string, unknown>;
    expect(parsed.aKeyThisShapeDoesNotDeclare).toBeUndefined();
  });

  it('OfflineConfigSchema still strips rather than rejecting -- deliberate, pending #4988', () => {
    const parsed = OfflineConfigSchema.parse({ aKeyThisShapeDoesNotDeclare: 1 }) as Record<string, unknown>;
    expect(parsed.aKeyThisShapeDoesNotDeclare).toBeUndefined();
  });

  // The standing half of measurement 1, so the verdict cannot go stale in
  // silence: the day someone gives this vocabulary a carrier they will add an
  // import, and this is where they are told to revisit #4988 and the ledger.
  it('is still imported by nothing but the ui/ barrel', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
          && full !== path.join(root, 'ui', 'offline.zod.ts')) {
          if (/(?:import|export)[^;]*['"][^'"]*\/offline\.zod['"]/.test(fs.readFileSync(full, 'utf-8'))) {
            importers.push(path.relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(importers, 'a new importer means this vocabulary got a carrier -- re-read #4988')
      .toEqual(['ui/index.ts']);
  });
});
