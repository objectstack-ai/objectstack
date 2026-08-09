import { describe, it, expect } from 'vitest';
import {
  DiscoverySchema,
  ApiRoutesSchema,
  ServiceInfoSchema,
  ServiceStatus,
  WellKnownCapabilitiesSchema,
  WELL_KNOWN_CAPABILITY_KEYS,
  CapabilityDescriptorSchema,
  RouteHealthEntrySchema,
  RouteHealthReportSchema,
  ServiceSelfInfoSchema,
  readServiceSelfInfo,
  resolveDiscoveryEnvironment,
  SERVICE_SELF_INFO_KEY,
  type DiscoveryResponse,
  type ApiRoutes,
  type ServiceInfo,
  type WellKnownCapabilities,
  type RouteHealthEntry,
  type RouteHealthReport,
  type DiscoveryEnvironment,
} from './discovery.zod';
import { EnvironmentTypeSchema, type EnvironmentType } from '../cloud/environment.zod';

describe('ApiRoutesSchema', () => {
  it('should accept valid minimal routes', () => {
    const routes: ApiRoutes = {
      data: '/api/v1/data',
      metadata: '/api/v1/meta',
      auth: '/api/v1/auth',
    };

    expect(() => ApiRoutesSchema.parse(routes)).not.toThrow();
  });

  it('should accept routes with all fields', () => {
    const routes = ApiRoutesSchema.parse({
      data: '/api/v1/data',
      metadata: '/api/v1/meta',
      auth: '/api/v1/auth',
      actions: '/api/v1/p',
      storage: '/api/v1/storage',
      discovery: '/api/v1/discovery',
    });

    expect(routes.data).toBe('/api/v1/data');
    expect(routes.discovery).toBe('/api/v1/discovery');
  });

  it('should accept custom route paths', () => {
    const routes = ApiRoutesSchema.parse({
      data: '/data',
      metadata: '/metadata',
      auth: '/auth',
    });

    expect(routes.data).toBe('/data');
  });

  it('should accept versioned routes', () => {
    const routes = ApiRoutesSchema.parse({
      data: '/api/v2/data',
      metadata: '/api/v2/meta',
      auth: '/api/v2/auth',
    });

    expect(routes.data).toBe('/api/v2/data');
  });

  it('should reject routes without required fields', () => {
    // data is required
    expect(() => ApiRoutesSchema.parse({
      metadata: '/api/v1/meta',
      auth: '/api/v1/auth',
    })).toThrow();

    // metadata is required
    expect(() => ApiRoutesSchema.parse({
      data: '/api/v1/data',
      auth: '/api/v1/auth',
    })).toThrow();
  });

  it('should accept routes without auth (auth is plugin-provided)', () => {
    const routes = ApiRoutesSchema.parse({
      data: '/api/v1/data',
      metadata: '/api/v1/meta',
    });

    expect(routes.data).toBe('/api/v1/data');
    expect(routes.auth).toBeUndefined();
  });

  // [#6633] The two direct-mount surface keys. `packages` predates this issue;
  // `datasources` is the base for the `datasources/:name/external/*`
  // federation-admin family. Both optional: absent = not mounted (ADR-0076
  // D12), and a rebased deployment advertises its real base.
  it('accepts the direct-mount surface keys (packages / datasources), rebased or absent', () => {
    const rebased = ApiRoutesSchema.parse({
      data: '/backend/api/v9/data',
      metadata: '/backend/api/v9/meta',
      packages: '/backend/api/v9/packages',
      datasources: '/backend/api/v9/datasources',
    });
    expect(rebased.packages).toBe('/backend/api/v9/packages');
    expect(rebased.datasources).toBe('/backend/api/v9/datasources');

    const minimal = ApiRoutesSchema.parse({
      data: '/api/v1/data',
      metadata: '/api/v1/meta',
    });
    expect(minimal.packages).toBeUndefined();
    expect(minimal.datasources).toBeUndefined();
  });

  // [#6714] The email surface key — base under which `POST {email}/send` is
  // mounted. Optional: absent = not mounted (ADR-0076 D12); a rebased
  // deployment advertises its real base and the SDK follows it.
  it('accepts the email surface key, rebased or absent', () => {
    const rebased = ApiRoutesSchema.parse({
      data: '/backend/api/v9/data',
      metadata: '/backend/api/v9/meta',
      email: '/backend/api/v9/email',
    });
    expect(rebased.email).toBe('/backend/api/v9/email');

    const minimal = ApiRoutesSchema.parse({
      data: '/api/v1/data',
      metadata: '/api/v1/meta',
    });
    expect(minimal.email).toBeUndefined();
  });
});

/** Minimal services map used as base fixture for DiscoverySchema tests */
const minimalServices = {
  data: { enabled: true, status: 'available' as const, route: '/api/v1/data', provider: 'objectql' },
  metadata: { enabled: true, status: 'available' as const, route: '/api/v1/meta', provider: 'objectql' },
};

/**
 * [#5672] The minimal legal `capabilities` block: the WHOLE vocabulary, every
 * entry `enabled: false`.
 *
 * Ruling A made `capabilities` a required, closed map, so every fixture below
 * carries one — including the fixtures that exist to be REJECTED, which must
 * fail for their own planted defect rather than for a second missing key they
 * were never testing.
 *
 * Built from `WELL_KNOWN_CAPABILITY_KEYS` rather than hand-listed, so adding a
 * capability to the spec does not silently leave this file testing a stale
 * vocabulary.
 */
const allCapabilitiesOff = Object.fromEntries(
  WELL_KNOWN_CAPABILITY_KEYS.map(key => [key, { enabled: false }]),
) as DiscoveryResponse['capabilities'];

