import { describe, it, expect } from 'vitest';
import {
  ObjectQLCapabilitiesSchema,
  ObjectUICapabilitiesSchema,
  ObjectOSCapabilitiesSchema,
  ObjectStackCapabilitiesSchema,
  ObjectStackDefinitionSchema,
  defineStack,
  type ObjectQLCapabilities,
  type ObjectUICapabilities,
  type ObjectOSCapabilities,
  type ObjectStackCapabilities,
  type ObjectStackDefinitionInput,
} from './stack.zod';

describe('ObjectQLCapabilitiesSchema', () => {
  it('should accept valid ObjectQL capabilities with all features enabled', () => {
    const capabilities: ObjectQLCapabilities = {
      queryFilters: true,
      queryAggregations: true,
      querySorting: true,
      queryPagination: true,
      queryWindowFunctions: true,
      querySubqueries: true,
      queryDistinct: true,
      queryHaving: true,
      queryJoins: true,
      fullTextSearch: true,
      vectorSearch: true,
      geoSpatial: true,
      jsonFields: true,
      arrayFields: true,
      validationRules: true,
      workflows: true,
      triggers: true,
      formulas: true,
      transactions: true,
      bulkOperations: true,
      supportedDrivers: ['postgresql', 'mongodb', 'mysql'],
    };

    expect(() => ObjectQLCapabilitiesSchema.parse(capabilities)).not.toThrow();
  });

  it('should accept minimal ObjectQL capabilities', () => {
    const capabilities: ObjectQLCapabilities = {
      queryFilters: false,
      queryAggregations: false,
      querySorting: false,
      queryPagination: false,
      queryWindowFunctions: false,
      querySubqueries: false,
      queryDistinct: false,
      queryHaving: false,
      queryJoins: false,
      fullTextSearch: false,
      vectorSearch: false,
      geoSpatial: false,
      jsonFields: false,
      arrayFields: false,
      validationRules: false,
      workflows: false,
      triggers: false,
      formulas: false,
      transactions: false,
      bulkOperations: false,
    };

    expect(() => ObjectQLCapabilitiesSchema.parse(capabilities)).not.toThrow();
  });

  it('should use default values for boolean fields', () => {
    const result = ObjectQLCapabilitiesSchema.parse({});

    expect(result.queryFilters).toBe(true);
    expect(result.queryAggregations).toBe(true);
    expect(result.querySorting).toBe(true);
    expect(result.queryPagination).toBe(true);
    expect(result.queryWindowFunctions).toBe(false);
    expect(result.vectorSearch).toBe(false);
  });

  it('should accept optional supportedDrivers array', () => {
    const withDrivers = ObjectQLCapabilitiesSchema.parse({
      supportedDrivers: ['postgresql', 'sqlite', 'excel'],
    });

    expect(withDrivers.supportedDrivers).toEqual(['postgresql', 'sqlite', 'excel']);

    const withoutDrivers = ObjectQLCapabilitiesSchema.parse({});
    expect(withoutDrivers.supportedDrivers).toBeUndefined();
  });
});

describe('ObjectUICapabilitiesSchema', () => {
  it('should accept valid ObjectUI capabilities with all features enabled', () => {
    const capabilities: ObjectUICapabilities = {
      listView: true,
      formView: true,
      kanbanView: true,
      calendarView: true,
      ganttView: true,
      dashboards: true,
      reports: true,
      charts: true,
      customPages: true,
      customThemes: true,
      customComponents: true,
      customActions: true,
      screenFlows: true,
      mobileOptimized: true,
      accessibility: true,
    };

    expect(() => ObjectUICapabilitiesSchema.parse(capabilities)).not.toThrow();
  });

  it('should accept minimal ObjectUI capabilities', () => {
    const capabilities: ObjectUICapabilities = {
      listView: false,
      formView: false,
      kanbanView: false,
      calendarView: false,
      ganttView: false,
      dashboards: false,
      reports: false,
      charts: false,
      customPages: false,
      customThemes: false,
      customComponents: false,
      customActions: false,
      screenFlows: false,
      mobileOptimized: false,
      accessibility: false,
    };

    expect(() => ObjectUICapabilitiesSchema.parse(capabilities)).not.toThrow();
  });

  it('should use default values for boolean fields', () => {
    const result = ObjectUICapabilitiesSchema.parse({});

    expect(result.listView).toBe(true);
    expect(result.formView).toBe(true);
    expect(result.dashboards).toBe(true);
    expect(result.kanbanView).toBe(false);
    expect(result.customThemes).toBe(false);
  });
});

