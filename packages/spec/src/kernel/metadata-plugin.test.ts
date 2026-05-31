import { describe, it, expect } from 'vitest';
import {
  MetadataTypeSchema,
  MetadataTypeRegistryEntrySchema,
  MetadataQuerySchema,
  MetadataQueryResultSchema,
  MetadataEventSchema,
  MetadataValidationResultSchema,
  MetadataPluginConfigSchema,
  MetadataPluginManifestSchema,
  MetadataBulkRegisterRequestSchema,
  MetadataBulkResultSchema,
  MetadataDependencySchema,
  DEFAULT_METADATA_TYPE_REGISTRY,
} from './metadata-plugin.zod';

describe('MetadataPluginProtocol', () => {
  describe('MetadataTypeSchema', () => {
    it('should accept all built-in metadata types', () => {
      const types = [
        'object', 'field', 'trigger', 'validation', 'hook',
        'view', 'page', 'dashboard', 'app', 'action', 'report',
        'flow', 'workflow',
        'datasource', 'translation', 'router', 'function', 'service',
        'permission', 'profile', 'role',
        'agent', 'tool', 'skill',
      ];

      types.forEach(type => {
        expect(MetadataTypeSchema.parse(type)).toBe(type);
      });
    });

    it('should reject unknown metadata types', () => {
      expect(() => MetadataTypeSchema.parse('unknown')).toThrow();
      expect(() => MetadataTypeSchema.parse('widget')).toThrow();
      expect(() => MetadataTypeSchema.parse('')).toThrow();
    });

    it('should reject `approval` as a metadata type (ADR-0019: approval is a flow node)', () => {
      expect(() => MetadataTypeSchema.parse('approval')).toThrow();
    });
  });

  describe('MetadataTypeRegistryEntrySchema', () => {
    it('should validate a complete registry entry', () => {
      const entry = {
        type: 'object',
        label: 'Object',
        description: 'Business entity definition',
        filePatterns: ['**/*.object.ts', '**/*.object.yml'],
        supportsOverlay: true,
        allowRuntimeCreate: false,
        supportsVersioning: true,
        loadOrder: 10,
        domain: 'data',
      };

      const result = MetadataTypeRegistryEntrySchema.parse(entry);
      expect(result.type).toBe('object');
      expect(result.label).toBe('Object');
      expect(result.filePatterns).toHaveLength(2);
      expect(result.domain).toBe('data');
    });

    it('should apply default values', () => {
      const entry = {
        type: 'view',
        label: 'View',
        filePatterns: ['**/*.view.ts'],
        domain: 'ui',
      };

      const result = MetadataTypeRegistryEntrySchema.parse(entry);
      expect(result.supportsOverlay).toBe(true);
      expect(result.allowRuntimeCreate).toBe(true);
      expect(result.supportsVersioning).toBe(false);
      expect(result.loadOrder).toBe(100);
    });

    it('should reject invalid domain', () => {
      expect(() => MetadataTypeRegistryEntrySchema.parse({
        type: 'object',
        label: 'Object',
        filePatterns: ['**/*.object.ts'],
        domain: 'invalid',
      })).toThrow();
    });

    it('should accept all valid domains', () => {
      const domains = ['data', 'ui', 'automation', 'system', 'security', 'ai'] as const;
      domains.forEach(domain => {
        const result = MetadataTypeRegistryEntrySchema.parse({
          type: 'object',
          label: 'Test',
          filePatterns: ['**/*.test.ts'],
          domain,
        });
        expect(result.domain).toBe(domain);
      });
    });

    it('should reject negative loadOrder', () => {
      expect(() => MetadataTypeRegistryEntrySchema.parse({
        type: 'object',
        label: 'Object',
        filePatterns: ['**/*.object.ts'],
        domain: 'data',
        loadOrder: -1,
      })).toThrow();
    });
  });

  describe('MetadataQuerySchema', () => {
    it('should apply default values', () => {
      const query = {};
      const result = MetadataQuerySchema.parse(query);

      expect(result.sortBy).toBe('name');
      expect(result.sortOrder).toBe('asc');
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it('should accept full query parameters', () => {
      const query = {
        types: ['object', 'view'] as const,
        namespaces: ['crm', 'base'],
        packageId: 'com.acme.crm',
        search: 'account',
        scope: 'platform' as const,
        state: 'active' as const,
        tags: ['core', 'crm'],
        sortBy: 'updatedAt' as const,
        sortOrder: 'desc' as const,
        page: 2,
        pageSize: 25,
      };

      const result = MetadataQuerySchema.parse(query);
      expect(result.types).toEqual(['object', 'view']);
      expect(result.search).toBe('account');
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(25);
    });

    it('should reject invalid page size', () => {
      expect(() => MetadataQuerySchema.parse({ pageSize: 0 })).toThrow();
      expect(() => MetadataQuerySchema.parse({ pageSize: 501 })).toThrow();
    });

    it('should reject invalid page number', () => {
      expect(() => MetadataQuerySchema.parse({ page: 0 })).toThrow();
      expect(() => MetadataQuerySchema.parse({ page: -1 })).toThrow();
    });

    it('should accept all sort fields', () => {
      const fields = ['name', 'type', 'updatedAt', 'createdAt'] as const;
      fields.forEach(sortBy => {
        const result = MetadataQuerySchema.parse({ sortBy });
        expect(result.sortBy).toBe(sortBy);
      });
    });
  });

  describe('MetadataQueryResultSchema', () => {
    it('should validate a query result', () => {
      const result = {
        items: [
          { type: 'object', name: 'account', label: 'Account', scope: 'system' as const },
          { type: 'view', name: 'account_list', namespace: 'crm' },
        ],
        total: 42,
        page: 1,
        pageSize: 50,
      };

      const validated = MetadataQueryResultSchema.parse(result);
      expect(validated.items).toHaveLength(2);
      expect(validated.total).toBe(42);
    });

    it('should accept empty results', () => {
      const result = { items: [], total: 0, page: 1, pageSize: 50 };
      const validated = MetadataQueryResultSchema.parse(result);
      expect(validated.items).toHaveLength(0);
      expect(validated.total).toBe(0);
    });

    it('should accept items with all optional fields', () => {
      const result = {
        items: [{
          type: 'object',
          name: 'account',
          namespace: 'crm',
          label: 'Account',
          scope: 'system' as const,
          state: 'active' as const,
          packageId: 'com.acme.crm',
          updatedAt: '2026-01-15T10:30:00.000Z',
        }],
        total: 1,
        page: 1,
        pageSize: 50,
      };

      const validated = MetadataQueryResultSchema.parse(result);
      expect(validated.items[0].packageId).toBe('com.acme.crm');
      expect(validated.items[0].updatedAt).toBeDefined();
    });
  });

  describe('MetadataEventSchema', () => {
    it('should validate metadata events', () => {
      const events = [
        { event: 'metadata.registered', metadataType: 'object', name: 'account', timestamp: new Date().toISOString() },
        { event: 'metadata.updated', metadataType: 'view', name: 'account_list', timestamp: new Date().toISOString() },
        { event: 'metadata.unregistered', metadataType: 'flow', name: 'approval_flow', timestamp: new Date().toISOString() },
      ] as const;

      events.forEach(event => {
        const validated = MetadataEventSchema.parse(event);
        expect(validated.event).toBe(event.event);
        expect(validated.name).toBe(event.name);
      });
    });

    it('should accept all event types', () => {
      const eventTypes = [
        'metadata.registered', 'metadata.updated', 'metadata.unregistered',
        'metadata.validated', 'metadata.deployed',
        'metadata.overlay.applied', 'metadata.overlay.removed',
        'metadata.imported', 'metadata.exported',
      ] as const;

      eventTypes.forEach(event => {
        expect(() => MetadataEventSchema.parse({
          event,
          metadataType: 'object',
          name: 'test',
          timestamp: new Date().toISOString(),
        })).not.toThrow();
      });
    });

    it('should accept optional fields', () => {
      const event = {
        event: 'metadata.registered' as const,
        metadataType: 'object' as const,
        name: 'account',
        namespace: 'crm',
        packageId: 'com.acme.crm',
        timestamp: new Date().toISOString(),
        actor: 'admin@example.com',
        payload: { version: '1.0.0' },
      };

      const validated = MetadataEventSchema.parse(event);
      expect(validated.namespace).toBe('crm');
      expect(validated.actor).toBe('admin@example.com');
      expect(validated.payload).toEqual({ version: '1.0.0' });
    });

    it('should reject invalid event types', () => {
      expect(() => MetadataEventSchema.parse({
        event: 'metadata.unknown',
        metadataType: 'object',
        name: 'test',
        timestamp: new Date().toISOString(),
      })).toThrow();
    });
  });

  describe('MetadataValidationResultSchema', () => {
    it('should validate a passing result', () => {
      const result = { valid: true };
      const validated = MetadataValidationResultSchema.parse(result);
      expect(validated.valid).toBe(true);
    });

    it('should validate a failing result with errors', () => {
      const result = {
        valid: false,
        errors: [
          { path: 'fields.name', message: 'Required field missing', code: 'REQUIRED' },
          { path: 'label', message: 'Label must be non-empty' },
        ],
      };

      const validated = MetadataValidationResultSchema.parse(result);
      expect(validated.valid).toBe(false);
      expect(validated.errors).toHaveLength(2);
      expect(validated.errors![0].code).toBe('REQUIRED');
    });

    it('should accept warnings', () => {
      const result = {
        valid: true,
        warnings: [
          { path: 'description', message: 'Description is recommended' },
        ],
      };

      const validated = MetadataValidationResultSchema.parse(result);
      expect(validated.valid).toBe(true);
      expect(validated.warnings).toHaveLength(1);
    });
  });

  describe('MetadataPluginConfigSchema', () => {
    it('should apply default values', () => {
      const config = {
        storage: {},
      };

      const result = MetadataPluginConfigSchema.parse(config);
      expect(result.enableEvents).toBe(true);
      expect(result.validateOnWrite).toBe(true);
      expect(result.enableVersioning).toBe(false);
      expect(result.cacheMaxItems).toBe(10000);
    });

    it('should accept full configuration', () => {
      const config = {
        storage: {
          datasource: 'default',
          tableName: 'sys_metadata',
          fallback: 'filesystem' as const,
          rootDir: '/metadata',
        },
        customizationPolicies: [{
          metadataType: 'object',
          allowCustomization: true,
          lockedFields: ['name', 'type'],
          customizableFields: ['label', 'description'],
        }],
        mergeStrategy: {
          defaultStrategy: 'three-way-merge' as const,
          alwaysKeepCustom: ['fields.*.label'],
        },
        additionalTypes: [{
          type: 'chart',
          label: 'Chart',
          filePatterns: ['**/*.chart.ts'],
          domain: 'ui',
        }],
        enableEvents: true,
        validateOnWrite: true,
        enableVersioning: true,
        cacheMaxItems: 5000,
      };

      const result = MetadataPluginConfigSchema.parse(config);
      expect(result.storage.datasource).toBe('default');
      expect(result.customizationPolicies).toHaveLength(1);
      expect(result.additionalTypes).toHaveLength(1);
      expect(result.cacheMaxItems).toBe(5000);
    });

    it('should reject negative cache max items', () => {
      expect(() => MetadataPluginConfigSchema.parse({
        storage: {},
        cacheMaxItems: -1,
      })).toThrow();
    });
  });

  describe('MetadataPluginManifestSchema', () => {
    it('should validate a minimal manifest', () => {
      const manifest = {
        id: 'com.objectstack.metadata',
        name: 'ObjectStack Metadata Service',
        version: '1.0.0',
        type: 'standard',
        capabilities: {},
      };

      const result = MetadataPluginManifestSchema.parse(manifest);
      expect(result.id).toBe('com.objectstack.metadata');
      expect(result.capabilities.crud).toBe(true);
      expect(result.capabilities.query).toBe(true);
      expect(result.capabilities.overlay).toBe(true);
      expect(result.capabilities.watch).toBe(false);
      expect(result.capabilities.importExport).toBe(true);
      expect(result.capabilities.validation).toBe(true);
      expect(result.capabilities.versioning).toBe(false);
      expect(result.capabilities.events).toBe(true);
    });

    it('should validate a full manifest with config', () => {
      const manifest = {
        id: 'com.objectstack.metadata',
        name: 'ObjectStack Metadata Service',
        version: '2.0.0',
        type: 'standard',
        description: 'Core metadata management service',
        capabilities: {
          crud: true,
          query: true,
          overlay: true,
          watch: true,
          importExport: true,
          validation: true,
          versioning: true,
          events: true,
        },
        config: {
          storage: {
            datasource: 'default',
            rootDir: '/metadata',
          },
          enableEvents: true,
          enableVersioning: true,
        },
      };

      const result = MetadataPluginManifestSchema.parse(manifest);
      expect(result.version).toBe('2.0.0');
      expect(result.capabilities.watch).toBe(true);
      expect(result.capabilities.versioning).toBe(true);
      expect(result.config?.enableVersioning).toBe(true);
    });

    it('should reject invalid plugin ID', () => {
      expect(() => MetadataPluginManifestSchema.parse({
        id: 'wrong.id',
        name: 'ObjectStack Metadata Service',
        version: '1.0.0',
        type: 'standard',
        capabilities: {},
      })).toThrow();
    });

    it('should reject invalid plugin name', () => {
      expect(() => MetadataPluginManifestSchema.parse({
        id: 'com.objectstack.metadata',
        name: 'Wrong Name',
        version: '1.0.0',
        type: 'standard',
        capabilities: {},
      })).toThrow();
    });

    it('should reject invalid version', () => {
      expect(() => MetadataPluginManifestSchema.parse({
        id: 'com.objectstack.metadata',
        name: 'ObjectStack Metadata Service',
        version: 'invalid',
        type: 'standard',
        capabilities: {},
      })).toThrow();
    });
  });

  describe('MetadataBulkRegisterRequestSchema', () => {
    it('should validate a bulk register request', () => {
      const request = {
        items: [
          { type: 'object', name: 'account', data: { label: 'Account' } },
          { type: 'view', name: 'account_list', data: { label: 'Account List' } },
        ],
      };

      const result = MetadataBulkRegisterRequestSchema.parse(request);
      expect(result.items).toHaveLength(2);
      expect(result.continueOnError).toBe(false);
      expect(result.validate).toBe(true);
    });

    it('should reject empty items array', () => {
      expect(() => MetadataBulkRegisterRequestSchema.parse({
        items: [],
      })).toThrow();
    });

    it('should accept options', () => {
      const request = {
        items: [{ type: 'object', name: 'test', data: {} }],
        continueOnError: true,
        validate: false,
      };

      const result = MetadataBulkRegisterRequestSchema.parse(request);
      expect(result.continueOnError).toBe(true);
      expect(result.validate).toBe(false);
    });
  });

  describe('MetadataBulkResultSchema', () => {
    it('should validate a successful bulk result', () => {
      const result = { total: 5, succeeded: 5, failed: 0 };
      const validated = MetadataBulkResultSchema.parse(result);
      expect(validated.total).toBe(5);
      expect(validated.succeeded).toBe(5);
      expect(validated.failed).toBe(0);
    });

    it('should validate a partial failure result', () => {
      const result = {
        total: 3,
        succeeded: 2,
        failed: 1,
        errors: [
          { type: 'object', name: 'bad_object', error: 'Validation failed' },
        ],
      };

      const validated = MetadataBulkResultSchema.parse(result);
      expect(validated.errors).toHaveLength(1);
      expect(validated.errors![0].error).toBe('Validation failed');
    });
  });

  describe('MetadataDependencySchema', () => {
    it('should validate a dependency', () => {
      const dep = {
        sourceType: 'view',
        sourceName: 'account_list',
        targetType: 'object',
        targetName: 'account',
        kind: 'reference',
      };

      const result = MetadataDependencySchema.parse(dep);
      expect(result.kind).toBe('reference');
    });

    it('should accept all dependency kinds', () => {
      const kinds = ['reference', 'extends', 'includes', 'triggers'] as const;
      kinds.forEach(kind => {
        const result = MetadataDependencySchema.parse({
          sourceType: 'view',
          sourceName: 'test',
          targetType: 'object',
          targetName: 'test',
          kind,
        });
        expect(result.kind).toBe(kind);
      });
    });

    it('should reject invalid dependency kind', () => {
      expect(() => MetadataDependencySchema.parse({
        sourceType: 'view',
        sourceName: 'test',
        targetType: 'object',
        targetName: 'test',
        kind: 'invalid',
      })).toThrow();
    });
  });

  describe('DEFAULT_METADATA_TYPE_REGISTRY', () => {
    it('should contain entries for all built-in types', () => {
      const types = DEFAULT_METADATA_TYPE_REGISTRY.map(e => e.type);

      expect(types).toContain('object');
      expect(types).toContain('field');
      expect(types).toContain('view');
      expect(types).toContain('app');
      expect(types).toContain('flow');
      expect(types).toContain('dashboard');
      expect(types).toContain('datasource');
      expect(types).toContain('permission');
      expect(types).toContain('agent');
      expect(types).toContain('tool');
      expect(types).toContain('skill');
    });

    it('should have valid entries for all registry items', () => {
      DEFAULT_METADATA_TYPE_REGISTRY.forEach(entry => {
        // Validate each entry against the schema
        const result = MetadataTypeRegistryEntrySchema.parse(entry);
        expect(result.type).toBeDefined();
        expect(result.label).toBeDefined();
        expect(result.filePatterns.length).toBeGreaterThan(0);
        expect(result.domain).toBeDefined();
      });
    });

    it('should have datasource loading before objects', () => {
      const dsEntry = DEFAULT_METADATA_TYPE_REGISTRY.find(e => e.type === 'datasource')!;
      const objEntry = DEFAULT_METADATA_TYPE_REGISTRY.find(e => e.type === 'object')!;
      expect(dsEntry.loadOrder).toBeLessThan(objEntry.loadOrder);
    });

    it('should have objects loading before views', () => {
      const objEntry = DEFAULT_METADATA_TYPE_REGISTRY.find(e => e.type === 'object')!;
      const viewEntry = DEFAULT_METADATA_TYPE_REGISTRY.find(e => e.type === 'view')!;
      expect(objEntry.loadOrder).toBeLessThan(viewEntry.loadOrder);
    });

    it('should have correct domain assignments', () => {
      const byDomain = (domain: string) =>
        DEFAULT_METADATA_TYPE_REGISTRY.filter(e => e.domain === domain).map(e => e.type);

      expect(byDomain('data')).toContain('object');
      expect(byDomain('data')).toContain('field');
      expect(byDomain('ui')).toContain('view');
      expect(byDomain('ui')).toContain('dashboard');
      expect(byDomain('automation')).toContain('flow');
      expect(byDomain('automation')).toContain('workflow');
      expect(byDomain('system')).toContain('datasource');
      expect(byDomain('system')).toContain('translation');
      expect(byDomain('security')).toContain('permission');
      expect(byDomain('ai')).toContain('agent');
      expect(byDomain('ai')).toContain('tool');
      expect(byDomain('ai')).toContain('skill');
    });
  });
});
