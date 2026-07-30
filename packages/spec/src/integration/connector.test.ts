import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  // Field Mapping
  FieldMappingSchema,
  
  // Data Sync
  DataSyncConfigSchema,
  SyncStrategySchema,
  ConflictResolutionSchema,
  
  // Webhook
  WebhookConfigSchema,
  WebhookEventSchema,
  
  // Rate Limiting & Retry
  RateLimitConfigSchema,
  RetryConfigSchema,
  
  // Base Connector
  ConnectorSchema,
  ConnectorTypeSchema,
  ConnectorStatusSchema,

  // Error Mapping
  ErrorMappingConfigSchema,
  ErrorMappingRuleSchema,
  ConnectorErrorCategorySchema,

  // Health & Circuit Breaker
  HealthCheckConfigSchema,
  CircuitBreakerConfigSchema,
  ConnectorHealthSchema,
  
  // Types
  type Connector,
  type FieldMapping,
  type DataSyncConfig,
  type WebhookConfig,
} from './connector.zod';

// Import shared auth schemas from canonical source
import {
  ConnectorAPIKeySchema as APIKeySchema,
  ConnectorOAuth2Schema as OAuth2Schema,
  ConnectorBasicAuthSchema as BasicAuthSchema,
  ConnectorBearerAuthSchema as BearerAuthSchema,
  ConnectorNoAuthSchema as NoAuthSchema,
  ConnectorAuthConfigSchema as AuthConfigSchema,
} from '../shared/connector-auth.zod';

// Deriving types from schemas
type APIKey = z.infer<typeof APIKeySchema>;
type OAuth2 = z.infer<typeof OAuth2Schema>;

// ============================================================================
// Authentication Schemas Tests (from shared/connector-auth.zod.ts)
// ============================================================================

describe('APIKeySchema', () => {
  it('should accept valid API key authentication', () => {
    const auth: APIKey = {
      type: 'api-key',
      key: 'test-api-key-12345',
      headerName: 'X-API-Key',
    };
    
    expect(() => APIKeySchema.parse(auth)).not.toThrow();
  });
  
  it('should accept API key with query parameter', () => {
    const auth = {
      type: 'api-key',
      key: 'test-key',
      headerName: 'X-Custom-Key',
      paramName: 'api_key',
    };
    
    const parsed = APIKeySchema.parse(auth);
    expect(parsed.paramName).toBe('api_key');
  });
  
  it('should use default header name', () => {
    const auth = {
      type: 'api-key',
      key: 'test-key',
    };
    
    const parsed = APIKeySchema.parse(auth);
    expect(parsed.headerName).toBe('X-API-Key');
  });
});

describe('OAuth2Schema', () => {
  it('should accept valid OAuth2 configuration', () => {
    const auth: OAuth2 = {
      type: 'oauth2',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
    };
    
    expect(() => OAuth2Schema.parse(auth)).not.toThrow();
  });
  
  it('should accept OAuth2 with scopes and refresh token', () => {
    const auth = {
      type: 'oauth2' as const,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      scopes: ['read', 'write'],
      refreshToken: 'refresh-token-xyz',
    };
    
    const parsed = OAuth2Schema.parse(auth);
    expect(parsed.scopes).toHaveLength(2);
    expect(parsed.refreshToken).toBe('refresh-token-xyz');
  });
  
  it('should accept OAuth2 without optional fields', () => {
    const auth = {
      type: 'oauth2' as const,
      clientId: 'client-id',
      clientSecret: 'client-secret',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
    };
    
    const parsed = OAuth2Schema.parse(auth);
    expect(parsed.type).toBe('oauth2');
    expect(parsed.clientId).toBe('client-id');
  });
});

describe('ConnectorAuthConfigSchema (Authentication)', () => {
  it('should accept all authentication types via discriminated union', () => {
    const keyAuth = { type: 'api-key' as const, key: 'key' };
    const oauth2Auth = { 
      type: 'oauth2' as const, 
      clientId: 'id', 
      clientSecret: 'secret',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
    };
    const basicAuth = { type: 'basic' as const, username: 'user', password: 'pass' };
    const noAuth = { type: 'none' as const };
    
    expect(() => AuthConfigSchema.parse(keyAuth)).not.toThrow();
    expect(() => AuthConfigSchema.parse(oauth2Auth)).not.toThrow();
    expect(() => AuthConfigSchema.parse(basicAuth)).not.toThrow();
    expect(() => AuthConfigSchema.parse(noAuth)).not.toThrow();
  });
});

// ============================================================================
// Field Mapping Tests
// ============================================================================