describe('ObjectOSCapabilitiesSchema', () => {
  it('should accept valid ObjectOS capabilities with all features enabled', () => {
    const capabilities: ObjectOSCapabilities = {
      version: '1.0.0',
      environment: 'production',
      restApi: true,
      graphqlApi: true,
      odataApi: true,
      websockets: true,
      serverSentEvents: true,
      eventBus: true,
      webhooks: true,
      apiContracts: true,
      authentication: true,
      rbac: true,
      fieldLevelSecurity: true,
      rowLevelSecurity: true,
      multiTenant: true,
      backgroundJobs: true,
      auditLogging: true,
      fileStorage: true,
      i18n: true,
      pluginSystem: true,
      features: [],
      apis: [],
      systemObjects: ['user', 'role', 'permission'],
      limits: {
        maxObjects: 1000,
        maxFieldsPerObject: 500,
        maxRecordsPerQuery: 10000,
        apiRateLimit: 1000,
        fileUploadSizeLimit: 10485760,
      },
    };

    expect(() => ObjectOSCapabilitiesSchema.parse(capabilities)).not.toThrow();
  });

  it('should require version and environment fields', () => {
    expect(() => ObjectOSCapabilitiesSchema.parse({})).toThrow();

    expect(() =>
      ObjectOSCapabilitiesSchema.parse({
        version: '1.0.0',
      })
    ).toThrow();

    expect(() =>
      ObjectOSCapabilitiesSchema.parse({
        version: '1.0.0',
        environment: 'development',
      })
    ).not.toThrow();
  });

  it('should validate environment enum values', () => {
    expect(() =>
      ObjectOSCapabilitiesSchema.parse({
        version: '1.0.0',
        environment: 'invalid',
      })
    ).toThrow();

    const validEnvironments = ['development', 'test', 'staging', 'production'];
    validEnvironments.forEach((env) => {
      expect(() =>
        ObjectOSCapabilitiesSchema.parse({
          version: '1.0.0',
          environment: env,
        })
      ).not.toThrow();
    });
  });

  it('should use default values for boolean fields', () => {
    const result = ObjectOSCapabilitiesSchema.parse({
      version: '1.0.0',
      environment: 'development',
    });

    expect(result.restApi).toBe(true);
    expect(result.authentication).toBe(true);
    expect(result.fileStorage).toBe(true);
    expect(result.graphqlApi).toBe(false);
    expect(result.multiTenant).toBe(false);
  });

  it('should accept optional limits object', () => {
    const withLimits = ObjectOSCapabilitiesSchema.parse({
      version: '1.0.0',
      environment: 'production',
      limits: {
        maxObjects: 500,
        apiRateLimit: 100,
      },
    });

    expect(withLimits.limits?.maxObjects).toBe(500);
    expect(withLimits.limits?.apiRateLimit).toBe(100);

    const withoutLimits = ObjectOSCapabilitiesSchema.parse({
      version: '1.0.0',
      environment: 'development',
    });

    expect(withoutLimits.limits).toBeUndefined();
  });
});

describe('ObjectStackCapabilitiesSchema', () => {
  it('should accept complete ObjectStack capabilities with all subsystems', () => {
    const capabilities: ObjectStackCapabilities = {
      data: {
        queryFilters: true,
        queryAggregations: true,
        querySorting: true,
        queryPagination: true,
        queryWindowFunctions: true,
        querySubqueries: true,
        queryDistinct: true,
        queryHaving: true,
        queryJoins: true,
        fullTextSearch: true,
        vectorSearch: true,
        geoSpatial: true,
        jsonFields: true,
        arrayFields: true,
        validationRules: true,
        workflows: true,
        triggers: true,
        formulas: true,
        transactions: true,
        bulkOperations: true,
        supportedDrivers: ['postgresql', 'mongodb'],
      },
      ui: {
        listView: true,
        formView: true,
        kanbanView: true,
        calendarView: true,
        ganttView: false,
        dashboards: true,
        reports: true,
        charts: true,
        customPages: true,
        customThemes: false,
        customComponents: false,
        customActions: true,
        screenFlows: true,
        mobileOptimized: true,
        accessibility: false,
      },
      system: {
        version: '1.0.0',
        environment: 'production',
        restApi: true,
        graphqlApi: true,
        odataApi: false,
        websockets: true,
        serverSentEvents: false,
        eventBus: true,
        webhooks: true,
        apiContracts: false,
        authentication: true,
        rbac: true,
        fieldLevelSecurity: true,
        rowLevelSecurity: true,
        multiTenant: true,
        backgroundJobs: true,
        auditLogging: true,
        fileStorage: true,
        i18n: true,
        pluginSystem: false,
        systemObjects: ['user', 'role', 'permission', 'object'],
        limits: {
          maxObjects: 1000,
          maxFieldsPerObject: 500,
          apiRateLimit: 1000,
        },
      },
    };

    expect(() => ObjectStackCapabilitiesSchema.parse(capabilities)).not.toThrow();
  });

  it('should require all three subsystem capability objects', () => {
    expect(() => ObjectStackCapabilitiesSchema.parse({})).toThrow();

    expect(() =>
      ObjectStackCapabilitiesSchema.parse({
        data: {},
        ui: {},
      })
    ).toThrow();

    expect(() =>
      ObjectStackCapabilitiesSchema.parse({
        data: {},
        ui: {},
        system: {
          version: '1.0.0',
          environment: 'development',
        },
      })
    ).not.toThrow();
  });

  it('should allow minimal valid configuration', () => {
    const minimal: ObjectStackCapabilities = {
      data: {},
      ui: {},
      system: {
        version: '0.1.0',
        environment: 'development',
      },
    };

    const result = ObjectStackCapabilitiesSchema.parse(minimal);

    // Check that defaults are applied
    expect(result.data.queryFilters).toBe(true);
    expect(result.ui.listView).toBe(true);
    expect(result.system.restApi).toBe(true);
  });

  it('should preserve subsystem-specific optional fields', () => {
    const capabilities = ObjectStackCapabilitiesSchema.parse({
      data: {
        supportedDrivers: ['postgresql', 'sqlite'],
      },
      ui: {},
      system: {
        version: '1.0.0',
        environment: 'production',
        systemObjects: ['user', 'role'],
        limits: {
          maxObjects: 100,
        },
      },
    });

    expect(capabilities.data.supportedDrivers).toEqual(['postgresql', 'sqlite']);
    expect(capabilities.system.systemObjects).toEqual(['user', 'role']);
    expect(capabilities.system.limits?.maxObjects).toBe(100);
  });
});

