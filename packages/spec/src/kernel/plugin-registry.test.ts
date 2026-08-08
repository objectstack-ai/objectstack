import { describe, it, expect } from 'vitest';
import {
  PluginVendorSchema,
  PluginQualityMetricsSchema,
  PluginStatisticsSchema,
  PluginRegistryEntrySchema,
  PluginSearchFiltersSchema,
  PluginInstallConfigSchema,
  type PluginVendor,
  type PluginVendorParsed,
  type PluginQualityMetrics,
  type PluginStatistics,
  type PluginRegistryEntry,
  type PluginSearchFilters,
  type PluginInstallConfig,
} from './plugin-registry.zod';

describe('Plugin Registry Schemas', () => {
  describe('PluginVendorSchema', () => {
    it('should accept valid vendor with required fields', () => {
      const vendor = PluginVendorSchema.parse({
        id: 'com.objectstack',
        name: 'ObjectStack',
      });
      expect(vendor.id).toBe('com.objectstack');
      expect(vendor.name).toBe('ObjectStack');
      expect(vendor.verified).toBe(false);
      expect(vendor.trustLevel).toBe('unverified');
    });

    it('should accept vendor with all optional fields', () => {
      const vendor = PluginVendorSchema.parse({
        id: 'com.acme',
        name: 'Acme Corp',
        website: 'https://acme.com',
        email: 'info@acme.com',
        verified: true,
        trustLevel: 'official',
      });
      expect(vendor.website).toBe('https://acme.com');
      expect(vendor.email).toBe('info@acme.com');
      expect(vendor.verified).toBe(true);
      expect(vendor.trustLevel).toBe('official');
    });

    it('should reject invalid vendor id format', () => {
      expect(() => PluginVendorSchema.parse({ id: 'INVALID', name: 'Test' })).toThrow();
      expect(() => PluginVendorSchema.parse({ id: 'single', name: 'Test' })).toThrow();
      expect(() => PluginVendorSchema.parse({ id: '123.abc', name: 'Test' })).toThrow();
    });

    it('should reject invalid email', () => {
      expect(() => PluginVendorSchema.parse({
        id: 'com.test',
        name: 'Test',
        email: 'not-an-email',
      })).toThrow();
    });

    it('should reject invalid website URL', () => {
      expect(() => PluginVendorSchema.parse({
        id: 'com.test',
        name: 'Test',
        website: 'not-a-url',
      })).toThrow();
    });

    it('should reject invalid trust level', () => {
      expect(() => PluginVendorSchema.parse({
        id: 'com.test',
        name: 'Test',
        trustLevel: 'invalid',
      })).toThrow();
    });

    it('should accept all valid trust levels', () => {
      for (const level of ['official', 'verified', 'community', 'unverified']) {
        const vendor = PluginVendorSchema.parse({ id: 'com.test', name: 'Test', trustLevel: level });
        expect(vendor.trustLevel).toBe(level);
      }
    });

    it('should satisfy type constraints', () => {
      const input: PluginVendor = { id: 'com.test', name: 'Test' };
      const vendor: PluginVendorParsed = PluginVendorSchema.parse(input);
      expect(vendor.id).toBe('com.test');
    });
  });

  describe('PluginQualityMetricsSchema', () => {
    it('should accept empty object', () => {
      const metrics = PluginQualityMetricsSchema.parse({});
      expect(metrics).toEqual({});
    });

    it('should accept valid quality metrics', () => {
      const metrics = PluginQualityMetricsSchema.parse({
        testCoverage: 85,
        documentationScore: 90,
        codeQuality: 75,
      });
      expect(metrics.testCoverage).toBe(85);
      expect(metrics.documentationScore).toBe(90);
      expect(metrics.codeQuality).toBe(75);
    });

    it('should reject scores out of range', () => {
      expect(() => PluginQualityMetricsSchema.parse({ testCoverage: -1 })).toThrow();
      expect(() => PluginQualityMetricsSchema.parse({ testCoverage: 101 })).toThrow();
      expect(() => PluginQualityMetricsSchema.parse({ documentationScore: 200 })).toThrow();
      expect(() => PluginQualityMetricsSchema.parse({ codeQuality: -5 })).toThrow();
    });

    it('should accept valid security scan', () => {
      const metrics = PluginQualityMetricsSchema.parse({
        securityScan: {
          lastScanDate: '2024-01-15T10:00:00Z',
          vulnerabilities: {
            critical: 0,
            high: 1,
            medium: 2,
            low: 5,
          },
          passed: true,
        },
      });
      expect(metrics.securityScan?.passed).toBe(true);
      expect(metrics.securityScan?.vulnerabilities?.high).toBe(1);
    });

    it('should apply defaults in security scan vulnerabilities', () => {
      const metrics = PluginQualityMetricsSchema.parse({
        securityScan: {
          vulnerabilities: {},
        },
      });
      expect(metrics.securityScan?.vulnerabilities?.critical).toBe(0);
      expect(metrics.securityScan?.vulnerabilities?.high).toBe(0);
      expect(metrics.securityScan?.vulnerabilities?.medium).toBe(0);
      expect(metrics.securityScan?.vulnerabilities?.low).toBe(0);
      expect(metrics.securityScan?.passed).toBe(false);
    });

    it('should reject negative vulnerability counts', () => {
      expect(() => PluginQualityMetricsSchema.parse({
        securityScan: {
          vulnerabilities: { critical: -1, high: 0, medium: 0, low: 0 },
        },
      })).toThrow();
    });

    it('should accept valid conformance tests', () => {
      const metrics = PluginQualityMetricsSchema.parse({
        conformanceTests: [
          {
            protocolId: 'com.objectstack.protocol.storage',
            passed: true,
            totalTests: 50,
            passedTests: 48,
            lastRunDate: '2024-01-15T10:00:00Z',
          },
        ],
      });
      expect(metrics.conformanceTests).toHaveLength(1);
      expect(metrics.conformanceTests![0].passed).toBe(true);
    });

    it('should satisfy type constraints', () => {
      const metrics: PluginQualityMetrics = PluginQualityMetricsSchema.parse({});
      expect(metrics).toBeDefined();
    });
  });

  describe('PluginStatisticsSchema', () => {
    it('should apply defaults for empty object', () => {
      const stats = PluginStatisticsSchema.parse({});
      expect(stats.downloads).toBe(0);
      expect(stats.downloadsLastMonth).toBe(0);
      expect(stats.activeInstallations).toBe(0);
      expect(stats.dependents).toBe(0);
    });

    it('should accept valid statistics', () => {
      const stats = PluginStatisticsSchema.parse({
        downloads: 10000,
        downloadsLastMonth: 500,
        activeInstallations: 200,
        stars: 150,
        dependents: 10,
      });
      expect(stats.downloads).toBe(10000);
      expect(stats.stars).toBe(150);
    });

    it('should reject negative values', () => {
      expect(() => PluginStatisticsSchema.parse({ downloads: -1 })).toThrow();
      expect(() => PluginStatisticsSchema.parse({ activeInstallations: -5 })).toThrow();
    });

    it('should accept valid ratings', () => {
      const stats = PluginStatisticsSchema.parse({
        ratings: {
          average: 4.5,
          count: 120,
          distribution: {
            '5': 60,
            '4': 30,
            '3': 15,
            '2': 10,
            '1': 5,
          },
        },
      });
      expect(stats.ratings?.average).toBe(4.5);
      expect(stats.ratings?.count).toBe(120);
    });

    it('should reject invalid rating values', () => {
      expect(() => PluginStatisticsSchema.parse({
        ratings: { average: 6, count: 0 },
      })).toThrow();
      expect(() => PluginStatisticsSchema.parse({
        ratings: { average: -1, count: 0 },
      })).toThrow();
    });

    it('should apply defaults in ratings', () => {
      const stats = PluginStatisticsSchema.parse({
        ratings: {},
      });
      expect(stats.ratings?.average).toBe(0);
      expect(stats.ratings?.count).toBe(0);
    });

    it('should satisfy type constraints', () => {
      const stats: PluginStatistics = PluginStatisticsSchema.parse({});
      expect(stats).toBeDefined();
    });
  });

  describe('PluginRegistryEntrySchema', () => {
    const validVendor = { id: 'com.objectstack', name: 'ObjectStack' };
    const validEntry = {
      id: 'com.objectstack.plugin-storage',
      version: '1.0.0',
      name: 'Storage Plugin',
      vendor: validVendor,
    };

    it('should accept valid registry entry with required fields', () => {
      const entry = PluginRegistryEntrySchema.parse(validEntry);
      expect(entry.id).toBe('com.objectstack.plugin-storage');
      expect(entry.version).toBe('1.0.0');
      expect(entry.deprecated).toBe(false);
    });

    it('should accept entry with all optional fields', () => {
      const entry = PluginRegistryEntrySchema.parse({
        ...validEntry,
        description: 'A storage plugin',
        readme: '# Storage Plugin\n\nA full-featured storage plugin.',
        category: 'data',
        tags: ['storage', 'database'],
        license: 'Apache-2.0',
        publishedAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-06-01T00:00:00Z',
        deprecated: true,
        deprecationMessage: 'Use v2 instead',
        replacedBy: 'com.objectstack.plugin-storage-v2',
      });
      expect(entry.category).toBe('data');
      expect(entry.tags).toEqual(['storage', 'database']);
      expect(entry.deprecated).toBe(true);
    });

    it('should reject invalid plugin id format', () => {
      expect(() => PluginRegistryEntrySchema.parse({
        ...validEntry,
        id: 'invalid',
      })).toThrow();
      expect(() => PluginRegistryEntrySchema.parse({
        ...validEntry,
        id: 'UPPERCASE.PLUGIN',
      })).toThrow();
    });

    it('should reject invalid version format', () => {
      expect(() => PluginRegistryEntrySchema.parse({
        ...validEntry,
        version: 'v1.0',
      })).toThrow();
      expect(() => PluginRegistryEntrySchema.parse({
        ...validEntry,
        version: '1.0',
      })).toThrow();
    });

    it('should accept all valid categories', () => {
      const categories = [
        'data', 'integration', 'ui', 'analytics', 'security',
        'automation', 'ai', 'utility', 'driver', 'gateway', 'adapter',
      ];
      for (const category of categories) {
        const entry = PluginRegistryEntrySchema.parse({ ...validEntry, category });
        expect(entry.category).toBe(category);
      }
    });

    it('should reject invalid category', () => {
      expect(() => PluginRegistryEntrySchema.parse({
        ...validEntry,
        category: 'not-a-category',
      })).toThrow();
    });

    it('should accept valid compatibility info', () => {
      const entry = PluginRegistryEntrySchema.parse({
        ...validEntry,
        compatibility: {
          minObjectStackVersion: '1.0.0',
          maxObjectStackVersion: '2.0.0',
          nodeVersion: '>=18.0.0',
          platforms: ['linux', 'darwin'],
        },
      });
      expect(entry.compatibility?.platforms).toEqual(['linux', 'darwin']);
    });

    it('should reject invalid platform', () => {
      expect(() => PluginRegistryEntrySchema.parse({
        ...validEntry,
        compatibility: { platforms: ['unsupported'] },
      })).toThrow();
    });

    it('should accept valid links', () => {
      const entry = PluginRegistryEntrySchema.parse({
        ...validEntry,
        links: {
          homepage: 'https://example.com',
          repository: 'https://github.com/org/repo',
          documentation: 'https://docs.example.com',
          bugs: 'https://github.com/org/repo/issues',
          changelog: 'https://example.com/changelog',
        },
      });
      expect(entry.links?.homepage).toBe('https://example.com');
    });

    it('should reject invalid URLs in links', () => {
      expect(() => PluginRegistryEntrySchema.parse({
        ...validEntry,
        links: { homepage: 'not-a-url' },
      })).toThrow();
    });

    it('should accept valid media', () => {
      const entry = PluginRegistryEntrySchema.parse({
        ...validEntry,
        media: {
          icon: 'https://cdn.example.com/icon.png',
          logo: 'https://cdn.example.com/logo.png',
          screenshots: ['https://cdn.example.com/ss1.png', 'https://cdn.example.com/ss2.png'],
          video: 'https://cdn.example.com/demo.mp4',
        },
      });
      expect(entry.media?.screenshots).toHaveLength(2);
    });

    it('should accept valid pricing', () => {
      const entry = PluginRegistryEntrySchema.parse({
        ...validEntry,
        pricing: {
          model: 'freemium',
          price: 9.99,
          currency: 'EUR',
          billingPeriod: 'monthly',
        },
      });
      expect(entry.pricing?.model).toBe('freemium');
      expect(entry.pricing?.price).toBe(9.99);
    });

    it('should reject invalid pricing model', () => {
      expect(() => PluginRegistryEntrySchema.parse({
        ...validEntry,
        pricing: { model: 'invalid' },
      })).toThrow();
    });

    it('should reject negative price', () => {
      expect(() => PluginRegistryEntrySchema.parse({
        ...validEntry,
        pricing: { model: 'paid', price: -10 },
      })).toThrow();
    });

    it('should accept valid flags', () => {
      const entry = PluginRegistryEntrySchema.parse({
        ...validEntry,
        flags: {
          experimental: true,
          beta: false,
          featured: true,
          verified: true,
        },
      });
      expect(entry.flags?.experimental).toBe(true);
      expect(entry.flags?.featured).toBe(true);
    });

    it('should apply defaults in flags', () => {
      const entry = PluginRegistryEntrySchema.parse({
        ...validEntry,
        flags: {},
      });
      expect(entry.flags?.experimental).toBe(false);
      expect(entry.flags?.beta).toBe(false);
      expect(entry.flags?.featured).toBe(false);
      expect(entry.flags?.verified).toBe(false);
    });

    it('should reject missing required fields', () => {
      expect(() => PluginRegistryEntrySchema.parse({})).toThrow();
      expect(() => PluginRegistryEntrySchema.parse({ id: 'com.test.plugin' })).toThrow();
    });

    it('should satisfy type constraints', () => {
      const entry: PluginRegistryEntry = PluginRegistryEntrySchema.parse(validEntry);
      expect(entry).toBeDefined();
    });
  });

  describe('PluginSearchFiltersSchema', () => {
    it('should accept empty object', () => {
      const filters = PluginSearchFiltersSchema.parse({});
      expect(filters).toBeDefined();
    });

    it('should accept valid search filters', () => {
      const filters = PluginSearchFiltersSchema.parse({
        query: 'storage',
        category: ['data', 'driver'],
        tags: ['database', 'sql'],
        trustLevel: ['official', 'verified'],
        implementsProtocols: ['com.objectstack.protocol.storage'],
        pricingModel: ['free', 'freemium'],
        minRating: 3.5,
        sortBy: 'downloads',
        sortOrder: 'desc',
        page: 1,
        limit: 20,
      });
      expect(filters.query).toBe('storage');
      expect(filters.category).toEqual(['data', 'driver']);
    });

    it('should reject invalid trust level in filter', () => {
      expect(() => PluginSearchFiltersSchema.parse({
        trustLevel: ['invalid'],
      })).toThrow();
    });

    it('should reject invalid pricing model in filter', () => {
      expect(() => PluginSearchFiltersSchema.parse({
        pricingModel: ['invalid'],
      })).toThrow();
    });

    it('should reject minRating out of range', () => {
      expect(() => PluginSearchFiltersSchema.parse({ minRating: -1 })).toThrow();
      expect(() => PluginSearchFiltersSchema.parse({ minRating: 6 })).toThrow();
    });

    it('should reject invalid sortBy', () => {
      expect(() => PluginSearchFiltersSchema.parse({ sortBy: 'invalid' })).toThrow();
    });

    it('should accept all valid sortBy values', () => {
      for (const sortBy of ['relevance', 'downloads', 'rating', 'updated', 'name']) {
        const filters = PluginSearchFiltersSchema.parse({ sortBy });
        expect(filters.sortBy).toBe(sortBy);
      }
    });

    it('should reject invalid pagination values', () => {
      expect(() => PluginSearchFiltersSchema.parse({ page: 0 })).toThrow();
      expect(() => PluginSearchFiltersSchema.parse({ limit: 0 })).toThrow();
      expect(() => PluginSearchFiltersSchema.parse({ limit: 101 })).toThrow();
    });

    it('should apply pagination defaults', () => {
      const filters = PluginSearchFiltersSchema.parse({
        page: undefined,
        limit: undefined,
      });
      expect(filters).toBeDefined();
    });

    it('should satisfy type constraints', () => {
      const filters: PluginSearchFilters = PluginSearchFiltersSchema.parse({});
      expect(filters).toBeDefined();
    });
  });

  describe('PluginInstallConfigSchema', () => {
    it('should accept minimal install config', () => {
      const config = PluginInstallConfigSchema.parse({
        pluginId: 'com.objectstack.plugin-storage',
      });
      expect(config.pluginId).toBe('com.objectstack.plugin-storage');
    });

    it('should accept full install config', () => {
      const config = PluginInstallConfigSchema.parse({
        pluginId: 'com.objectstack.plugin-storage',
        version: '1.2.3',
        config: { apiKey: 'abc123', region: 'us-east-1' },
        autoUpdate: true,
        options: {
          skipDependencies: true,
          force: true,
          target: 'system',
        },
      });
      expect(config.version).toBe('1.2.3');
      expect(config.autoUpdate).toBe(true);
      expect(config.options?.skipDependencies).toBe(true);
      expect(config.options?.force).toBe(true);
      expect(config.options?.target).toBe('system');
    });

    it('should apply defaults in options', () => {
      const config = PluginInstallConfigSchema.parse({
        pluginId: 'com.test.plugin',
        options: {},
      });
      expect(config.options?.skipDependencies).toBe(false);
      expect(config.options?.force).toBe(false);
      expect(config.options?.target).toBe('space');
    });

    it('should accept all valid target values', () => {
      for (const target of ['system', 'space', 'user']) {
        const config = PluginInstallConfigSchema.parse({
          pluginId: 'com.test.plugin',
          options: { target },
        });
        expect(config.options?.target).toBe(target);
      }
    });

    it('should reject invalid target', () => {
      expect(() => PluginInstallConfigSchema.parse({
        pluginId: 'com.test.plugin',
        options: { target: 'invalid' },
      })).toThrow();
    });

    it('should reject missing pluginId', () => {
      expect(() => PluginInstallConfigSchema.parse({})).toThrow();
    });

    it('should accept config with record values', () => {
      const config = PluginInstallConfigSchema.parse({
        pluginId: 'com.test.plugin',
        config: { nested: { key: 'value' }, number: 42 },
      });
      expect(config.config?.nested).toEqual({ key: 'value' });
    });

    it('should satisfy type constraints', () => {
      const config: PluginInstallConfig = PluginInstallConfigSchema.parse({
        pluginId: 'com.test.plugin',
      });
      expect(config).toBeDefined();
    });
  });
});
