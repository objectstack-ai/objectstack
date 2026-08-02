import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  // Field Mapping
  ConnectorFieldMappingSchema,
  
  // Data Sync
  DataSyncConfigSchema,
  SyncStrategySchema,
  ConflictResolutionSchema,
  
  // Webhook
  WebhookConfigSchema,
  WebhookEventSchema,
  
  // Rate Limiting & Retry
  ConnectorRateLimitConfigSchema,
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
  type ConnectorFieldMapping,
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
  
  it('should accept field with transformation', () => {
    const mapping = {
      source: 'name',
      target: 'full_name',
      transform: {
        type: 'javascript' as const,
        expression: 'value.toUpperCase()',
      },
    };
    
    const parsed = ConnectorFieldMappingSchema.parse(mapping);
    expect(parsed.transform?.type).toBe('javascript');
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

describe('ConnectorRateLimitConfigSchema', () => {
  it('should accept valid rate limit configuration', () => {
    const config = {
      strategy: 'token_bucket',
      maxRequests: 100,
      windowSeconds: 60,
      burstCapacity: 150,
      respectUpstreamLimits: true,
    };
    
    expect(() => ConnectorRateLimitConfigSchema.parse(config)).not.toThrow();
  });
  
  it('should use default values', () => {
    const config = {
      maxRequests: 100,
      windowSeconds: 60,
    };
    
    const parsed = ConnectorRateLimitConfigSchema.parse(config);
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

// ─── [#4684] Dual-source regression pin ──────────────────────────────
//
// RUNTIME + compiler-API assertions, deliberately. #4642 established that a
// compile-time pin in `packages/spec` is a no-op: `tsconfig.json` excludes
// `**/*.test.ts` and `vitest.config.ts` never enables `typecheck`, so an
// `Assert< Equal< … > >` here would be dead text. The third test below is the
// only shape in this repo that actually pins a TYPE.
//
// What these defend: `RateLimitConfig` naming exactly ONE declaration across
// the published entries. `./shared` limits INBOUND API traffic (`enabled` /
// `windowMs` / `maxRequests`, every key defaulted); `./integration` throttles
// OUTBOUND connector calls (`strategy` / `maxRequests` / `windowSeconds`
// required, plus the upstream `X-RateLimit-*` header names). Neither is a
// superset of the other and neither schema is `.strict()`, so before #4684 a
// snippet copied from one side to the other PARSED CLEAN with its foreign keys
// silently stripped — ADR-0104's silent-strip class, in the export surface
// rather than in stored metadata. ADR-0112 D9a's remedy applies: the
// connector-side name gets a `Connector` prefix so one name means one thing.
describe('[#4684] RateLimitConfig no longer names two declarations', () => {
  it('./integration exposes the connector shape only under its prefixed name', async () => {
    const integrationEntry = await import('./index');

    expect(integrationEntry.ConnectorRateLimitConfigSchema).toBeDefined();
    // The bare name must be gone from this entry — an alias re-export kept "for
    // compatibility" would be a THIRD declaration of the same name and would
    // re-open the trap this issue closed.
    expect('RateLimitConfigSchema' in integrationEntry).toBe(false);
  });

  it('./shared keeps the inbound declaration untouched', async () => {
    const sharedEntry = await import('../shared/index');

    // Same object identity as before the rename, same three defaulted keys.
    expect(sharedEntry.RateLimitConfigSchema.parse({})).toEqual({
      enabled: false,
      windowMs: 60000,
      maxRequests: 100,
    });
  });

  it('the two schemas remain distinct declarations that reject each other’s shape', async () => {
    const integrationEntry = await import('./index');
    const sharedEntry = await import('../shared/index');

    expect(integrationEntry.ConnectorRateLimitConfigSchema).not.toBe(
      sharedEntry.RateLimitConfigSchema,
    );

    // The outbound shape demands what the inbound shape defaults away.
    expect(integrationEntry.ConnectorRateLimitConfigSchema.safeParse({}).success).toBe(false);
    // And the inbound shape still strips outbound keys — which is exactly why
    // the two must not answer to one name. Pinned, not fixed: it is correct
    // behaviour for a non-strict schema; the defect was the shared NAME.
    expect(sharedEntry.RateLimitConfigSchema.parse({ windowSeconds: 60, strategy: 'token_bucket' }))
      .toEqual({ enabled: false, windowMs: 60000, maxRequests: 100 });
  });

  // The load-bearing one. `RateLimitConfig` / `ConnectorRateLimitConfig` are
  // TYPES — erased before any runtime assertion can see them — so every test
  // above would stay green if `./integration` re-added `export type
  // RateLimitConfig = z.infer<…>`, which is precisely the defect. This resolves
  // each entry's exports through their alias chains to the ORIGINAL
  // declaration: the same symbol-identity measurement
  // `check:dual-source-exports` makes, but over `src/` so it runs in `pnpm test`
  // without a build.
  it('no name resolves to two declarations across ./shared and ./integration (types included)', async () => {
    const ts = (await import('typescript')).default;
    const { resolve, relative, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const specDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const entries = {
      './shared': resolve(specDir, 'src/shared/index.ts'),
      './integration': resolve(specDir, 'src/integration/index.ts'),
    };
    const program = ts.createProgram(Object.values(entries), {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      noEmit: true,
    });
    const checker = program.getTypeChecker();
    const unalias = (s: import('typescript').Symbol) =>
      s.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;

    /** entry → exported name → `file:line` of the ORIGINAL declaration. */
    const originsByEntry = new Map<string, Map<string, string>>();
    for (const [sub, file] of Object.entries(entries)) {
      const sf = program.getSourceFile(file);
      const moduleSym = sf && checker.getSymbolAtLocation(sf);
      // Without this, a resolution failure would make every assertion below
      // pass vacuously — the exact way a gate goes dormant (#4642).
      expect(moduleSym, `${sub} module symbol must resolve`).toBeTruthy();

      const origins = new Map<string, string>();
      for (const exported of checker.getExportsOfModule(moduleSym!)) {
        const decl = unalias(exported).declarations?.[0];
        if (!decl) continue;
        const declFile = decl.getSourceFile();
        origins.set(
          exported.getName(),
          `${relative(specDir, declFile.fileName)}:${
            declFile.getLineAndCharacterOfPosition(decl.getStart()).line + 1
          }`,
        );
      }
      // Guard #2: an entry that resolved to nothing would also pass vacuously.
      expect(origins.size, `${sub} must export something`).toBeGreaterThan(20);
      originsByEntry.set(sub, origins);
    }

    const shared = originsByEntry.get('./shared')!;
    const integration = originsByEntry.get('./integration')!;

    // The names this issue is about: present on the right entry, absent from
    // the wrong one, and each resolving to its own file.
    expect(integration.get('ConnectorRateLimitConfig')).toMatch(
      /^src\/integration\/connector\.zod\.ts:\d+$/,
    );
    expect(integration.get('ConnectorRateLimitConfigSchema')).toMatch(
      /^src\/integration\/connector\.zod\.ts:\d+$/,
    );
    expect(integration.get('RateLimitConfig')).toBeUndefined();
    expect(integration.get('RateLimitConfigSchema')).toBeUndefined();
    expect(shared.get('RateLimitConfig')).toMatch(/^src\/shared\/http\.zod\.ts:\d+$/);
    expect(shared.get('RateLimitConfigSchema')).toMatch(/^src\/shared\/http\.zod\.ts:\d+$/);

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
// It is wrong in both directions: widening the base to 7 keys pushes connector
// sync semantics onto `automation/sync.zod.ts` and `data/external-lookup.zod.ts`
// which also extend it, and narrowing the connector side to 4 is a retirement of
// three live keys, not a naming fix. ADR-0112 D9a's prefix remedy applies, and
// the file next door already demonstrates it: `data/ExternalFieldMappingSchema`
// extends the same base and, purely because it carries a prefix, never entered
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

    // Four keys, `transform` a discriminated union, `source`/`target` required.
    expect(
      sharedEntry.FieldMappingSchema.parse({
        source: 'FirstName',
        target: 'first_name',
        transform: { type: 'cast', targetType: 'string' },
        defaultValue: '',
      }),
    ).toEqual({
      source: 'FirstName',
      target: 'first_name',
      transform: { type: 'cast', targetType: 'string' },
      defaultValue: '',
    });

    // And it is a DIFFERENT object from the connector superset that extends it
    // — `.extend()` builds a new schema, which is why both were in the baseline.
    expect(integrationEntry.ConnectorFieldMappingSchema).not.toBe(
      sharedEntry.FieldMappingSchema,
    );
  });

  // ── Difference 1: `transform` is the same key name with mutually
  //    unparseable value types. The hardest evidence that these are two
  //    concepts rather than three spellings of one.
  it('`transform` means a discriminated union on two sides and a flat enum on the third', async () => {
    const dataEntry = await import('../data/index');
    const sharedEntry = await import('../shared/index');
    const integrationEntry = await import('./index');

    const unionForm = { type: 'cast' as const, targetType: 'string' as const };

    // shared / integration: the object form parses…
    expect(
      sharedEntry.FieldMappingSchema.parse({ source: 'a', target: 'b', transform: unionForm })
        .transform,
    ).toEqual(unionForm);
    expect(
      integrationEntry.ConnectorFieldMappingSchema.parse({
        source: 'a',
        target: 'b',
        transform: unionForm,
      }).transform,
    ).toEqual(unionForm);
    // …and the enum form does NOT.
    expect(
      sharedEntry.FieldMappingSchema.safeParse({ source: 'a', target: 'b', transform: 'join' })
        .success,
    ).toBe(false);

    // data: exactly the other way round — a bare enum steering a flat `params`
    // bag, defaulting to 'none'.
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
  // compile-time `Assert< Equal< … > >` is dead text in this package
  // (`tsconfig.json` excludes `**/*.test.ts`, vitest never enables `typecheck`),
  // so this resolves each entry's exports through their alias chains with the
  // TypeScript compiler API — the same symbol-identity measurement
  // `check:dual-source-exports` makes against `dist`, run over `src/` so it is
  // part of `pnpm test`. Three entries means THREE pairs, all checked.
  it('no name resolves to two declarations across ./shared, ./integration and ./data (types included)', async () => {
    const ts = (await import('typescript')).default;
    const { resolve, relative, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const specDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const entries = {
      './shared': resolve(specDir, 'src/shared/index.ts'),
      './integration': resolve(specDir, 'src/integration/index.ts'),
      './data': resolve(specDir, 'src/data/index.ts'),
    };
    const program = ts.createProgram(Object.values(entries), {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      noEmit: true,
    });
    const checker = program.getTypeChecker();
    const unalias = (s: import('typescript').Symbol) =>
      s.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;

    /** entry → exported name → `file:line` of the ORIGINAL declaration. */
    const originsByEntry = new Map<string, Map<string, string>>();
    for (const [sub, file] of Object.entries(entries)) {
      const sf = program.getSourceFile(file);
      const moduleSym = sf && checker.getSymbolAtLocation(sf);
      // Without this, a resolution failure would make every assertion below
      // pass vacuously — the exact way a gate goes dormant (#4642).
      expect(moduleSym, `${sub} module symbol must resolve`).toBeTruthy();

      const origins = new Map<string, string>();
      for (const exported of checker.getExportsOfModule(moduleSym!)) {
        const decl = unalias(exported).declarations?.[0];
        if (!decl) continue;
        const declFile = decl.getSourceFile();
        origins.set(
          exported.getName(),
          `${relative(specDir, declFile.fileName)}:${
            declFile.getLineAndCharacterOfPosition(decl.getStart()).line + 1
          }`,
        );
      }
      // Guard #2: an entry that resolved to nothing would also pass vacuously.
      expect(origins.size, `${sub} must export something`).toBeGreaterThan(20);
      originsByEntry.set(sub, origins);
    }

    const shared = originsByEntry.get('./shared')!;
    const integration = originsByEntry.get('./integration')!;
    const data = originsByEntry.get('./data')!;

    // Each renamed name resolves into its own domain's file…
    for (const name of ['ConnectorFieldMapping', 'ConnectorFieldMappingSchema']) {
      expect(integration.get(name), name).toMatch(/^src\/integration\/connector\.zod\.ts:\d+$/);
    }
    for (const name of ['ImportFieldMapping', 'ImportFieldMappingSchema']) {
      expect(data.get(name), name).toMatch(/^src\/data\/mapping\.zod\.ts:\d+$/);
    }
    // …the base keeps the bare name on `./shared` only…
    for (const name of ['FieldMapping', 'FieldMappingSchema']) {
      expect(shared.get(name), name).toMatch(/^src\/shared\/mapping\.zod\.ts:\d+$/);
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
    const pairs: Array<[string, Map<string, string>, string, Map<string, string>]> = [
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