describe('ObjectStackDefinitionSchema', () => {
  it('should accept a complete ObjectStack definition', () => {
    const definition = {
      manifest: {
        id: 'com.example.test',
        name: 'test-project',
        version: '1.0.0',
        type: 'app',
        description: 'A test project',
      },
      objects: [],
      apps: [],
    };

    expect(() => ObjectStackDefinitionSchema.parse(definition)).not.toThrow();
  });

  it('should accept definition without manifest (manifest is optional)', () => {
    expect(() => ObjectStackDefinitionSchema.parse({})).not.toThrow();
  });
});

describe('defineStack', () => {
  const baseManifest = {
    id: 'com.example.test',
    name: 'test-project',
    version: '1.0.0',
    type: 'app' as const,
  };

  it('should validate config in default mode (strict by default)', () => {
    const config = { manifest: baseManifest, objects: [] };
    const result = defineStack(config);
    // Default is now strict=true, so result is validated and is a different object reference
    expect(result).not.toBe(config);  // Validation creates new object
    // Validation may add defaults like defaultDatasource
    expect(result.manifest).toBeDefined();
    expect(result.manifest.id).toBe(baseManifest.id);
    expect(result.manifest.name).toBe(baseManifest.name);
    expect(result.manifest.version).toBe(baseManifest.version);
    expect(result.manifest.type).toBe(baseManifest.type);
  });

  it('should return config as-is when strict is false', () => {
    const config = { manifest: baseManifest };
    const result = defineStack(config, { strict: false });
    expect(result).toStrictEqual(config);  // When strict=false, content should be equivalent
  });

  it('should parse and validate in strict mode', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', fields: { title: { type: 'text' } } },
      ],
    };
    expect(() => defineStack(config, { strict: true })).not.toThrow();
  });

  it('should throw on invalid manifest in strict mode', () => {
    const config = { manifest: {} };
    expect(() => defineStack(config as any, { strict: true })).toThrow('defineStack validation failed');
  });

  it('should detect hook referencing undefined object in strict mode', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'contact', fields: { email: { type: 'email' } } },
      ],
      hooks: [
        { name: 'enrich', object: 'ghost_object', events: ['beforeInsert'] },
      ],
    };
    expect(() => defineStack(config, { strict: true })).toThrow('ghost_object');
  });

  it('should pass strict mode when all references are valid', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'lead', fields: { status: { type: 'text' } } },
      ],
      hooks: [
        { name: 'enrich_lead', object: 'lead', events: ['beforeInsert'] },
      ],
    };
    expect(() => defineStack(config, { strict: true })).not.toThrow();
  });

  it('should skip cross-reference validation when no objects are defined', () => {
    const config = {
      manifest: baseManifest,
      hooks: [
        { name: 'some_hook', object: 'external_object', events: ['beforeInsert'] },
      ],
    };
    // No objects defined, so cross-ref validation is skipped
    expect(() => defineStack(config, { strict: true })).not.toThrow();
  });

  it('should accept config without manifest (manifest is optional)', () => {
    const config = {
      objects: [
        { name: 'task', fields: { title: { type: 'text' } } },
      ],
    };
    const result = defineStack(config as any);
    expect(result.manifest).toBeUndefined();
    expect(result.objects).toHaveLength(1);
  });
});

describe('defineStack - Field Name Validation', () => {
  const baseManifest = {
    id: 'com.example.test',
    name: 'test-field-validation',
    version: '1.0.0',
    type: 'app' as const,
  };

  it('should reject camelCase field names in strict mode (default)', () => {
    const config = {
      manifest: baseManifest,
      objects: [{
        name: 'test_object',
        fields: {
          firstName: { type: 'text' as const }  // Invalid: camelCase
        }
      }]
    };

    expect(() => defineStack(config)).toThrow(/Invalid key in record|Field names must be lowercase snake_case/);
  });

  it('should reject PascalCase field names in strict mode (default)', () => {
    const config = {
      manifest: baseManifest,
      objects: [{
        name: 'test_object',
        fields: {
          FirstName: { type: 'text' as const }  // Invalid: PascalCase
        }
      }]
    };

    expect(() => defineStack(config)).toThrow(/Invalid key in record|Field names must be lowercase snake_case/);
  });

  it('should accept snake_case field names', () => {
    const config = {
      manifest: baseManifest,
      objects: [{
        name: 'test_object',
        fields: {
          first_name: { type: 'text' as const },  // Valid
          last_name: { type: 'text' as const },   // Valid
        }
      }]
    };

    expect(() => defineStack(config)).not.toThrow();
  });

  it('should bypass validation when strict is false', () => {
    const config = {
      manifest: baseManifest,
      objects: [{
        name: 'test_object',
        fields: {
          firstName: { type: 'text' as const }  // Invalid, but allowed in non-strict mode
        }
      }]
    };

    expect(() => defineStack(config, { strict: false })).not.toThrow();
  });
});