describe('DiscoverySchema', () => {
  it('should accept valid minimal discovery response', () => {
    const discovery: DiscoveryResponse = {
      name: 'ObjectStack',
      version: '1.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      capabilities: allCapabilitiesOff,
      services: minimalServices,
      locale: {
        default: 'en-US',
        supported: ['en-US', 'zh-CN'],
        timezone: 'UTC',
      },
    };

    expect(() => DiscoverySchema.parse(discovery)).not.toThrow();
  });

  it('should accept discovery with all fields', () => {
    const discovery = DiscoverySchema.parse({
      name: 'ObjectStack Platform',
      version: '2.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
        actions: '/api/v1/p',
        storage: '/api/v1/storage',
      },
      capabilities: allCapabilitiesOff,
      services: {
        ...minimalServices,
        search: { enabled: true, status: 'available' as const, route: '/api/v1/search', provider: 'plugin-search' },
      },
      locale: {
        default: 'en-US',
        supported: ['en-US', 'zh-CN', 'es-ES', 'fr-FR'],
        timezone: 'America/Los_Angeles',
      },
    });

    expect(discovery.name).toBe('ObjectStack Platform');
    expect(discovery.version).toBe('2.0.0');
  });

  it('should accept different environment values', () => {
    const environments: Array<DiscoveryResponse['environment']> = ['production', 'sandbox', 'development'];

    environments.forEach(environment => {
      const discovery = DiscoverySchema.parse({
        name: 'ObjectStack',
        version: '1.0.0',
        environment,
        routes: {
          data: '/api/v1/data',
          metadata: '/api/v1/meta',
          auth: '/api/v1/auth',
        },
        capabilities: allCapabilitiesOff,
        services: minimalServices,
        locale: {
          default: 'en-US',
          supported: ['en-US'],
          timezone: 'UTC',
        },
      });
      expect(discovery.environment).toBe(environment);
    });
  });

  it('should reject invalid environment', () => {
    expect(() => DiscoverySchema.parse({
      name: 'ObjectStack',
      version: '1.0.0',
      environment: 'staging',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      capabilities: allCapabilitiesOff,
      services: minimalServices,
      locale: {
        default: 'en-US',
        supported: ['en-US'],
        timezone: 'UTC',
      },
    })).toThrow();
  });

  it('should handle production environment', () => {
    const discovery = DiscoverySchema.parse({
      name: 'ObjectStack Production',
      version: '1.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      capabilities: allCapabilitiesOff,
      services: {
        ...minimalServices,
        search: { enabled: true, status: 'available' as const, route: '/api/v1/search', provider: 'plugin-search' },
      },
      locale: {
        default: 'en-US',
        supported: ['en-US', 'zh-CN', 'es-ES'],
        timezone: 'UTC',
      },
    });

    expect(discovery.environment).toBe('production');
  });

  it('should handle sandbox environment', () => {
    const discovery = DiscoverySchema.parse({
      name: 'ObjectStack Sandbox',
      version: '1.0.0-sandbox',
      environment: 'sandbox',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      capabilities: allCapabilitiesOff,
      services: minimalServices,
      locale: {
        default: 'en-US',
        supported: ['en-US'],
        timezone: 'UTC',
      },
    });

    expect(discovery.environment).toBe('sandbox');
  });

  it('should handle development environment', () => {
    const discovery = DiscoverySchema.parse({
      name: 'ObjectStack Dev',
      version: '0.1.0-dev',
      environment: 'development',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      capabilities: allCapabilitiesOff,
      services: minimalServices,
      locale: {
        default: 'en-US',
        supported: ['en-US'],
        timezone: 'America/Los_Angeles',
      },
    });

    expect(discovery.environment).toBe('development');
  });

  it('should handle locale configuration', () => {
    const discovery = DiscoverySchema.parse({
      name: 'ObjectStack',
      version: '1.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      capabilities: allCapabilitiesOff,
      services: minimalServices,
      locale: {
        default: 'zh-CN',
        supported: ['en-US', 'zh-CN', 'ja-JP'],
        timezone: 'Asia/Shanghai',
      },
    });

    expect(discovery.locale.default).toBe('zh-CN');
    expect(discovery.locale.supported).toHaveLength(3);
    expect(discovery.locale.timezone).toBe('Asia/Shanghai');
  });

  it('should handle timezone configuration', () => {
    const timezones = [
      'UTC',
      'America/New_York',
      'America/Los_Angeles',
      'Europe/London',
      'Asia/Tokyo',
      'Australia/Sydney',
    ];

    timezones.forEach(timezone => {
      const discovery = DiscoverySchema.parse({
        name: 'ObjectStack',
        version: '1.0.0',
        environment: 'production',
        routes: {
          data: '/api/v1/data',
          metadata: '/api/v1/meta',
          auth: '/api/v1/auth',
        },
        capabilities: allCapabilitiesOff,
        services: minimalServices,
        locale: {
          default: 'en-US',
          supported: ['en-US'],
          timezone,
        },
      });
      expect(discovery.locale.timezone).toBe(timezone);
    });
  });

  it('should handle multiple supported locales', () => {
    const discovery = DiscoverySchema.parse({
      name: 'ObjectStack',
      version: '1.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      capabilities: allCapabilitiesOff,
      services: minimalServices,
      locale: {
        default: 'en-US',
        supported: [
          'en-US',
          'en-GB',
          'zh-CN',
          'zh-TW',
          'es-ES',
          'es-MX',
          'fr-FR',
          'de-DE',
          'ja-JP',
          'ko-KR',
        ],
        timezone: 'UTC',
      },
    });

    expect(discovery.locale.supported).toHaveLength(10);
  });

  it('should reject discovery without required fields', () => {
    expect(() => DiscoverySchema.parse({
      version: '1.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      capabilities: allCapabilitiesOff,
      services: minimalServices,
      locale: {
        default: 'en-US',
        supported: ['en-US'],
        timezone: 'UTC',
      },
    })).toThrow();

    expect(() => DiscoverySchema.parse({
      name: 'ObjectStack',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      capabilities: allCapabilitiesOff,
      services: minimalServices,
      locale: {
        default: 'en-US',
        supported: ['en-US'],
        timezone: 'UTC',
      },
    })).toThrow();
  });

  it('should reject discovery without services (now required)', () => {
    expect(() => DiscoverySchema.parse({
      name: 'ObjectStack',
      version: '1.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
      },
      // Present so the ONLY defect under test is the missing `services` —
      // without it this would also throw for a missing `capabilities` (#5672)
      // and stop testing what its name says.
      capabilities: allCapabilitiesOff,
      locale: {
        default: 'en-US',
        supported: ['en-US'],
        timezone: 'UTC',
      },
    })).toThrow();
  });
});

