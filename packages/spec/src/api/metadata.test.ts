import { describe, it, expect } from 'vitest';
import {
  ObjectDefinitionResponseSchema,
  AppDefinitionResponseSchema,
  ConceptListResponseSchema,
  // CRUD
  MetadataRegisterRequestSchema,
  MetadataItemResponseSchema,
  MetadataListResponseSchema,
  MetadataNamesResponseSchema,
  MetadataExistsResponseSchema,
  MetadataDeleteResponseSchema,
  // Query
  MetadataQueryRequestSchema,
  MetadataQueryResponseSchema,
  // Bulk
  MetadataBulkRegisterRequestSchema,
  MetadataBulkUnregisterRequestSchema,
  MetadataBulkResponseSchema,
  // Import/Export
  MetadataExportRequestSchema,
  MetadataExportResponseSchema,
  MetadataImportRequestSchema,
  MetadataImportResponseSchema,
  // Validation
  MetadataValidateRequestSchema,
  MetadataValidateResponseSchema,
  // Type Registry
  MetadataTypesResponseSchema,
  MetadataTypeInfoResponseSchema,
  // Dependencies
  MetadataDependenciesResponseSchema,
  MetadataDependentsResponseSchema,
  type MetadataBulkRegisterRequest,
} from './metadata.zod';

// ==========================================
// 1. Legacy Response Schemas (existing)
// ==========================================

describe('ObjectDefinitionResponseSchema', () => {
  it('should accept valid object definition response', () => {
    const result = ObjectDefinitionResponseSchema.parse({
      success: true,
      data: {
        name: 'project_task',
        fields: {
          title: { type: 'text', label: 'Title' },
        },
      },
    });
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('project_task');
  });

  it('should reject missing data', () => {
    expect(() =>
      ObjectDefinitionResponseSchema.parse({ success: true })
    ).toThrow();
  });

  it('should reject invalid object name in data', () => {
    expect(() =>
      ObjectDefinitionResponseSchema.parse({
        success: true,
        data: {
          name: 'InvalidName',
          fields: {},
        },
      })
    ).toThrow();
  });

  it('should accept optional meta and error fields', () => {
    const result = ObjectDefinitionResponseSchema.parse({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Object not found' },
      meta: { timestamp: '2025-01-01T00:00:00Z' },
      data: {
        name: 'account',
        fields: {},
      },
    });
    expect(result.error?.code).toBe('NOT_FOUND');
    expect(result.meta?.timestamp).toBe('2025-01-01T00:00:00Z');
  });
});

describe('AppDefinitionResponseSchema', () => {
  it('should accept valid app definition response', () => {
    const result = AppDefinitionResponseSchema.parse({
      success: true,
      data: {
        name: 'crm_app',
        label: 'CRM App',
      },
    });
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('crm_app');
    expect(result.data.label).toBe('CRM App');
  });

  it('should reject missing data', () => {
    expect(() =>
      AppDefinitionResponseSchema.parse({ success: true })
    ).toThrow();
  });

  it('should reject invalid app name', () => {
    expect(() =>
      AppDefinitionResponseSchema.parse({
        success: true,
        data: {
          name: 'CRM',
          label: 'CRM',
        },
      })
    ).toThrow();
  });

  it('should accept app with navigation', () => {
    const result = AppDefinitionResponseSchema.parse({
      success: true,
      data: {
        name: 'sales_app',
        label: 'Sales',
        navigation: [
          {
            type: 'object',
            id: 'nav_leads',
            label: 'Leads',
            objectName: 'leads',
          },
        ],
      },
    });
    expect(result.data.navigation).toHaveLength(1);
  });
});