describe('FieldMappingSchema', () => {
  it('should accept valid field mapping', () => {
    const mapping: FieldMapping = {
      source: 'firstName',
      target: 'first_name',
      dataType: 'string',
      syncMode: 'bidirectional',
    };
    
    expect(() => FieldMappingSchema.parse(mapping)).not.toThrow();
  });
  
  it('should accept field with transformation', () => {
    const mapping = {
      source: 'name',
      target: 'full_name',
      transform: {
        type: 'javascript' as const,
        expression: 'value.toUpperCase()',
      },
    };
    
    const parsed = FieldMappingSchema.parse(mapping);
    expect(parsed.transform?.type).toBe('javascript');
  });
  
  it('should use default values', () => {
    const mapping = {
      source: 'field1',
      target: 'field_1',
    };
    
    const parsed = FieldMappingSchema.parse(mapping);
    expect(parsed.required).toBe(false);
    expect(parsed.syncMode).toBe('bidirectional');
  });
});

// ============================================================================
// Data Sync Configuration Tests
// ============================================================================

describe('DataSyncConfigSchema', () => {
  it('should accept valid sync configuration', () => {
    const config: DataSyncConfig = {
      strategy: 'incremental',
      direction: 'bidirectional',
      schedule: '0 */6 * * *',
      realtimeSync: true,
      conflictResolution: 'latest_wins',
      batchSize: 1000,
      deleteMode: 'soft_delete',
    };
    
    expect(() => DataSyncConfigSchema.parse(config)).not.toThrow();
  });
  
  it('should use default values', () => {
    const config = {};
    
    const parsed = DataSyncConfigSchema.parse(config);
    expect(parsed.strategy).toBe('incremental');
    expect(parsed.direction).toBe('import');
    expect(parsed.realtimeSync).toBe(false);
    expect(parsed.conflictResolution).toBe('latest_wins');
    expect(parsed.batchSize).toBe(1000);
    expect(parsed.deleteMode).toBe('soft_delete');
  });
  
  it('should validate batch size range', () => {
    expect(() => DataSyncConfigSchema.parse({ batchSize: 0 })).toThrow();
    expect(() => DataSyncConfigSchema.parse({ batchSize: 10001 })).toThrow();
    expect(() => DataSyncConfigSchema.parse({ batchSize: 500 })).not.toThrow();
  });
});

// ============================================================================
// Webhook Configuration Tests
// ============================================================================

describe('WebhookConfigSchema', () => {
  it('should accept valid webhook configuration', () => {
    const webhook: WebhookConfig = {
      name: 'test_webhook',
      url: 'https://api.example.com/webhooks',
      events: ['record.created', 'record.updated'],
      secret: 'webhook-secret',
      signatureAlgorithm: 'hmac_sha256',
    };
    
    expect(() => WebhookConfigSchema.parse(webhook)).not.toThrow();
  });
  
  it('should use default values', () => {
    const webhook = {
      name: 'default_webhook',
      url: 'https://api.example.com/webhooks',
      events: ['record.created'],
    };
    
    const parsed = WebhookConfigSchema.parse(webhook);
    expect(parsed.signatureAlgorithm).toBe('hmac_sha256');
    expect(parsed.timeoutMs).toBe(30000);
  });
});

// ============================================================================
// Rate Limiting & Retry Tests
// ============================================================================

describe('RateLimitConfigSchema', () => {
  it('should accept valid rate limit configuration', () => {
    const config = {
      strategy: 'token_bucket',
      maxRequests: 100,
      windowSeconds: 60,
      burstCapacity: 150,
      respectUpstreamLimits: true,
    };
    
    expect(() => RateLimitConfigSchema.parse(config)).not.toThrow();
  });
  
  it('should use default values', () => {
    const config = {
      maxRequests: 100,
      windowSeconds: 60,
    };
    
    const parsed = RateLimitConfigSchema.parse(config);
    expect(parsed.strategy).toBe('token_bucket');
    expect(parsed.respectUpstreamLimits).toBe(true);
  });
});

describe('RetryConfigSchema', () => {
  it('should accept valid retry configuration', () => {
    const config = {
      strategy: 'exponential_backoff',
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      retryableStatusCodes: [429, 500, 502, 503],
      retryOnNetworkError: true,
      jitter: true,
    };
    
    expect(() => RetryConfigSchema.parse(config)).not.toThrow();
  });
  
  it('should use default values', () => {
    const config = {};
    
    const parsed = RetryConfigSchema.parse(config);
    expect(parsed.strategy).toBe('exponential_backoff');
    expect(parsed.maxAttempts).toBe(3);
    expect(parsed.initialDelayMs).toBe(1000);
    expect(parsed.maxDelayMs).toBe(60000);
    expect(parsed.backoffMultiplier).toBe(2);
    expect(parsed.retryableStatusCodes).toEqual([408, 429, 500, 502, 503, 504]);
    expect(parsed.retryOnNetworkError).toBe(true);
    expect(parsed.jitter).toBe(true);
  });
  
  it('should validate max attempts range', () => {
    expect(() => RetryConfigSchema.parse({ maxAttempts: -1 })).toThrow();
    expect(() => RetryConfigSchema.parse({ maxAttempts: 11 })).toThrow();
    expect(() => RetryConfigSchema.parse({ maxAttempts: 5 })).not.toThrow();
  });
});