describe('ServiceInfoSchema', () => {
  it('should accept an available service', () => {
    const info: ServiceInfo = {
      enabled: true,
      status: 'available',
      route: '/api/v1/data',
      provider: 'objectql',
    };
    expect(() => ServiceInfoSchema.parse(info)).not.toThrow();
  });

  it('should accept an unavailable service with message', () => {
    const info = ServiceInfoSchema.parse({
      enabled: false,
      status: 'unavailable',
      message: 'Install plugin-workflow to enable',
    });
    expect(info.enabled).toBe(false);
    expect(info.route).toBeUndefined();
    expect(info.message).toBe('Install plugin-workflow to enable');
  });

  it('should accept a stub service', () => {
    const info = ServiceInfoSchema.parse({
      enabled: false,
      status: 'stub',
      route: '/api/v1/automation',
      message: 'Install plugin-automation to enable',
    });
    expect(info.status).toBe('stub');
  });

  it('should accept a degraded service', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'degraded',
      provider: 'objectql',
      message: 'HTTP ETag caching only',
    });
    expect(info.status).toBe('degraded');
    expect(info.enabled).toBe(true);
  });

  it('should reject invalid status', () => {
    expect(() => ServiceInfoSchema.parse({
      enabled: true,
      status: 'unknown',
    })).toThrow();
  });
});

describe('DiscoverySchema with services', () => {
  const baseDiscovery = {
    name: 'ObjectStack',
    version: '1.0.0',
    environment: 'production' as const,
    routes: {
      data: '/api/v1/data',
      metadata: '/api/v1/meta',
      auth: '/api/v1/auth',
    },
    capabilities: allCapabilitiesOff,
    services: minimalServices,
    locale: {
      default: 'en-US',
      supported: ['en-US'],
      timezone: 'UTC',
    },
  };

  it('should accept discovery with services map', () => {
    const discovery = DiscoverySchema.parse({
      ...baseDiscovery,
      services: {
        metadata: { enabled: true, status: 'available', route: '/api/v1/meta', provider: 'objectql' },
        data: { enabled: true, status: 'available', route: '/api/v1/data', provider: 'objectql' },
        auth: { enabled: true, status: 'available', route: '/api/v1/auth' },
        workflow: { enabled: false, status: 'unavailable', message: 'Not installed' },
        analytics: { enabled: false, status: 'stub', message: 'Install plugin' },
      },
    });

    expect(discovery.services).toBeDefined();
    expect(discovery.services['metadata'].enabled).toBe(true);
    expect(discovery.services['metadata'].status).toBe('available');
    expect(discovery.services['workflow'].enabled).toBe(false);
    expect(discovery.services['analytics'].status).toBe('stub');
  });

  it('should allow clients to enumerate available vs unavailable services', () => {
    const discovery = DiscoverySchema.parse({
      ...baseDiscovery,
      services: {
        metadata: { enabled: true, status: 'available' },
        data: { enabled: true, status: 'available' },
        auth: { enabled: true, status: 'available' },
        cache: { enabled: true, status: 'degraded', message: 'ETag only' },
        workflow: { enabled: false, status: 'unavailable' },
        ai: { enabled: false, status: 'unavailable' },
      },
    });

    const available = Object.entries(discovery.services)
      .filter(([, s]) => s.enabled)
      .map(([name]) => name);
    const unavailable = Object.entries(discovery.services)
      .filter(([, s]) => !s.enabled)
      .map(([name]) => name);

    expect(available).toEqual(['metadata', 'data', 'auth', 'cache']);
    expect(unavailable).toEqual(['workflow', 'ai']);
  });

  it('should derive capabilities from services (no dedicated capabilities field needed)', () => {
    const discovery = DiscoverySchema.parse({
      ...baseDiscovery,
      services: {
        ...minimalServices,
        ai: { enabled: false, status: 'unavailable', message: 'Not installed' },
      },
    });

    // Capability can be derived from service.enabled
    expect(discovery.services['ai'].enabled).toBe(false);
  });
});

// ==========================================
// ServiceInfoSchema — version & rateLimit
// ==========================================

describe('ServiceInfoSchema (version field)', () => {
  it('should accept a service with version', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'available',
      route: '/api/v1/data',
      provider: 'objectql',
      version: '3.0.6',
    });
    expect(info.version).toBe('3.0.6');
  });

  it('should allow version to be omitted', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'available',
    });
    expect(info.version).toBeUndefined();
  });
});

describe('ServiceInfoSchema (rateLimit field)', () => {
  it('should accept a service with rateLimit', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'available',
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerHour: 1000,
        burstLimit: 10,
        retryAfterMs: 5000,
      },
    });
    expect(info.rateLimit?.requestsPerMinute).toBe(60);
    expect(info.rateLimit?.burstLimit).toBe(10);
  });

  it('should allow rateLimit to be omitted', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'available',
    });
    expect(info.rateLimit).toBeUndefined();
  });

  it('should allow partial rateLimit fields', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'available',
      rateLimit: {
        requestsPerMinute: 100,
      },
    });
    expect(info.rateLimit?.requestsPerMinute).toBe(100);
    expect(info.rateLimit?.requestsPerHour).toBeUndefined();
  });
});

// ==========================================
// DiscoverySchema — capabilities
// ==========================================