describe('defineStack - Map Format Support', () => {
  const baseManifest = {
    id: 'com.example.test',
    name: 'test-map-format',
    version: '1.0.0',
    type: 'app' as const,
  };

  it('should accept objects in map format', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      objects: {
        task: { fields: { title: { type: 'text' } } },
        project: { fields: { name: { type: 'text' } } },
      },
    };

    const result = defineStack(config);
    expect(result.objects).toHaveLength(2);
    expect(result.objects![0].name).toBe('task');
    expect(result.objects![1].name).toBe('project');
  });

  it('should accept apps in map format', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      apps: {
        sales: {
          label: 'Sales',
          objects: ['account', 'contact'],
        },
      },
    };

    const result = defineStack(config);
    expect(result.apps).toHaveLength(1);
    expect(result.apps![0].name).toBe('sales');
    expect(result.apps![0].label).toBe('Sales');
  });

  it('should accept mixed array and map formats in the same call', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      objects: {
        task: { fields: { title: { type: 'text' } } },
      },
      apps: [
        { name: 'sales', label: 'Sales', objects: ['account'] },
      ],
    };

    const result = defineStack(config);
    expect(result.objects).toHaveLength(1);
    expect(result.objects![0].name).toBe('task');
    expect(result.apps).toHaveLength(1);
    expect(result.apps![0].name).toBe('sales');
  });

  it('should preserve explicit name in value over map key', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      objects: {
        my_key: { name: 'actual_object', fields: { title: { type: 'text' } } },
      },
    };

    const result = defineStack(config);
    expect(result.objects![0].name).toBe('actual_object');
  });

  it('should work with empty map', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      objects: {},
    };

    const result = defineStack(config);
    expect(result.objects).toEqual([]);
  });

  it('should validate cross-references with map-formatted objects', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      objects: {
        task: { fields: { title: { type: 'text' } } },
      },
      hooks: {
        update_status: { object: 'task', events: ['beforeInsert'] },
      },
    };

    // Valid reference — should not throw
    expect(() => defineStack(config, { strict: true })).not.toThrow();
  });

  it('should detect invalid cross-references with map-formatted inputs', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      objects: {
        task: { fields: { title: { type: 'text' } } },
      },
      hooks: {
        bad_hook: { object: 'nonexistent', events: ['beforeInsert'] },
      },
    };

    expect(() => defineStack(config, { strict: true })).toThrow('nonexistent');
    expect(() => defineStack(config, { strict: true })).toThrow('cross-reference validation failed');
  });

  it('should support map format for actions', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      actions: {
        approve_deal: {
          label: 'Approve Deal',
          type: 'script',
        },
      },
    };

    const result = defineStack(config);
    expect(result.actions).toHaveLength(1);
    expect(result.actions![0].name).toBe('approve_deal');
    expect(result.actions![0].label).toBe('Approve Deal');
  });

  it('should support map format for pages', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      pages: {
        landing: {
          label: 'Landing Page',
          type: 'app',
          route: '/landing',
          regions: [
            { name: 'main', components: [{ type: 'page:section', properties: {} }] },
          ],
        },
      },
    };

    const result = defineStack(config);
    expect(result.pages).toHaveLength(1);
    expect(result.pages![0].name).toBe('landing');
  });

  it('should support map format for dashboards', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      dashboards: {
        sales_overview: {
          label: 'Sales Overview',
          widgets: [],
        },
      },
    };

    const result = defineStack(config);
    expect(result.dashboards).toHaveLength(1);
    expect(result.dashboards![0].name).toBe('sales_overview');
  });

  it('should support map format for roles', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      roles: {
        admin: { label: 'Administrator' },
        user: { label: 'Standard User' },
      },
    };

    const result = defineStack(config);
    expect(result.roles).toHaveLength(2);
    expect(result.roles![0].name).toBe('admin');
    expect(result.roles![1].name).toBe('user');
  });

  it('should support map format for hooks', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      objects: {
        contact: { fields: { email: { type: 'email' } } },
      },
      hooks: {
        enrich_contact: {
          object: 'contact',
          events: ['beforeInsert'],
        },
      },
    };

    const result = defineStack(config, { strict: true });
    expect(result.hooks).toHaveLength(1);
    expect(result.hooks![0].name).toBe('enrich_contact');
    expect(result.hooks![0].object).toBe('contact');
  });

  it('should work with non-strict mode and map format', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      objects: {
        task: { fields: { title: { type: 'text' } } },
      },
    };

    const result = defineStack(config, { strict: false });
    // Even in non-strict mode, normalization should apply
    expect(Array.isArray(result.objects)).toBe(true);
    expect(result.objects![0].name).toBe('task');
  });

  it('should reject invalid object names from map keys in strict mode', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      objects: {
        InvalidName: { fields: { title: { type: 'text' } } },
      },
    };

    // The key 'InvalidName' becomes name, which fails snake_case validation
    expect(() => defineStack(config, { strict: true })).toThrow();
  });

  it('should not affect views (ViewSchema has no name field)', () => {
    const config: ObjectStackDefinitionInput = {
      manifest: baseManifest,
      views: [
        {
          list: {
            type: 'grid',
            columns: ['title', 'status'],
          },
        },
      ],
    };

    const result = defineStack(config);
    expect(result.views).toHaveLength(1);
    expect(result.views![0].list?.type).toBe('grid');
  });
});

