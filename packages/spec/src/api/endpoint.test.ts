import { describe, it, expect } from 'vitest';
// `z` is used in a type position below (`z.infer<typeof HttpMethod>`) and was
// never imported — TS2503, invisible to vitest because esbuild strips type
// annotations without resolving them (#5286).
import type { z } from 'zod';
import {
  ApiEndpointSchema,
  ApiMappingSchema,
  ApiEndpoint,
} from './endpoint.zod';
import type { ApiEndpointParsed } from './endpoint.zod';
import { RateLimitConfigSchema } from '../shared/http.zod';
import { HttpMethod } from './router.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

describe('HttpMethod', () => {
  it('should accept valid HTTP methods', () => {
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

    validMethods.forEach(method => {
      expect(() => HttpMethod.parse(method)).not.toThrow();
    });
  });

  it('should reject invalid HTTP methods', () => {
    expect(() => HttpMethod.parse('TRACE')).toThrow();
    expect(() => HttpMethod.parse('CONNECT')).toThrow();
    expect(() => HttpMethod.parse('get')).toThrow();
  });
});

describe('RateLimitConfigSchema', () => {
  it('should accept valid rate limit', () => {
    const rateLimit = RateLimitConfigSchema.parse({});

    expect(rateLimit.enabled).toBe(false);
    expect(rateLimit.windowMs).toBe(60000);
    expect(rateLimit.maxRequests).toBe(100);
  });

  it('should accept custom rate limit', () => {
    const rateLimit = RateLimitConfigSchema.parse({
      enabled: true,
      windowMs: 3600000,
      maxRequests: 1000,
    });

    expect(rateLimit.enabled).toBe(true);
    expect(rateLimit.windowMs).toBe(3600000);
    expect(rateLimit.maxRequests).toBe(1000);
  });

  it('should accept enabled rate limit', () => {
    const rateLimit = RateLimitConfigSchema.parse({
      enabled: true,
    });

    expect(rateLimit.enabled).toBe(true);
  });
});

describe('ApiMappingSchema', () => {
  it('should accept valid minimal mapping', () => {
    const mapping = ApiMappingSchema.parse({
      source: 'firstName',
      target: 'first_name',
    });

    expect(mapping.source).toBe('firstName');
    expect(mapping.target).toBe('first_name');
  });

  it('should accept mapping with transform', () => {
    const mapping = ApiMappingSchema.parse({
      source: 'price',
      target: 'amount',
      transform: 'convertToInt',
    });

    expect(mapping.transform).toBe('convertToInt');
  });

  it('should accept nested path mapping', () => {
    const mapping = ApiMappingSchema.parse({
      source: 'user.profile.email',
      target: 'contact.email',
    });

    expect(mapping.source).toBe('user.profile.email');
  });
});