describe('DiscoverySchema (capabilities field)', () => {
  const fixture = {
    name: 'ObjectStack',
    version: '1.0.0',
    environment: 'production' as const,
    routes: { data: '/api/v1/data', metadata: '/api/v1/meta' },
    capabilities: allCapabilitiesOff,
    services: minimalServices,
    locale: { default: 'en-US', supported: ['en-US'], timezone: 'UTC' },
  };

  it('should accept discovery with capabilities', () => {
    const discovery = DiscoverySchema.parse({
      ...fixture,
      // [#5672] Spread over the full vocabulary rather than replacing it: this
      // test is about the hierarchical extras (`features`, `description`)
      // round-tripping, and a two-key literal is no longer a legal
      // `capabilities` block at all.
      capabilities: {
        ...allCapabilitiesOff,
        comments: {
          enabled: true,
          features: { threaded: true, reactions: true, mentions: true },
          description: 'Feed and comments support',
        },
        automation: {
          enabled: false,
          description: 'Flow automation engine',
        },
      },
    });
    expect(discovery.capabilities.comments.enabled).toBe(true);
    expect(discovery.capabilities.comments.features?.threaded).toBe(true);
    expect(discovery.capabilities.automation.enabled).toBe(false);
  });

  // ── [#5672] ruling A: closed vocabulary, emitted whole ─────────────────────
  //
  // These four replace the single `should allow capabilities to be omitted`
  // test, which pinned exactly the limb this issue removes. Note it would have
  // kept PASSING for the wrong reason if it had merely been re-spelled — a
  // `toBeUndefined()` on a key nothing produces is green whether the contract
  // says "optional" or "we forgot"; only asserting the rejection is evidence.

  it('REJECTS a discovery that omits capabilities entirely', () => {
    const { capabilities: _omitted, ...withoutCapabilities } = fixture;
    const result = DiscoverySchema.safeParse(withoutCapabilities);

    expect(result.success).toBe(false);
    expect(
      result.success ? [] : result.error.issues.map(i => i.path.join('.')),
    ).toContain('capabilities');
  });

  it('REJECTS a discovery that emits only part of the vocabulary', () => {
    // The exact pre-#5672 shapes: each producer's half, on its own.
    const dispatcherHalf = {
      search: { enabled: true }, websockets: { enabled: false }, files: { enabled: false },
      analytics: { enabled: false }, ai: { enabled: false }, notifications: { enabled: false },
      i18n: { enabled: false },
    };
    const protocolHalf = {
      comments: { enabled: false }, automation: { enabled: false }, cron: { enabled: false },
      search: { enabled: true }, export: { enabled: false }, chunkedUpload: { enabled: false },
      transactionalBatch: { enabled: false },
    };

    for (const half of [dispatcherHalf, protocolHalf]) {
      expect(
        DiscoverySchema.safeParse({ ...fixture, capabilities: half }).success,
        `a partial capability map must not parse: ${Object.keys(half).join(',')}`,
      ).toBe(false);
    }
  });

  it('declares exactly the WellKnownCapabilities vocabulary — one list, not two', () => {
    const declared = Object.keys((DiscoverySchema as any).shape.capabilities.shape);
    expect(new Set(declared)).toEqual(new Set(WELL_KNOWN_CAPABILITY_KEYS));
    // Anti-vacuity: the vocabulary really is the UNION of the two halves that
    // used to be disjoint, not one of them.
    expect(declared).toEqual(expect.arrayContaining(['transactionalBatch', 'websockets']));
  });

  it('every entry carries the CapabilityDescriptor shape', () => {
    const parsed = DiscoverySchema.parse(fixture);
    for (const key of WELL_KNOWN_CAPABILITY_KEYS) {
      expect(
        CapabilityDescriptorSchema.safeParse(parsed.capabilities[key]).success,
        `capabilities.${key}`,
      ).toBe(true);
    }
  });
});

// ==========================================
// DiscoverySchema — schemaDiscovery
// ==========================================

describe('DiscoverySchema (schemaDiscovery field)', () => {
  const fixture = {
    name: 'ObjectStack',
    version: '1.0.0',
    environment: 'production' as const,
    routes: { data: '/api/v1/data', metadata: '/api/v1/meta' },
    capabilities: allCapabilitiesOff,
    services: minimalServices,
    locale: { default: 'en-US', supported: ['en-US'], timezone: 'UTC' },
  };

  it('should accept discovery with schemaDiscovery', () => {
    const discovery = DiscoverySchema.parse({
      ...fixture,
      schemaDiscovery: {
        openapi: '/api/v1/openapi.json',
        jsonSchema: '/api/v1/schemas',
      },
    });
    expect(discovery.schemaDiscovery?.openapi).toBe('/api/v1/openapi.json');
    expect(discovery.schemaDiscovery?.jsonSchema).toBe('/api/v1/schemas');
  });

  it('should allow schemaDiscovery to be omitted', () => {
    const discovery = DiscoverySchema.parse(fixture);
    expect(discovery.schemaDiscovery).toBeUndefined();
  });

  it('should allow partial schemaDiscovery fields', () => {
    const discovery = DiscoverySchema.parse({
      ...fixture,
      schemaDiscovery: {
        openapi: '/api/v1/openapi.json',
      },
    });
    expect(discovery.schemaDiscovery?.openapi).toBe('/api/v1/openapi.json');
  });
});

// ==========================================
// WellKnownCapabilitiesSchema
// ==========================================