// ============================================================================
// Negative / Inverse Validation Tests — Cross-Reference
// ============================================================================

describe('defineStack - Seed Data Cross-Reference Validation', () => {
  const baseManifest = {
    id: 'com.example.test',
    name: 'test-project',
    version: '1.0.0',
    type: 'app' as const,
  };

  it('should detect seed data referencing undefined object', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'account', fields: { name: { type: 'text' } } },
      ],
      data: [
        { object: 'ghost_object', records: [{ name: 'Test' }] },
      ],
    };
    expect(() => defineStack(config)).toThrow('ghost_object');
    expect(() => defineStack(config)).toThrow('cross-reference validation failed');
  });

  it('should pass when seed data references defined object', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'account', fields: { name: { type: 'text' } } },
      ],
      data: [
        { object: 'account', records: [{ name: 'Acme Corp' }] },
      ],
    };
    expect(() => defineStack(config)).not.toThrow();
  });
});

describe('defineStack - Navigation Cross-Reference Validation', () => {
  const baseManifest = {
    id: 'com.example.test',
    name: 'test-project',
    version: '1.0.0',
    type: 'app' as const,
  };

  it('should detect navigation referencing undefined object', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', fields: { title: { type: 'text' } } },
      ],
      apps: [
        {
          name: 'my_app',
          label: 'My App',
          navigation: [
            { id: 'nav_missing', type: 'object' as const, label: 'Missing', objectName: 'nonexistent_object' },
          ],
        },
      ],
    };
    expect(() => defineStack(config)).toThrow('nonexistent_object');
  });

  it('should detect navigation referencing undefined dashboard', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', fields: { title: { type: 'text' } } },
      ],
      dashboards: [
        { name: 'sales_dashboard', label: 'Sales', widgets: [] },
      ],
      apps: [
        {
          name: 'my_app',
          label: 'My App',
          navigation: [
            { id: 'nav_ghost', type: 'dashboard' as const, label: 'Missing', dashboardName: 'ghost_dashboard' },
          ],
        },
      ],
    };
    expect(() => defineStack(config)).toThrow('ghost_dashboard');
  });

  it('should pass when all navigation references are valid', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', fields: { title: { type: 'text' } } },
      ],
      dashboards: [
        { name: 'task_overview', label: 'Overview', widgets: [] },
      ],
      apps: [
        {
          name: 'my_app',
          label: 'My App',
          navigation: [
            { id: 'nav_tasks', type: 'object' as const, label: 'Tasks', objectName: 'task' },
            { id: 'nav_overview', type: 'dashboard' as const, label: 'Overview', dashboardName: 'task_overview' },
          ],
        },
      ],
    };
    expect(() => defineStack(config)).not.toThrow();
  });
});

// ============================================================================
// Action Cross-Reference Validation — ensures action targets resolve
// ============================================================================

describe('defineStack - Action Cross-Reference Validation', () => {
  const baseManifest = {
    id: 'com.example.test',
    name: 'test-project',
    version: '1.0.0',
    type: 'app' as const,
  };

  it('should detect action referencing undefined flow', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', label: 'Task', fields: { title: { type: 'text' as const } } },
      ],
      flows: [
        { name: 'existing_flow', label: 'Existing Flow', type: 'autolaunched' as const, nodes: [], edges: [] },
      ],
      actions: [
        { name: 'run_flow', label: 'Run Flow', type: 'flow' as const, target: 'nonexistent_flow' },
      ],
    };

    expect(() => defineStack(config)).toThrow('cross-reference validation failed');
    expect(() => defineStack(config)).toThrow('nonexistent_flow');
  });

  it('should pass when action references a defined flow', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', label: 'Task', fields: { title: { type: 'text' as const } } },
      ],
      flows: [
        { name: 'approval_flow', label: 'Approval Flow', type: 'autolaunched' as const, nodes: [], edges: [] },
      ],
      actions: [
        { name: 'run_approval', label: 'Run Approval', type: 'flow' as const, target: 'approval_flow' },
      ],
    };

    expect(() => defineStack(config)).not.toThrow();
  });

  it('should skip action flow validation when no flows are defined', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', label: 'Task', fields: { title: { type: 'text' as const } } },
      ],
      actions: [
        { name: 'run_flow', label: 'Run Flow', type: 'flow' as const, target: 'some_flow' },
      ],
    };

    expect(() => defineStack(config)).not.toThrow();
  });

  it('should accept script actions without cross-reference validation', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', label: 'Task', fields: { title: { type: 'text' as const } } },
      ],
      actions: [
        { name: 'approve_task', label: 'Approve', type: 'script' as const, target: 'approveTask' },
      ],
    };

    expect(() => defineStack(config)).not.toThrow();
  });
});

// ============================================================================
// Action → Object Auto-Merge — actions with objectName are merged into objects
// ============================================================================

