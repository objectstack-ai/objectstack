import { describe, it, expect } from 'vitest';
import {
  MetadataFallbackStrategySchema,
  MetadataManagerConfigSchema,
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
          ttl: 7200,
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
      expect(validated.cache?.ttl).toBe(7200);
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
        cache: { enabled: true, ttl: -100 },
      };

      expect(() => MetadataManagerConfigSchema.parse(config)).toThrow();
    });
  });
});
