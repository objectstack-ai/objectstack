import { describe, it, expect } from 'vitest';
import {
  OpenApiServerSchema,
  OpenApiSecuritySchemeSchema,
  OpenApiSpecSchema,
  ApiTestingUiType,
  ApiTestingUiConfigSchema,
  ApiTestRequestSchema,
  ApiTestCollectionSchema,
  ApiChangelogEntrySchema,
  CodeGenerationTemplateSchema,
  ApiDocumentationConfigSchema,
  GeneratedApiDocumentationSchema,
  ApiDocumentationConfig,
  ApiTestCollection,
  OpenApiSpec,
} from './documentation.zod';

describe('API Documentation Protocol', () => {
  describe('OpenApiServerSchema', () => {
    it('should validate valid server', () => {
      const server = {
        url: 'https://api.example.com',
        description: 'Production server',
      };

      const result = OpenApiServerSchema.parse(server);
      expect(result.url).toBe('https://api.example.com');
      expect(result.description).toBe('Production server');
    });

    it('should support server variables', () => {
      const server = {
        url: 'https://{environment}.example.com/api/{version}',
        description: 'Templated server',
        variables: {
          environment: {
            default: 'api',
            description: 'Environment',
            enum: ['api', 'staging', 'dev'],
          },
          version: {
            default: 'v1',
            description: 'API version',
          },
        },
      };

      const result = OpenApiServerSchema.parse(server);
      expect(result.variables).toBeDefined();
      expect(result.variables?.environment.default).toBe('api');
    });
  });

  describe('OpenApiSecuritySchemeSchema', () => {
    it('should validate API key security', () => {
      const scheme = {
        type: 'apiKey' as const,
        name: 'X-API-Key',
        in: 'header' as const,
        description: 'API key authentication',
      };

      const result = OpenApiSecuritySchemeSchema.parse(scheme);
      expect(result.type).toBe('apiKey');
      expect(result.name).toBe('X-API-Key');
    });

    it('should validate HTTP bearer security', () => {
      const scheme = {
        type: 'http' as const,
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT bearer token',
      };

      const result = OpenApiSecuritySchemeSchema.parse(scheme);
      expect(result.type).toBe('http');
      expect(result.scheme).toBe('bearer');
      expect(result.bearerFormat).toBe('JWT');
    });

    it('should validate OAuth2 security', () => {
      const scheme = {
        type: 'oauth2' as const,
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://example.com/oauth/authorize',
            tokenUrl: 'https://example.com/oauth/token',
            scopes: {
              'read:customer': 'Read customer data',
              'write:customer': 'Write customer data',
            },
          },
        },
      };

      const result = OpenApiSecuritySchemeSchema.parse(scheme);
      expect(result.type).toBe('oauth2');
      expect(result.flows).toBeDefined();
    });
  });

  describe('OpenApiSpecSchema', () => {
    it('should validate complete OpenAPI spec', () => {
      const spec = {
        openapi: '3.0.0',
        info: {
          title: 'ObjectStack API',
          version: '1.0.0',
          description: 'Unified API for ObjectStack',
          contact: {
            name: 'API Support',
            email: 'api@example.com',
          },
          license: {
            name: 'Apache 2.0',
            url: 'https://www.apache.org/licenses/LICENSE-2.0',
          },
        },
        servers: [
          {
            url: 'https://api.example.com',
            description: 'Production',
          },
        ],
        paths: {
          '/customers': {
            get: {
              summary: 'List customers',
              responses: {
                '200': {
                  description: 'Success',
                },
              },
            },
          },
        },
        components: {
          schemas: {
            Customer: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
            },
          },
          securitySchemes: {
            bearerAuth: {
              type: 'http' as const,
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
        security: [
          {
            bearerAuth: [],
          },
        ],
        tags: [
          {
            name: 'customer',
            description: 'Customer operations',
          },
        ],
      };

      const result = OpenApiSpecSchema.parse(spec);
      expect(result.openapi).toBe('3.0.0');
      expect(result.info.title).toBe('ObjectStack API');
      expect(result.servers).toHaveLength(1);
    });

    it('should apply defaults', () => {
      const spec = {
        info: {
          title: 'Test API',
          version: '1.0.0',
        },
        paths: {},
      };

      const result = OpenApiSpecSchema.parse(spec);
      expect(result.openapi).toBe('3.0.0');
      expect(result.servers).toEqual([]);
    });
  });

  describe('ApiTestingUiType', () => {
    it('should accept valid UI types', () => {
      expect(ApiTestingUiType.parse('swagger-ui')).toBe('swagger-ui');
      expect(ApiTestingUiType.parse('redoc')).toBe('redoc');
      expect(ApiTestingUiType.parse('rapidoc')).toBe('rapidoc');
      expect(ApiTestingUiType.parse('stoplight')).toBe('stoplight');
      expect(ApiTestingUiType.parse('scalar')).toBe('scalar');
        expect(ApiTestingUiType.parse('graphiql')).toBe('graphiql');
      expect(ApiTestingUiType.parse('postman')).toBe('postman');
      expect(ApiTestingUiType.parse('custom')).toBe('custom');
    });

    it('should reject invalid UI types', () => {
      expect(() => ApiTestingUiType.parse('invalid')).toThrow();
    });
  });

  describe('ApiTestingUiConfigSchema', () => {
    it('should validate Swagger UI config', () => {
      const config = {
        type: 'swagger-ui' as const,
        path: '/api-docs',
        theme: 'light' as const,
        enableTryItOut: true,
        enableFilter: true,
        enableCors: true,
        defaultModelsExpandDepth: 1,
        layout: {
          deepLinking: true,
          displayOperationId: false,
          defaultModelRendering: 'example' as const,
          docExpansion: 'list' as const,
        },
      };

      const result = ApiTestingUiConfigSchema.parse(config);
      expect(result.type).toBe('swagger-ui');
      expect(result.theme).toBe('light');
      expect(result.enableTryItOut).toBe(true);
    });

    it('should apply defaults', () => {
      const config = {
        type: 'swagger-ui' as const,
      };

      const result = ApiTestingUiConfigSchema.parse(config);
      expect(result.path).toBe('/api-docs');
      expect(result.theme).toBe('light');
      expect(result.enableTryItOut).toBe(true);
      expect(result.enableFilter).toBe(true);
    });

    it('should support custom CSS and JS', () => {
      const config = {
        type: 'swagger-ui' as const,
        customCssUrl: 'https://example.com/custom.css',
        customJsUrl: 'https://example.com/custom.js',
      };

      const result = ApiTestingUiConfigSchema.parse(config);
      expect(result.customCssUrl).toBe('https://example.com/custom.css');
      expect(result.customJsUrl).toBe('https://example.com/custom.js');
    });
  });

  describe('ApiTestRequestSchema', () => {
    it('should validate complete test request', () => {
      const request = {
        name: 'Get Customer',
        description: 'Retrieve a customer by ID',
        method: 'GET' as const,
        url: '/api/v1/customers/{{customerId}}',
        headers: {
          'Authorization': 'Bearer {{token}}',
          'Content-Type': 'application/json',
        },
        queryParams: {
          expand: 'orders',
          limit: 10,
        },
        variables: {
          customerId: '123',
          token: 'test_token',
        },
        expectedResponse: {
          statusCode: 200,
          body: {
            id: '123',
            name: 'John Doe',
          },
        },
      };

      const result = ApiTestRequestSchema.parse(request);
      expect(result.name).toBe('Get Customer');
      expect(result.method).toBe('GET');
      expect(result.variables?.customerId).toBe('123');
    });

    it('should apply defaults for optional fields', () => {
      const request = {
        name: 'Simple Request',
        method: 'GET' as const,
        url: '/api/test',
      };

      const result = ApiTestRequestSchema.parse(request);
      expect(result.headers).toEqual({});
      expect(result.queryParams).toEqual({});
      expect(result.variables).toEqual({});
    });

    it('should support POST with body', () => {
      const request = {
        name: 'Create Customer',
        method: 'POST' as const,
        url: '/api/v1/customers',
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          name: 'Jane Doe',
          email: 'jane@example.com',
        },
        expectedResponse: {
          statusCode: 201,
        },
      };

      const result = ApiTestRequestSchema.parse(request);
      expect(result.body).toBeDefined();
      expect(result.body.name).toBe('Jane Doe');
    });
  });

  describe('ApiTestCollectionSchema', () => {
    it('should validate test collection', () => {
      const collection = {
        name: 'Customer API Tests',
        description: 'Test collection for customer endpoints',
        variables: {
          baseUrl: 'https://api.example.com',
          apiKey: 'test_key',
        },
        requests: [
          {
            name: 'List Customers',
            method: 'GET' as const,
            url: '{{baseUrl}}/customers',
          },
          {
            name: 'Get Customer',
            method: 'GET' as const,
            url: '{{baseUrl}}/customers/123',
          },
        ],
      };

      const result = ApiTestCollectionSchema.parse(collection);
      expect(result.name).toBe('Customer API Tests');
      expect(result.requests).toHaveLength(2);
      expect(result.variables?.baseUrl).toBe('https://api.example.com');
    });

    it('should support folders', () => {
      const collection = {
        name: 'API Tests',
        variables: {},
        requests: [],
        folders: [
          {
            name: 'Customer Operations',
            description: 'Customer CRUD operations',
            requests: [
              {
                name: 'Create Customer',
                method: 'POST' as const,
                url: '/customers',
              },
            ],
          },
        ],
      };

      const result = ApiTestCollectionSchema.parse(collection);
      expect(result.folders).toHaveLength(1);
      expect(result.folders?.[0].requests).toHaveLength(1);
    });

    it('should use helper create function', () => {
      const collection = ApiTestCollection.create({
        name: 'Test Collection',
        requests: [],
      });

      expect(collection.name).toBe('Test Collection');
    });
  });

  describe('ApiChangelogEntrySchema', () => {
    it('should validate changelog entry', () => {
      const entry = {
        version: '1.1.0',
        date: '2024-01-15',
        changes: {
          added: ['New customer search endpoint'],
          changed: ['Updated pagination format'],
          deprecated: ['Old search endpoint'],
          removed: ['Legacy endpoints'],
          fixed: ['Bug in date filtering'],
          security: ['Fixed XSS vulnerability'],
        },
        migrationGuide: 'https://docs.example.com/migration/v1.1.0',
      };

      const result = ApiChangelogEntrySchema.parse(entry);
      expect(result.version).toBe('1.1.0');
      expect(result.changes.added).toHaveLength(1);
      expect(result.changes.security).toHaveLength(1);
    });

    it('should apply defaults for empty change arrays', () => {
      const entry = {
        version: '1.0.0',
        date: '2024-01-01',
        changes: {},
      };

      const result = ApiChangelogEntrySchema.parse(entry);
      expect(result.changes.added).toEqual([]);
      expect(result.changes.fixed).toEqual([]);
    });
  });

  describe('CodeGenerationTemplateSchema', () => {
    it('should validate code template', () => {
      const template = {
        language: 'typescript',
        name: 'API Client',
        template: 'const client = new ApiClient("{{baseUrl}}", "{{apiKey}}");',
        variables: ['baseUrl', 'apiKey'],
      };

      const result = CodeGenerationTemplateSchema.parse(template);
      expect(result.language).toBe('typescript');
      expect(result.variables).toHaveLength(2);
    });

    it('should support curl templates', () => {
      const template = {
        language: 'curl',
        name: 'cURL Request',
        template: 'curl -X {{method}} {{url}} -H "Authorization: Bearer {{token}}"',
        variables: ['method', 'url', 'token'],
      };

      const result = CodeGenerationTemplateSchema.parse(template);
      expect(result.language).toBe('curl');
    });
  });

  describe('ApiDocumentationConfigSchema', () => {
    it('should validate complete documentation config', () => {
      const config = {
        enabled: true,
        title: 'ObjectStack API Documentation',
        version: '1.0.0',
        description: 'Unified API for ObjectStack platform',
        servers: [
          {
            url: 'https://api.example.com',
            description: 'Production',
          },
          {
            url: 'https://staging-api.example.com',
            description: 'Staging',
          },
        ],
        ui: {
          type: 'swagger-ui' as const,
          theme: 'light' as const,
          enableTryItOut: true,
        },
        generateOpenApi: true,
        generateTestCollections: true,
        testCollections: [
          {
            name: 'Basic Tests',
            requests: [
              {
                name: 'Health Check',
                method: 'GET' as const,
                url: '/health',
              },
            ],
          },
        ],
        changelog: [
          {
            version: '1.0.0',
            date: '2024-01-01',
            changes: {
              added: ['Initial release'],
            },
          },
        ],
        codeTemplates: [
          {
            language: 'typescript',
            name: 'TypeScript Client',
            template: 'const client = new ApiClient();',
          },
        ],
        contact: {
          name: 'API Team',
          email: 'api@example.com',
        },
        license: {
          name: 'Apache 2.0',
          url: 'https://www.apache.org/licenses/LICENSE-2.0',
        },
        securitySchemes: {
          bearerAuth: {
            type: 'http' as const,
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
        tags: [
          {
            name: 'customer',
            description: 'Customer operations',
          },
        ],
      };

      const result = ApiDocumentationConfigSchema.parse(config);
      expect(result.title).toBe('ObjectStack API Documentation');
      expect(result.servers).toHaveLength(2);
      expect(result.testCollections).toHaveLength(1);
      expect(result.changelog).toHaveLength(1);
      expect(result.codeTemplates).toHaveLength(1);
    });

    it('should apply defaults', () => {
      const config = {
        version: '1.0.0',
      };

      const result = ApiDocumentationConfigSchema.parse(config);
      expect(result.enabled).toBe(true);
      expect(result.title).toBe('API Documentation');
      expect(result.generateOpenApi).toBe(true);
      expect(result.generateTestCollections).toBe(true);
      expect(result.servers).toEqual([]);
      expect(result.testCollections).toEqual([]);
      expect(result.changelog).toEqual([]);
      expect(result.codeTemplates).toEqual([]);
    });

    it('should use helper create function', () => {
      const config = ApiDocumentationConfig.create({
        version: '1.0.0',
        title: 'My API',
      });

      expect(config.version).toBe('1.0.0');
      expect(config.title).toBe('My API');
    });
  });

  describe('GeneratedApiDocumentationSchema', () => {
    it('should validate generated documentation', () => {
      const generated = {
        openApiSpec: {
          openapi: '3.0.0',
          info: {
            title: 'Generated API',
            version: '1.0.0',
          },
          paths: {},
        },
        testCollections: [
          {
            name: 'Test Collection',
            requests: [],
          },
        ],
        markdown: '# API Documentation\n\nGenerated documentation...',
        html: '<html><body>Documentation</body></html>',
        generatedAt: new Date().toISOString(),
        sourceApis: ['customer_api', 'order_api'],
      };

      const result = GeneratedApiDocumentationSchema.parse(generated);
      expect(result.sourceApis).toHaveLength(2);
      expect(result.markdown).toBeDefined();
      expect(result.html).toBeDefined();
    });

    it('should require generatedAt and sourceApis', () => {
      expect(() => GeneratedApiDocumentationSchema.parse({
        sourceApis: ['api1'],
      })).toThrow();

      expect(() => GeneratedApiDocumentationSchema.parse({
        generatedAt: new Date().toISOString(),
      })).toThrow();
    });
  });

  describe('Helper functions', () => {
    it('should use OpenApiSpec helper', () => {
      const spec = OpenApiSpec.create({
        info: {
          title: 'Test API',
          version: '1.0.0',
        },
        paths: {},
      });

      expect(spec.info.title).toBe('Test API');
    });
  });
});