describe('ConceptListResponseSchema', () => {
  it('should accept valid concept list response', () => {
    const result = ConceptListResponseSchema.parse({
      success: true,
      data: [
        { name: 'account', label: 'Account' },
        { name: 'contact', label: 'Contact', icon: 'user', description: 'Contacts' },
      ],
    });
    expect(result.data).toHaveLength(2);
    expect(result.data[0].name).toBe('account');
  });

  it('should accept empty concept list', () => {
    const result = ConceptListResponseSchema.parse({
      success: true,
      data: [],
    });
    expect(result.data).toHaveLength(0);
  });

  it('should reject concept items missing required fields', () => {
    expect(() =>
      ConceptListResponseSchema.parse({
        success: true,
        data: [{ name: 'account' }],
      })
    ).toThrow();
  });

  it('should accept concept items with optional icon and description', () => {
    const result = ConceptListResponseSchema.parse({
      success: true,
      data: [{ name: 'flow', label: 'Flow', icon: 'zap' }],
    });
    expect(result.data[0].icon).toBe('zap');
    expect(result.data[0].description).toBeUndefined();
  });
});

// ==========================================
// 2. CRUD Operations
// ==========================================

describe('MetadataRegisterRequestSchema', () => {
  it('should accept valid register request', () => {
    const result = MetadataRegisterRequestSchema.parse({
      type: 'object',
      name: 'customer_order',
      data: { label: 'Customer Order', fields: {} },
    });
    expect(result.type).toBe('object');
    expect(result.name).toBe('customer_order');
  });

  it('should reject invalid snake_case name', () => {
    expect(() =>
      MetadataRegisterRequestSchema.parse({
        type: 'object',
        name: 'InvalidName',
        data: {},
      })
    ).toThrow();
  });

  it('should reject names starting with a number', () => {
    expect(() =>
      MetadataRegisterRequestSchema.parse({
        type: 'view',
        name: '1invalid',
        data: {},
      })
    ).toThrow();
  });

  it('should accept name with namespace', () => {
    const result = MetadataRegisterRequestSchema.parse({
      type: 'view',
      name: 'account_list',
      data: { label: 'Account List' },
      namespace: 'crm',
    });
    expect(result.namespace).toBe('crm');
  });

  it('should reject unknown metadata type', () => {
    expect(() =>
      MetadataRegisterRequestSchema.parse({
        type: 'invalid_type',
        name: 'test',
        data: {},
      })
    ).toThrow();
  });

  it('should accept all valid metadata types', () => {
    const validTypes = ['object', 'field', 'view', 'page', 'dashboard', 'app', 'flow', 'agent']; // ADR-0088: 'trigger' retired
    for (const type of validTypes) {
      const result = MetadataRegisterRequestSchema.parse({ type, name: 'test_item', data: {} });
      expect(result.type).toBe(type);
    }
  });
});

describe('MetadataItemResponseSchema', () => {
  it('should accept valid item response', () => {
    const result = MetadataItemResponseSchema.parse({
      success: true,
      data: {
        type: 'object',
        name: 'account',
        definition: { label: 'Account', fields: { name: { type: 'text' } } },
      },
    });
    expect(result.data.type).toBe('object');
    expect(result.data.name).toBe('account');
  });

  it('should reject missing definition', () => {
    expect(() =>
      MetadataItemResponseSchema.parse({
        success: true,
        data: { type: 'object', name: 'account' },
      })
    ).toThrow();
  });
});

describe('MetadataListResponseSchema', () => {
  it('should accept list of metadata definitions', () => {
    const result = MetadataListResponseSchema.parse({
      success: true,
      data: [
        { name: 'account', label: 'Account' },
        { name: 'contact', label: 'Contact' },
      ],
    });
    expect(result.data).toHaveLength(2);
  });

  it('should accept empty list', () => {
    const result = MetadataListResponseSchema.parse({ success: true, data: [] });
    expect(result.data).toHaveLength(0);
  });
});

describe('MetadataNamesResponseSchema', () => {
  it('should accept list of names', () => {
    const result = MetadataNamesResponseSchema.parse({
      success: true,
      data: ['account', 'contact', 'lead'],
    });
    expect(result.data).toHaveLength(3);
    expect(result.data[0]).toBe('account');
  });

  it('should accept empty names list', () => {
    const result = MetadataNamesResponseSchema.parse({ success: true, data: [] });
    expect(result.data).toHaveLength(0);
  });
});