describe('defineStack - Action Auto-Merge into Objects', () => {
  const baseManifest = {
    id: 'com.example.test',
    name: 'test-project',
    version: '1.0.0',
    type: 'app' as const,
  };

  it('should merge actions with objectName into corresponding objects', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', fields: { title: { type: 'text' as const } } },
      ],
      actions: [
        { name: 'approve_task', label: 'Approve', objectName: 'task' },
      ],
    };

    const result = defineStack(config);
    expect(result.objects![0].actions).toHaveLength(1);
    expect(result.objects![0].actions![0].name).toBe('approve_task');
  });

  it('should merge multiple actions into the same object', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'deal', fields: { amount: { type: 'number' as const } } },
      ],
      actions: [
        { name: 'close_deal', label: 'Close Deal', objectName: 'deal' },
        { name: 'reopen_deal', label: 'Reopen Deal', objectName: 'deal' },
      ],
    };

    const result = defineStack(config);
    expect(result.objects![0].actions).toHaveLength(2);
    expect(result.objects![0].actions!.map(a => a.name)).toEqual(['close_deal', 'reopen_deal']);
  });

  it('should merge actions into different objects', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', fields: { title: { type: 'text' as const } } },
        { name: 'project', fields: { name: { type: 'text' as const } } },
      ],
      actions: [
        { name: 'complete_task', label: 'Complete', objectName: 'task' },
        { name: 'archive_project', label: 'Archive', objectName: 'project' },
      ],
    };

    const result = defineStack(config);
    expect(result.objects![0].actions).toHaveLength(1);
    expect(result.objects![0].actions![0].name).toBe('complete_task');
    expect(result.objects![1].actions).toHaveLength(1);
    expect(result.objects![1].actions![0].name).toBe('archive_project');
  });

  it('should not modify objects when no actions have objectName', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', fields: { title: { type: 'text' as const } } },
      ],
      actions: [
        { name: 'global_action', label: 'Global' },
      ],
    };

    const result = defineStack(config);
    expect(result.objects![0].actions).toBeUndefined();
  });

  it('should preserve top-level actions array after merge', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', fields: { title: { type: 'text' as const } } },
      ],
      actions: [
        { name: 'approve_task', label: 'Approve', objectName: 'task' },
        { name: 'global_search', label: 'Search' },
      ],
    };

    const result = defineStack(config);
    // Top-level actions are preserved
    expect(result.actions).toHaveLength(2);
    // Object has the merged action
    expect(result.objects![0].actions).toHaveLength(1);
  });

  it('should append merged actions to existing object.actions', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        {
          name: 'task',
          fields: { title: { type: 'text' as const } },
          actions: [{ name: 'inline_action', label: 'Inline' }],
        },
      ],
      actions: [
        { name: 'merged_action', label: 'Merged', objectName: 'task' },
      ],
    };

    const result = defineStack(config);
    expect(result.objects![0].actions).toHaveLength(2);
    expect(result.objects![0].actions![0].name).toBe('inline_action');
    expect(result.objects![0].actions![1].name).toBe('merged_action');
  });

  it('should work in non-strict mode', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', fields: { title: { type: 'text' as const } } },
      ],
      actions: [
        { name: 'approve_task', label: 'Approve', objectName: 'task' },
      ],
    };

    const result = defineStack(config, { strict: false });
    expect(result.objects![0].actions).toHaveLength(1);
    expect(result.objects![0].actions![0].name).toBe('approve_task');
  });

  it('should detect action objectName referencing undefined object', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', fields: { title: { type: 'text' as const } } },
      ],
      actions: [
        { name: 'approve_deal', label: 'Approve', objectName: 'nonexistent_object' },
      ],
    };

    expect(() => defineStack(config)).toThrow('cross-reference validation failed');
    expect(() => defineStack(config)).toThrow('nonexistent_object');
  });

  it('should skip objectName validation when no objects are defined', () => {
    const config = {
      manifest: baseManifest,
      actions: [
        { name: 'approve_deal', label: 'Approve', objectName: 'deal' },
      ],
    };

    // No objects defined, cross-ref validation is skipped
    expect(() => defineStack(config)).not.toThrow();
  });
});

// ============================================================================
// Action → Modal Cross-Reference Validation — ensures modal targets resolve to pages
// ============================================================================

describe('defineStack - Modal Cross-Reference Validation', () => {
  const baseManifest = {
    id: 'com.example.test',
    name: 'test-project',
    version: '1.0.0',
    type: 'app' as const,
  };

  const makePage = (name: string) => ({
    name,
    label: name,
    regions: [{ name: 'main', components: [] }],
  });

  it('should detect modal action referencing undefined page', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', label: 'Task', fields: { title: { type: 'text' as const } } },
      ],
      pages: [makePage('existing_page')],
      actions: [
        { name: 'open_modal', label: 'Open Modal', type: 'modal' as const, target: 'nonexistent_page' },
      ],
    };

    expect(() => defineStack(config)).toThrow('cross-reference validation failed');
    expect(() => defineStack(config)).toThrow('nonexistent_page');
  });

  it('should pass when modal action references a defined page', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', label: 'Task', fields: { title: { type: 'text' as const } } },
      ],
      pages: [makePage('defer_task_modal')],
      actions: [
        { name: 'defer_task', label: 'Defer Task', type: 'modal' as const, target: 'defer_task_modal' },
      ],
    };

    expect(() => defineStack(config)).not.toThrow();
  });

  it('should skip modal validation when no pages are defined', () => {
    const config = {
      manifest: baseManifest,
      objects: [
        { name: 'task', label: 'Task', fields: { title: { type: 'text' as const } } },
      ],
      actions: [
        { name: 'open_modal', label: 'Open Modal', type: 'modal' as const, target: 'some_modal' },
      ],
    };

    expect(() => defineStack(config)).not.toThrow();
  });
});

