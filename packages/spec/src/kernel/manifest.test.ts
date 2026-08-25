import { describe, it, expect } from 'vitest';
import { ManifestSchema, type ObjectStackManifest } from './manifest.zod';

describe('ManifestSchema', () => {
  describe('Basic Properties', () => {
    it('should accept minimal manifest', () => {
      const manifest: ObjectStackManifest = {
        id: 'com.example.app',
        version: '1.0.0',
        type: 'app',
        name: 'Example App',
      };

      expect(() => ManifestSchema.parse(manifest)).not.toThrow();
    });

    it('should enforce semantic versioning', () => {
      const validVersions = ['0.0.1', '1.0.0', '1.2.3', '10.20.30'];
      validVersions.forEach(version => {
        const manifest = {
          id: 'com.test.app',
          version,
          type: 'app' as const,
          name: 'Test',
        };
        expect(() => ManifestSchema.parse(manifest)).not.toThrow();
      });

      const invalidVersions = ['1.0', '1', 'v1.0.0', '1.0.0-beta'];
      invalidVersions.forEach(version => {
        const manifest = {
          id: 'com.test.app',
          version,
          type: 'app' as const,
          name: 'Test',
        };
        expect(() => ManifestSchema.parse(manifest)).toThrow();
      });
    });

    it('should accept all package types', () => {
      const types = ['app', 'plugin', 'driver', 'module', 'objectql', 'gateway', 'adapter'] as const;
      
      types.forEach(type => {
        const manifest = {
          id: 'com.test.package',
          version: '1.0.0',
          type,
          name: 'Test Package',
        };
        expect(() => ManifestSchema.parse(manifest)).not.toThrow();
      });
    });
  });

  describe('Optional Properties', () => {
    it('should accept manifest with description', () => {
      const manifest: ObjectStackManifest = {
        id: 'com.example.crm',
        version: '2.1.0',
        type: 'app',
        name: 'CRM Application',
        description: 'Customer relationship management system',
      };

      expect(() => ManifestSchema.parse(manifest)).not.toThrow();
    });

    it('should accept manifest with permissions', () => {
      const manifest: ObjectStackManifest = {
        id: 'com.example.admin',
        version: '1.0.0',
        type: 'plugin',
        name: 'Admin Tools',
        permissions: [
          'system.user.read',
          'system.user.write',
          'system.data.read',
          'system.data.write',
        ],
      };

      expect(() => ManifestSchema.parse(manifest)).not.toThrow();
    });

    it('should accept manifest with object patterns', () => {
      const manifest: ObjectStackManifest = {
        id: 'com.example.sales',
        version: '3.0.0',
        type: 'app',
        name: 'Sales Module',
        objects: [
          './src/objects/*.object.yml',
          './src/objects/**/*.object.ts',
        ],
      };

      expect(() => ManifestSchema.parse(manifest)).not.toThrow();
    });

    it('should accept manifest with extensions', () => {
      const manifest: ObjectStackManifest = {
        id: 'com.example.custom',
        version: '1.0.0',
        type: 'plugin',
        name: 'Custom Extensions',
        extensions: {
          'ui.components': [
            {
              id: 'custom-widget',
              component: 'CustomWidget',
            },
          ],
          'api.hooks': {
            'before_save': 'validateData',
          },
        },
      };

      expect(() => ManifestSchema.parse(manifest)).not.toThrow();
    });
  });

  describe('Real-World Manifest Examples', () => {
    it('should accept complete CRM application manifest', () => {
      const crmManifest: ObjectStackManifest = {
        id: 'com.objectstack.crm',
        version: '2.5.0',
        type: 'app',
        name: 'ObjectStack CRM',
        description: 'Complete customer relationship management solution with sales, marketing, and service modules',
        permissions: [
          'app.access.crm',
          'crm.lead.read',
          'crm.lead.write',
          'crm.opportunity.read',
          'crm.opportunity.write',
          'crm.account.read',
          'crm.account.write',
          'crm.contact.read',
          'crm.contact.write',
        ],
        objects: [
          './objects/lead.object.ts',
          './objects/opportunity.object.ts',
          './objects/account.object.ts',
          './objects/contact.object.ts',
          './objects/campaign.object.ts',
        ],
        extensions: {
          'dashboard.widgets': [
            {
              id: 'sales-pipeline',
              name: 'Sales Pipeline',
              component: 'SalesPipelineWidget',
            },
            {
              id: 'revenue-forecast',
              name: 'Revenue Forecast',
              component: 'RevenueForecastWidget',
            },
          ],
          'workflows': {
            'lead_conversion': './workflows/lead-conversion.yml',
            'opportunity_close': './workflows/opportunity-close.yml',
          },
        },
      };

      expect(() => ManifestSchema.parse(crmManifest)).not.toThrow();
    });

    it('should accept bi plugin with custom kinds', () => {
      const biPlugin: ObjectStackManifest = {
        id: 'com.objectstack.bi',
        version: '1.0.0',
        type: 'plugin',
        name: 'Business Intelligence',
        contributes: {
            kinds: [
                {
                    id: 'bi.dataset',
                    globs: ['**/*.dataset.json']
                },
                {
                    id: 'bi.dashboard',
                    globs: ['**/*.bi-dash.json']
                }
            ]
        }
      };
      
      expect(() => ManifestSchema.parse(biPlugin)).not.toThrow();
    });

    // `contributes.commands` acceptance pins removed with the key (#10724):
    // the CLI never resolved commands from the declaration (oclif
    // auto-discovery is the enforced channel — `cli-extension.zod.ts`). The
    // rejection is pinned with its eight retired siblings below.

    it('should accept authentication plugin manifest', () => {
      const authPlugin: ObjectStackManifest = {
        id: 'com.objectstack.auth.saml',
        version: '1.2.1',
        type: 'plugin',
        name: 'SAML Authentication Plugin',
        description: 'Enables SAML 2.0 single sign-on authentication',
        permissions: [
          'system.auth.configure',
          'system.user.create',
        ],
        extensions: {
          'auth.providers': {
            id: 'saml',
            name: 'SAML 2.0',
            configSchema: 'saml-config.schema.json',
            handler: 'SAMLAuthHandler',
          },
          'admin.settings': [
            {
              page: 'saml-settings',
              label: 'SAML Configuration',
              component: 'SAMLSettingsPage',
            },
          ],
        },
      };

      expect(() => ManifestSchema.parse(authPlugin)).not.toThrow();
    });

    it('should accept database driver manifest', () => {
      const dbDriver: ObjectStackManifest = {
        id: 'com.objectstack.driver.postgres',
        version: '5.0.0',
        type: 'driver',
        name: 'PostgreSQL Driver',
        description: 'PostgreSQL database driver with advanced features',
        permissions: [
          'system.datasource.manage',
        ],
        extensions: {
          'datasource.types': {
            id: 'postgresql',
            name: 'PostgreSQL',
            driver: 'PostgreSQLDriver',
            features: ['transactions', 'jsonb', 'full-text-search'],
          },
        },
      };

      expect(() => ManifestSchema.parse(dbDriver)).not.toThrow();
    });

    it('should accept utility module manifest', () => {
      const utilModule: ObjectStackManifest = {
        id: 'com.objectstack.module.utils',
        version: '1.0.0',
        type: 'module',
        name: 'Utility Functions',
        description: 'Common utility functions for ObjectStack applications',
      };

      expect(() => ManifestSchema.parse(utilModule)).not.toThrow();
    });

    it('should accept objectql engine manifest', () => {
      const objectqlEngine: ObjectStackManifest = {
        id: 'com.objectstack.engine.objectql',
        version: '2.0.0',
        type: 'objectql',
        name: 'ObjectQL Engine',
        description: 'Core data layer implementation with query AST and validation',
      };

      expect(() => ManifestSchema.parse(objectqlEngine)).not.toThrow();
    });

    it('should accept gateway manifest for GraphQL', () => {
      const graphqlGateway: ObjectStackManifest = {
        id: 'com.objectstack.gateway.graphql',
        version: '1.0.0',
        type: 'gateway',
        name: 'GraphQL Gateway',
        description: 'GraphQL API protocol gateway for ObjectStack',
        permissions: [
          'system.api.configure',
        ],
      };

      expect(() => ManifestSchema.parse(graphqlGateway)).not.toThrow();
    });

    it('should accept gateway manifest for REST', () => {
      const restGateway: ObjectStackManifest = {
        id: 'com.objectstack.gateway.rest',
        version: '1.0.0',
        type: 'gateway',
        name: 'REST API Gateway',
        description: 'RESTful API protocol gateway for ObjectStack',
      };

      expect(() => ManifestSchema.parse(restGateway)).not.toThrow();
    });

    it('should accept adapter manifest for Express', () => {
      const expressAdapter: ObjectStackManifest = {
        id: 'com.objectstack.adapter.express',
        version: '4.0.0',
        type: 'adapter',
        name: 'Express Adapter',
        description: 'Express.js HTTP server adapter for ObjectStack runtime',
        configuration: {
          title: 'Express Server Settings',
          properties: {
            port: {
              type: 'number',
              default: 3000,
              description: 'HTTP server port',
            },
            corsEnabled: {
              type: 'boolean',
              default: true,
              description: 'Enable CORS middleware',
            },
          },
        },
      };

      expect(() => ManifestSchema.parse(expressAdapter)).not.toThrow();
    });

    it('should accept adapter manifest for Hono', () => {
      const honoAdapter: ObjectStackManifest = {
        id: 'com.objectstack.adapter.hono',
        version: '1.0.0',
        type: 'adapter',
        name: 'Hono Adapter',
        description: 'Hono ultrafast HTTP server adapter for ObjectStack runtime',
      };

      expect(() => ManifestSchema.parse(honoAdapter)).not.toThrow();
    });
  });

  describe('Platform Compatibility (engine)', () => {
    it('should accept manifest with engine requirements', () => {
      const manifest = {
        id: 'com.acme.crm',
        version: '1.0.0',
        type: 'app' as const,
        name: 'Acme CRM',
        engine: {
          objectstack: '>=3.0.0',
        },
      };
      const parsed = ManifestSchema.parse(manifest);
      expect(parsed.engine?.objectstack).toBe('>=3.0.0');
    });

    it('should accept various semver range formats', () => {
      const ranges = ['>=3.0.0', '^2.1.0', '~1.5.0', '>=1.0.0', '3.0.0'];
      ranges.forEach(range => {
        const manifest = {
          id: 'com.test.app',
          version: '1.0.0',
          type: 'app' as const,
          name: 'Test',
          engine: { objectstack: range },
        };
        expect(() => ManifestSchema.parse(manifest)).not.toThrow();
      });
    });

    it('should reject invalid engine version format', () => {
      const manifest = {
        id: 'com.test.app',
        version: '1.0.0',
        type: 'app' as const,
        name: 'Test',
        engine: { objectstack: 'latest' },
      };
      expect(() => ManifestSchema.parse(manifest)).toThrow();
    });

    it('should accept manifest without engine (backward compatible)', () => {
      const manifest = {
        id: 'com.test.app',
        version: '1.0.0',
        type: 'app' as const,
        name: 'Test',
      };
      const parsed = ManifestSchema.parse(manifest);
      expect(parsed.engine).toBeUndefined();
    });
  });

  describe('Reverse Domain Notation', () => {
    it('should accept various reverse domain notation formats', () => {
      const validIds = [
        'com.example.app',
        'com.company.product.module',
        'org.opensource.project',
        'io.github.username.repo',
        'net.example.service',
      ];

      validIds.forEach(id => {
        const manifest = {
          id,
          version: '1.0.0',
          type: 'app' as const,
          name: 'Test',
        };
        expect(() => ManifestSchema.parse(manifest)).not.toThrow();
      });
    });
  });
});

