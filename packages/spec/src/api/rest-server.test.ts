import { describe, it, expect } from 'vitest';
import {
  RestApiConfigSchema,
  CrudOperation,
  CrudEndpointPatternSchema,
  CrudEndpointsConfigSchema,
  MetadataEndpointsConfigSchema,
  BatchEndpointsConfigSchema,
  RouteGenerationConfigSchema,
  RestServerConfigSchema,
  GeneratedEndpointSchema,
  EndpointRegistrySchema,
  RestApiConfig,
  RestServerConfig,
  type RestApiConfig as RestApiConfigType,
  type RestServerConfig as RestServerConfigType,
  type MetadataEndpointsConfig,
} from './rest-server.zod';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';
describe('RestApiConfigSchema', () => {
  it('should accept minimal config with defaults', () => {
    const config = RestApiConfigSchema.parse({});

    expect(config.version).toBe('v1');
    expect(config.basePath).toBe('/api');
    expect(config.enableCrud).toBe(true);
    expect(config.enableMetadata).toBe(true);
    expect(config.enableBatch).toBe(true);
    expect(config.enableDiscovery).toBe(true);
  });

  it('should accept custom version', () => {
    const config = RestApiConfigSchema.parse({
      version: 'v2',
    });

    expect(config.version).toBe('v2');
  });

  it('should accept date-based version', () => {
    const config = RestApiConfigSchema.parse({
      version: '2024-01',
    });

    expect(config.version).toBe('2024-01');
  });

  it('should accept custom basePath', () => {
    const config = RestApiConfigSchema.parse({
      basePath: '/rest',
    });

    expect(config.basePath).toBe('/rest');
  });

  it('should accept custom apiPath', () => {
    const config = RestApiConfigSchema.parse({
      apiPath: '/api/v2',
    });

    expect(config.apiPath).toBe('/api/v2');
  });

  it('should disable features', () => {
    const config = RestApiConfigSchema.parse({
      enableCrud: false,
      enableMetadata: false,
      enableBatch: false,
      enableDiscovery: false,
    });

    expect(config.enableCrud).toBe(false);
    expect(config.enableMetadata).toBe(false);
    expect(config.enableBatch).toBe(false);
    expect(config.enableDiscovery).toBe(false);
  });

  describe('Documentation Configuration', () => {
    it('should accept basic documentation config', () => {
      const config = RestApiConfigSchema.parse({
        documentation: {
          enabled: true,
          title: 'My API',
        },
      });

      expect(config.documentation?.enabled).toBe(true);
      expect(config.documentation?.title).toBe('My API');
    });

    it('should accept complete documentation config', () => {
      const config = RestApiConfigSchema.parse({
        documentation: {
          enabled: true,
          title: 'ObjectStack API',
          description: 'Complete API for ObjectStack platform',
          version: '1.0.0',
          termsOfService: 'https://example.com/terms',
          contact: {
            name: 'API Support',
            url: 'https://example.com/support',
            email: 'api@example.com',
          },
          license: {
            name: 'MIT',
            url: 'https://opensource.org/licenses/MIT',
          },
        },
      });

      expect(config.documentation?.title).toBe('ObjectStack API');
      expect(config.documentation?.contact?.email).toBe('api@example.com');
      expect(config.documentation?.license?.name).toBe('MIT');
    });
  });

  describe('Response Format Configuration', () => {
    it('should accept response format config', () => {
      const config = RestApiConfigSchema.parse({
        responseFormat: {
          envelope: true,
          includeMetadata: true,
          includePagination: true,
        },
      });

      expect(config.responseFormat?.envelope).toBe(true);
      expect(config.responseFormat?.includeMetadata).toBe(true);
      expect(config.responseFormat?.includePagination).toBe(true);
    });

    it('should accept minimal response format', () => {
      const config = RestApiConfigSchema.parse({
        responseFormat: {
          envelope: false,
          includeMetadata: false,
          includePagination: false,
        },
      });

      expect(config.responseFormat?.envelope).toBe(false);
    });
  });
});