describe('WellKnownCapabilitiesSchema', () => {
  /** Every vocabulary flag set to `value` — built from the vocabulary, never listed. */
  const allFlags = (value: boolean) =>
    Object.fromEntries(WELL_KNOWN_CAPABILITY_KEYS.map(k => [k, value])) as WellKnownCapabilities;

  it('should accept all capabilities enabled', () => {
    const caps: WellKnownCapabilities = allFlags(true);
    expect(() => WellKnownCapabilitiesSchema.parse(caps)).not.toThrow();
  });

  it('should accept all capabilities disabled', () => {
    const caps = WellKnownCapabilitiesSchema.parse(allFlags(false));
    expect(caps.comments).toBe(false);
    expect(caps.chunkedUpload).toBe(false);
    expect(caps.transactionalBatch).toBe(false);
    // [#5672] The six that joined the vocabulary with ruling A.
    expect(caps.websockets).toBe(false);
    expect(caps.files).toBe(false);
    expect(caps.analytics).toBe(false);
    expect(caps.ai).toBe(false);
    expect(caps.notifications).toBe(false);
    expect(caps.i18n).toBe(false);
  });

  it('should reject missing required fields', () => {
    expect(() => WellKnownCapabilitiesSchema.parse({ comments: true })).toThrow();
    expect(() => WellKnownCapabilitiesSchema.parse({})).toThrow();
    // EVERY key is required — a payload missing exactly one must fail, so no
    // producer can silently drop a capability bit (#3298 established this for
    // `transactionalBatch`; #5672 makes it the rule for the whole vocabulary).
    for (const dropped of WELL_KNOWN_CAPABILITY_KEYS) {
      const { [dropped]: _gone, ...rest } = allFlags(true);
      expect(
        WellKnownCapabilitiesSchema.safeParse(rest).success,
        `a payload missing only \`${dropped}\` must be rejected`,
      ).toBe(false);
    }
  });

  it('should reject non-boolean values', () => {
    expect(() => WellKnownCapabilitiesSchema.parse({
      ...allFlags(true),
      comments: 'yes',
    })).toThrow();
  });

  it('should have .describe() annotations on all fields', () => {
    const shape = WellKnownCapabilitiesSchema.shape as Record<string, { description?: string }>;
    // Derived, so a new capability cannot arrive undocumented — the reference
    // docs are generated from these strings.
    const undocumented = WELL_KNOWN_CAPABILITY_KEYS.filter(k => !shape[k]?.description);
    expect(undocumented, 'vocabulary keys with no .describe()').toEqual([]);
  });

  it('[#5672] is the ONE vocabulary — WELL_KNOWN_CAPABILITY_KEYS is derived from it', () => {
    expect([...WELL_KNOWN_CAPABILITY_KEYS].sort())
      .toEqual(Object.keys(WellKnownCapabilitiesSchema.shape).sort());
    // The union of the two historically disjoint producer halves: 7 + 7 with
    // `search` shared.
    expect(WELL_KNOWN_CAPABILITY_KEYS).toHaveLength(13);
  });
});

// ==========================================
// ServiceStatus enum
// ==========================================

describe('ServiceStatus', () => {
  it('should accept all valid status values', () => {
    const values = ['available', 'registered', 'unavailable', 'degraded', 'stub'] as const;
    values.forEach(status => {
      expect(() => ServiceStatus.parse(status)).not.toThrow();
    });
  });

  it('should include "registered" for declared-but-unverified routes', () => {
    expect(ServiceStatus.parse('registered')).toBe('registered');
  });

  it('should reject invalid status values', () => {
    expect(() => ServiceStatus.parse('unknown')).toThrow();
    expect(() => ServiceStatus.parse('active')).toThrow();
  });
});

// ==========================================
// ServiceInfoSchema — handlerReady field
// ==========================================

describe('ServiceInfoSchema (handlerReady field)', () => {
  it('should default handlerReady to undefined when omitted', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'available',
    });
    expect(info.handlerReady).toBeUndefined();
  });

  it('should accept explicit handlerReady: true', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'available',
      handlerReady: true,
      route: '/api/v1/data',
    });
    expect(info.handlerReady).toBe(true);
  });

  it('should accept registered status with handlerReady false', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'registered',
      handlerReady: false,
      route: '/api/v1/ai',
      message: 'Route declared but handler not verified',
    });
    expect(info.status).toBe('registered');
    expect(info.handlerReady).toBe(false);
  });

  it('should allow clients to filter handler-ready services', () => {
    const services: Record<string, ServiceInfo> = {
      data: ServiceInfoSchema.parse({ enabled: true, status: 'available', handlerReady: true }),
      ai: ServiceInfoSchema.parse({ enabled: true, status: 'registered', handlerReady: false }),
      workflow: ServiceInfoSchema.parse({ enabled: false, status: 'unavailable', handlerReady: false }),
    };

    const ready = Object.entries(services)
      .filter(([, s]) => s.enabled && s.handlerReady)
      .map(([name]) => name);

    expect(ready).toEqual(['data']);
  });
});

// ==========================================
// RouteHealthReportSchema
// ==========================================

describe('RouteHealthEntrySchema', () => {
  it('should accept a valid entry', () => {
    const entry: RouteHealthEntry = {
      route: '/api/v1/analytics/query',
      method: 'POST',
      service: 'analytics',
      declared: true,
      handlerRegistered: true,
      healthStatus: 'pass',
    };
    expect(() => RouteHealthEntrySchema.parse(entry)).not.toThrow();
  });

  it('should accept all health status values', () => {
    const statuses = ['pass', 'fail', 'missing', 'skip'] as const;
    statuses.forEach(healthStatus => {
      expect(() => RouteHealthEntrySchema.parse({
        route: '/test',
        method: 'GET',
        service: 'test',
        declared: true,
        handlerRegistered: false,
        healthStatus,
      })).not.toThrow();
    });
  });

  it('should accept entry with diagnostic message', () => {
    const entry = RouteHealthEntrySchema.parse({
      route: '/api/v1/workflow',
      method: 'GET',
      service: 'workflow',
      declared: true,
      handlerRegistered: false,
      healthStatus: 'missing',
      message: 'No handler registered — install plugin-workflow',
    });
    expect(entry.message).toBe('No handler registered — install plugin-workflow');
  });
});