describe('ApiEndpointSchema', () => {
  it('should accept valid minimal endpoint', () => {
    const endpoint = ApiEndpointSchema.parse({
      name: 'get_customers',
      path: '/api/v1/customers',
      method: 'GET',
      type: 'object_operation',
      target: 'customer',
    });

    expect(endpoint.name).toBe('get_customers');
  });

  it('should validate endpoint name format (snake_case)', () => {
    expect(() => ApiEndpointSchema.parse({
      name: 'valid_endpoint_name',
      path: '/api/test',
      method: 'GET',
      type: 'flow',
      target: 'flow_id',
    })).not.toThrow();

    expect(() => ApiEndpointSchema.parse({
      name: 'InvalidEndpoint',
      path: '/api/test',
      method: 'GET',
      type: 'flow',
      target: 'flow_id',
    })).toThrow();

    expect(() => ApiEndpointSchema.parse({
      name: 'invalid-endpoint',
      path: '/api/test',
      method: 'GET',
      type: 'flow',
      target: 'flow_id',
    })).toThrow();
  });

  it('should validate path format (must start with /)', () => {
    expect(() => ApiEndpointSchema.parse({
      name: 'test_endpoint',
      path: '/api/test',
      method: 'GET',
      type: 'flow',
      target: 'flow_id',
    })).not.toThrow();

    expect(() => ApiEndpointSchema.parse({
      name: 'test_endpoint',
      path: 'api/test',
      method: 'GET',
      type: 'flow',
      target: 'flow_id',
    })).toThrow();
  });

  it('should apply default authRequired', () => {
    const endpoint = ApiEndpointSchema.parse({
      name: 'test_endpoint',
      path: '/api/test',
      method: 'GET',
      type: 'flow',
      target: 'flow_id',
    });

    expect(endpoint.authRequired).toBe(true);
  });

  it('should accept endpoint with all fields', () => {
    const endpoint = ApiEndpointSchema.parse({
      name: 'create_order',
      path: '/api/v1/orders',
      method: 'POST',
      summary: 'Create a new order',
      description: 'Creates a new order in the system',
      type: 'flow',
      target: 'order_creation_flow',
      inputMapping: [
        { source: 'customer_id', target: 'customerId' },
        { source: 'items', target: 'orderItems' },
      ],
      outputMapping: [
        { source: 'order_id', target: 'id' },
        { source: 'order_number', target: 'orderNumber' },
      ],
      authRequired: true,
      rateLimit: {
        enabled: true,
        windowMs: 60000,
        maxRequests: 10,
      },
      cacheTtl: 300,
    });

    expect(endpoint.summary).toBe('Create a new order');
    expect(endpoint.inputMapping).toHaveLength(2);
    expect(endpoint.rateLimit?.enabled).toBe(true);
    expect(endpoint.cacheTtl).toBe(300);
  });

  it('should accept different HTTP methods', () => {
    const methods: Array<z.infer<typeof HttpMethod>> = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

    methods.forEach(method => {
      const endpoint = ApiEndpointSchema.parse({
        name: 'test_endpoint',
        path: '/api/test',
        method,
        type: 'flow',
        target: 'flow_id',
      });
      expect(endpoint.method).toBe(method);
    });
  });

  it('should accept different implementation types', () => {
    const types: Array<'flow' | 'script' | 'object_operation' | 'proxy'> = ['flow', 'script', 'object_operation', 'proxy'];

    types.forEach(type => {
      const endpoint = ApiEndpointSchema.parse({
        name: 'test_endpoint',
        path: '/api/test',
        method: 'GET',
        type,
        target: 'target_id',
      });
      expect(endpoint.type).toBe(type);
    });
  });

  it('should accept flow-based endpoint', () => {
    const endpoint = ApiEndpointSchema.parse({
      name: 'run_approval_flow',
      path: '/api/v1/approve',
      method: 'POST',
      type: 'flow',
      target: 'approval_flow_id',
    });

    expect(endpoint.type).toBe('flow');
  });

  it('should accept script-based endpoint', () => {
    const endpoint = ApiEndpointSchema.parse({
      name: 'calculate_tax',
      path: '/api/v1/tax',
      method: 'POST',
      type: 'script',
      target: 'tax_calculator_script',
    });

    expect(endpoint.type).toBe('script');
  });

  it('should accept object operation endpoint', () => {
    const endpoint = ApiEndpointSchema.parse({
      name: 'get_accounts',
      path: '/api/v1/accounts',
      method: 'GET',
      type: 'object_operation',
      target: 'account',
      objectParams: {
        object: 'account',
        operation: 'find',
      },
    });

    expect(endpoint.type).toBe('object_operation');
    expect(endpoint.objectParams?.operation).toBe('find');
  });

  it('should accept different object operations', () => {
    const operations: Array<'find' | 'get' | 'create' | 'update' | 'delete'> = ['find', 'get', 'create', 'update', 'delete'];

    operations.forEach(operation => {
      const endpoint = ApiEndpointSchema.parse({
        name: 'test_endpoint',
        path: '/api/test',
        method: 'POST',
        type: 'object_operation',
        target: 'object_name',
        objectParams: {
          object: 'test_object',
          operation,
        },
      });
      expect(endpoint.objectParams?.operation).toBe(operation);
    });
  });

  it('should accept proxy endpoint', () => {
    const endpoint = ApiEndpointSchema.parse({
      name: 'external_api_proxy',
      path: '/api/v1/proxy/external',
      method: 'GET',
      type: 'proxy',
      target: 'https://external-api.example.com/endpoint',
    });

    expect(endpoint.type).toBe('proxy');
  });

  it('should accept endpoint with input/output mapping', () => {
    const endpoint = ApiEndpointSchema.parse({
      name: 'transform_data',
      path: '/api/v1/transform',
      method: 'POST',
      type: 'flow',
      target: 'transform_flow',
      inputMapping: [
        { source: 'firstName', target: 'first_name' },
        { source: 'lastName', target: 'last_name' },
        { source: 'email', target: 'email_address', transform: 'toLowerCase' },
      ],
      outputMapping: [
        { source: 'user_id', target: 'id' },
        { source: 'created_at', target: 'createdAt' },
      ],
    });

    expect(endpoint.inputMapping).toHaveLength(3);
    expect(endpoint.outputMapping).toHaveLength(2);
  });

  it('should accept endpoint with rate limiting', () => {
    const endpoint = ApiEndpointSchema.parse({
      name: 'limited_endpoint',
      path: '/api/v1/limited',
      method: 'POST',
      type: 'flow',
      target: 'flow_id',
      rateLimit: {
        enabled: true,
        windowMs: 3600000,
        maxRequests: 100,
      },
    });

    expect(endpoint.rateLimit?.enabled).toBe(true);
    expect(endpoint.rateLimit?.maxRequests).toBe(100);
  });

  it('should accept endpoint with caching', () => {
    const endpoint = ApiEndpointSchema.parse({
      name: 'cached_endpoint',
      path: '/api/v1/cached',
      method: 'GET',
      type: 'object_operation',
      target: 'data',
      cacheTtl: 600,
    });

    expect(endpoint.cacheTtl).toBe(600);
  });

  it('should accept public endpoint (no auth required)', () => {
    const endpoint = ApiEndpointSchema.parse({
      name: 'public_endpoint',
      path: '/api/v1/public',
      method: 'GET',
      type: 'flow',
      target: 'public_flow',
      authRequired: false,
    });

    expect(endpoint.authRequired).toBe(false);
  });

  it('should accept endpoint with documentation', () => {
    const endpoint = ApiEndpointSchema.parse({
      name: 'documented_endpoint',
      path: '/api/v1/documented',
      method: 'POST',
      summary: 'Create a resource',
      description: 'This endpoint creates a new resource with the provided data',
      type: 'object_operation',
      target: 'resource',
    });

    expect(endpoint.summary).toBe('Create a resource');
    expect(endpoint.description).toBeDefined();
  });

  it('should accept CRUD endpoints', () => {
    const endpoints = [
      { method: 'GET' as const, path: '/api/v1/users', operation: 'find' as const },
      { method: 'GET' as const, path: '/api/v1/users/:id', operation: 'get' as const },
      { method: 'POST' as const, path: '/api/v1/users', operation: 'create' as const },
      { method: 'PUT' as const, path: '/api/v1/users/:id', operation: 'update' as const },
      { method: 'DELETE' as const, path: '/api/v1/users/:id', operation: 'delete' as const },
    ];

    endpoints.forEach(({ method, path, operation }) => {
      const endpoint = ApiEndpointSchema.parse({
        name: `${operation}_user`,
        path,
        method,
        type: 'object_operation',
        target: 'user',
        objectParams: {
          object: 'user',
          operation,
        },
      });
      expect(endpoint.method).toBe(method);
      expect(endpoint.objectParams?.operation).toBe(operation);
    });
  });

  it('should use ApiEndpoint factory', () => {
    const config = ApiEndpoint.create({
      name: 'factory_endpoint',
      path: '/api/test',
      method: 'GET',
      type: 'flow',
      target: 'flow_id',
    });

    expect(config.name).toBe('factory_endpoint');
  });

  it('should reject endpoint without required fields', () => {
    expect(() => ApiEndpointSchema.parse({
      path: '/api/test',
      method: 'GET',
      type: 'flow',
      target: 'flow_id',
    })).toThrow();

    expect(() => ApiEndpointSchema.parse({
      name: 'test_endpoint',
      method: 'GET',
      type: 'flow',
      target: 'flow_id',
    })).toThrow();

    expect(() => ApiEndpointSchema.parse({
      name: 'test_endpoint',
      path: '/api/test',
      type: 'flow',
      target: 'flow_id',
    })).toThrow();
  });

  it('should reject invalid implementation type', () => {
    expect(() => ApiEndpointSchema.parse({
      name: 'test_endpoint',
      path: '/api/test',
      method: 'GET',
      type: 'invalid_type',
      target: 'target',
    })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// #5384 — the shape is CLOSED. #5227 — the author state is expressible.
// ---------------------------------------------------------------------------

/**
 * A minimal endpoint that satisfies every required key and nothing else.
 *
 * Deliberately omits `authRequired`: that omission is the SAFE shape the
 * protocol upgrade guide prescribes (`declarative-apis-endpoints-live`), and
 * #5227 was filed because it used to be inexpressible in TypeScript.
 */
const AUTHORED_ENDPOINT = {
  name: 'probe_endpoint',
  path: '/api/v1/apps/probe/things',
  method: 'GET',
  type: 'object_operation',
  target: 'probe_thing',
} as const;

/**
 * Every `unrecognized_keys` issue naming `key`, as the author meets it.
 *
 * `ApiEndpointSchema.safeParse` speaks in zod ISSUES, not in an ADR-0112
 * `{ code, status }` envelope — that envelope appears further out, where the
 * `PUT /meta/api/:name` handler turns this verdict into a 422. So the named
 * issue is what a rejection test at this layer must assert. `toThrow()` alone
 * would pass on any failure at all, including the ones these cases exist to
 * tell apart (refused by NAME with a prescription vs. refused for a missing
 * required key).
 */
function unknownKeyIssues(result: ReturnType<typeof ApiEndpointSchema.safeParse>, key: string) {
  if (result.success) return [];
  return result.error.issues.filter(
    (i) => i.code === 'unrecognized_keys' && (i as { keys?: string[] }).keys?.includes(key),
  );
}

describe('#5384 — ApiEndpointSchema REJECTS undeclared keys', () => {
  it('CONTROL — the authored endpoint parses, and the omitted `authRequired` defaults to true', () => {
    // Without this the rejection cases below would also pass if the fixture
    // were simply invalid, which proves nothing about strictness.
    const ok = ApiEndpointSchema.safeParse(AUTHORED_ENDPOINT);
    expect(ok.success, 'the CONTROL endpoint must parse').toBe(true);
    expect(ok.data!.authRequired, 'the omission must still be fail-SAFE').toBe(true);
  });

  it('CONTROL — a loader-stamped ADR-0010 protection envelope still parses', () => {
    // The reason the `...MetadataProtectionFields` spread is load-bearing now:
    // undeclared, these would be REJECTED rather than dropped, and every
    // registered `api` item the artifact loader stamps would stop parsing.
    const stamped = ApiEndpointSchema.safeParse({
      ...AUTHORED_ENDPOINT,
      _packageId: 'com.acme.things',
      _provenance: 'package',
      _lock: 'no-delete',
    });
    expect(stamped.success).toBe(true);
  });

  it('refuses a plain undeclared key by name, naming the surface', () => {
    const result = ApiEndpointSchema.safeParse({ ...AUTHORED_ENDPOINT, aKeyThatIsNotDeclared: 1 });
    expect(result.success).toBe(false);
    const issues = unknownKeyIssues(result, 'aKeyThatIsNotDeclared');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('this API endpoint');
    expect(issues[0]!.message).toContain('aKeyThatIsNotDeclared');
  });

  it.each([
    // The three typos the file header names as what the strip used to cost.
    ['cacheTTL', 'cacheTtl'],
    ['objectParam', 'objectParams'],
    ['outputMappings', 'outputMapping'],
    // The policy block, where a silent strip is worst.
    ['auth', 'authRequired'],
    ['requiresAuth', 'authRequired'],
    ['rateLimiting', 'rateLimit'],
    // Routing.
    ['url', 'path'],
    ['verb', 'method'],
  ])('refuses `%s` and prescribes `%s`', (written, canonical) => {
    const result = ApiEndpointSchema.safeParse({ ...AUTHORED_ENDPOINT, [written]: 1 });
    expect(result.success, `\`${written}\` still parses`).toBe(false);
    const issues = unknownKeyIssues(result, written);
    expect(issues, `\`${written}\` was not reported by name`).toHaveLength(1);
    expect(issues[0]!.message).toContain(canonical);
  });

  it('refuses `namespace` with the ADR-0121 D2 wrong-layer prescription, not a rename', () => {
    // The endpoint's namespace segment is DERIVED from `manifest.namespace`
    // and has never been per-endpoint. Suggesting a rename here would steer the
    // author at a key this surface refuses (ledger finding 7); the guidance
    // entry suppresses the suggestion and points at the real layer instead.
    const result = ApiEndpointSchema.safeParse({ ...AUTHORED_ENDPOINT, namespace: 'acme' });
    expect(result.success).toBe(false);
    const issues = unknownKeyIssues(result, 'namespace');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('manifest.namespace');
    expect(issues[0]!.message).toContain('ADR-0121 D2');
    expect(issues[0]!.message).not.toContain('Did you mean');
  });

  it('the registered `api` metadata type rejects it too — one contract, both doors', () => {
    // The write path (`saveMetaItem` / `PUT /meta/api/:name`) parses through the
    // registry, and the CLI parses through the stack root. They agreed while the
    // shape was open (both accepted); the point of #5384 is that they now agree
    // while REJECTING. The CLI half is pinned in
    // `packages/cli/test/metadata-type-schema-gate.test.ts`, where `api` moved
    // from NOT_YET_CLOSED into GATED_AT with this change.
    const registered = getMetadataTypeSchema('api');
    expect(registered).toBeDefined();
    const result = registered!.safeParse({ ...AUTHORED_ENDPOINT, aKeyThatIsNotDeclared: 1 });
    expect(result.success).toBe(false);
    expect(
      result.error!.issues.some(
        (i) => i.code === 'unrecognized_keys' && (i as { keys?: string[] }).keys?.includes('aKeyThatIsNotDeclared'),
      ),
    ).toBe(true);
  });
});

describe('#5227 — the author state is what `ApiEndpoint` denotes', () => {
  it('omitting `authRequired` type-checks on the AUTHOR state and is the safe shape', () => {
    // The compile-time half of this file's #5227 claim. `packages/spec` type
    // checks its tests (`tsconfig.test.json`, AGENTS.md), so the annotation
    // below is a real check rather than a phantom one — it fails the build if
    // `ApiEndpoint` ever goes back to denoting the parsed state.
    const authored: ApiEndpoint = { ...AUTHORED_ENDPOINT };
    expect(ApiEndpointSchema.safeParse(authored).success).toBe(true);
  });

  it('the PARSED state still requires it — the two names denote different types', () => {
    // Control for the case above: if these were the same type, one of the two
    // assertions could not hold, and #5227 would still be open. This is the
    // exact TS2741 the issue reported, now attached to the name that should
    // carry it.
    // @ts-expect-error `authRequired` is required on the parsed state (ADR-0122).
    const parsed: ApiEndpointParsed = { ...AUTHORED_ENDPOINT };
    expect(parsed).toBeDefined();
  });
});