describe('CrudOperation', () => {
  it('should accept all CRUD operations', () => {
    const operations = ['create', 'read', 'update', 'delete', 'list'];
    
    operations.forEach(op => {
      expect(() => CrudOperation.parse(op)).not.toThrow();
    });
  });

  it('should reject invalid operation', () => {
    expect(() => CrudOperation.parse('invalid')).toThrow();
  });
});

describe('CrudEndpointPatternSchema', () => {
  it('should accept basic pattern', () => {
    const pattern = CrudEndpointPatternSchema.parse({
      method: 'GET',
      path: '/data/{object}',
    });

    expect(pattern.method).toBe('GET');
    expect(pattern.path).toBe('/data/{object}');
  });

  it('should accept pattern with documentation', () => {
    const pattern = CrudEndpointPatternSchema.parse({
      method: 'POST',
      path: '/data/{object}',
      summary: 'Create record',
      description: 'Creates a new record in the specified object',
    });

    expect(pattern.summary).toBe('Create record');
    expect(pattern.description).toBeDefined();
  });
});

describe('CrudEndpointsConfigSchema', () => {
  it('should accept default config', () => {
    const config = CrudEndpointsConfigSchema.parse({});

    expect(config.dataPrefix).toBe('/data');
    expect(config.objectParamStyle).toBe('path');
  });

  it('should accept custom operations config', () => {
    const config = CrudEndpointsConfigSchema.parse({
      operations: {
        create: true,
        read: true,
        update: true,
        delete: false,
        list: true,
      },
    });

    expect(config.operations?.delete).toBe(false);
  });

  it('should accept custom patterns', () => {
    const config = CrudEndpointsConfigSchema.parse({
      patterns: {
        create: { method: 'POST', path: '/objects/{object}' },
        read: { method: 'GET', path: '/objects/{object}/:id' },
      },
    });

    expect(config.patterns?.create.path).toBe('/objects/{object}');
  });

  it('should accept custom data prefix', () => {
    const config = CrudEndpointsConfigSchema.parse({
      dataPrefix: '/objects',
    });

    expect(config.dataPrefix).toBe('/objects');
  });

  it('should accept query param style', () => {
    const config = CrudEndpointsConfigSchema.parse({
      objectParamStyle: 'query',
    });

    expect(config.objectParamStyle).toBe('query');
  });
});