describe('RouteHealthReportSchema', () => {
  it('should accept a valid report', () => {
    const report: RouteHealthReport = {
      timestamp: '2026-04-01T00:00:00.000Z',
      adapter: 'hono',
      totalDeclared: 3,
      totalRegistered: 2,
      totalMissing: 1,
      routes: [
        { route: '/api/v1/data', method: 'GET', service: 'data', declared: true, handlerRegistered: true, healthStatus: 'pass' },
        { route: '/api/v1/meta', method: 'GET', service: 'metadata', declared: true, handlerRegistered: true, healthStatus: 'pass' },
        { route: '/api/v1/ai/chat', method: 'POST', service: 'ai', declared: true, handlerRegistered: false, healthStatus: 'missing' },
      ],
    };
    expect(() => RouteHealthReportSchema.parse(report)).not.toThrow();
  });

  it('should validate summary counters are integers', () => {
    expect(() => RouteHealthReportSchema.parse({
      timestamp: '2026-04-01T00:00:00.000Z',
      adapter: 'express',
      totalDeclared: 1.5,
      totalRegistered: 1,
      totalMissing: 0,
      routes: [],
    })).toThrow();
  });
});

describe('Service self-description marker (ADR-0076 D12, #2462)', () => {
  it('ServiceSelfInfoSchema accepts stub and degraded declarations', () => {
    expect(() => ServiceSelfInfoSchema.parse({ status: 'stub' })).not.toThrow();
    expect(() => ServiceSelfInfoSchema.parse({
      status: 'degraded', handlerReady: true, message: 'fallback',
    })).not.toThrow();
  });

  it('ServiceSelfInfoSchema rejects available — real services carry no marker', () => {
    expect(() => ServiceSelfInfoSchema.parse({ status: 'available' })).toThrow();
  });

  it('readServiceSelfInfo returns undefined for unmarked services and non-objects', () => {
    expect(readServiceSelfInfo({ query: () => [] })).toBeUndefined();
    expect(readServiceSelfInfo(undefined)).toBeUndefined();
    expect(readServiceSelfInfo(null)).toBeUndefined();
    expect(readServiceSelfInfo('svc')).toBeUndefined();
  });

  it('readServiceSelfInfo reads the standard __serviceInfo descriptor', () => {
    const svc = {
      [SERVICE_SELF_INFO_KEY]: { status: 'degraded', message: 'partial' },
    };
    expect(readServiceSelfInfo(svc)).toEqual({
      status: 'degraded',
      handlerReady: true, // degraded defaults to a genuinely-serving handler
      message: 'partial',
    });
  });

  it('readServiceSelfInfo defaults handlerReady to false for stubs', () => {
    const svc = { [SERVICE_SELF_INFO_KEY]: { status: 'stub' } };
    expect(readServiceSelfInfo(svc)).toEqual({ status: 'stub', handlerReady: false });
  });

  it('readServiceSelfInfo honors an explicit handlerReady override', () => {
    const svc = { [SERVICE_SELF_INFO_KEY]: { status: 'degraded', handlerReady: false } };
    expect(readServiceSelfInfo(svc)?.handlerReady).toBe(false);
  });

  // The retired markers read as unmarked — i.e. as fully real. That is the
  // deliberate cost of collapsing three dialects into one (#4319): a service
  // still carrying `_dev` / `_fallback` is now OVER-reported, not under-. It is
  // acceptable only because both had zero producers left when they went (the
  // `_fallback` case never worked at all — nothing ever read it, which is how
  // the kernel fallbacks came to be reported `available` in the first place),
  // and because keeping a boolean alive cannot express the `stub` / `degraded`
  // split that every consumer gates on.
  it('readServiceSelfInfo does not recognize the retired _dev / _fallback markers', () => {
    expect(readServiceSelfInfo({ _dev: true, chat: () => 'fake' })).toBeUndefined();
    expect(readServiceSelfInfo({ _fallback: true, get: () => undefined })).toBeUndefined();
  });

  it('readServiceSelfInfo ignores malformed markers', () => {
    expect(readServiceSelfInfo({ [SERVICE_SELF_INFO_KEY]: { status: 'available' } })).toBeUndefined();
    expect(readServiceSelfInfo({ [SERVICE_SELF_INFO_KEY]: 'stub' })).toBeUndefined();
  });
});

// ===========================================================================
// [#4828] The two-schema contract, and the gate that keeps them in step
// ===========================================================================
//
// The discovery surface drifted for as long as it did because ONE lenient
// schema stood in for two different jobs. `GetDiscoveryResponseSchema` is
// `DiscoverySchema.partial().required({version}).extend({apiName})`: `.partial()`
// hid every missing REQUIRED key, and zod's default unknown-key strip hid every
// UNDECLARED emitted one. Two producers drifted in opposite directions through
// the same blind spot — one omitted `name`/`environment`/`locale`, the other
// invented `features` and `endpoints`.
//
// The split is now explicit: `DiscoverySchema` binds PRODUCERS, the protocol
// schema is the CONSUMER's tolerant parse, and the producer-side conformance
// tests (one per producer package) check emitted keys against the protocol
// schema's shape. That last step only stays honest while the two shapes are
// the same modulo declared aliases — which is what this gate pins.

describe('[#4828] DiscoverySchema ↔ GetDiscoveryResponseSchema', () => {
  /** The one declared deprecated alias, and its removal is scheduled (protocol 18). */
  const DECLARED_ALIASES = ['apiName'] as const;

  it('the protocol response schema declares exactly DiscoverySchema keys + declared aliases', async () => {
    const { GetDiscoveryResponseSchema } = await import('./protocol.zod');

    const canonical = Object.keys((DiscoverySchema as any).shape);
    const response = Object.keys((GetDiscoveryResponseSchema as any).shape);

    expect(new Set(response)).toEqual(new Set([...canonical, ...DECLARED_ALIASES]));
  });

  it('anti-vacuity: both shapes are non-trivial and carry the keys this issue is about', () => {
    const canonical = Object.keys((DiscoverySchema as any).shape);

    expect(canonical.length).toBeGreaterThan(5);
    // Canonical capability key — the ruling's winner over `features`.
    expect(canonical).toContain('capabilities');
    // Newly declared (#4828 decision 3).
    expect(canonical).toContain('scoping');
    // The retired spellings must NOT come back as declared keys.
    expect(canonical).not.toContain('features');
    expect(canonical).not.toContain('endpoints');
  });
});