describe('defineStack - Example-Level Strict Validation', () => {
  it('should validate a Todo-style app config (strict mode)', () => {
    const todoConfig = {
      manifest: {
        id: 'com.example.todo',
        namespace: 'todo',
        version: '2.0.0',
        type: 'app' as const,
        name: 'Todo Manager',
        description: 'A comprehensive Todo app',
      },
      objects: [
        {
          name: 'todo_task',
          label: 'Task',
          fields: {
            subject: { type: 'text', label: 'Subject', required: true },
            status: { type: 'select', label: 'Status', options: [
              { value: 'not_started', label: 'Not Started' },
              { value: 'in_progress', label: 'In Progress' },
              { value: 'completed', label: 'Completed' },
            ]},
            priority: { type: 'select', label: 'Priority', options: [
              { value: 'low', label: 'Low' },
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
            ]},
            category: { type: 'text', label: 'Category' },
            due_date: { type: 'date', label: 'Due Date' },
          },
        },
      ],
      data: [
        {
          object: 'todo_task',
          mode: 'upsert' as const,
          externalId: 'subject',
          records: [
            { subject: 'Learn ObjectStack', status: 'completed', priority: 'high', category: 'Work' },
            { subject: 'Build a cool app', status: 'in_progress', priority: 'normal', category: 'Work' },
          ],
        },
      ],
      datasets: [
        {
          name: 'todo_task_metrics',
          label: 'Task Metrics',
          object: 'todo_task',
          dimensions: [{ name: 'status', field: 'status', type: 'string' as const }],
          measures: [{ name: 'task_count', aggregate: 'count' as const }],
        },
      ],
      dashboards: [
        {
          name: 'task_overview',
          label: 'Task Overview',
          widgets: [
            { id: 'total_tasks', title: 'Total Tasks', type: 'metric', dataset: 'todo_task_metrics', values: ['task_count'], layout: { x: 0, y: 0, w: 3, h: 2 } },
            { id: 'by_status', title: 'By Status', type: 'pie', dataset: 'todo_task_metrics', dimensions: ['status'], values: ['task_count'], layout: { x: 3, y: 0, w: 6, h: 4 } },
          ],
        },
      ],
      apps: [
        {
          name: 'todo_app',
          label: 'Todo Manager',
          navigation: [
            { id: 'nav_tasks', type: 'object' as const, label: 'Tasks', objectName: 'todo_task' },
            { id: 'nav_dashboard', type: 'dashboard' as const, label: 'Overview', dashboardName: 'task_overview' },
          ],
        },
      ],
    };
    expect(() => defineStack(todoConfig, { strict: true })).not.toThrow();
  });

  it('should validate a CRM-style app config with seed data and reports (strict mode)', () => {
    const crmConfig = {
      manifest: {
        id: 'com.example.crm',
        namespace: 'crm',
        version: '1.0.0',
        type: 'app' as const,
        name: 'Sales CRM',
        description: 'Complete sales management solution',
      },
      objects: [
        {
          name: 'crm_account',
          label: 'Account',
          fields: {
            name: { type: 'text', label: 'Name', required: true },
            industry: { type: 'text', label: 'Industry' },
            annual_revenue: { type: 'number', label: 'Annual Revenue' },
          },
        },
        {
          name: 'crm_opportunity',
          label: 'Opportunity',
          fields: {
            name: { type: 'text', label: 'Name', required: true },
            amount: { type: 'currency', label: 'Amount' },
            stage: { type: 'select', label: 'Stage', options: [
              { value: 'prospecting', label: 'Prospecting' },
              { value: 'negotiation', label: 'Negotiation' },
              { value: 'closed_won', label: 'Closed Won' },
            ]},
          },
        },
      ],
      data: [
        {
          object: 'crm_account',
          mode: 'upsert' as const,
          externalId: 'name',
          records: [
            { name: 'Acme Corp', industry: 'technology', annual_revenue: 5000000 },
          ],
        },
      ],
      datasets: [
        {
          name: 'crm_opportunity_metrics',
          label: 'Opportunity Metrics',
          object: 'crm_opportunity',
          dimensions: [{ name: 'stage', field: 'stage', type: 'string' as const }],
          measures: [{ name: 'amount_sum', aggregate: 'sum' as const, field: 'amount' }],
        },
      ],
      reports: [
        {
          name: 'pipeline_report',
          label: 'Pipeline Report',
          type: 'summary' as const,
          dataset: 'crm_opportunity_metrics',
          rows: ['stage'],
          values: ['amount_sum'],
        },
      ],
      dashboards: [
        {
          name: 'sales_overview',
          label: 'Sales Overview',
          widgets: [
            { id: 'pipeline_value', title: 'Pipeline Value', type: 'metric', dataset: 'crm_opportunity_metrics', values: ['amount_sum'], layout: { x: 0, y: 0, w: 4, h: 2 } },
          ],
        },
      ],
      apps: [
        {
          name: 'sales_crm',
          label: 'Sales CRM',
          icon: 'briefcase',
          navigation: [
            { id: 'nav_accounts', type: 'object' as const, label: 'Accounts', objectName: 'crm_account' },
            { id: 'nav_opportunities', type: 'object' as const, label: 'Opportunities', objectName: 'crm_opportunity' },
            { id: 'nav_dashboard', type: 'dashboard' as const, label: 'Sales Overview', dashboardName: 'sales_overview' },
            { id: 'nav_report', type: 'report' as const, label: 'Pipeline', reportName: 'pipeline_report' },
          ],
        },
      ],
    };
    expect(() => defineStack(crmConfig, { strict: true })).not.toThrow();
  });

  it('should reject CRM config with seed data referencing non-existent object', () => {
    const badConfig = {
      manifest: {
        id: 'com.example.crm',
        name: 'crm',
        version: '1.0.0',
        type: 'app' as const,
      },
      objects: [
        { name: 'account', fields: { name: { type: 'text' } } },
      ],
      data: [
        { object: 'contact', records: [{ name: 'John' }] },
      ],
    };
    expect(() => defineStack(badConfig, { strict: true })).toThrow('contact');
  });
});