// ============================================================================
// Base Connector Tests
// ============================================================================

describe('ConnectorSchema', () => {
  it('should accept valid minimal connector', () => {
    const connector: Connector = {
      name: 'test_connector',
      label: 'Test Connector',
      type: 'api',
      authentication: {
        type: 'api-key',
        key: 'test-key',
      },
      status: 'inactive',
      enabled: true,
    };
    
    expect(() => ConnectorSchema.parse(connector)).not.toThrow();
  });
  
  it('should validate connector name format (snake_case)', () => {
    expect(() => ConnectorSchema.parse({
      name: 'valid_connector_name',
      label: 'Test',
      type: 'saas',
      authentication: { type: 'none' },
    })).not.toThrow();
    
    expect(() => ConnectorSchema.parse({
      name: 'InvalidConnector',
      label: 'Test',
      type: 'saas',
      authentication: { type: 'none' },
    })).toThrow();
  });
  
  it('should accept connector with all fields', () => {
    const connector = {
      name: 'full_connector',
      label: 'Full Connector',
      type: 'saas',
      description: 'A comprehensive connector',
      icon: 'cloud',
      authentication: {
        type: 'oauth2' as const,
        clientId: 'client',
        clientSecret: 'secret',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
      },
      syncConfig: {
        strategy: 'incremental',
        direction: 'bidirectional',
      },
      fieldMappings: [
        {
          source: 'id',
          target: 'external_id',
        },
      ],
      webhooks: [
        {
          name: 'connector_webhook',
          url: 'https://api.example.com/webhook',
          events: ['record.created'],
        },
      ],
      rateLimitConfig: {
        maxRequests: 100,
        windowSeconds: 60,
      },
      retryConfig: {
        maxAttempts: 3,
      },
      status: 'active',
      enabled: true,
      metadata: {
        version: '1.0',
      },
    };
    
    const parsed = ConnectorSchema.parse(connector);
    expect(parsed.description).toBe('A comprehensive connector');
    expect(parsed.fieldMappings).toHaveLength(1);
    expect(parsed.webhooks).toHaveLength(1);
    expect(parsed.metadata?.version).toBe('1.0');
  });
});

// ============================================================================
// Error Mapping Configuration Tests
// ============================================================================

describe('ErrorMappingConfigSchema', () => {
  it('should accept valid error mapping config', () => {
    const config = ErrorMappingConfigSchema.parse({
      rules: [
        {
          sourceCode: 404,
          targetCode: 'RESOURCE_NOT_FOUND',
          targetCategory: 'not_found',
          severity: 'low',
          retryable: false,
        },
      ],
      unmappedBehavior: 'generic_error',
    });

    expect(config.rules).toHaveLength(1);
    expect(config.defaultCategory).toBe('integration_error');
    expect(config.logUnmapped).toBe(true);
  });

  it('should accept rules with string source codes', () => {
    const config = ErrorMappingConfigSchema.parse({
      rules: [
        {
          sourceCode: 'INVALID_TOKEN',
          sourceMessage: 'Token has expired',
          targetCode: 'AUTH_EXPIRED',
          targetCategory: 'authorization',
          severity: 'high',
          retryable: true,
          userMessage: 'Your session has expired. Please log in again.',
        },
      ],
      unmappedBehavior: 'passthrough',
    });

    expect(config.rules[0].sourceCode).toBe('INVALID_TOKEN');
    expect(config.rules[0].userMessage).toBeDefined();
  });

  it('should accept all unmapped behaviors', () => {
    const behaviors = ['passthrough', 'generic_error', 'throw'] as const;
    behaviors.forEach(behavior => {
      const config = ErrorMappingConfigSchema.parse({
        rules: [],
        unmappedBehavior: behavior,
      });
      expect(config.unmappedBehavior).toBe(behavior);
    });
  });

  it('should accept all error categories', () => {
    const categories = ['validation', 'authorization', 'not_found', 'conflict', 'rate_limit', 'timeout', 'server_error', 'integration_error'] as const;
    categories.forEach(cat => {
      expect(() => ConnectorErrorCategorySchema.parse(cat)).not.toThrow();
    });
  });

  it('should accept all severity levels', () => {
    const severities = ['low', 'medium', 'high', 'critical'] as const;
    severities.forEach(severity => {
      const rule = ErrorMappingRuleSchema.parse({
        sourceCode: 500,
        targetCode: 'ERROR',
        targetCategory: 'server_error',
        severity,
        retryable: false,
      });
      expect(rule.severity).toBe(severity);
    });
  });
});