describe('MetadataEndpointsConfigSchema', () => {
  it('should accept default config', () => {
    const config = MetadataEndpointsConfigSchema.parse({});

    expect(config.prefix).toBe('/meta');
    expect(config.enableCache).toBe(true);
    expect(config.cacheTtl).toBe(3600);
  });

  it('should accept custom prefix', () => {
    const config = MetadataEndpointsConfigSchema.parse({
      prefix: '/metadata',
    });

    expect(config.prefix).toBe('/metadata');
  });

  it('should accept cache config', () => {
    const config = MetadataEndpointsConfigSchema.parse({
      enableCache: false,
      cacheTtl: 7200,
    });

    expect(config.enableCache).toBe(false);
    expect(config.cacheTtl).toBe(7200);
  });

  it('should accept endpoints config', () => {
    const config = MetadataEndpointsConfigSchema.parse({
      endpoints: {
        types: true,
        items: true,
        item: true,
        schema: false,
      },
    });

    expect(config.endpoints?.schema).toBe(false);
  });

  it('[ADR-0106 D8] maskObjectFields defaults to true — the mask is ON unless opted out', () => {
    // The default is the whole security posture of the key: a deployment that
    // never mentions `maskObjectFields` must still mask served object schemas.
    // Pinning the MATERIALIZED default (not just the declaration) is what makes
    // a later `.optional()` — which would hand `undefined` to the REST layer —
    // fail here rather than silently unmask every metadata read.
    const config = MetadataEndpointsConfigSchema.parse({});

    expect(config.maskObjectFields).toBe(true);
  });

  it('[ADR-0106 D8] maskObjectFields: false is the declared per-server opt-out', () => {
    // The opt-out has to SURVIVE the parse. Before this key had a declared seat,
    // the schema stripped it (zod's default posture for an undeclared key) and
    // the REST layer only saw it because it reads its config object raw, through
    // a cast. An author who parses their config first now keeps the opt-out.
    const optedOut = MetadataEndpointsConfigSchema.parse({ maskObjectFields: false });

    expect(optedOut.maskObjectFields).toBe(false);

    // Explicit `true` is a real answer too, not a no-op the parse discards.
    expect(MetadataEndpointsConfigSchema.parse({ maskObjectFields: true }).maskObjectFields).toBe(true);
  });

  it('[ADR-0106 D8] maskObjectFields is authorable without a cast, and is a boolean (compile-time)', () => {
    // The declaration's REASON for existing: `objectstack.config.ts` authors the
    // key by name and `packages/rest`'s `normalizeConfig` reads it. Both of them
    // go through this input type, so this is the pin that says the key no longer
    // needs `(metadata as any)` to be reachable.
    const authored: MetadataEndpointsConfig = { maskObjectFields: false };
    const readAsBoolean: boolean | undefined = authored.maskObjectFields;
    expect(readAsBoolean).toBe(false);

    // Optional on the INPUT side — omitting it is how a deployment takes the
    // default, and it must stay legal.
    const omitted: MetadataEndpointsConfig = { prefix: '/meta' };
    expect(omitted.maskObjectFields).toBeUndefined();

    // …and it is a boolean switch, not a string one. Never invoked: its only job
    // is to make the compiler prove the seat is typed rather than `any`, which
    // is exactly what the cast it replaces could not do.
    const mustNotCompile = () => {
      // @ts-expect-error `maskObjectFields` is a boolean — a truthy string is not the opt-out
      const wrongType: MetadataEndpointsConfig = { maskObjectFields: 'false' };
      return wrongType;
    };
    expect(typeof mustNotCompile).toBe('function');
  });
});

describe('BatchEndpointsConfigSchema', () => {
  it('should accept default config', () => {
    const config = BatchEndpointsConfigSchema.parse({});

    expect(config.maxBatchSize).toBe(200);
    expect(config.enableBatchEndpoint).toBe(true);
    expect(config.defaultAtomic).toBe(true);
  });

  it('should accept custom max batch size', () => {
    const config = BatchEndpointsConfigSchema.parse({
      maxBatchSize: 500,
    });

    expect(config.maxBatchSize).toBe(500);
  });

  it('should reject invalid batch size', () => {
    expect(() => BatchEndpointsConfigSchema.parse({
      maxBatchSize: 0,
    })).toThrow();

    expect(() => BatchEndpointsConfigSchema.parse({
      maxBatchSize: 2000,
    })).toThrow();
  });

  it('should accept operations config', () => {
    const config = BatchEndpointsConfigSchema.parse({
      operations: {
        createMany: true,
        updateMany: true,
        deleteMany: false,
        upsertMany: true,
      },
    });

    expect(config.operations?.deleteMany).toBe(false);
  });

  it('should accept non-atomic mode', () => {
    const config = BatchEndpointsConfigSchema.parse({
      defaultAtomic: false,
    });

    expect(config.defaultAtomic).toBe(false);
  });
});

