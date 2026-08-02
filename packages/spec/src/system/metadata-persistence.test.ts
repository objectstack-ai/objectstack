import { describe, it, expect } from 'vitest';
import {
  MetadataScopeSchema,
  MetadataStateSchema,
  MetadataRecordSchema,
  MetadataFormatSchema,
  MetadataStatsSchema,
  MetadataLoaderContractSchema,
  MetadataLoadOptionsSchema,
  MetadataLoadResultSchema,
  MetadataSaveOptionsSchema,
  MetadataSaveResultSchema,
  MetadataWatchEventSchema,
  MetadataCollectionInfoSchema,
  MetadataExportOptionsSchema,
  MetadataImportOptionsSchema,
  MetadataManagerConfigSchema,
  MetadataFallbackStrategySchema,
  MetadataSourceSchema,
  PackagePublishResultSchema,
} from './metadata-persistence.zod';

describe('MetadataScopeSchema', () => {
  it('should accept valid scopes', () => {
    const scopes = ['system', 'platform', 'user'];
    scopes.forEach((scope) => {
      expect(() => MetadataScopeSchema.parse(scope)).not.toThrow();
    });
  });

  it('should reject invalid scopes', () => {
    expect(() => MetadataScopeSchema.parse('invalid')).toThrow();
    expect(() => MetadataScopeSchema.parse('admin')).toThrow();
  });
});

describe('MetadataStateSchema', () => {
  it('should accept valid states', () => {
    const states = ['draft', 'active', 'archived', 'deprecated'];
    states.forEach((state) => {
      expect(() => MetadataStateSchema.parse(state)).not.toThrow();
    });
  });

  it('should reject invalid states', () => {
    expect(() => MetadataStateSchema.parse('deleted')).toThrow();
  });
});

describe('MetadataRecordSchema', () => {
  it('should accept valid record with defaults', () => {
    const record = MetadataRecordSchema.parse({
      id: 'abc-123',
      name: 'account_list_view',
      type: 'view',
      metadata: { columns: ['name', 'email'] },
    });

    expect(record.id).toBe('abc-123');
    expect(record.name).toBe('account_list_view');
    expect(record.type).toBe('view');
    expect(record.namespace).toBe('default');
    expect(record.scope).toBe('platform');
    expect(record.strategy).toBe('merge');
    expect(record.state).toBe('active');
    expect(record.version).toBe(1);
  });

  it('should accept full record with new ADR-0002 fields', () => {
    const record = MetadataRecordSchema.parse({
      id: 'abc-123',
      name: 'account_list_view',
      type: 'view',
      namespace: 'crm',
      scope: 'system',
      metadata: { columns: ['name'] },
      extends: 'base_view',
      strategy: 'replace',
      owner: 'user-1',
      state: 'draft',
      tenantId: 'tenant-acme',
      version: 3,
      checksum: 'sha256:abc123',
      source: 'database',
      tags: ['crm', 'custom'],
      createdBy: 'admin',
      createdAt: '2025-01-01T00:00:00Z',
      updatedBy: 'admin',
      updatedAt: '2025-01-02T00:00:00Z',
    });

    expect(record.namespace).toBe('crm');
    expect(record.scope).toBe('system');
    expect(record.extends).toBe('base_view');
    expect(record.strategy).toBe('replace');
    expect(record.state).toBe('draft');
    expect(record.tenantId).toBe('tenant-acme');
    expect(record.version).toBe(3);
    expect(record.checksum).toBe('sha256:abc123');
    expect(record.source).toBe('database');
    expect(record.tags).toEqual(['crm', 'custom']);
  });

  it('should accept publishing fields', () => {
    const record = MetadataRecordSchema.parse({
      id: 'abc-123',
      name: 'account_list_view',
      type: 'view',
      metadata: { columns: ['name'] },
      publishedDefinition: { columns: ['name', 'email'] },
      publishedAt: '2025-06-01T12:00:00Z',
      publishedBy: 'admin-user',
    });

    expect(record.publishedDefinition).toEqual({ columns: ['name', 'email'] });
    expect(record.publishedAt).toBe('2025-06-01T12:00:00Z');
    expect(record.publishedBy).toBe('admin-user');
  });

  it('should allow omitting publishing fields (backward compatible)', () => {
    const record = MetadataRecordSchema.parse({
      id: 'abc-123',
      name: 'test',
      type: 'object',
      metadata: {},
    });

    expect(record.publishedDefinition).toBeUndefined();
    expect(record.publishedAt).toBeUndefined();
    expect(record.publishedBy).toBeUndefined();
  });

  it('should default version to 1', () => {
    const record = MetadataRecordSchema.parse({
      id: 'x', name: 'y', type: 'z', metadata: {},
    });
    expect(record.version).toBe(1);
  });

  it('should accept all valid source origins', () => {
    const sources = ['filesystem', 'database', 'api', 'migration'];
    sources.forEach((source) => {
      const record = MetadataRecordSchema.parse({
        id: 'x', name: 'y', type: 'z', metadata: {}, source,
      });
      expect(record.source).toBe(source);
    });
  });

  it('should reject invalid source origin', () => {
    expect(() => MetadataRecordSchema.parse({
      id: 'x', name: 'y', type: 'z', metadata: {}, source: 'unknown',
    })).toThrow();
  });

  it('should accept tags as string array', () => {
    const record = MetadataRecordSchema.parse({
      id: 'x', name: 'y', type: 'z', metadata: {},
      tags: ['important', 'v2'],
    });
    expect(record.tags).toEqual(['important', 'v2']);
  });

  it('should reject missing required fields', () => {
    expect(() => MetadataRecordSchema.parse({})).toThrow();
    expect(() => MetadataRecordSchema.parse({ id: 'x' })).toThrow();
    expect(() => MetadataRecordSchema.parse({ id: 'x', name: 'y', type: 'z' })).toThrow();
  });

  it('should reject invalid datetime for createdAt', () => {
    expect(() =>
      MetadataRecordSchema.parse({
        id: 'x',
        name: 'y',
        type: 'z',
        metadata: {},
        createdAt: 'not-a-date',
      }),
    ).toThrow();
  });
});