describe('MetadataExistsResponseSchema', () => {
  it('should accept exists=true', () => {
    const result = MetadataExistsResponseSchema.parse({
      success: true,
      data: { exists: true },
    });
    expect(result.data.exists).toBe(true);
  });

  it('should accept exists=false', () => {
    const result = MetadataExistsResponseSchema.parse({
      success: true,
      data: { exists: false },
    });
    expect(result.data.exists).toBe(false);
  });
});

describe('MetadataDeleteResponseSchema', () => {
  it('should accept valid delete response', () => {
    const result = MetadataDeleteResponseSchema.parse({
      success: true,
      data: { type: 'object', name: 'old_entity' },
    });
    expect(result.data.name).toBe('old_entity');
  });
});

// ==========================================
// 3. Query / Search
// ==========================================

describe('MetadataQueryRequestSchema', () => {
  it('should accept minimal query (defaults)', () => {
    const result = MetadataQueryRequestSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
    expect(result.sortBy).toBe('name');
    expect(result.sortOrder).toBe('asc');
  });

  it('should accept query with type filters', () => {
    const result = MetadataQueryRequestSchema.parse({
      types: ['object', 'view'],
      search: 'account',
    });
    expect(result.types).toEqual(['object', 'view']);
    expect(result.search).toBe('account');
  });

  it('should accept query with scope and state filters', () => {
    const result = MetadataQueryRequestSchema.parse({
      scope: 'platform',
      state: 'active',
      tags: ['crm', 'sales'],
    });
    expect(result.scope).toBe('platform');
    expect(result.state).toBe('active');
  });

  it('should accept query with pagination', () => {
    const result = MetadataQueryRequestSchema.parse({
      page: 3,
      pageSize: 25,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(25);
  });

  it('should reject invalid page size', () => {
    expect(() =>
      MetadataQueryRequestSchema.parse({ pageSize: 0 })
    ).toThrow();
  });

  it('should reject page size exceeding max', () => {
    expect(() =>
      MetadataQueryRequestSchema.parse({ pageSize: 501 })
    ).toThrow();
  });
});

describe('MetadataQueryResponseSchema', () => {
  it('should accept valid query response', () => {
    const result = MetadataQueryResponseSchema.parse({
      success: true,
      data: {
        items: [
          { type: 'object', name: 'account', label: 'Account', scope: 'system' },
          { type: 'view', name: 'account_list', label: 'Account List' },
        ],
        total: 2,
        page: 1,
        pageSize: 50,
      },
    });
    expect(result.data.items).toHaveLength(2);
    expect(result.data.total).toBe(2);
  });

  it('should accept empty result set', () => {
    const result = MetadataQueryResponseSchema.parse({
      success: true,
      data: { items: [], total: 0, page: 1, pageSize: 50 },
    });
    expect(result.data.items).toHaveLength(0);
  });

  it('should accept items with all optional fields', () => {
    const result = MetadataQueryResponseSchema.parse({
      success: true,
      data: {
        items: [{
          type: 'object',
          name: 'project',
          namespace: 'pm',
          label: 'Project',
          scope: 'platform',
          state: 'active',
          packageId: 'com.acme.pm',
          updatedAt: '2025-06-15T10:30:00Z',
        }],
        total: 1,
        page: 1,
        pageSize: 50,
      },
    });
    expect(result.data.items[0].namespace).toBe('pm');
    expect(result.data.items[0].packageId).toBe('com.acme.pm');
  });
});

// ==========================================
// 4. Bulk Operations
// ==========================================

describe('MetadataBulkRegisterRequestSchema', () => {
  it('should accept valid bulk register request', () => {
    const result = MetadataBulkRegisterRequestSchema.parse({
      items: [
        { type: 'object', name: 'account', data: { label: 'Account' } },
        { type: 'view', name: 'account_list', data: { label: 'Account List' } },
      ],
    });
    expect(result.items).toHaveLength(2);
    expect(result.continueOnError).toBe(false);
    expect(result.validate).toBe(true);
  });

  it('should reject empty items array', () => {
    expect(() =>
      MetadataBulkRegisterRequestSchema.parse({ items: [] })
    ).toThrow();
  });

  it('should accept options overrides', () => {
    const result = MetadataBulkRegisterRequestSchema.parse({
      items: [{ type: 'field', name: 'status', data: {} }],
      continueOnError: true,
      validate: false,
    });
    expect(result.continueOnError).toBe(true);
    expect(result.validate).toBe(false);
  });

  // v17 (#4587): `MetadataBulkRegisterRequest` moved here from ./kernel,
  // which carried a dead near-duplicate of this schema (extra per-item
  // `namespace` that no enforced write path reads). The exported type is the
  // authoring-side shape (z.input): the defaulted flags stay optional, and a
  // per-item `namespace` is NOT part of the contract.
  it('exports the authoring-side MetadataBulkRegisterRequest type (#4587)', () => {
    const minimal: MetadataBulkRegisterRequest = {
      items: [{ type: 'object', name: 'account', data: { label: 'Account' } }],
    };
    const parsed = MetadataBulkRegisterRequestSchema.parse(minimal);
    expect(parsed.continueOnError).toBe(false);
    expect(parsed.validate).toBe(true);

    type Item = MetadataBulkRegisterRequest['items'][number];
    const hasNamespace: 'namespace' extends keyof Item ? true : false = false;
    expect(hasNamespace).toBe(false);
  });
});

describe('MetadataBulkUnregisterRequestSchema', () => {
  it('should accept valid bulk unregister request', () => {
    const result = MetadataBulkUnregisterRequestSchema.parse({
      items: [
        { type: 'object', name: 'old_object' },
        { type: 'view', name: 'old_view' },
      ],
    });
    expect(result.items).toHaveLength(2);
  });

  it('should reject empty items array', () => {
    expect(() =>
      MetadataBulkUnregisterRequestSchema.parse({ items: [] })
    ).toThrow();
  });
});

describe('MetadataBulkResponseSchema', () => {
  it('should accept successful bulk result', () => {
    const result = MetadataBulkResponseSchema.parse({
      success: true,
      data: { total: 5, succeeded: 5, failed: 0 },
    });
    expect(result.data.total).toBe(5);
    expect(result.data.succeeded).toBe(5);
  });

  it('should accept bulk result with errors', () => {
    const result = MetadataBulkResponseSchema.parse({
      success: true,
      data: {
        total: 3,
        succeeded: 2,
        failed: 1,
        errors: [
          { type: 'object', name: 'bad_item', error: 'Validation failed' },
        ],
      },
    });
    expect(result.data.failed).toBe(1);
    expect(result.data.errors).toHaveLength(1);
  });
});

// ==========================================
// 5. Overlay / Customization — REMOVED (#13135, ADR-0049; see metadata.zod.ts §5)
// ==========================================

// ==========================================
// 6. Import / Export
// ==========================================

describe('MetadataExportRequestSchema', () => {
  it('should accept minimal export request', () => {
    const result = MetadataExportRequestSchema.parse({});
    expect(result.format).toBe('json');
  });

  it('should accept export with type filters', () => {
    const result = MetadataExportRequestSchema.parse({
      types: ['object', 'view'],
      namespaces: ['crm'],
      format: 'yaml',
    });
    expect(result.types).toEqual(['object', 'view']);
    expect(result.format).toBe('yaml');
  });
});

describe('MetadataExportResponseSchema', () => {
  it('should accept export response with data', () => {
    const result = MetadataExportResponseSchema.parse({
      success: true,
      data: { objects: { account: { label: 'Account' } }, views: {} },
    });
    expect(result.success).toBe(true);
  });
});

describe('MetadataImportRequestSchema', () => {
  it('should accept valid import request with defaults', () => {
    const result = MetadataImportRequestSchema.parse({
      data: { objects: { test: {} } },
    });
    expect(result.conflictResolution).toBe('skip');
    expect(result.validate).toBe(true);
    expect(result.dryRun).toBe(false);
  });

  it('should accept import with overwrite strategy', () => {
    const result = MetadataImportRequestSchema.parse({
      data: {},
      conflictResolution: 'overwrite',
      validate: false,
      dryRun: true,
    });
    expect(result.conflictResolution).toBe('overwrite');
    expect(result.dryRun).toBe(true);
  });
});

describe('MetadataImportResponseSchema', () => {
  it('should accept successful import response', () => {
    const result = MetadataImportResponseSchema.parse({
      success: true,
      data: { total: 10, imported: 8, skipped: 2, failed: 0 },
    });
    expect(result.data.imported).toBe(8);
  });

  it('should accept import response with errors', () => {
    const result = MetadataImportResponseSchema.parse({
      success: true,
      data: {
        total: 5,
        imported: 3,
        skipped: 0,
        failed: 2,
        errors: [
          { type: 'object', name: 'bad_obj', error: 'Schema validation failed' },
          { type: 'view', name: 'bad_view', error: 'Missing required field' },
        ],
      },
    });
    expect(result.data.errors).toHaveLength(2);
  });
});

// ==========================================
// 7. Validation
// ==========================================

describe('MetadataValidateRequestSchema', () => {
  it('should accept valid validation request', () => {
    const result = MetadataValidateRequestSchema.parse({
      type: 'object',
      data: { name: 'test', fields: {} },
    });
    expect(result.type).toBe('object');
  });
});

describe('MetadataValidateResponseSchema', () => {
  it('should accept valid validation result', () => {
    const result = MetadataValidateResponseSchema.parse({
      success: true,
      data: { valid: true },
    });
    expect(result.data.valid).toBe(true);
  });

  it('should accept validation result with errors and warnings', () => {
    const result = MetadataValidateResponseSchema.parse({
      success: true,
      data: {
        valid: false,
        errors: [
          { path: 'fields.name', message: 'Field name is required', code: 'required' },
        ],
        warnings: [
          { path: 'fields.status', message: 'Consider adding a default value' },
        ],
      },
    });
    expect(result.data.valid).toBe(false);
    expect(result.data.errors).toHaveLength(1);
    expect(result.data.warnings).toHaveLength(1);
  });
});

// ==========================================
// 8. Type Registry
// ==========================================

describe('MetadataTypesResponseSchema', () => {
  it('should accept list of type identifiers', () => {
    const result = MetadataTypesResponseSchema.parse({
      success: true,
      data: ['object', 'view', 'flow', 'agent'],
    });
    expect(result.data).toHaveLength(4);
  });

  it('should accept empty types list', () => {
    const result = MetadataTypesResponseSchema.parse({ success: true, data: [] });
    expect(result.data).toHaveLength(0);
  });
});

describe('MetadataTypeInfoResponseSchema', () => {
  it('should accept type info response', () => {
    const result = MetadataTypeInfoResponseSchema.parse({
      success: true,
      data: {
        type: 'object',
        label: 'Object',
        description: 'Business entity definition',
        filePatterns: ['**/*.object.ts', '**/*.object.yml'],
        supportsOverlay: true,
        domain: 'data',
      },
    });
    expect(result.data?.type).toBe('object');
    expect(result.data?.supportsOverlay).toBe(true);
  });

  it('should accept undefined data (type not found)', () => {
    const result = MetadataTypeInfoResponseSchema.parse({
      success: true,
    });
    expect(result.data).toBeUndefined();
  });
});

// ==========================================
// 9. Dependency Tracking
// ==========================================

describe('MetadataDependenciesResponseSchema', () => {
  it('should accept dependencies list', () => {
    const result = MetadataDependenciesResponseSchema.parse({
      success: true,
      data: [
        {
          sourceType: 'view',
          sourceName: 'account_list',
          targetType: 'object',
          targetName: 'account',
          kind: 'reference',
        },
      ],
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].kind).toBe('reference');
  });

  it('should accept empty dependencies', () => {
    const result = MetadataDependenciesResponseSchema.parse({
      success: true,
      data: [],
    });
    expect(result.data).toHaveLength(0);
  });
});

describe('MetadataDependentsResponseSchema', () => {
  it('should accept dependents list', () => {
    const result = MetadataDependentsResponseSchema.parse({
      success: true,
      data: [
        {
          sourceType: 'view',
          sourceName: 'account_list',
          targetType: 'object',
          targetName: 'account',
          kind: 'reference',
        },
        {
          sourceType: 'flow',
          sourceName: 'onboard_flow',
          targetType: 'object',
          targetName: 'account',
          kind: 'triggers',
        },
      ],
    });
    expect(result.data).toHaveLength(2);
  });

  it('should accept all dependency kinds', () => {
    const kinds = ['reference', 'extends', 'includes', 'triggers'] as const;
    for (const kind of kinds) {
      const result = MetadataDependentsResponseSchema.parse({
        success: true,
        data: [{
          sourceType: 'view',
          sourceName: 'test',
          targetType: 'object',
          targetName: 'account',
          kind,
        }],
      });
      expect(result.data[0].kind).toBe(kind);
    }
  });
});

// ==========================================
// 10. Cross-Framework API Contract Tests
//     Validate that the schema contract covers
//     all metadata endpoints exposed by Hono,
//     Next.js, and NestJS adapters.
// ==========================================

describe('Cross-Framework Metadata API Contracts', () => {
  describe('GET /api/meta/:type — List metadata items', () => {
    it('response conforms to MetadataListResponseSchema', () => {
      const response = MetadataListResponseSchema.parse({
        success: true,
        data: [
          { name: 'account', label: 'Account', fields: {} },
          { name: 'contact', label: 'Contact', fields: {} },
        ],
      });
      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
    });
  });

  describe('GET /api/meta/:type/:name — Get single metadata item', () => {
    it('response conforms to MetadataItemResponseSchema', () => {
      const response = MetadataItemResponseSchema.parse({
        success: true,
        data: {
          type: 'object',
          name: 'account',
          definition: {
            label: 'Account',
            fields: { name: { type: 'text', label: 'Name' } },
          },
        },
      });
      expect(response.data.name).toBe('account');
    });

    it('error response conforms to BaseResponseSchema', () => {
      const response = MetadataItemResponseSchema.safeParse({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Object account not found' },
      });
      // This should fail validation because data is required in the schema
      expect(response.success).toBe(false);
    });
  });

  describe('POST /api/meta/:type — Register metadata', () => {
    it('request conforms to MetadataRegisterRequestSchema', () => {
      const request = MetadataRegisterRequestSchema.parse({
        type: 'object',
        name: 'project_task',
        data: {
          label: 'Project Task',
          fields: {
            title: { type: 'text', label: 'Title' },
            status: { type: 'select', label: 'Status' },
          },
        },
      });
      expect(request.name).toBe('project_task');
    });
  });

  describe('DELETE /api/meta/:type/:name — Delete metadata', () => {
    it('response conforms to MetadataDeleteResponseSchema', () => {
      const response = MetadataDeleteResponseSchema.parse({
        success: true,
        data: { type: 'view', name: 'obsolete_view' },
      });
      expect(response.data.type).toBe('view');
    });
  });

  describe('GET /api/meta/:type/:name/exists — Check existence', () => {
    it('response conforms to MetadataExistsResponseSchema', () => {
      const response = MetadataExistsResponseSchema.parse({
        success: true,
        data: { exists: true },
      });
      expect(response.data.exists).toBe(true);
    });
  });

  describe('GET /api/meta/:type/names — List names', () => {
    it('response conforms to MetadataNamesResponseSchema', () => {
      const response = MetadataNamesResponseSchema.parse({
        success: true,
        data: ['account', 'contact', 'opportunity'],
      });
      expect(response.data).toContain('account');
    });
  });

  describe('POST /api/meta/query — Advanced search', () => {
    it('request with all filters conforms to MetadataQueryRequestSchema', () => {
      const request = MetadataQueryRequestSchema.parse({
        types: ['object', 'view', 'flow'],
        namespaces: ['crm', 'hr'],
        packageId: 'com.acme.crm',
        search: 'account',
        scope: 'platform',
        state: 'active',
        tags: ['sales'],
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        page: 2,
        pageSize: 25,
      });
      expect(request.types).toHaveLength(3);
      expect(request.page).toBe(2);
    });
  });

  describe('POST /api/meta/bulk/register — Bulk register', () => {
    it('full lifecycle: request → response validation', () => {
      const request = MetadataBulkRegisterRequestSchema.parse({
        items: [
          { type: 'object', name: 'customer', data: { label: 'Customer' } },
          { type: 'object', name: 'order', data: { label: 'Order' } },
          { type: 'view', name: 'customer_list', data: { label: 'Customer List' } },
        ],
        continueOnError: true,
      });
      expect(request.items).toHaveLength(3);

      const response = MetadataBulkResponseSchema.parse({
        success: true,
        data: { total: 3, succeeded: 3, failed: 0 },
      });
      expect(response.data.succeeded).toBe(3);
    });
  });

  describe('POST /api/meta/export — Export metadata', () => {
    it('full lifecycle: request → response validation', () => {
      const request = MetadataExportRequestSchema.parse({
        types: ['object', 'view'],
        format: 'yaml',
      });
      expect(request.format).toBe('yaml');

      const response = MetadataExportResponseSchema.parse({
        success: true,
        data: { version: '1.0', objects: { account: {} }, views: { account_list: {} } },
      });
      expect(response.success).toBe(true);
    });
  });

  describe('POST /api/meta/import — Import metadata', () => {
    it('full lifecycle: request → response validation', () => {
      const request = MetadataImportRequestSchema.parse({
        data: { objects: { customer: { label: 'Customer' } } },
        conflictResolution: 'merge',
        validate: true,
        dryRun: false,
      });
      expect(request.conflictResolution).toBe('merge');

      const response = MetadataImportResponseSchema.parse({
        success: true,
        data: { total: 1, imported: 1, skipped: 0, failed: 0 },
      });
      expect(response.data.imported).toBe(1);
    });
  });

  describe('POST /api/meta/validate — Validate metadata', () => {
    it('valid payload returns valid=true', () => {
      const response = MetadataValidateResponseSchema.parse({
        success: true,
        data: { valid: true },
      });
      expect(response.data.valid).toBe(true);
    });

    it('invalid payload returns errors', () => {
      const response = MetadataValidateResponseSchema.parse({
        success: true,
        data: {
          valid: false,
          errors: [{ path: 'name', message: 'Required field', code: 'required' }],
        },
      });
      expect(response.data.valid).toBe(false);
      expect(response.data.errors?.[0].code).toBe('required');
    });
  });

  describe('GET /api/meta/types — Type registry', () => {
    it('returns all registered types', () => {
      const response = MetadataTypesResponseSchema.parse({
        success: true,
        data: ['object', 'field', 'view', 'page', 'dashboard', 'app', 'flow', 'agent'],
      });
      expect(response.data).toContain('object');
      expect(response.data).toContain('agent');
    });
  });

  describe('GET /api/meta/types/:type — Type info', () => {
    it('returns type metadata', () => {
      const response = MetadataTypeInfoResponseSchema.parse({
        success: true,
        data: {
          type: 'flow',
          label: 'Flow',
          description: 'Visual logic flows',
          filePatterns: ['**/*.flow.ts', '**/*.flow.yml'],
          supportsOverlay: false,
          domain: 'automation',
        },
      });
      expect(response.data?.domain).toBe('automation');
    });
  });

  // (The `…/overlay` and `…/effective` route cases were removed with the
  // section-5 contracts — #13135, ADR-0049: no adapter ever served those
  // paths, so the cases pinned an API that did not exist.)

  describe('GET /api/meta/:type/:name/dependencies — Get dependencies', () => {
    it('returns what this item depends on', () => {
      const response = MetadataDependenciesResponseSchema.parse({
        success: true,
        data: [
          {
            sourceType: 'view',
            sourceName: 'account_list',
            targetType: 'object',
            targetName: 'account',
            kind: 'reference',
          },
        ],
      });
      expect(response.data[0].targetName).toBe('account');
    });
  });

  describe('GET /api/meta/:type/:name/dependents — Get dependents', () => {
    it('returns what depends on this item', () => {
      const response = MetadataDependentsResponseSchema.parse({
        success: true,
        data: [
          {
            sourceType: 'view',
            sourceName: 'account_list',
            targetType: 'object',
            targetName: 'account',
            kind: 'reference',
          },
          {
            sourceType: 'flow',
            sourceName: 'new_account_flow',
            targetType: 'object',
            targetName: 'account',
            kind: 'triggers',
          },
        ],
      });
      expect(response.data).toHaveLength(2);
    });
  });
});