describe('RouteGenerationConfigSchema', () => {
  it('should accept minimal config', () => {
    const config = RouteGenerationConfigSchema.parse({});

    expect(config.nameTransform).toBe('none');
  });

  it('should accept include objects', () => {
    const config = RouteGenerationConfigSchema.parse({
      includeObjects: ['account', 'contact', 'opportunity'],
    });

    expect(config.includeObjects).toHaveLength(3);
  });

  it('should accept exclude objects', () => {
    const config = RouteGenerationConfigSchema.parse({
      excludeObjects: ['system_log', 'audit_trail'],
    });

    expect(config.excludeObjects).toHaveLength(2);
  });

  it('should accept name transform', () => {
    const transforms = ['none', 'plural', 'kebab-case', 'camelCase'] as const;
    
    transforms.forEach(transform => {
      const config = RouteGenerationConfigSchema.parse({
        nameTransform: transform,
      });
      expect(config.nameTransform).toBe(transform);
    });
  });

  it('should accept overrides', () => {
    const config = RouteGenerationConfigSchema.parse({
      overrides: {
        account: {
          enabled: true,
          basePath: '/accounts',
        },
        contact: {
          enabled: false,
        },
        task: {
          operations: {
            create: true,
            read: true,
            update: true,
            delete: false,
            list: true,
          },
        },
      },
    });

    expect(config.overrides?.account?.basePath).toBe('/accounts');
    expect(config.overrides?.contact?.enabled).toBe(false);
    expect(config.overrides?.task?.operations?.delete).toBe(false);
  });
});

describe('RestServerConfigSchema', () => {
  it('should accept minimal config', () => {
    const config = RestServerConfigSchema.parse({});

    expect(config).toBeDefined();
  });

  it('should accept complete config', () => {
    const config = RestServerConfigSchema.parse({
      api: {
        version: 'v1',
        basePath: '/api',
        enableCrud: true,
        enableMetadata: true,
        enableBatch: true,
      },
      crud: {
        dataPrefix: '/data',
        operations: {
          create: true,
          read: true,
          update: true,
          delete: true,
          list: true,
        },
      },
      metadata: {
        prefix: '/meta',
        enableCache: true,
      },
      batch: {
        maxBatchSize: 200,
      },
      routes: {
        excludeObjects: ['system_log'],
      },
    });

    expect(config.api?.version).toBe('v1');
    expect(config.crud?.dataPrefix).toBe('/data');
    expect(config.metadata?.prefix).toBe('/meta');
    expect(config.batch?.maxBatchSize).toBe(200);
    expect(config.routes?.excludeObjects).toContain('system_log');
  });
});

describe('GeneratedEndpointSchema', () => {
  it('should accept basic endpoint', () => {
    const endpoint = GeneratedEndpointSchema.parse({
      id: 'list_accounts',
      method: 'GET',
      path: '/api/v1/data/account',
      object: 'account',
      operation: 'list',
      handler: 'list_handler',
    });

    expect(endpoint.id).toBe('list_accounts');
    expect(endpoint.method).toBe('GET');
    expect(endpoint.operation).toBe('list');
  });

  it('should accept endpoint with metadata', () => {
    const endpoint = GeneratedEndpointSchema.parse({
      id: 'create_account',
      method: 'POST',
      path: '/api/v1/data/account',
      object: 'account',
      operation: 'create',
      handler: 'create_handler',
      metadata: {
        summary: 'Create Account',
        description: 'Creates a new account record',
        tags: ['account', 'crm'],
        deprecated: false,
      },
    });

    expect(endpoint.metadata?.summary).toBe('Create Account');
    expect(endpoint.metadata?.tags).toContain('crm');
  });
});