describe('MetadataFormatSchema', () => {
  it('should accept valid formats', () => {
    const formats = ['json', 'yaml', 'typescript', 'javascript'];
    formats.forEach((format) => {
      expect(() => MetadataFormatSchema.parse(format)).not.toThrow();
    });
  });

  it('should reject invalid formats', () => {
    expect(() => MetadataFormatSchema.parse('xml')).toThrow();
  });

  // Pin (#4537): the extension-style aliases the system-side copy used to
  // carry had zero producers — every loader normalizes at the boundary
  // (FilesystemLoader.detectFormat maps .yml/.ts/.js to the canonical names).
  // They must stay rejected so the alias vocabulary cannot silently return.
  it('should reject the retired yml/ts/js aliases', () => {
    ['yml', 'ts', 'js'].forEach((alias) => {
      expect(() => MetadataFormatSchema.parse(alias)).toThrow();
    });
  });
});

describe('MetadataStatsSchema', () => {
  it('should accept empty object (all optional)', () => {
    const stats = MetadataStatsSchema.parse({});
    expect(stats).toBeDefined();
  });

  it('should accept full stats', () => {
    const stats = MetadataStatsSchema.parse({
      path: '/metadata/view.json',
      size: 1024,
      mtime: '2025-01-01T00:00:00Z',
      hash: 'sha256:abc',
      etag: '"abc123"',
      modifiedAt: '2025-01-01T00:00:00Z',
      format: 'json',
    });

    expect(stats.path).toBe('/metadata/view.json');
    expect(stats.size).toBe(1024);
    expect(stats.format).toBe('json');
  });
});

