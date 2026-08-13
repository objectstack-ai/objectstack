import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  // Field Mapping
  ConnectorFieldMappingSchema,
  
  // Data Sync
  DataSyncConfigSchema,
  SyncStrategySchema,
  ConnectorConflictResolutionSchema,
  
  // Webhook
  WebhookConfigSchema,
  WebhookEventSchema,
  
  // Retry (rate limiting retired in #4911 — see the pin block at the bottom)
  RetryConfigSchema,
  
  // Base Connector
  ConnectorSchema,
  ConnectorTypeSchema,
  ConnectorStatusSchema,

  // Action + its declared upstream effect (#4395)
  ConnectorActionSchema,
  ConnectorActionEffectSchema,

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
  type ConnectorFieldMapping,
  type DataSyncConfig,
  type WebhookConfig,

  // The `/meta/connector/:name` door's schema (#6245) — `ConnectorSchema` plus
  // the ADR-0097 cross-field rules. The envelope pins below drive BOTH, because
  // this is the shape the round-trip actually goes through.
  DeclarativeConnectorEntrySchema,
} from './connector.zod';

import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

// Import shared auth schemas from canonical source
import {
  ConnectorAPIKeySchema as APIKeySchema,
  ConnectorOAuth2Schema as OAuth2Schema,
  ConnectorBasicAuthSchema as BasicAuthSchema,
  ConnectorBearerAuthSchema as BearerAuthSchema,
  ConnectorNoAuthSchema as NoAuthSchema,
  ConnectorAuthConfigSchema as AuthConfigSchema,
} from '../shared/connector-auth.zod';

import {
  originFileOf,
  originMapOf,
} from '../../scripts/lib/export-origins-testkit';
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