// ===========================================================================
// [#5679] The same contract, one level down: `routes`
// ===========================================================================
//
// #4828 pinned its gate at the TOP level, deliberately. `routes.mcp` lived in
// exactly the gap that left: emitted by `@objectstack/rest` (behind an `as any`)
// and by the runtime dispatcher, read by objectui's Integrations connect card,
// declared by nothing. `ApiRoutesSchema` is a plain `z.object`, so a
// spec-strict consumer stripped it silently — the connect card would blank with
// no error. The producer-side conformance tests now check `routes` keys the same
// way they check top-level keys, and derive their allowance from
// `ApiRoutesSchema`; these two pin that the allowance is the real one.
describe('[#5679] routes: the declared key set the producer gates check against', () => {
  it('is the very schema `DiscoverySchema` nests, not a second copy of it', () => {
    // The three producer gates read `ApiRoutesSchema.shape`. That is only a
    // faithful allowance while it IS what `DiscoverySchema.routes` declares —
    // if the two ever diverge the gates would be policing a schema nothing
    // parses with, which is how #4828's blind spot was built in the first place.
    const nested = (DiscoverySchema as any).shape.routes;
    expect(new Set(Object.keys(nested.shape)))
      .toEqual(new Set(Object.keys((ApiRoutesSchema as any).shape)));
  });

  it('declares `mcp` — optional, string, and stripped-not-rejected before it was declared', () => {
    const declared = Object.keys((ApiRoutesSchema as any).shape);
    expect(declared).toContain('mcp');

    const base = { data: '/api/v1/data', metadata: '/api/v1/meta' };

    // Present: survives the parse. This is the assertion that was impossible
    // before — `mcp` used to be dropped here, which is the whole defect.
    expect(ApiRoutesSchema.parse({ ...base, mcp: '/api/v1/mcp' }).mcp).toBe('/api/v1/mcp');

    // Absent: optional, so a producer that cannot answer omits it.
    expect(ApiRoutesSchema.parse(base).mcp).toBeUndefined();

    // A non-string is now rejected rather than silently dropped — the value
    // half of the contract, which a key-set gate alone cannot judge.
    expect(() => ApiRoutesSchema.parse({ ...base, mcp: 123 })).toThrow();

    // And a still-undeclared key is still stripped, which is why the producer
    // gates need their key-set check in addition to this parse.
    expect(ApiRoutesSchema.parse({ ...base, notAThing: '/x' } as any))
      .not.toHaveProperty('notAThing');
  });
});

describe('[#4828] scoping (decision 3 — declare what REST actually emits)', () => {
  const base = {
    name: 'ObjectStack',
    version: '1.0.0',
    environment: 'development',
    routes: { data: '/api/v1/data', metadata: '/api/v1/meta' },
    capabilities: allCapabilitiesOff,
    services: minimalServices,
    locale: { default: 'en', supported: ['en'], timezone: 'UTC' },
  };

  it('accepts the shape the REST discovery endpoint emits on a scoped mount', () => {
    const parsed = DiscoverySchema.parse({
      ...base,
      scoping: { enabled: true, resolution: 'auto', scoped: true, environmentId: 'env_alpha' },
    });
    expect(parsed.scoping?.environmentId).toBe('env_alpha');
  });

  it('accepts an unscoped mount, where environmentId is absent', () => {
    const parsed = DiscoverySchema.parse({
      ...base,
      scoping: { enabled: false, resolution: 'auto', scoped: false },
    });
    expect(parsed.scoping?.scoped).toBe(false);
    expect(parsed.scoping?.environmentId).toBeUndefined();
  });

  it('is optional — the dispatcher producer mounts no scoped variant and emits none', () => {
    expect(DiscoverySchema.parse(base).scoping).toBeUndefined();
  });

  it('rejects a resolution outside RestApiConfig.projectResolution', () => {
    expect(() => DiscoverySchema.parse({
      ...base,
      scoping: { enabled: true, resolution: 'whenever', scoped: true },
    })).toThrow();
  });
});

describe('[#4828] resolveDiscoveryEnvironment (decision 4 — enum, not passthrough)', () => {
  it('maps every documented NODE_ENV spelling into the declared enum', () => {
    const table: Array<[string, string]> = [
      ['production', 'production'],
      ['prod', 'production'],
      ['sandbox', 'sandbox'],
      ['staging', 'sandbox'],
      ['development', 'development'],
      ['dev', 'development'],
      ['test', 'development'],
    ];
    for (const [raw, expected] of table) {
      expect(resolveDiscoveryEnvironment(raw), `NODE_ENV=${raw}`).toBe(expected);
    }
  });

  it('normalizes case and surrounding whitespace (operator-supplied value)', () => {
    expect(resolveDiscoveryEnvironment('  Production ')).toBe('production');
    expect(resolveDiscoveryEnvironment('STAGING')).toBe('sandbox');
  });

  // [#5936] These were ONE case until the 2026-08-07 ruling folded the unset
  // default into this mapper (direction 1). They are two different rules and
  // they now point opposite ways, so they are two cases: absence is the host
  // declining to answer and resolves conservatively to `production`; a spelling
  // this repo does not recognise is a GUESS and never claims production.
  // Collapsing them back into one is the regression these two guard.
  it('an UNSET value advertises production — the host declined to say (#5673, #5936)', () => {
    // Blank counts as unset: `NODE_ENV=` exports an empty string, and the
    // runtime's `getEnv` has always folded that into its default. Were it
    // treated as "anything else" the two producers would drift again on exactly
    // that input — the drift this consolidation ends.
    for (const raw of [undefined, null, '', '   ']) {
      expect(resolveDiscoveryEnvironment(raw as any), JSON.stringify(raw)).toBe('production');
    }
  });

  // [#6287] `preview` was one of this fixture's three examples until the fold
  // table grew a row for it. The RULE is unchanged and still pinned — an
  // unrecognised spelling never claims production — but `preview` is no longer
  // an example of one: it is a declared `EnvironmentTypeSchema` member with a
  // stated fold, so leaving it here would have asserted the opposite of what
  // the source now says, and would have kept passing only because the declared
  // answer happened to equal the fallback's. Re-spelled to inputs that are
  // genuinely outside both the taxonomy and the operator shorthands.
  it('never CLAIMS production for an unrecognized spelling (#4828)', () => {
    for (const raw of ['qa', 'uat', 'nonsense']) {
      expect(resolveDiscoveryEnvironment(raw), raw).toBe('development');
    }
  });

  it('every mapped result actually satisfies the declared enum', () => {
    for (const raw of ['production', 'prod', 'sandbox', 'staging', 'development', 'dev', 'test', 'preview', 'trial', 'qa', '']) {
      const parsed = DiscoverySchema.parse({
        name: 'ObjectStack',
        version: '1.0.0',
        environment: resolveDiscoveryEnvironment(raw),
        routes: { data: '/api/v1/data', metadata: '/api/v1/meta' },
        capabilities: allCapabilitiesOff,
        services: minimalServices,
        locale: { default: 'en', supported: ['en'], timezone: 'UTC' },
      });
      expect(parsed.environment).toBeDefined();
    }
  });
});