describe('MetadataLoaderContractSchema', () => {
  it('should accept valid loader with capability defaults', () => {
    const loader = MetadataLoaderContractSchema.parse({
      name: 'filesystem',
      protocol: 'file:',
      capabilities: {},
    });

    expect(loader.name).toBe('filesystem');
    expect(loader.capabilities.read).toBe(true);
    expect(loader.capabilities.write).toBe(false);
    expect(loader.capabilities.watch).toBe(false);
    expect(loader.capabilities.list).toBe(true);
  });

  it('should accept full loader config', () => {
    const loader = MetadataLoaderContractSchema.parse({
      name: 'http-loader',
      protocol: 'http:',
      description: 'Loads metadata over HTTP',
      supportedFormats: ['json', 'yaml'],
      supportsWatch: false,
      supportsWrite: true,
      supportsCache: true,
      capabilities: { read: true, write: true, watch: false, list: true },
    });

    expect(loader.description).toBe('Loads metadata over HTTP');
    expect(loader.supportedFormats).toEqual(['json', 'yaml']);
  });

  it('should accept datasource protocol', () => {
    const loader = MetadataLoaderContractSchema.parse({
      name: 'database',
      protocol: 'datasource:',
      capabilities: { read: true, write: true, watch: false, list: true },
    });

    expect(loader.protocol).toBe('datasource:');
    expect(loader.capabilities.write).toBe(true);
  });

  it('should accept all valid protocols', () => {
    const protocols = ['file:', 'http:', 's3:', 'datasource:', 'memory:'];
    protocols.forEach((protocol) => {
      expect(() => MetadataLoaderContractSchema.parse({
        name: 'test', protocol, capabilities: {},
      })).not.toThrow();
    });
  });

  it('should reject invalid protocol', () => {
    expect(() => MetadataLoaderContractSchema.parse({
      name: 'test', protocol: 'ftp:', capabilities: {},
    })).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => MetadataLoaderContractSchema.parse({})).toThrow();
    expect(() => MetadataLoaderContractSchema.parse({ name: 'x' })).toThrow();
  });
});

describe('MetadataLoadOptionsSchema', () => {
  it('should accept empty object (all optional)', () => {
    const opts = MetadataLoadOptionsSchema.parse({});
    expect(opts).toBeDefined();
  });

  it('should accept full options', () => {
    const opts = MetadataLoadOptionsSchema.parse({
      scope: 'user',
      namespace: 'crm',
      raw: true,
      cache: true,
      useCache: true,
      validate: true,
      ifNoneMatch: '"etag-123"',
      recursive: true,
      limit: 50,
      patterns: ['*.view.json'],
      loader: 'filesystem',
    });

    expect(opts.scope).toBe('user');
    expect(opts.limit).toBe(50);
  });
});

describe('MetadataLoadResultSchema', () => {
  it('should accept minimal result', () => {
    const result = MetadataLoadResultSchema.parse({ data: null });
    expect(result.data).toBeNull();
  });

  it('should accept full result', () => {
    const result = MetadataLoadResultSchema.parse({
      data: { name: 'test' },
      stats: { size: 100 },
      format: 'yaml',
      source: '/metadata/test.yaml',
      fromCache: true,
      etag: '"abc"',
      notModified: false,
      loadTime: 42,
    });

    expect(result.format).toBe('yaml');
    expect(result.fromCache).toBe(true);
    expect(result.loadTime).toBe(42);
  });
});

describe('MetadataSaveOptionsSchema', () => {
  it('should accept empty object with defaults', () => {
    const opts = MetadataSaveOptionsSchema.parse({});
    expect(opts.create).toBe(true);
    expect(opts.overwrite).toBe(true);
  });

  it('should accept full options', () => {
    const opts = MetadataSaveOptionsSchema.parse({
      format: 'json',
      create: false,
      overwrite: false,
      path: '/metadata/out.json',
      prettify: true,
      indent: 2,
      sortKeys: true,
      backup: true,
      atomic: true,
      loader: 'filesystem',
    });

    expect(opts.create).toBe(false);
    expect(opts.indent).toBe(2);
  });
});