describe('EndpointRegistrySchema', () => {
  it('should accept basic registry', () => {
    const registry = EndpointRegistrySchema.parse({
      endpoints: [
        {
          id: 'list_accounts',
          method: 'GET',
          path: '/api/v1/data/account',
          object: 'account',
          operation: 'list',
          handler: 'list_handler',
        },
      ],
      total: 1,
    });

    expect(registry.endpoints).toHaveLength(1);
    expect(registry.total).toBe(1);
  });

  it('should accept registry with groupings', () => {
    const registry = EndpointRegistrySchema.parse({
      endpoints: [
        {
          id: 'list_accounts',
          method: 'GET',
          path: '/api/data/account',
          object: 'account',
          operation: 'list',
          handler: 'list_handler',
        },
        {
          id: 'create_account',
          method: 'POST',
          path: '/api/data/account',
          object: 'account',
          operation: 'create',
          handler: 'create_handler',
        },
      ],
      total: 2,
      byObject: {
        account: [
          {
            id: 'list_accounts',
            method: 'GET',
            path: '/api/data/account',
            object: 'account',
            operation: 'list',
            handler: 'list_handler',
          },
          {
            id: 'create_account',
            method: 'POST',
            path: '/api/data/account',
            object: 'account',
            operation: 'create',
            handler: 'create_handler',
          },
        ],
      },
      byOperation: {
        list: [
          {
            id: 'list_accounts',
            method: 'GET',
            path: '/api/data/account',
            object: 'account',
            operation: 'list',
            handler: 'list_handler',
          },
        ],
        create: [
          {
            id: 'create_account',
            method: 'POST',
            path: '/api/data/account',
            object: 'account',
            operation: 'create',
            handler: 'create_handler',
          },
        ],
      },
    });

    expect(registry.byObject?.account).toHaveLength(2);
    expect(registry.byOperation?.list).toHaveLength(1);
  });
});

describe('Helper Functions', () => {
  it('should create config with RestApiConfig.create', () => {
    const config = RestApiConfig.create({
      version: 'v2',
      basePath: '/api',
    });

    expect(config.version).toBe('v2');
  });

  it('should create server config with RestServerConfig.create', () => {
    const config = RestServerConfig.create({
      api: {
        version: 'v1',
      },
      crud: {
        dataPrefix: '/data',
      },
    });

    expect(config.api?.version).toBe('v1');
  });
});

describe('Integration Tests', () => {
  it('should support complete REST server configuration', () => {
    const serverConfig: RestServerConfigType = {
      api: {
        version: 'v1',
        basePath: '/api',
        enableCrud: true,
        enableMetadata: true,
        enableBatch: true,
        enableDiscovery: true,
        documentation: {
          enabled: true,
          title: 'ObjectStack API',
          description: 'REST API for ObjectStack platform',
          version: '1.0.0',
        },
        responseFormat: {
          envelope: true,
          includeMetadata: true,
          includePagination: true,
        },
      },
      crud: {
        dataPrefix: '/data',
        operations: {
          create: true,
          read: true,
          update: true,
          delete: true,
          list: true,
        },
        objectParamStyle: 'path',
      },
      metadata: {
        prefix: '/meta',
        enableCache: true,
        cacheTtl: 3600,
        endpoints: {
          types: true,
          items: true,
          item: true,
          schema: true,
        },
      },
      batch: {
        maxBatchSize: 200,
        enableBatchEndpoint: true,
        operations: {
          createMany: true,
          updateMany: true,
          deleteMany: true,
          upsertMany: true,
        },
        defaultAtomic: true,
      },
      routes: {
        excludeObjects: ['system_log'],
        nameTransform: 'none',
      },
    };

    const result = RestServerConfigSchema.parse(serverConfig);
    expect(result.api?.version).toBe('v1');
    expect(result.crud?.dataPrefix).toBe('/data');
    expect(result.metadata?.cacheTtl).toBe(3600);
    expect(result.batch?.maxBatchSize).toBe(200);
  });
});

// ==========================================
// OpenAPI 3.1 Webhooks & Callbacks — retired (#4579)
// ==========================================
//
// `OpenApiWebhookEventSchema` / `CallbackSchema` / `OpenApi31ExtensionsSchema`
// tests were removed with the schemas (#4579, ADR-0049 enforce-or-remove).
// The retirement itself is pinned below.

