import { describe, it, expect } from 'vitest';
import {
  RestApiRouteCategory,
  RestApiEndpointSchema,
  RestApiRouteRegistrationSchema,
  RequestValidationConfigSchema,
  ResponseEnvelopeConfigSchema,
  ErrorHandlingConfigSchema,
  OpenApiGenerationConfigSchema,
  RestApiPluginConfigSchema,
  ValidationMode,
  DEFAULT_DISCOVERY_ROUTES,
  DEFAULT_METADATA_ROUTES,
  DEFAULT_DATA_CRUD_ROUTES,
  DEFAULT_BATCH_ROUTES,
  DEFAULT_PERMISSION_ROUTES,
  DEFAULT_VIEW_ROUTES,
  DEFAULT_WORKFLOW_ROUTES,
  DEFAULT_REALTIME_ROUTES,
  DEFAULT_NOTIFICATION_ROUTES,
  DEFAULT_AI_ROUTES,
  DEFAULT_I18N_ROUTES,
  DEFAULT_ANALYTICS_ROUTES,
  DEFAULT_AUTOMATION_ROUTES,
  getDefaultRouteRegistrations,
} from './plugin-rest-api.zod';

describe('plugin-rest-api.zod', () => {
  describe('RestApiRouteCategory', () => {
    it('should validate valid route categories', () => {
      expect(RestApiRouteCategory.parse('discovery')).toBe('discovery');
      expect(RestApiRouteCategory.parse('metadata')).toBe('metadata');
      expect(RestApiRouteCategory.parse('data')).toBe('data');
      expect(RestApiRouteCategory.parse('batch')).toBe('batch');
      expect(RestApiRouteCategory.parse('permission')).toBe('permission');
    });

    it('should reject invalid route categories', () => {
      expect(() => RestApiRouteCategory.parse('invalid')).toThrow();
    });
  });

  describe('RestApiEndpointSchema', () => {
    it('should validate a basic endpoint', () => {
      const endpoint = RestApiEndpointSchema.parse({
        method: 'GET',
        path: '/api/v1/discovery',
        handler: 'getDiscovery',
        category: 'discovery',
      });

      expect(endpoint.method).toBe('GET');
      expect(endpoint.path).toBe('/api/v1/discovery');
      expect(endpoint.handler).toBe('getDiscovery');
      expect(endpoint.category).toBe('discovery');
      expect(endpoint.public).toBe(false); // default
    });

    it('should validate endpoint with all fields', () => {
      const endpoint = RestApiEndpointSchema.parse({
        method: 'POST',
        path: '/api/v1/data/:object',
        handler: 'createData',
        category: 'data',
        public: false,
        permissions: ['data.create'],
        summary: 'Create a record',
        description: 'Creates a new record in the specified object',
        tags: ['Data', 'CRUD'],
        requestSchema: 'CreateRequestSchema',
        responseSchema: 'SingleRecordResponseSchema',
        timeout: 30000,
        rateLimit: 'standard',
        cacheable: false,
      });

      expect(endpoint.permissions).toEqual(['data.create']);
      expect(endpoint.summary).toBe('Create a record');
      expect(endpoint.tags).toEqual(['Data', 'CRUD']);
      expect(endpoint.timeout).toBe(30000);
    });

    it('should default public to false', () => {
      const endpoint = RestApiEndpointSchema.parse({
        method: 'GET',
        path: '/test',
        handler: 'test',
        category: 'data',
      });

      expect(endpoint.public).toBe(false);
    });

    it('should default cacheable to false', () => {
      const endpoint = RestApiEndpointSchema.parse({
        method: 'GET',
        path: '/test',
        handler: 'test',
        category: 'metadata',
      });

      expect(endpoint.cacheable).toBe(false);
    });
  });

  describe('RestApiRouteRegistrationSchema', () => {
    it('should validate a basic route registration', () => {
      const registration = RestApiRouteRegistrationSchema.parse({
        prefix: '/api/v1/data',
        service: 'data',
        category: 'data',
      });

      expect(registration.prefix).toBe('/api/v1/data');
      expect(registration.service).toBe('data');
      expect(registration.category).toBe('data');
      expect(registration.authRequired).toBe(true); // default
    });

    it('should validate route registration with endpoints', () => {
      const registration = RestApiRouteRegistrationSchema.parse({
        prefix: '/api/v1/data',
        service: 'data',
        category: 'data',
        methods: ['findData', 'getData', 'createData'],
        endpoints: [
          {
            method: 'GET',
            path: '/:object',
            handler: 'findData',
            category: 'data',
            summary: 'Find records',
          },
          {
            method: 'GET',
            path: '/:object/:id',
            handler: 'getData',
            category: 'data',
            summary: 'Get record',
          },
        ],
        authRequired: true,
      });

      expect(registration.methods).toHaveLength(3);
      expect(registration.endpoints).toHaveLength(2);
      expect(registration.endpoints?.[0].method).toBe('GET');
    });

    it('should validate route registration with middleware', () => {
      const registration = RestApiRouteRegistrationSchema.parse({
        prefix: '/api/v1/meta',
        service: 'metadata',
        category: 'metadata',
        middleware: [
          {
            name: 'auth',
            type: 'authentication',
            enabled: true,
            order: 10,
          },
          {
            name: 'validation',
            type: 'validation',
            enabled: true,
            order: 20,
          },
        ],
      });

      expect(registration.middleware).toHaveLength(2);
      expect(registration.middleware?.[0].name).toBe('auth');
      expect(registration.middleware?.[0].type).toBe('authentication');
      expect(registration.middleware?.[1].type).toBe('validation');
    });

    it('should require prefix to start with /', () => {
      expect(() =>
        RestApiRouteRegistrationSchema.parse({
          prefix: 'api/v1/data', // missing leading /
          service: 'data',
          category: 'data',
        })
      ).toThrow();
    });
  });

  describe('RequestValidationConfigSchema', () => {
    it('should validate with defaults', () => {
      const config = RequestValidationConfigSchema.parse({});

      expect(config.enabled).toBe(true);
      expect(config.mode).toBe('strict');
      expect(config.validateBody).toBe(true);
      expect(config.validateQuery).toBe(true);
      expect(config.validateParams).toBe(true);
      expect(config.validateHeaders).toBe(false);
      expect(config.includeFieldErrors).toBe(true);
    });

    it('should validate validation modes', () => {
      expect(ValidationMode.parse('strict')).toBe('strict');
      expect(ValidationMode.parse('permissive')).toBe('permissive');
      expect(ValidationMode.parse('strip')).toBe('strip');
      expect(() => ValidationMode.parse('invalid')).toThrow();
    });

    it('should validate custom config', () => {
      const config = RequestValidationConfigSchema.parse({
        enabled: true,
        mode: 'permissive',
        validateBody: true,
        validateQuery: false,
        validateParams: false,
        validateHeaders: true,
        includeFieldErrors: false,
        errorPrefix: 'Validation Error: ',
      });

      expect(config.mode).toBe('permissive');
      expect(config.validateQuery).toBe(false);
      expect(config.validateHeaders).toBe(true);
      expect(config.errorPrefix).toBe('Validation Error: ');
    });
  });

  describe('ResponseEnvelopeConfigSchema', () => {
    it('should validate with defaults', () => {
      const config = ResponseEnvelopeConfigSchema.parse({});

      expect(config.enabled).toBe(true);
      expect(config.includeMetadata).toBe(true);
      expect(config.includeTimestamp).toBe(true);
      expect(config.includeRequestId).toBe(true);
      expect(config.includeDuration).toBe(false);
      expect(config.includeTraceId).toBe(false);
      expect(config.skipIfWrapped).toBe(true);
    });

    it('should validate custom config', () => {
      const config = ResponseEnvelopeConfigSchema.parse({
        enabled: true,
        includeMetadata: true,
        includeTimestamp: true,
        includeRequestId: true,
        includeDuration: true,
        includeTraceId: true,
        customMetadata: {
          version: '1.0.0',
          environment: 'production',
        },
        skipIfWrapped: false,
      });

      expect(config.includeDuration).toBe(true);
      expect(config.includeTraceId).toBe(true);
      expect(config.customMetadata).toEqual({
        version: '1.0.0',
        environment: 'production',
      });
      expect(config.skipIfWrapped).toBe(false);
    });
  });

  describe('ErrorHandlingConfigSchema', () => {
    it('should validate with defaults', () => {
      const config = ErrorHandlingConfigSchema.parse({});

      expect(config.enabled).toBe(true);
      expect(config.includeStackTrace).toBe(false);
      expect(config.logErrors).toBe(true);
      expect(config.exposeInternalErrors).toBe(false);
      expect(config.includeRequestId).toBe(true);
      expect(config.includeTimestamp).toBe(true);
      expect(config.includeDocumentation).toBe(true);
    });

    it('should validate custom config', () => {
      const config = ErrorHandlingConfigSchema.parse({
        enabled: true,
        includeStackTrace: true,
        logErrors: true,
        exposeInternalErrors: true,
        includeRequestId: true,
        includeTimestamp: true,
        includeDocumentation: true,
        documentationBaseUrl: 'https://docs.example.com/errors',
        customErrorMessages: {
          validation_error: 'Invalid input data',
          not_found: 'Resource not found',
        },
        redactFields: ['password', 'ssn', 'creditCard'],
      });

      expect(config.includeStackTrace).toBe(true);
      expect(config.documentationBaseUrl).toBe('https://docs.example.com/errors');
      expect(config.customErrorMessages).toHaveProperty('validation_error');
      expect(config.redactFields).toEqual(['password', 'ssn', 'creditCard']);
    });

    it('should validate URL format for documentationBaseUrl', () => {
      expect(() =>
        ErrorHandlingConfigSchema.parse({
          documentationBaseUrl: 'not-a-url',
        })
      ).toThrow();

      expect(
        ErrorHandlingConfigSchema.parse({
          documentationBaseUrl: 'https://docs.example.com',
        })
      ).toBeTruthy();
    });
  });

  describe('OpenApiGenerationConfigSchema', () => {
    it('should validate with defaults', () => {
      const config = OpenApiGenerationConfigSchema.parse({});

      expect(config.enabled).toBe(true);
      expect(config.version).toBe('3.0.3');
      expect(config.title).toBe('ObjectStack API');
      expect(config.apiVersion).toBe('1.0.0');
      expect(config.outputPath).toBe('/api/docs/openapi.json');
      expect(config.uiPath).toBe('/api/docs');
      expect(config.uiFramework).toBe('swagger-ui');
      expect(config.includeInternal).toBe(false);
      expect(config.generateSchemas).toBe(true);
      expect(config.includeExamples).toBe(true);
    });

    it('should validate OpenAPI versions', () => {
      const versions = ['3.0.0', '3.0.1', '3.0.2', '3.0.3', '3.1.0'];
      
      versions.forEach(version => {
        const config = OpenApiGenerationConfigSchema.parse({ version });
        expect(config.version).toBe(version);
      });

      expect(() =>
        OpenApiGenerationConfigSchema.parse({ version: '2.0.0' })
      ).toThrow();
    });

    it('should validate UI frameworks', () => {
      const frameworks = ['swagger-ui', 'redoc', 'rapidoc', 'elements'];
      
      frameworks.forEach(framework => {
        const config = OpenApiGenerationConfigSchema.parse({ uiFramework: framework });
        expect(config.uiFramework).toBe(framework);
      });

      expect(() =>
        OpenApiGenerationConfigSchema.parse({ uiFramework: 'invalid' })
      ).toThrow();
    });

    it('should validate complete config', () => {
      const config = OpenApiGenerationConfigSchema.parse({
        enabled: true,
        version: '3.1.0',
        title: 'My API',
        description: 'API for my application',
        apiVersion: '2.0.0',
        outputPath: '/docs/api.json',
        uiPath: '/docs',
        uiFramework: 'redoc',
        includeInternal: true,
        generateSchemas: true,
        includeExamples: true,
        servers: [
          { url: 'https://api.example.com', description: 'Production' },
          { url: 'https://api-staging.example.com', description: 'Staging' },
        ],
        contact: {
          name: 'API Support',
          url: 'https://example.com/support',
          email: 'api@example.com',
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT',
        },
      });

      expect(config.title).toBe('My API');
      expect(config.servers).toHaveLength(2);
      expect(config.contact?.email).toBe('api@example.com');
      expect(config.license?.name).toBe('MIT');
    });
  });

  describe('RestApiPluginConfigSchema', () => {
    it('should validate minimal config', () => {
      const config = RestApiPluginConfigSchema.parse({
        routes: [],
      });

      expect(config.enabled).toBe(true);
      expect(config.basePath).toBe('/api');
      expect(config.version).toBe('v1');
      expect(config.routes).toEqual([]);
    });

    it('should validate complete config', () => {
      const config = RestApiPluginConfigSchema.parse({
        enabled: true,
        basePath: '/api',
        version: 'v2',
        routes: [
          {
            prefix: '/api/v2/data',
            service: 'data',
            category: 'data',
          },
        ],
        validation: {
          enabled: true,
          mode: 'strict',
        },
        responseEnvelope: {
          enabled: true,
          includeMetadata: true,
        },
        errorHandling: {
          enabled: true,
          includeStackTrace: false,
        },
        openApi: {
          enabled: true,
          title: 'My API',
        },
        globalMiddleware: [
          {
            name: 'cors',
            type: 'custom',
            enabled: true,
            order: 1,
          },
        ],
        cors: {
          enabled: true,
          origins: ['http://localhost:3000'],
          methods: ['GET', 'POST', 'PUT', 'DELETE'],
          credentials: true,
        },
        performance: {
          enableCompression: true,
          enableETag: true,
          enableCaching: true,
          defaultCacheTtl: 600,
        },
      });

      expect(config.version).toBe('v2');
      expect(config.routes).toHaveLength(1);
      expect(config.validation?.mode).toBe('strict');
      expect(config.openApi?.title).toBe('My API');
      expect(config.cors?.origins).toContain('http://localhost:3000');
      expect(config.performance?.defaultCacheTtl).toBe(600);
    });
  });

  describe('Default Route Registrations', () => {
    it('should validate DEFAULT_DISCOVERY_ROUTES', () => {
      expect(DEFAULT_DISCOVERY_ROUTES.prefix).toBe('/api/v1/discovery');
      expect(DEFAULT_DISCOVERY_ROUTES.service).toBe('metadata');
      expect(DEFAULT_DISCOVERY_ROUTES.category).toBe('discovery');
      expect(DEFAULT_DISCOVERY_ROUTES.authRequired).toBe(false);
      expect(DEFAULT_DISCOVERY_ROUTES.endpoints).toHaveLength(1);
      expect(DEFAULT_DISCOVERY_ROUTES.endpoints?.[0].public).toBe(true);
    });

    it('should validate DEFAULT_METADATA_ROUTES', () => {
      expect(DEFAULT_METADATA_ROUTES.prefix).toBe('/api/v1/meta');
      expect(DEFAULT_METADATA_ROUTES.service).toBe('metadata');
      expect(DEFAULT_METADATA_ROUTES.category).toBe('metadata');
      expect(DEFAULT_METADATA_ROUTES.authRequired).toBe(true);
      expect(DEFAULT_METADATA_ROUTES.endpoints).toHaveLength(4);
      expect(DEFAULT_METADATA_ROUTES.middleware).toBeDefined();
    });

    it('should validate DEFAULT_DATA_CRUD_ROUTES', () => {
      expect(DEFAULT_DATA_CRUD_ROUTES.prefix).toBe('/api/v1/data');
      expect(DEFAULT_DATA_CRUD_ROUTES.service).toBe('data');
      expect(DEFAULT_DATA_CRUD_ROUTES.category).toBe('data');
      expect(DEFAULT_DATA_CRUD_ROUTES.methods).toContain('findData');
      expect(DEFAULT_DATA_CRUD_ROUTES.methods).toContain('getData');
      expect(DEFAULT_DATA_CRUD_ROUTES.methods).toContain('createData');
      expect(DEFAULT_DATA_CRUD_ROUTES.methods).toContain('updateData');
      expect(DEFAULT_DATA_CRUD_ROUTES.methods).toContain('deleteData');
      expect(DEFAULT_DATA_CRUD_ROUTES.endpoints).toHaveLength(5);
    });

    it('should validate DEFAULT_BATCH_ROUTES', () => {
      expect(DEFAULT_BATCH_ROUTES.prefix).toBe('/api/v1/data/:object');
      expect(DEFAULT_BATCH_ROUTES.service).toBe('data');
      expect(DEFAULT_BATCH_ROUTES.category).toBe('batch');
      expect(DEFAULT_BATCH_ROUTES.methods).toContain('batchData');
      expect(DEFAULT_BATCH_ROUTES.methods).toContain('createManyData');
      expect(DEFAULT_BATCH_ROUTES.methods).toContain('updateManyData');
      expect(DEFAULT_BATCH_ROUTES.methods).toContain('deleteManyData');
      expect(DEFAULT_BATCH_ROUTES.endpoints).toHaveLength(4);
      
      // Verify batch endpoints have longer timeouts
      DEFAULT_BATCH_ROUTES.endpoints?.forEach(endpoint => {
        expect(endpoint.timeout).toBe(60000);
      });
    });

    it('should validate DEFAULT_PERMISSION_ROUTES', () => {
      expect(DEFAULT_PERMISSION_ROUTES.prefix).toBe('/api/v1/auth');
      expect(DEFAULT_PERMISSION_ROUTES.service).toBe('auth');
      expect(DEFAULT_PERMISSION_ROUTES.category).toBe('permission');
      expect(DEFAULT_PERMISSION_ROUTES.methods).toContain('checkPermission');
      expect(DEFAULT_PERMISSION_ROUTES.methods).toContain('getObjectPermissions');
      expect(DEFAULT_PERMISSION_ROUTES.methods).toContain('getEffectivePermissions');
      expect(DEFAULT_PERMISSION_ROUTES.endpoints).toHaveLength(3);
    });

    it('should validate DEFAULT_VIEW_ROUTES', () => {
      expect(DEFAULT_VIEW_ROUTES.prefix).toBe('/api/v1/ui');
      expect(DEFAULT_VIEW_ROUTES.service).toBe('ui');
      expect(DEFAULT_VIEW_ROUTES.category).toBe('ui');
      expect(DEFAULT_VIEW_ROUTES.methods).toContain('listViews');
      expect(DEFAULT_VIEW_ROUTES.methods).toContain('getView');
      expect(DEFAULT_VIEW_ROUTES.methods).toContain('createView');
      expect(DEFAULT_VIEW_ROUTES.methods).toContain('updateView');
      expect(DEFAULT_VIEW_ROUTES.methods).toContain('deleteView');
      expect(DEFAULT_VIEW_ROUTES.endpoints).toHaveLength(5);
    });

    it('should validate DEFAULT_WORKFLOW_ROUTES', () => {
      expect(DEFAULT_WORKFLOW_ROUTES.prefix).toBe('/api/v1/workflow');
      expect(DEFAULT_WORKFLOW_ROUTES.service).toBe('workflow');
      expect(DEFAULT_WORKFLOW_ROUTES.category).toBe('workflow');
      expect(DEFAULT_WORKFLOW_ROUTES.methods).toContain('getWorkflowConfig');
      expect(DEFAULT_WORKFLOW_ROUTES.methods).toContain('getWorkflowState');
      expect(DEFAULT_WORKFLOW_ROUTES.methods).toContain('workflowTransition');
      expect(DEFAULT_WORKFLOW_ROUTES.methods).toContain('workflowApprove');
      expect(DEFAULT_WORKFLOW_ROUTES.methods).toContain('workflowReject');
      expect(DEFAULT_WORKFLOW_ROUTES.endpoints).toHaveLength(5);
    });

    it('should validate DEFAULT_REALTIME_ROUTES', () => {
      expect(DEFAULT_REALTIME_ROUTES.prefix).toBe('/api/v1/realtime');
      expect(DEFAULT_REALTIME_ROUTES.service).toBe('realtime');
      expect(DEFAULT_REALTIME_ROUTES.category).toBe('realtime');
      expect(DEFAULT_REALTIME_ROUTES.methods).toContain('realtimeConnect');
      expect(DEFAULT_REALTIME_ROUTES.methods).toContain('realtimeDisconnect');
      expect(DEFAULT_REALTIME_ROUTES.methods).toContain('realtimeSubscribe');
      expect(DEFAULT_REALTIME_ROUTES.methods).toContain('realtimeUnsubscribe');
      expect(DEFAULT_REALTIME_ROUTES.methods).toContain('setPresence');
      expect(DEFAULT_REALTIME_ROUTES.methods).toContain('getPresence');
      expect(DEFAULT_REALTIME_ROUTES.endpoints).toHaveLength(6);
    });

    it('should validate DEFAULT_NOTIFICATION_ROUTES', () => {
      expect(DEFAULT_NOTIFICATION_ROUTES.prefix).toBe('/api/v1/notifications');
      expect(DEFAULT_NOTIFICATION_ROUTES.service).toBe('notification');
      expect(DEFAULT_NOTIFICATION_ROUTES.category).toBe('notification');
      expect(DEFAULT_NOTIFICATION_ROUTES.methods).toContain('registerDevice');
      expect(DEFAULT_NOTIFICATION_ROUTES.methods).toContain('listNotifications');
      expect(DEFAULT_NOTIFICATION_ROUTES.methods).toContain('markNotificationsRead');
      expect(DEFAULT_NOTIFICATION_ROUTES.methods).toContain('markAllNotificationsRead');
      expect(DEFAULT_NOTIFICATION_ROUTES.endpoints).toHaveLength(7);
    });

    it('should validate DEFAULT_AI_ROUTES', () => {
      expect(DEFAULT_AI_ROUTES.prefix).toBe('/api/v1/ai');
      expect(DEFAULT_AI_ROUTES.service).toBe('ai');
      expect(DEFAULT_AI_ROUTES.category).toBe('ai');
      expect(DEFAULT_AI_ROUTES.methods).toContain('aiNlq');
      // aiChat removed — wire protocol aligned with Vercel AI SDK
      expect(DEFAULT_AI_ROUTES.methods).toContain('aiSuggest');
      expect(DEFAULT_AI_ROUTES.methods).toContain('aiInsights');
      expect(DEFAULT_AI_ROUTES.endpoints).toHaveLength(3);
    });

    it('should validate DEFAULT_I18N_ROUTES', () => {
      expect(DEFAULT_I18N_ROUTES.prefix).toBe('/api/v1/i18n');
      expect(DEFAULT_I18N_ROUTES.service).toBe('i18n');
      expect(DEFAULT_I18N_ROUTES.category).toBe('i18n');
      expect(DEFAULT_I18N_ROUTES.methods).toContain('getLocales');
      expect(DEFAULT_I18N_ROUTES.methods).toContain('getTranslations');
      expect(DEFAULT_I18N_ROUTES.methods).toContain('getFieldLabels');
      expect(DEFAULT_I18N_ROUTES.endpoints).toHaveLength(3);
      // i18n endpoints should be cacheable
      DEFAULT_I18N_ROUTES.endpoints?.forEach(endpoint => {
        expect(endpoint.cacheable).toBe(true);
      });
    });

    it('should validate DEFAULT_ANALYTICS_ROUTES', () => {
      expect(DEFAULT_ANALYTICS_ROUTES.prefix).toBe('/api/v1/analytics');
      expect(DEFAULT_ANALYTICS_ROUTES.service).toBe('analytics');
      expect(DEFAULT_ANALYTICS_ROUTES.category).toBe('analytics');
      expect(DEFAULT_ANALYTICS_ROUTES.methods).toContain('analyticsQuery');
      expect(DEFAULT_ANALYTICS_ROUTES.methods).toContain('getAnalyticsMeta');
      expect(DEFAULT_ANALYTICS_ROUTES.endpoints).toHaveLength(2);
      // Analytics query should have extended timeout
      const queryEndpoint = DEFAULT_ANALYTICS_ROUTES.endpoints?.find(e => e.handler === 'analyticsQuery');
      expect(queryEndpoint?.timeout).toBe(120000);
    });

    it('should validate DEFAULT_AUTOMATION_ROUTES', () => {
      expect(DEFAULT_AUTOMATION_ROUTES.prefix).toBe('/api/v1/automation');
      expect(DEFAULT_AUTOMATION_ROUTES.service).toBe('automation');
      expect(DEFAULT_AUTOMATION_ROUTES.category).toBe('automation');
      expect(DEFAULT_AUTOMATION_ROUTES.methods).toContain('triggerAutomation');
      // POST /trigger + GET /actions (ADR-0018 action descriptor registry)
      expect(DEFAULT_AUTOMATION_ROUTES.endpoints).toHaveLength(2);
      // Automation trigger should have extended timeout
      expect(DEFAULT_AUTOMATION_ROUTES.endpoints?.[0].timeout).toBe(120000);
      // The actions endpoint exposes the live registry and is cacheable.
      const actionsEndpoint = DEFAULT_AUTOMATION_ROUTES.endpoints?.find(e => e.path === '/actions');
      expect(actionsEndpoint?.method).toBe('GET');
      expect(actionsEndpoint?.handler).toBe('getActionDescriptors');
      expect(actionsEndpoint?.responseSchema).toBe('AutomationActionsResponseSchema');
    });

    it('should return all 13 default registrations', () => {
      const registrations = getDefaultRouteRegistrations();
      
      expect(registrations).toHaveLength(13);
      expect(registrations[0]).toBe(DEFAULT_DISCOVERY_ROUTES);
      expect(registrations[1]).toBe(DEFAULT_METADATA_ROUTES);
      expect(registrations[2]).toBe(DEFAULT_DATA_CRUD_ROUTES);
      expect(registrations[3]).toBe(DEFAULT_BATCH_ROUTES);
      expect(registrations[4]).toBe(DEFAULT_PERMISSION_ROUTES);
      expect(registrations[5]).toBe(DEFAULT_VIEW_ROUTES);
      expect(registrations[6]).toBe(DEFAULT_WORKFLOW_ROUTES);
      expect(registrations[7]).toBe(DEFAULT_REALTIME_ROUTES);
      expect(registrations[8]).toBe(DEFAULT_NOTIFICATION_ROUTES);
      expect(registrations[9]).toBe(DEFAULT_AI_ROUTES);
      expect(registrations[10]).toBe(DEFAULT_I18N_ROUTES);
      expect(registrations[11]).toBe(DEFAULT_ANALYTICS_ROUTES);
      expect(registrations[12]).toBe(DEFAULT_AUTOMATION_ROUTES);
    });

    it('should cover all protocol categories', () => {
      const registrations = getDefaultRouteRegistrations();
      const categories = registrations.map(r => r.category);
      
      expect(categories).toContain('discovery');
      expect(categories).toContain('metadata');
      expect(categories).toContain('data');
      expect(categories).toContain('batch');
      expect(categories).toContain('permission');
      expect(categories).toContain('ui');
      expect(categories).toContain('workflow');
      expect(categories).toContain('realtime');
      expect(categories).toContain('notification');
      expect(categories).toContain('ai');
      expect(categories).toContain('i18n');
      expect(categories).toContain('analytics');
      expect(categories).toContain('automation');
    });
  });

  describe('Schema Consistency', () => {
    it('should ensure all endpoints have required fields', () => {
      const allRegistrations = getDefaultRouteRegistrations();
      
      allRegistrations.forEach(registration => {
        registration.endpoints?.forEach(endpoint => {
          expect(endpoint.method).toBeDefined();
          expect(endpoint.path).toBeDefined();
          expect(endpoint.handler).toBeDefined();
          expect(endpoint.category).toBeDefined();
          // public field has a default value of false, so it's always defined after parsing
          expect(typeof endpoint.public).toBe('boolean');
        });
      });
    });

    it('should ensure middleware has proper order', () => {
      const allRegistrations = getDefaultRouteRegistrations();
      
      allRegistrations.forEach(registration => {
        if (registration.middleware && registration.middleware.length > 1) {
          for (let i = 1; i < registration.middleware.length; i++) {
            const prev = registration.middleware[i - 1];
            const curr = registration.middleware[i];
            
            // If order is specified, ensure it's increasing
            if (prev.order && curr.order) {
              expect(curr.order).toBeGreaterThanOrEqual(prev.order);
            }
          }
        }
      });
    });

    it('should ensure auth middleware comes before validation', () => {
      const allRegistrations = getDefaultRouteRegistrations();
      
      allRegistrations.forEach(registration => {
        if (registration.middleware) {
          const authIndex = registration.middleware.findIndex(m => m.type === 'authentication');
          const validationIndex = registration.middleware.findIndex(m => m.type === 'validation');
          
          if (authIndex !== -1 && validationIndex !== -1) {
            expect(authIndex).toBeLessThan(validationIndex);
          }
        }
      });
    });
  });
});