describe('MetadataSaveResultSchema', () => {
  it('should accept minimal result', () => {
    const result = MetadataSaveResultSchema.parse({ success: true });
    expect(result.success).toBe(true);
  });

  it('should accept full result', () => {
    const result = MetadataSaveResultSchema.parse({
      success: true,
      path: '/metadata/out.json',
      stats: { size: 200 },
      etag: '"xyz"',
      size: 200,
      saveTime: 10,
      backupPath: '/metadata/out.json.bak',
    });

    expect(result.backupPath).toBe('/metadata/out.json.bak');
  });

  it('should reject missing success', () => {
    expect(() => MetadataSaveResultSchema.parse({})).toThrow();
  });
});

describe('MetadataWatchEventSchema', () => {
  it('should accept the canonical event types', () => {
    const types = ['added', 'changed', 'deleted'];
    types.forEach((type) => {
      expect(() => MetadataWatchEventSchema.parse({ type, path: '/test' })).not.toThrow();
    });
  });

  // Pin (#4536): the raw chokidar vocabulary is translated in
  // NodeMetadataManager's watcher callbacks and never reaches the event
  // surface — the schema must reject it, not smuggle it back in.
  it('should reject the raw chokidar event types', () => {
    const rawTypes = ['add', 'change', 'unlink'];
    rawTypes.forEach((type) => {
      expect(() => MetadataWatchEventSchema.parse({ type, path: '/test' })).toThrow();
    });
  });

  it('should accept full event', () => {
    const event = MetadataWatchEventSchema.parse({
      type: 'changed',
      path: '/metadata/view.json',
      name: 'account_view',
      stats: { size: 512 },
      metadataType: 'view',
      data: { columns: ['name'] },
      timestamp: '2025-01-01T00:00:00Z',
    });

    expect(event.name).toBe('account_view');
    expect(event.metadataType).toBe('view');
  });

  it('should reject invalid event type', () => {
    expect(() => MetadataWatchEventSchema.parse({ type: 'modify', path: '/test' })).toThrow();
  });

  it('should reject missing path', () => {
    expect(() => MetadataWatchEventSchema.parse({ type: 'added' })).toThrow();
  });
});

describe('MetadataCollectionInfoSchema', () => {
  it('should accept valid collection info', () => {
    const info = MetadataCollectionInfoSchema.parse({
      type: 'view',
      count: 15,
      namespaces: ['crm', 'finance'],
    });

    expect(info.type).toBe('view');
    expect(info.count).toBe(15);
    expect(info.namespaces).toEqual(['crm', 'finance']);
  });

  it('should reject missing required fields', () => {
    expect(() => MetadataCollectionInfoSchema.parse({})).toThrow();
    expect(() => MetadataCollectionInfoSchema.parse({ type: 'view' })).toThrow();
  });
});

describe('MetadataExportOptionsSchema', () => {
  it('should accept minimal export options with defaults', () => {
    const opts = MetadataExportOptionsSchema.parse({ output: '/export' });
    expect(opts.output).toBe('/export');
    expect(opts.format).toBe('json');
  });

  it('should accept full export options', () => {
    const opts = MetadataExportOptionsSchema.parse({
      types: ['view', 'object'],
      namespaces: ['crm'],
      output: '/export/crm',
      format: 'yaml',
    });

    expect(opts.types).toEqual(['view', 'object']);
    expect(opts.format).toBe('yaml');
  });

  it('should reject missing output', () => {
    expect(() => MetadataExportOptionsSchema.parse({})).toThrow();
  });
});

describe('MetadataImportOptionsSchema', () => {
  it('should accept minimal import options with defaults', () => {
    const opts = MetadataImportOptionsSchema.parse({ source: '/import' });
    expect(opts.source).toBe('/import');
    expect(opts.strategy).toBe('merge');
    expect(opts.validate).toBe(true);
  });

  it('should accept all strategies', () => {
    const strategies = ['merge', 'replace', 'skip'];
    strategies.forEach((strategy) => {
      expect(() => MetadataImportOptionsSchema.parse({ source: '/x', strategy })).not.toThrow();
    });
  });

  it('should reject missing source', () => {
    expect(() => MetadataImportOptionsSchema.parse({})).toThrow();
  });
});