describe('defineStack - Namespace Prefix Validation', () => {
  const makeConfig = (objectName: string, namespace?: string) => ({
    manifest: {
      id: 'com.example.pkg',
      version: '1.0.0',
      type: 'app' as const,
      name: 'Pkg',
      ...(namespace ? { namespace } : {}),
    },
    objects: [
      { name: objectName, label: 'X', fields: { title: { type: 'text' as const } } },
    ],
  });

  it('rejects an object whose name lacks the namespace prefix', () => {
    expect(() => defineStack(makeConfig('task', 'todo'), { strict: true }))
      .toThrow(/namespace-prefix validation failed/);
    expect(() => defineStack(makeConfig('task', 'todo'), { strict: true }))
      .toThrow(/Rename it to 'todo_task'/);
  });

  it('accepts an object whose name starts with the namespace prefix', () => {
    expect(() => defineStack(makeConfig('todo_task', 'todo'), { strict: true })).not.toThrow();
  });

  it('rejects the legacy double-underscore FQN form and suggests the single-prefix form', () => {
    expect(() => defineStack(makeConfig('todo__task', 'todo'), { strict: true }))
      .toThrow(/legacy FQN form/);
    expect(() => defineStack(makeConfig('todo__task', 'todo'), { strict: true }))
      .toThrow(/Rename it to 'todo_task'/);
  });

  it('allows sys_-prefixed names regardless of package namespace', () => {
    expect(() => defineStack(makeConfig('sys_user', 'todo'), { strict: true })).not.toThrow();
  });

  it('skips the check when manifest.namespace is absent (legacy compatibility)', () => {
    expect(() => defineStack(makeConfig('task'), { strict: true })).not.toThrow();
  });

  it('skips the check entirely in non-strict mode', () => {
    expect(() => defineStack(makeConfig('task', 'todo'), { strict: false })).not.toThrow();
  });

  it('aggregates errors across multiple offending objects', () => {
    const config = {
      manifest: { id: 'p', version: '1.0.0', type: 'app' as const, name: 'P', namespace: 'todo' },
      objects: [
        { name: 'task', label: 'T', fields: { t: { type: 'text' as const } } },
        { name: 'project', label: 'P', fields: { t: { type: 'text' as const } } },
        { name: 'todo_label', label: 'L', fields: { t: { type: 'text' as const } } },
      ],
    };
    try {
      defineStack(config, { strict: true });
      throw new Error('expected throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/2 issues/);
      expect(msg).toMatch(/todo_task/);
      expect(msg).toMatch(/todo_project/);
      expect(msg).not.toMatch(/todo_todo_label/);
    }
  });
});

describe('defineStack — at most one App per package (ADR-0019 D1/D3)', () => {
  // A minimal app must carry navigation to a defined object so it passes the
  // cross-reference / landing checks that run before the single-app rule.
  const obj = { name: 'demo_task', label: 'Task', fields: { title: { type: 'text' as const } } };
  const appNav = (name: string, label: string) => ({
    name,
    label,
    navigation: [{ id: 'nav_tasks', type: 'object' as const, label: 'Tasks', objectName: 'demo_task' }],
  });
  const manifest = { id: 'p', version: '1.0.0', type: 'app' as const, name: 'P', namespace: 'demo' };

  it('accepts an app package with exactly one app', () => {
    expect(() =>
      defineStack({ manifest, objects: [obj], apps: [appNav('my_app', 'My App')] }),
    ).not.toThrow();
  });

  it('accepts an app package with zero apps (not a suite)', () => {
    expect(() => defineStack({ manifest, objects: [obj], apps: [] })).not.toThrow();
  });

  it('rejects an app package with more than one app (the banned suite shape)', () => {
    expect(() =>
      defineStack({
        manifest,
        objects: [obj],
        apps: [appNav('app_one', 'App One'), appNav('app_two', 'App Two')],
      }),
    ).toThrow(/at most one app/);
  });

  it('does not constrain non-app package types', () => {
    expect(() =>
      defineStack({
        manifest: { id: 'p', version: '1.0.0', type: 'driver' as const, name: 'Driver', namespace: 'demo' },
        objects: [obj],
        apps: [appNav('app_a', 'A'), appNav('app_b', 'B')],
      }),
    ).not.toThrow();
  });
});