describe('ConnectorFieldMappingSchema', () => {
  it('should accept valid field mapping', () => {
    const mapping: ConnectorFieldMapping = {
      source: 'firstName',
      target: 'first_name',
      dataType: 'string',
      syncMode: 'bidirectional',
    };
    
    expect(() => ConnectorFieldMappingSchema.parse(mapping)).not.toThrow();
  });
  
  // Was `should accept field with transformation`, asserting this exact literal
  // parsed and came back as `type: 'javascript'`. Replaced rather than
  // re-spelled: #5552 retired the key and the whole union behind it, so there is
  // no other member to move the fixture to. Its `value.toUpperCase()` is also
  // the string that got the bug filed — `ExpressionInputSchema` wrapped it as
  // `dialect: 'cel'`, where that method does not exist.
  it('[#5552] rejects a field transformation — the key and its union are retired', () => {
    const result = ConnectorFieldMappingSchema.safeParse({
      source: 'name',
      target: 'full_name',
      transform: { type: 'javascript', expression: 'value.toUpperCase()' },
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path.join('.')).toBe('transform');
    expect(result.error!.issues[0]!.message).toMatch(/removed in @objectstack\/spec 17\.0\.0/s);
  });
  
  it('should use default values', () => {
    const mapping = {
      source: 'field1',
      target: 'field_1',
    };
    
    const parsed = ConnectorFieldMappingSchema.parse(mapping);
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

  it('resolves conflicts with the CONNECTOR vocabulary, unchanged by the #4738 rename', () => {
    // `ConflictResolution` → `ConnectorConflictResolution` renamed the TS
    // export only; the authored value domain is byte-for-byte the same.
    (['source_wins', 'target_wins', 'latest_wins', 'manual'] as const).forEach((v) => {
      expect(() => ConnectorConflictResolutionSchema.parse(v)).not.toThrow();
    });
    // The retired automation-side vocabulary was disjoint precisely where it
    // mattered — these values were never part of the connector strategy:
    expect(() => ConnectorConflictResolutionSchema.parse('destination_wins')).toThrow();
    expect(() => ConnectorConflictResolutionSchema.parse('merge')).toThrow();
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

  // #4001 batch 11 closed the BASE (`automation/webhook.zod.ts`), and zod
  // carries both the strictness and the base's error map through `.extend()`.
  // That is the trap the ledger records as finding 16 — a base tightened for
  // one surface silently retightening another — so it is asserted here, on the
  // extension's own file, rather than left for someone to discover.
  it('inherits the base webhook\'s strictness through `.extend()` (#4001)', () => {
    const result = WebhookConfigSchema.safeParse({
      name: 'test_webhook', url: 'https://api.example.com/webhooks', notAKey: 1,
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
  });

  it('still accepts the two keys the extension adds', () => {
    // The base names `signatureAlgorithm` in `extraKeys` so a typo of it is
    // still suggestible on this surface, where the base has never heard of it.
    expect(WebhookConfigSchema.safeParse({
      name: 'test_webhook', url: 'https://api.example.com/webhooks',
      events: ['record.created'], signatureAlgorithm: 'hmac_sha512',
    }).success).toBe(true);
  });
});

// ============================================================================
// Retry Tests
// ============================================================================
// (`ConnectorRateLimitConfigSchema` tests lived here until #4911 retired the
// whole shape — no outbound rate-limiting engine ever existed. The retirement
// is pinned in the "[#4911]" block at the bottom of this file.)

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
// Connector Action Effect (#4395)
// ============================================================================

describe('ConnectorActionSchema.effect (#4395)', () => {
  it('declares exactly read | write — the two countable answers', () => {
    expect(ConnectorActionEffectSchema.options).toEqual(['read', 'write']);
  });

  it('is optional, and absent stays absent (the uncountable default)', () => {
    const parsed = ConnectorActionSchema.parse({ key: 'push', label: 'Push' });
    expect(parsed.effect).toBeUndefined();
    expect('effect' in parsed).toBe(false);
  });

  it('carries a declared effect through ConnectorSchema.parse, which is the ONLY producer', () => {
    // The regression this pins: `ConnectorSchema` is a non-strict `z.object`,
    // so before #4395 an authored `effect` was SILENTLY STRIPPED here. The
    // engine stores this parsed def and both the `connector_action` executor
    // and `GET /connectors` read the declaration back out of it — a descriptor
    // field alone could never have been populated by anything.
    const parsed = ConnectorSchema.parse({
      name: 'crm',
      label: 'CRM',
      type: 'saas',
      actions: [
        { key: 'push_opportunity', label: 'Push Opportunity', effect: 'write' },
        { key: 'lookup_account', label: 'Lookup Account', effect: 'read' },
        { key: 'legacy', label: 'Legacy' },
      ],
    });
    expect(parsed.actions?.map((a) => a.effect)).toEqual(['write', 'read', undefined]);
  });

  it('rejects a value outside the enum instead of coercing it', () => {
    // `writes` is the `FlowFunctionEffectSchema` (#4396) spelling — the nearest
    // wrong word an author already knows. It must fail loudly here rather than
    // parse to something the executor then counts.
    expect(ConnectorActionEffectSchema.safeParse('writes').success).toBe(false);
    expect(ConnectorActionEffectSchema.safeParse('reads').success).toBe(false);
    expect(ConnectorActionEffectSchema.safeParse('pure').success).toBe(false);
    expect(() => ConnectorActionSchema.parse({ key: 'k', label: 'L', effect: 'write ' })).toThrow();
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
      // `rateLimitConfig` was authored here until #4911 retired it.
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

// ─── [#4911] Outbound rate limiting retired — with the [#4684] pin folded in ──
//
// RUNTIME + compiler-API assertions, deliberately. #4642 established that a
// compile-time pin in `packages/spec` was a no-op until #5286: `tsconfig.json` excluded
// `**/*.test.ts` and `vitest.config.ts` never enables `typecheck`, so an
// `Assert< Equal< … > >` here was dead text until #5286. The last test below is the
// only shape in this repo that actually pins a TYPE — which is what makes it the
// load-bearing one here: `ConnectorRateLimitConfig` is a TYPE, erased before any
// runtime assertion can see it, so re-adding `export type ConnectorRateLimitConfig`
// would slip past every `in`-check.
//
// History, because it explains what these now defend. #4684 found `RateLimitConfig`
// naming TWO declarations: `./shared` limits INBOUND API traffic (`enabled` /
// `windowMs` / `maxRequests`, every key defaulted) while `./integration` claimed to
// throttle OUTBOUND connector calls (`strategy` / `maxRequests` / `windowSeconds`,
// plus upstream `X-RateLimit-*` header names). Neither schema is `.strict()`, so a
// snippet copied across parsed clean with its foreign keys silently stripped
// (ADR-0104). #4684's remedy was ADR-0112 D9a's prefix.
//
// #4911 then found the deeper defect: the outbound side had no ENGINE. The only
// token bucket in the platform is `runtime/src/security/rate-limit.ts`, and it
// serves the INBOUND dispatcher. So the connector-side shape is gone entirely
// (ADR-0049 enforce-or-remove), the key is tombstoned, and what these tests pin
// is now an ASYMMETRY that must not be "tidied up": one direction has a real
// implementation and keeps its schema, the other does not and has none. The
// tempting wrong fix — pointing `connector.rateLimitConfig` at the shared inbound
// schema — would throttle the opposite direction, so the absence assertions below
// are as load-bearing as the presence ones.
describe('[#4911] `./integration` no longer publishes an outbound rate-limit shape', () => {
  it('every retired name is absent from the entry — no alias, no re-export', async () => {
    const integrationEntry = await import('./index');

    // The retired shape and its orphaned enum. `in` (not `=== undefined`) so an
    // explicitly-`undefined` re-export would still fail.
    expect('ConnectorRateLimitConfigSchema' in integrationEntry).toBe(false);
    expect('RateLimitStrategySchema' in integrationEntry).toBe(false);
    // And the pre-#4684 bare name stays gone: re-adding it would re-open the
    // dual-source trap on top of un-retiring the shape.
    expect('RateLimitConfigSchema' in integrationEntry).toBe(false);

    // Guard against a vacuous pass — if `./index` ever stopped resolving, every
    // `in` above would be false for the wrong reason (#4642).
    expect(integrationEntry.ConnectorSchema).toBeDefined();
    expect(integrationEntry.RetryConfigSchema).toBeDefined();
  });

  it('authoring `rateLimitConfig` is rejected with the prescription, not silently stripped', async () => {
    const { ConnectorSchema: Connector } = await import('./index');

    const authored = {
      name: 'billing_api',
      label: 'Billing API',
      type: 'api',
      rateLimitConfig: { maxRequests: 100, windowSeconds: 60 },
    };

    // `ConnectorSchema` is NOT `.strict()`, so a plain delete would have parsed
    // clean and dropped the key — the exact ADR-0104 failure the tombstone exists
    // to prevent. The message must carry the fix, not just "invalid".
    expect(() => Connector.parse(authored)).toThrow(/rateLimitConfig.*removed.*Delete the key/s);
    const failed = Connector.safeParse(authored);
    expect(failed.success).toBe(false);
    // It must not point authors at the INBOUND limiter as a replacement.
    expect(JSON.stringify(failed.error)).toMatch(/wrong direction/);

    // A connector without the key is untouched: the tombstone rejects a VALUE,
    // it does not make the key required.
    const clean = Connector.parse({ name: 'billing_api', label: 'Billing API', type: 'api' });
    expect(clean).not.toHaveProperty('rateLimitConfig');
  });

  it('the same rejection reaches `connectors[]` in a stack — the real authoring path', async () => {
    const { ObjectStackSchema } = await import('../stack.zod');

    const connector = { name: 'billing_api', label: 'Billing API', type: 'api' } as const;

    // Reachability, demonstrated rather than asserted from prose: the tombstone
    // is only worth anything if it fires through `stack.connectors[]`, which is
    // the surface an author actually writes (`DeclarativeConnectorEntrySchema`
    // is `ConnectorSchema.superRefine(…)`, so it inherits the tombstone).
    const rejected = ObjectStackSchema.safeParse({
      name: 'acme',
      connectors: [{ ...connector, rateLimitConfig: { maxRequests: 1 } }],
    });
    expect(rejected.success).toBe(false);
    expect(JSON.stringify(rejected.error)).toMatch(/rateLimitConfig.*was removed/);

    // Positive control: the identical stack minus the retired key parses, so the
    // failure above is attributable to `rateLimitConfig` and nothing else.
    expect(ObjectStackSchema.safeParse({ name: 'acme', connectors: [connector] }).success)
      .toBe(true);
  });

  it('./shared keeps the INBOUND declaration untouched — a real engine backs it', async () => {
    const sharedEntry = await import('../shared/index');

    // Same object identity and same three defaulted keys as before #4684/#4911.
    // The asymmetry is the point: this one is enforced by the dispatcher's token
    // bucket, so it stays while the outbound side goes.
    expect(sharedEntry.RateLimitConfigSchema.parse({})).toEqual({
      enabled: false,
      windowMs: 60000,
      maxRequests: 100,
    });
    // It still strips outbound-shaped keys — pinned, not fixed: correct
    // behaviour for a non-strict schema, and the reason it is NOT the
    // replacement for the retired key.
    expect(sharedEntry.RateLimitConfigSchema.parse({ windowSeconds: 60, strategy: 'token_bucket' }))
      .toEqual({ enabled: false, windowMs: 60000, maxRequests: 100 });
  });

  // The load-bearing one. `RateLimitConfig` / `ConnectorRateLimitConfig` /
  // `RateLimitStrategy` are TYPES — erased before any runtime assertion can see
  // them — so every test above would stay green if `./integration` re-added
  // `export type ConnectorRateLimitConfig = z.infer<…>`, which un-retires the
  // shape for every TypeScript author while the runtime namespace looks clean.
  // This resolves each entry's exports through their alias chains to the
  // ORIGINAL declaration: the same symbol-identity measurement
  // `check:dual-source-exports` makes, but over `src/` so it runs in `pnpm test`
  // without a build.
  it('no name resolves to two declarations across ./shared and ./integration (types included)', () => {
    // The per-entry origin maps `export-origins/` records. (Each of these two
    // pins used to build its own `ts.createProgram` right here; that resolution
    // is now a build-time artifact — #4796.)
    const shared = originMapOf('./shared');
    const integration = originMapOf('./integration');
    // Guard: an entry that resolved to nothing would make every assertion below
    // pass vacuously — the exact way a gate goes dormant (#4642).
    for (const [sub, origins] of [['./shared', shared], ['./integration', integration]] as const) {
      expect(origins.size, `${sub} must export something`).toBeGreaterThan(20);
    }


    // The names this issue is about. TYPE-level absence of the retired shape —
    // the assertion the runtime `in`-checks above structurally cannot make.
    expect(integration.get('ConnectorRateLimitConfig')).toBeUndefined();
    expect(integration.get('ConnectorRateLimitConfigSchema')).toBeUndefined();
    expect(integration.get('RateLimitStrategy')).toBeUndefined();
    expect(integration.get('RateLimitStrategySchema')).toBeUndefined();
    // …and the pre-#4684 bare names stay off this entry too.
    expect(integration.get('RateLimitConfig')).toBeUndefined();
    expect(integration.get('RateLimitConfigSchema')).toBeUndefined();
    // Positive control for the four `toBeUndefined()`s above: a live neighbour
    // in the same file must still resolve, or they would pass vacuously.
    expect(originFileOf('./integration', 'RetryConfigSchema')).toBe('src/integration/connector.zod.ts');
    expect(originFileOf('./shared', 'RateLimitConfig')).toBe('src/shared/http.zod.ts');
    expect(originFileOf('./shared', 'RateLimitConfigSchema')).toBe('src/shared/http.zod.ts');

    // And the general invariant for this pair of entries: any name they BOTH
    // export must resolve to one and the same declaration. The list stayed
    // explicit rather than being written as a blanket "no shared names" that
    // never held — so that a NEW offender fails here instead of hiding inside a
    // permanently-red assertion. #4535 C12 (#4703) cleared its last two
    // entries (`FieldMapping` / `FieldMappingSchema`), so it is now empty and
    // the invariant has finally graduated to the blanket form it always wanted
    // to be. **Do not "fix" a failure here by adding a name back to this list**
    // — that is the dual-source trap re-opening.
    const KNOWN_STILL_DUAL_SOURCE: string[] = [];
    const conflicts = [...shared.keys()]
      .filter((name) => integration.has(name) && integration.get(name) !== shared.get(name))
      .sort();
    expect(conflicts).toEqual(KNOWN_STILL_DUAL_SOURCE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #4535 C12 / #4703 — `FieldMapping` named THREE declarations
// ─────────────────────────────────────────────────────────────────────────────
//
// Same defect class as #4684 above, one entry worse: `FieldMapping` /
// `FieldMappingSchema` resolved to a different declaration on EACH of
// `./shared`, `./integration` and `./data`.
//
//   ./shared       — the base. plain `z.object`, 4 keys.
//   ./integration  — `Base.extend({ dataType, required, syncMode })`, 7 keys.
//                    A superset, and a connector's remote-field mapping.
//   ./data         — an INDEPENDENT `strictObject`, 4 keys, and a different
//                    CONCEPT: the column mapping of a CSV/table import.
//
// The first two are base-and-superset, so "converge them" is a tempting read.
// It is wrong in both directions: widening the base to 7 keys pushed connector
// sync semantics onto every other extender of the base
// (`data/external-lookup.zod.ts` extended it until its #8075 retirement;
// `automation/sync.zod.ts` embedded it too until its retirement in #4738), and
// narrowing the connector side to 4 is a retirement of
// three live keys, not a naming fix. ADR-0112 D9a's prefix remedy applies, and
// the file next door already demonstrated it: `data/ExternalFieldMappingSchema`
// extended the same base and, purely because it carried a prefix, never entered
// the dual-source baseline at all.
//
// The `./data` side is not a spelling variant of anything. The tests below pin
// the three incompatibilities, because they are the ARGUMENT for the rename and
// the thing a future "let's just unify these" has to defeat.
describe('[#4703] FieldMapping no longer names three declarations', () => {
  it('each entry exposes exactly one field-mapping name, and not the others’', async () => {
    const integrationEntry = await import('./index');
    const dataEntry = await import('../data/index');
    const sharedEntry = await import('../shared/index');

    expect(integrationEntry.ConnectorFieldMappingSchema).toBeDefined();
    expect(dataEntry.ImportFieldMappingSchema).toBeDefined();
    // The base keeps the bare name — it is the incumbent, and two other defs
    // extend it.
    expect(sharedEntry.FieldMappingSchema).toBeDefined();

    // No compatibility alias on either renamed side. Re-exporting the old name
    // would be a third declaration of it and would re-open the trap.
    expect('FieldMappingSchema' in integrationEntry).toBe(false);
    expect('FieldMappingSchema' in dataEntry).toBe(false);
    expect('ConnectorFieldMappingSchema' in dataEntry).toBe(false);
    expect('ImportFieldMappingSchema' in integrationEntry).toBe(false);
  });

  it('./shared keeps the base declaration byte-for-byte', async () => {
    const sharedEntry = await import('../shared/index');
    const integrationEntry = await import('./index');

    // Three live keys since #5552 retired `transform`: `source`/`target`
    // required, `defaultValue` optional.
    expect(
      sharedEntry.FieldMappingSchema.parse({
        source: 'FirstName',
        target: 'first_name',
        defaultValue: '',
      }),
    ).toEqual({
      source: 'FirstName',
      target: 'first_name',
      defaultValue: '',
    });

    // And it is a DIFFERENT object from the connector superset that extends it
    // — `.extend()` builds a new schema, which is why both were in the baseline.
    expect(integrationEntry.ConnectorFieldMappingSchema).not.toBe(
      sharedEntry.FieldMappingSchema,
    );
  });

  // ── Difference 1: `transform` is the same key name meaning opposite things.
  //    Until #5552 that read "a discriminated union on two sides and a flat
  //    enum on the third", and the object/enum forms were mutually unparseable.
  //    The retirement did not soften the difference, it sharpened it: on
  //    shared/integration the key is now RETIRED — the union it named had no
  //    executor on any of the five members — while on ./data it is the live,
  //    enforced import pipeline. So the same word is now "gone, with a
  //    prescription" versus "runs on every imported row", which is the loudest
  //    the distinction has ever been, and the reason a snippet copied across
  //    these domains can no longer half-work.
  it('`transform` is retired on shared/integration and live on ./data', async () => {
    const dataEntry = await import('../data/index');
    const sharedEntry = await import('../shared/index');
    const integrationEntry = await import('./index');

    const unionForm = { type: 'cast' as const, targetType: 'string' as const };

    // shared / integration: the object form is refused BY NAME, with the #5552
    // prescription — not stripped, and not a generic "unrecognized key".
    for (const schema of [
      sharedEntry.FieldMappingSchema,
      integrationEntry.ConnectorFieldMappingSchema,
    ]) {
      const result = schema.safeParse({ source: 'a', target: 'b', transform: unionForm });
      expect(result.success).toBe(false);
      expect(result.error!.issues.some((i) => /#5552/.test(i.message))).toBe(true);
    }
    // The enum form does not get in either — retired is retired, whatever the
    // value's shape.
    expect(
      sharedEntry.FieldMappingSchema.safeParse({ source: 'a', target: 'b', transform: 'join' })
        .success,
    ).toBe(false);

    // data: untouched by #5552 — a bare enum steering a flat `params` bag,
    // defaulting to 'none', and still rejecting the union form.
    expect(
      dataEntry.ImportFieldMappingSchema.parse({ source: 'a', target: 'b' }).transform,
    ).toBe('none');
    expect(
      dataEntry.ImportFieldMappingSchema.parse({
        source: 'a',
        target: 'b',
        transform: 'join',
        params: { separator: ' ' },
      }).params?.separator,
    ).toBe(' ');
    expect(
      dataEntry.ImportFieldMappingSchema.safeParse({
        source: 'a',
        target: 'b',
        transform: unionForm,
      }).success,
    ).toBe(false);
  });

  // ── Difference 2: cardinality. An import may compose one target field from
  //    several source columns; a connector mapping is 1:1.
  it('./data accepts arrays for source/target where the other two take a single string', async () => {
    const dataEntry = await import('../data/index');
    const sharedEntry = await import('../shared/index');
    const integrationEntry = await import('./index');

    const composed = { source: ['first_name', 'last_name'], target: 'full_name' };

    expect(dataEntry.ImportFieldMappingSchema.parse({ ...composed, transform: 'join' }).source)
      .toEqual(['first_name', 'last_name']);
    expect(
      dataEntry.ImportFieldMappingSchema.parse({
        source: 'full_name',
        target: ['first_name', 'last_name'],
        transform: 'split',
      }).target,
    ).toEqual(['first_name', 'last_name']);

    expect(sharedEntry.FieldMappingSchema.safeParse(composed).success).toBe(false);
    expect(integrationEntry.ConnectorFieldMappingSchema.safeParse(composed).success).toBe(false);
  });

  // ── Difference 3: OPPOSITE failure modes for an unknown key. This is what
  //    made one shared name actively dangerous: the same typo is a hard error
  //    on one side and a silent no-op on the other (ADR-0104's silent-strip
  //    class), so a snippet moved between domains "works" and does nothing.
  it('an unknown key THROWS on ./data and is silently stripped by the other two', async () => {
    const dataEntry = await import('../data/index');
    const sharedEntry = await import('../shared/index');
    const integrationEntry = await import('./index');

    // `strictObject` (#4001) — rejects, and prescribes the canonical spelling.
    const rejected = dataEntry.ImportFieldMappingSchema.safeParse({
      source: 'a',
      target: 'b',
      sourceField: 'a', // a real alias, deliberately: the message must name it
    });
    expect(rejected.success).toBe(false);
    expect(JSON.stringify(rejected.error?.issues)).toContain('source');

    // Plain `z.object` on the other two — the foreign key vanishes and the
    // parse reports success. Pinned, not fixed: it is correct behaviour for a
    // non-strict schema. The defect was the shared NAME.
    expect(
      sharedEntry.FieldMappingSchema.parse({ source: 'a', target: 'b', syncMode: 'read_only' }),
    ).toEqual({ source: 'a', target: 'b' });
    expect(
      integrationEntry.ConnectorFieldMappingSchema.parse({
        source: 'a',
        target: 'b',
        params: { separator: ' ' }, // a `./data` key, meaningless here
      }),
    ).toEqual({ source: 'a', target: 'b', required: false, syncMode: 'bidirectional' });
  });

  // The load-bearing one, and the reason this block exists at all: `FieldMapping`
  // is a TYPE. Every runtime assertion above stays green if any entry re-adds
  // `export type FieldMapping = z.infer<…>`, which IS the defect. #4642 proved a
  // compile-time `Assert< Equal< … > >` was dead text until #5286 in this package
  // (`tsconfig.json` excluded `**/*.test.ts`, vitest never enables `typecheck`),
  // so this resolves each entry's exports through their alias chains with the
  // TypeScript compiler API — the same symbol-identity measurement
  // `check:dual-source-exports` makes against `dist`, run over `src/` so it is
  // part of `pnpm test`. Three entries means THREE pairs, all checked.
  it('no name resolves to two declarations across ./shared, ./integration and ./data (types included)', () => {
    // The per-entry origin maps `export-origins/` records. (Each of these two
    // pins used to build its own `ts.createProgram` right here; that resolution
    // is now a build-time artifact — #4796.)
    const shared = originMapOf('./shared');
    const integration = originMapOf('./integration');
    const data = originMapOf('./data');
    // Guard: an entry that resolved to nothing would make every assertion below
    // pass vacuously — the exact way a gate goes dormant (#4642).
    for (const [sub, origins] of [['./shared', shared], ['./integration', integration], ['./data', data]] as const) {
      expect(origins.size, `${sub} must export something`).toBeGreaterThan(20);
    }


    // Each renamed name resolves into its own domain's file…
    for (const name of ['ConnectorFieldMapping', 'ConnectorFieldMappingSchema']) {
      expect(originFileOf('./integration', name), name).toBe('src/integration/connector.zod.ts');
    }
    for (const name of ['ImportFieldMapping', 'ImportFieldMappingSchema']) {
      expect(originFileOf('./data', name), name).toBe('src/data/mapping.zod.ts');
    }
    // …the base keeps the bare name on `./shared` only…
    for (const name of ['FieldMapping', 'FieldMappingSchema']) {
      expect(originFileOf('./shared', name), name).toBe('src/shared/mapping.zod.ts');
      expect(integration.get(name), `${name} must be gone from ./integration`).toBeUndefined();
      expect(data.get(name), `${name} must be gone from ./data`).toBeUndefined();
    }
    // …and neither renamed name leaks onto the other domain's entry.
    expect(data.get('ConnectorFieldMappingSchema')).toBeUndefined();
    expect(integration.get('ImportFieldMappingSchema')).toBeUndefined();

    // The general invariant, now over all THREE pairs. `./data` re-exports a
    // handful of `./shared` declarations (identical origin — that is fine and
    // is what this measures), so only a name resolving to two DIFFERENT files
    // counts.
    const pairs: Array<[string, ReadonlyMap<string, string>, string, ReadonlyMap<string, string>]> = [
      ['./shared', shared, './integration', integration],
      ['./shared', shared, './data', data],
      ['./integration', integration, './data', data],
    ];
    const conflicts: string[] = [];
    for (const [leftName, left, rightName, right] of pairs) {
      for (const [name, origin] of left) {
        const other = right.get(name);
        if (other !== undefined && other !== origin) {
          conflicts.push(`${name} — ${leftName} ${origin} ≠ ${rightName} ${other}`);
        }
      }
    }
    // Empty, and it must stay empty. A failure here is a NEW dual-source name;
    // the fix is to converge or prefix it, never to allow-list it back in.
    expect(conflicts.sort()).toEqual([]);
  });
});

// ============================================================================
// ADR-0010 protection envelope — PRESERVED on round-trip, not merely tolerated
// (#6362, split out of #6245)
// ============================================================================

/**
 * The defect these pins hold shut is the QUIET half of the envelope-handling
 * pair, and it is quiet in a way that reads as success.
 *
 * Both metadata load paths call `applyProtection` on EVERY type, so a
 * package-loaded connector carries the seven `_`-prefixed envelope keys by the
 * time anything re-parses it — and since #6245 bound
 * `DeclarativeConnectorEntrySchema` to `PUT /api/v1/meta/connector/:name`,
 * something does re-parse it on every write.
 *
 * `sharing_rule` is `.strict()`, so its undeclared envelope was REJECTED: a
 * hard 422, loud, fixed in #6245. `ConnectorSchema` is a plain `z.object`, so
 * it TOLERATED the same envelope and answered `success` — then stripped every
 * key from the output. Tolerate is not preserve. Measured on `origin/main`
 * before the `...MetadataProtectionFields` spread: a stamped catalog descriptor
 * came back having lost all seven keys, with no error anywhere, so every
 * downstream reader of `extractProtection` / `resolveLockState` saw an
 * unlocked, unattributed, org-provenance item.
 *
 * ⚠️ Assert the VALUES, key by key — not `success`, and not "some `_` key
 * survived". A presence-only or parses-only assertion is green on the very
 * shape this issue is about: the unfixed schema parses that body perfectly
 * well. The whole defect lives in the output, so the output is what gets
 * asserted.
 */
const STAMPED_ENVELOPE = {
  _lock: 'no-overlay',
  _lockReason: 'Ships with the billing package.',
  _lockSource: 'artifact',
  _lockDocsUrl: 'https://docs.example.com/locked-connectors',
  _provenance: 'package',
  _packageId: 'com.acme.billing',
  _packageVersion: '1.2.3',
} as const;

/**
 * A catalog descriptor: no `provider`, so the ADR-0097 §3/§5 instance rules do
 * not fire and the entry schema judges exactly what the base schema does. That
 * keeps these pins about the envelope and nothing else.
 */
const STAMPED_CONNECTOR = {
  name: 'billing_api',
  label: 'Billing API',
  type: 'api',
  ...STAMPED_ENVELOPE,
} as const;

describe('ADR-0010 protection envelope (#6362)', () => {
  it('ConnectorSchema PRESERVES every stamped envelope key through a parse', () => {
    const parsed = ConnectorSchema.parse(STAMPED_CONNECTOR);

    // The reverse-verification target: remove `...MetadataProtectionFields`
    // from `ConnectorSchema` and this object is `{}` — every key stripped —
    // while the parse above still succeeds.
    expect({
      _lock: parsed._lock,
      _lockReason: parsed._lockReason,
      _lockSource: parsed._lockSource,
      _lockDocsUrl: parsed._lockDocsUrl,
      _provenance: parsed._provenance,
      _packageId: parsed._packageId,
      _packageVersion: parsed._packageVersion,
    }).toEqual(STAMPED_ENVELOPE);
  });

  it('the /meta write door (DeclarativeConnectorEntrySchema) preserves it too', () => {
    // #6245 bound this shape, not the base, to `PUT /meta/connector/:name`.
    // The base carrying the spread is only half an answer if the door's own
    // schema drops it, so the door is pinned separately.
    const parsed = DeclarativeConnectorEntrySchema.parse(STAMPED_CONNECTOR);
    expect(parsed._packageId).toBe('com.acme.billing');
    expect(parsed._provenance).toBe('package');
    expect(parsed._lock).toBe('no-overlay');
    expect(parsed._lockDocsUrl).toBe('https://docs.example.com/locked-connectors');
  });

  it('the schema the metadata registry resolves for `connector` preserves it', () => {
    // The registry lookup is the real entry point — a future rebinding that
    // pointed `connector` at some third shape would pass both pins above and
    // still strip the envelope in production.
    const schema = getMetadataTypeSchema('connector');
    expect(schema, 'no schema bound for `connector`').toBeDefined();

    const result = schema!.safeParse(STAMPED_CONNECTOR);
    expect(result.success).toBe(true);

    const out = result.success ? (result.data as Record<string, unknown>) : {};
    const survived = Object.keys(STAMPED_ENVELOPE).filter((k) => k in out);
    expect(survived.sort()).toEqual(Object.keys(STAMPED_ENVELOPE).sort());
  });

  it('a provider-bound instance keeps the envelope alongside the §3/§5 rules', () => {
    // The envelope must not become a casualty of the cross-field rules: an
    // instance declaration is package-loaded too, and it is the shape most
    // likely to be locked.
    const parsed = DeclarativeConnectorEntrySchema.parse({
      name: 'billing_openapi',
      label: 'Billing (OpenAPI)',
      type: 'api',
      provider: 'openapi',
      providerConfig: { spec: './billing-openapi.json' },
      auth: { type: 'bearer', credentialRef: 'BILLING_TOKEN' },
      ...STAMPED_ENVELOPE,
    });
    expect(parsed._packageId).toBe('com.acme.billing');
    expect(parsed._lockSource).toBe('artifact');
  });

  it('declaring the envelope did not open the schema to arbitrary `_` keys', () => {
    // `ConnectorSchema` is deliberately non-strict (subtypes `.extend()` it),
    // so an unknown key is stripped rather than refused. The point of this pin
    // is the converse of the ones above: the spread adds SEVEN named keys, not
    // a passthrough — an underscore key nobody declared still does not survive.
    const parsed = ConnectorSchema.parse({
      ...STAMPED_CONNECTOR,
      _notAnEnvelopeKey: 'should not survive',
    });
    expect('_notAnEnvelopeKey' in parsed).toBe(false);
    expect(parsed._packageId).toBe('com.acme.billing');
  });

  it('WebhookConfigSchema — the nested webhook — preserves it as well', () => {
    // `WebhookConfigSchema` extends `WebhookSchema`, which has carried the
    // spread since #4001 batch 11. Pinned here so the inherited behaviour
    // cannot regress silently through a future `.extend()`/`.omit()` on the
    // connector side.
    const parsed = WebhookConfigSchema.parse({
      name: 'billing_events',
      url: 'https://example.com/hooks/billing',
      ...STAMPED_ENVELOPE,
    });
    expect(parsed._packageId).toBe('com.acme.billing');
    expect(parsed._provenance).toBe('package');
  });
});