// ============================================================================
// Health Check Configuration Tests
// ============================================================================

describe('HealthCheckConfigSchema', () => {
  it('should accept minimal health check config', () => {
    const config = HealthCheckConfigSchema.parse({
      enabled: true,
    });

    expect(config.enabled).toBe(true);
    expect(config.intervalMs).toBe(60000);
    expect(config.timeoutMs).toBe(5000);
    expect(config.expectedStatus).toBe(200);
    expect(config.unhealthyThreshold).toBe(3);
    expect(config.healthyThreshold).toBe(1);
  });

  it('should accept full health check config', () => {
    const config = HealthCheckConfigSchema.parse({
      enabled: true,
      intervalMs: 30000,
      timeoutMs: 10000,
      endpoint: '/health',
      method: 'HEAD',
      expectedStatus: 204,
      unhealthyThreshold: 5,
      healthyThreshold: 2,
    });

    expect(config.endpoint).toBe('/health');
    expect(config.method).toBe('HEAD');
    expect(config.expectedStatus).toBe(204);
  });

  it('should accept all HTTP methods for health check', () => {
    const methods = ['GET', 'HEAD', 'OPTIONS'] as const;
    methods.forEach(method => {
      const config = HealthCheckConfigSchema.parse({ enabled: true, method });
      expect(config.method).toBe(method);
    });
  });
});

// ============================================================================
// Circuit Breaker Configuration Tests
// ============================================================================

describe('CircuitBreakerConfigSchema', () => {
  it('should accept minimal circuit breaker config', () => {
    const config = CircuitBreakerConfigSchema.parse({
      enabled: true,
    });

    expect(config.enabled).toBe(true);
    expect(config.failureThreshold).toBe(5);
    expect(config.resetTimeoutMs).toBe(30000);
    expect(config.halfOpenMaxRequests).toBe(1);
    expect(config.monitoringWindow).toBe(60000);
  });

  it('should accept full circuit breaker config', () => {
    const config = CircuitBreakerConfigSchema.parse({
      enabled: true,
      failureThreshold: 10,
      resetTimeoutMs: 60000,
      halfOpenMaxRequests: 3,
      monitoringWindow: 120000,
      fallbackStrategy: 'cache',
    });

    expect(config.failureThreshold).toBe(10);
    expect(config.fallbackStrategy).toBe('cache');
  });

  it('should accept all fallback strategies', () => {
    const strategies = ['cache', 'default_value', 'error', 'queue'] as const;
    strategies.forEach(strategy => {
      const config = CircuitBreakerConfigSchema.parse({
        enabled: true,
        fallbackStrategy: strategy,
      });
      expect(config.fallbackStrategy).toBe(strategy);
    });
  });
});

// ============================================================================
// Connector Health Configuration Tests
// ============================================================================

describe('ConnectorHealthSchema', () => {
  it('should accept empty health config', () => {
    const health = ConnectorHealthSchema.parse({});

    expect(health.healthCheck).toBeUndefined();
    expect(health.circuitBreaker).toBeUndefined();
  });

  it('should accept combined health check and circuit breaker', () => {
    const health = ConnectorHealthSchema.parse({
      healthCheck: {
        enabled: true,
        intervalMs: 30000,
        endpoint: '/ping',
      },
      circuitBreaker: {
        enabled: true,
        failureThreshold: 3,
        fallbackStrategy: 'queue',
      },
    });

    expect(health.healthCheck?.enabled).toBe(true);
    expect(health.circuitBreaker?.fallbackStrategy).toBe('queue');
  });

  it('should accept connector with health config', () => {
    const connector = ConnectorSchema.parse({
      name: 'resilient_connector',
      label: 'Resilient Connector',
      type: 'api',
      authentication: { type: 'none' },
      health: {
        healthCheck: { enabled: true },
        circuitBreaker: { enabled: true, failureThreshold: 5 },
      },
    });

    expect(connector.health?.healthCheck?.enabled).toBe(true);
    expect(connector.health?.circuitBreaker?.failureThreshold).toBe(5);
  });

  it('should accept connector with error mapping', () => {
    const connector = ConnectorSchema.parse({
      name: 'mapped_connector',
      label: 'Mapped Connector',
      type: 'saas',
      authentication: { type: 'api-key', key: 'test' },
      errorMapping: {
        rules: [
          {
            sourceCode: 429,
            targetCode: 'RATE_LIMITED',
            targetCategory: 'rate_limit',
            severity: 'medium',
            retryable: true,
          },
        ],
        unmappedBehavior: 'generic_error',
      },
    });

    expect(connector.errorMapping?.rules).toHaveLength(1);
  });
});