describe('[#4579] `RestServerConfig.openApi31` retirement', () => {
  it('REJECTS an authored openApi31 block, with the fix in the message', () => {
    // Tombstoned, not deleted: RestServerConfigSchema is not `.strict()`, so a
    // plain deletion would silently strip the key — the author's webhook
    // declarations would vanish without a word, which is the exact
    // declared ≠ enforced failure the removal closes.
    expect(() =>
      RestServerConfigSchema.parse({
        openApi31: {
          webhooks: {
            test_hook: {
              name: 'test_hook',
              description: 'Test webhook',
              payloadSchema: '#/ref',
              security: ['basic'],
            },
          },
          pathItemReferences: true,
        },
      }),
    ).toThrow(/RestServerConfig\.openApi31.*removed.*Delete the key/s);
  });

  it('still parses every live key cleanly — the tombstone rejects one key, not the config', () => {
    const parsed = RestServerConfigSchema.parse({
      api: { version: 'v1', basePath: '/api' },
      crud: { dataPrefix: '/data' },
      metadata: { prefix: '/meta' },
      batch: { maxBatchSize: 200 },
      routes: { excludeObjects: ['system_log'] },
    });
    expect(parsed.api?.version).toBe('v1');
    expect(parsed.crud?.dataPrefix).toBe('/data');
    expect(parsed).not.toHaveProperty('openApi31');
  });
});

// #4642 established that a compile-time conditional-type pin in this package was
// a no-op until #5286 (tsconfig excluded `**/*.test.ts`; vitest never enables `typecheck`),
// so the load-bearing pin is the compiler-API test below, with anti-vacuity
// guards (a resolution failure would otherwise make every assertion pass
// vacuously); sabotage-verified in the PR (re-adding an export turns it red).
describe('[#4579] the OpenApi31 block schemas are not exported from any entry point', () => {
  const REMOVED_NAMES = [
    'OpenApi31ExtensionsSchema',
    'OpenApi31Extensions',
    'CallbackSchema',
    'Callback',
    'OpenApiWebhookEventSchema',
    'OpenApiWebhookEvent',
  ] as const;

  it('resolves the export surface: no public entry names any of the six', () => {
    // Anti-vacuity: the baseline must cover the real surface. (This used to
    // enumerate package.json's exports map and build its own `ts.createProgram`
    // right here; `export-origins/` IS that resolution, computed once at build
    // time and checked in — #4796.)
    expect(EXPORT_ENTRY_POINTS).toContain('./api');
    expect(EXPORT_ENTRY_POINTS.length).toBeGreaterThan(10);

    // The surface stays non-trivial (the `not.toContain` cannot pass by
    // resolving nothing) and the surviving neighbours stand.
    const apiNames = exportNamesOf('./api');
    expect(apiNames.length, './api must export a non-trivial surface').toBeGreaterThan(50);
    expect(apiNames).toContain('RestServerConfigSchema');
    expect(apiNames).toContain('RestApiConfigSchema');

    for (const removed of REMOVED_NAMES) {
      expect(holdersOf(removed), `no entry may export ${removed} (#4579)`).toEqual([]);
    }
  });

  it('keeps the runtime namespace consistent with the compiler view', async () => {
    const api = await import('./index');
    for (const removed of REMOVED_NAMES) {
      expect(removed in api, `./api runtime namespace must not carry ${removed}`).toBe(false);
    }
    // What survives is the live config surface, not the dead documentation one.
    expect('RestServerConfigSchema' in api).toBe(true);
  });

  // v17 dual-source cleanup (#4572): the bare names WebhookEvent(Schema) /
  // WebhookConfig(Schema) belong to @objectstack/spec/integration alone
  // (connector event enum + connector webhook config). The ./api pair was the
  // #4411-style trap: same names, different concepts, different forms
  // (z.object here vs z.enum there). WebhookConfig(Schema) on ./api was dead
  // and removed; WebhookEvent(Schema) was first renamed OpenApiWebhookEvent(Schema)
  // (#4572) and then removed outright with the openApi31 block (#4579).
  // Pin: this module declares neither the bare names nor the renamed ones.
  it('does not re-expose the bare WebhookEvent/WebhookConfig names from ./api (#4572)', async () => {
    const restServer = await import('./rest-server.zod');
    expect('WebhookEventSchema' in restServer).toBe(false);
    expect('WebhookConfigSchema' in restServer).toBe(false);
  });
});