/**
 * [#6287] Every `EnvironmentType` member folds by DECLARATION, not by fallback.
 *
 * Before this, five of the seven members had a row in the fold table and
 * `preview` / `trial` fell through `?? 'development'` — a fold nobody had
 * written down, in a table whose whole purpose is to be read by the next
 * author. The repair is a row each, and a type that keeps the table total.
 */
describe('[#6287] the fold table is total over EnvironmentType', () => {
  /**
   * The declared fold per bucket. This mirrors the source table on purpose: it
   * is the RUNTIME half of the pin and it proves the *values*, so a silent
   * re-aim of any row (`staging` quietly moving to `development`, say) fails
   * here rather than in a consumer.
   */
  const declaredFold: Record<EnvironmentType, DiscoveryEnvironment> = {
    production: 'production',
    sandbox: 'sandbox',
    development: 'development',
    test: 'development',
    staging: 'sandbox',
    preview: 'sandbox',
    trial: 'sandbox',
  };

  it('resolves every EnvironmentTypeSchema member to its declared fold', () => {
    const members = EnvironmentTypeSchema.options as readonly EnvironmentType[];
    // Anti-vacuity: `.options` comes through the lazySchema Proxy, and a broken
    // read would make the loop below assert nothing at all.
    expect(Array.isArray(members)).toBe(true);
    expect(members.length).toBeGreaterThan(0);
    for (const member of members) {
      expect(resolveDiscoveryEnvironment(member), member).toBe(declaredFold[member]);
    }
  });

  it('folds preview and trial to sandbox — the two rows this issue added', () => {
    // Both are provisioned environments (isolated database, hostname, plan
    // tier, per-environment RBAC), not the developer-class runs `development`
    // and `test` describe — and `trial` in particular holds an evaluating
    // customer's real data, so `development` would understate the posture a
    // client reads this flag to judge.
    expect(resolveDiscoveryEnvironment('preview')).toBe('sandbox');
    expect(resolveDiscoveryEnvironment('trial')).toBe('sandbox');
    // Declared rows go through the same operator-input normalization as the
    // rest of the table, not a second path.
    expect(resolveDiscoveryEnvironment('  PREVIEW ')).toBe('sandbox');
    expect(resolveDiscoveryEnvironment('Trial')).toBe('sandbox');
  });

  it('leaves the #5936 two-rule split standing (absence ≠ unrecognised)', () => {
    // Neither new row may be read as loosening those. Absence is still the host
    // declining to answer; an unrecognised spelling is still a guess.
    expect(resolveDiscoveryEnvironment(undefined)).toBe('production');
    expect(resolveDiscoveryEnvironment('preview-2')).toBe('development');
  });

  it('rejects a fold table that misses a member — the exhaustiveness gate itself', () => {
    // ⚠️ This assertion is made by `tsc`, not by vitest, and that is the point.
    // A RUNTIME exhaustiveness test cannot see the defect #6287 reported: the
    // fallback and three declared rows all produce `'development'`, so calling
    // `resolveDiscoveryEnvironment('preview')` returned an identical answer
    // whether a row existed or the `??` invented one. Such a test would have
    // passed on the broken state. `Record<EnvironmentType, …>` compares the KEY
    // SET, which is the actual claim, so the gate lives on the source table's
    // type annotation and this is its negative control.
    //
    // What it does and does not cover, stated exactly:
    //   - It DOES fail both ways on the enum's membership. Add a bucket to
    //     `EnvironmentTypeSchema` and the six-key literal below is missing two,
    //     so the source table must grow a row before anything compiles. REMOVE
    //     `trial` from the enum and this literal becomes complete, the directive
    //     goes UNUSED, and tsc reports TS2578 — a vacuously-passing negative
    //     control cannot hide here.
    //   - It does NOT catch someone widening the source annotation itself (to
    //     `Record<string, …>`, say). No type-level pin can: the table is not
    //     exported, and exporting it to satisfy a test would put a private
    //     lookup on this package's public surface. That edit is a deliberate,
    //     visible change to a line whose own comment forbids it, not the silent
    //     drift #6287 was about — the drift was a member that nobody had to
    //     touch anything to omit.
    // `packages/spec`'s test layer IS type-checked (`tsconfig.test.json`, named
    // in the `typecheck` script since #5286) and this file carries no entry in
    // `test-typecheck-debt.json`, so the directive is live, not phantom.
    // @ts-expect-error [#6287] `trial` has no fold — a partial table must not type-check.
    const missingTrial: Record<EnvironmentType, DiscoveryEnvironment> = {
      production: 'production',
      sandbox: 'sandbox',
      development: 'development',
      test: 'development',
      staging: 'sandbox',
      preview: 'sandbox',
    };
    expect(Object.keys(missingTrial)).toHaveLength(6);
  });
});