describe('MetadataManagerConfigSchema', () => {
  it('should accept empty object with defaults', () => {
    const config = MetadataManagerConfigSchema.parse({});
    expect(config).toBeDefined();
    expect(config.tableName).toBe('sys_metadata');
    expect(config.fallback).toBe('none');
  });

  it('should accept datasource-backed config', () => {
    const config = MetadataManagerConfigSchema.parse({
      datasource: 'default',
      tableName: 'custom_metadata',
      fallback: 'filesystem',
      rootDir: '/app/metadata',
    });

    expect(config.datasource).toBe('default');
    expect(config.tableName).toBe('custom_metadata');
    expect(config.fallback).toBe('filesystem');
    expect(config.rootDir).toBe('/app/metadata');
  });

  it('should accept filesystem-only config', () => {
    const config = MetadataManagerConfigSchema.parse({
      rootDir: '/app',
      watch: true,
      cache: { enabled: true },
      formats: ['json', 'yaml'],
    });

    expect(config.rootDir).toBe('/app');
    expect(config.watch).toBe(true);
    expect(config.formats).toEqual(['json', 'yaml']);
  });

  it('should accept all fallback strategies', () => {
    const strategies = ['filesystem', 'memory', 'none'];
    strategies.forEach((fallback) => {
      const config = MetadataManagerConfigSchema.parse({ fallback });
      expect(config.fallback).toBe(fallback);
    });
  });

  it('should reject invalid fallback strategy', () => {
    expect(() => MetadataManagerConfigSchema.parse({ fallback: 'redis' })).toThrow();
  });
});

describe('MetadataFallbackStrategySchema', () => {
  it('should accept valid fallback strategies', () => {
    const strategies = ['filesystem', 'memory', 'none'];
    strategies.forEach((s) => {
      expect(() => MetadataFallbackStrategySchema.parse(s)).not.toThrow();
    });
  });

  it('should reject invalid strategy', () => {
    expect(() => MetadataFallbackStrategySchema.parse('redis')).toThrow();
  });
});

describe('MetadataSourceSchema', () => {
  it('should accept valid sources', () => {
    const sources = ['filesystem', 'database', 'api', 'migration'];
    sources.forEach((s) => {
      expect(() => MetadataSourceSchema.parse(s)).not.toThrow();
    });
  });

  it('should reject invalid source', () => {
    expect(() => MetadataSourceSchema.parse('unknown')).toThrow();
  });
});

describe('PackagePublishResultSchema', () => {
  it('should accept a successful publish result', () => {
    const result = PackagePublishResultSchema.parse({
      success: true,
      packageId: 'com.acme.crm',
      version: 2,
      publishedAt: '2025-06-01T12:00:00Z',
      itemsPublished: 5,
    });

    expect(result.success).toBe(true);
    expect(result.packageId).toBe('com.acme.crm');
    expect(result.version).toBe(2);
    expect(result.publishedAt).toBe('2025-06-01T12:00:00Z');
    expect(result.itemsPublished).toBe(5);
    expect(result.validationErrors).toBeUndefined();
  });

  it('should accept a failed publish result with validation errors', () => {
    const result = PackagePublishResultSchema.parse({
      success: false,
      packageId: 'com.acme.crm',
      version: 1,
      publishedAt: '2025-06-01T12:00:00Z',
      itemsPublished: 0,
      validationErrors: [
        { type: 'view', name: 'missing_view', message: 'Referenced object not found' },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.validationErrors).toHaveLength(1);
    expect(result.validationErrors![0].type).toBe('view');
  });

  it('should reject missing required fields', () => {
    expect(() => PackagePublishResultSchema.parse({})).toThrow();
    expect(() => PackagePublishResultSchema.parse({ success: true })).toThrow();
  });
});