describe('contributes dead-member retirement (#10724, ADR-0049 — tombstoned, not deleted)', () => {
  // Nine members had zero readers monorepo-wide (#10627's controlled census,
  // completed on cloud 2026-08-24). `ManifestSchema` and the `contributes`
  // object are NOT `.strict()`, so a plain deletion would have silently
  // stripped the keys — `retiredKey()` is what makes each rejection carry the
  // prescription, and the prescription is what these pins assert (the specific
  // zod issue, never just "it threw").
  const base = { id: 'com.example.retired', version: '1.0.0', type: 'plugin', name: 'Retired' };
  const authored: Array<[member: string, value: unknown]> = [
    ['events', ['kernel:ready']],
    ['menus', { toolbar: [{ id: 'm', label: 'M' }] }],
    ['themes', [{ id: 't', label: 'T', path: './theme.css' }]],
    ['translations', [{ locale: 'en', path: 'i18n/en.json' }]],
    ['actions', [{ name: 'do_thing' }]],
    ['drivers', [{ id: 'memory', label: 'In-Memory' }]],
    ['fieldTypes', [{ name: 'vector', label: 'Vector' }]],
    ['functions', [{ name: 'distance' }]],
    ['commands', [{ name: 'marketplace' }]],
  ];

  it.each(authored)('REJECTS an authored `contributes.%s` with the prescription as the issue', (member, value) => {
    const result = ManifestSchema.safeParse({ ...base, contributes: { [member]: value } });
    expect(result.success).toBe(false);
    if (result.success) return;
    // The SPECIFIC zod issue: located at the retired key, carrying the
    // fully-qualified key, the removal record, and the imperative fix.
    const issue = result.error.issues.find(
      (i) => i.path[0] === 'contributes' && i.path[1] === member,
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(
      new RegExp(`manifest\\.contributes\\.${member}.*removed in @objectstack/spec 17.*#10724.*Delete the key`, 's'),
    );
  });

  it('still parses the two survivors — `kinds` registers, `routes` is untouched (#10726 fork)', () => {
    const parsed = ManifestSchema.parse({
      ...base,
      contributes: {
        kinds: [{ id: 'sys.bi.report', description: 'BI report kind' }],
        routes: [{ prefix: '/api/v1/example', service: 'example' }],
      },
    });
    expect(parsed.contributes!.kinds).toHaveLength(1);
    expect(parsed.contributes!.routes).toHaveLength(1);
  });

  it('parses cleanly with the retired keys simply absent', () => {
    const parsed = ManifestSchema.parse({ ...base, contributes: {} });
    expect(parsed.contributes).toEqual({});
    expect(parsed.contributes).not.toHaveProperty('commands');
  });
});
