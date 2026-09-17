import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  RuntimeConfigSchema,
  SandboxConfigSchema,
  PluginPermissionSchema,
  PluginPermissionSetSchema,
  KernelSecurityPolicySchema,
  PluginSecurityManifestSchema,
} from './plugin-security-advanced.zod';

describe('Plugin Security Advanced Schemas', () => {
  describe('RuntimeConfigSchema', () => {
    it('should validate default V8 isolate runtime', () => {
      const config = RuntimeConfigSchema.parse({});
      expect(config.engine).toBe('v8-isolate');
    });

    it('should validate WASM runtime with memory pages', () => {
      const config = {
        engine: 'wasm' as const,
        engineConfig: {
          wasm: {
            maxMemoryPages: 256,
            instructionLimit: 1000000,
            enableSimd: true,
            enableThreads: false,
            enableBulkMemory: true,
          },
        },
        resourceLimits: {
          maxMemory: 16777216, // 16MB
          maxCpu: 50,
          timeoutMs: 30000,
        },
      };
      const result = RuntimeConfigSchema.parse(config);
      expect(result.engine).toBe('wasm');
      expect(result.engineConfig?.wasm?.maxMemoryPages).toBe(256);
      expect(result.engineConfig?.wasm?.instructionLimit).toBe(1000000);
      expect(result.resourceLimits?.maxMemory).toBe(16777216);
    });

    it('should validate container runtime', () => {
      const config = {
        engine: 'container' as const,
        engineConfig: {
          container: {
            image: 'objectstack/plugin-runtime:latest',
            runtime: 'docker' as const,
            resources: {
              cpuLimit: '0.5',
              memoryLimit: '512m',
            },
            networkMode: 'bridge' as const,
          },
        },
      };
      const result = RuntimeConfigSchema.parse(config);
      expect(result.engine).toBe('container');
      expect(result.engineConfig?.container?.image).toBe('objectstack/plugin-runtime:latest');
      expect(result.engineConfig?.container?.runtime).toBe('docker');
    });

    it('should validate process runtime', () => {
      const config = {
        engine: 'process' as const,
        resourceLimits: {
          maxMemory: 1073741824, // 1GB
          maxCpu: 100,
          timeoutMs: 60000,
        },
      };
      const result = RuntimeConfigSchema.parse(config);
      expect(result.engine).toBe('process');
    });

    it('should validate V8 isolate with custom settings', () => {
      const config = {
        engine: 'v8-isolate' as const,
        engineConfig: {
          v8Isolate: {
            heapSizeMb: 128,
            enableSnapshot: true,
          },
        },
      };
      const result = RuntimeConfigSchema.parse(config);
      expect(result.engineConfig?.v8Isolate?.heapSizeMb).toBe(128);
    });
  });

  describe('SandboxConfigSchema', () => {
    it('should validate sandbox with defaults', () => {
      const config = SandboxConfigSchema.parse({});
      expect(config.enabled).toBe(true);
      expect(config.level).toBe('standard');
    });

    it('should validate strict sandbox with WASM runtime', () => {
      const config = {
        enabled: true,
        level: 'strict' as const,
        runtime: {
          engine: 'wasm' as const,
          engineConfig: {
            wasm: {
              maxMemoryPages: 128,
              instructionLimit: 500000,
            },
          },
        },
        filesystem: {
          mode: 'readonly' as const,
          allowedPaths: ['/data/readonly'],
        },
        network: {
          mode: 'restricted' as const,
          allowedHosts: ['api.objectstack.com'],
          allowedPorts: [443],
        },
        memory: {
          maxHeap: 67108864, // 64MB
        },
        cpu: {
          maxCpuPercent: 25,
          maxThreads: 2,
        },
      };
      const result = SandboxConfigSchema.parse(config);
      expect(result.level).toBe('strict');
      expect(result.runtime?.engine).toBe('wasm');
      expect(result.filesystem?.mode).toBe('readonly');
    });

    it('should validate paranoid sandbox', () => {
      const config = {
        enabled: true,
        level: 'paranoid' as const,
        runtime: {
          engine: 'wasm' as const,
        },
        filesystem: {
          mode: 'none' as const,
        },
        network: {
          mode: 'none' as const,
        },
        process: {
          allowSpawn: false,
        },
        environment: {
          mode: 'none' as const,
        },
      };
      const result = SandboxConfigSchema.parse(config);
      expect(result.level).toBe('paranoid');
      expect(result.filesystem?.mode).toBe('none');
      expect(result.network?.mode).toBe('none');
    });
  });

  describe('PluginPermissionSchema', () => {
    it('should validate basic permission', () => {
      const permission = {
        id: 'read-objects',
        resource: 'data.object' as const,
        actions: ['read' as const],
        description: 'Read access to data objects',
      };
      const result = PluginPermissionSchema.parse(permission);
      expect(result.id).toBe('read-objects');
      expect(result.scope).toBe('plugin');
      expect(result.required).toBe(true);
    });

    it('should validate permission with filter', () => {
      const permission = {
        id: 'manage-user-records',
        resource: 'data.record' as const,
        actions: ['read' as const, 'update' as const],
        scope: 'user' as const,
        filter: {
          condition: 'owner = currentUser',
          fields: ['name', 'email', 'preferences'],
        },
        description: 'Manage user records',
        justification: 'Required for user profile management',
      };
      const result = PluginPermissionSchema.parse(permission);
      expect(result.scope).toBe('user');
      expect(result.filter?.fields).toHaveLength(3);
    });
  });

  describe('PluginPermissionSetSchema', () => {
    it('should validate permission set', () => {
      const permissionSet = {
        permissions: [
          {
            id: 'read-data',
            resource: 'data.object' as const,
            actions: ['read' as const],
            description: 'Read data',
          },
        ],
        groups: [
          {
            name: 'data-access',
            description: 'Data access permissions',
            permissions: ['read-data'],
          },
        ],
        defaultGrant: 'prompt' as const,
      };
      const result = PluginPermissionSetSchema.parse(permissionSet);
      expect(result.permissions).toHaveLength(1);
      expect(result.groups).toHaveLength(1);
    });
  });

  describe('KernelSecurityPolicySchema', () => {
    it('should validate comprehensive security policy', () => {
      const policy = {
        csp: {
          directives: {
            'default-src': ["'self'"],
            'script-src': ["'self'", "'unsafe-inline'"],
          },
          reportOnly: false,
        },
        cors: {
          allowedOrigins: ['https://app.objectstack.com'],
          allowedMethods: ['GET', 'POST'],
          allowedHeaders: ['Content-Type', 'Authorization'],
          allowCredentials: true,
        },
        rateLimit: {
          enabled: true,
          maxRequests: 100,
          windowMs: 60000,
          strategy: 'sliding' as const,
        },
        authentication: {
          required: true,
          methods: ['jwt' as const, 'api-key' as const],
          tokenExpirationSeconds: 3600,
        },
        encryption: {
          dataAtRest: true,
          dataInTransit: true,
          algorithm: 'AES-256-GCM',
          minKeyLength: 256,
        },
        auditLog: {
          enabled: true,
          events: ['auth', 'data-access', 'config-change'],
          retentionDays: 90,
        },
      };
      const result = KernelSecurityPolicySchema.parse(policy);
      expect(result.rateLimit?.enabled).toBe(true);
      expect(result.authentication?.required).toBe(true);
      expect(result.encryption?.dataAtRest).toBe(true);
    });
  });

  describe('PluginSecurityManifestSchema', () => {
    it('should validate complete security manifest', () => {
      const manifest = {
        pluginId: 'com.acme.analytics',
        trustLevel: 'trusted' as const,
        permissions: {
          permissions: [
            {
              id: 'read-analytics',
              resource: 'data.object' as const,
              actions: ['read' as const],
              description: 'Read analytics data',
            },
          ],
          defaultGrant: 'prompt' as const,
        },
        sandbox: {
          enabled: true,
          level: 'strict' as const,
          runtime: {
            engine: 'wasm' as const,
            engineConfig: {
              wasm: {
                maxMemoryPages: 256,
              },
            },
          },
        },
        codeSigning: {
          signed: true,
          signature: 'sha256:abc123...',
          algorithm: 'RSA-SHA256',
          timestamp: new Date().toISOString(),
        },
      };
      const result = PluginSecurityManifestSchema.parse(manifest);
      expect(result.trustLevel).toBe('trusted');
      expect(result.sandbox.level).toBe('strict');
      expect(result.codeSigning?.signed).toBe(true);
    });
  });
});

// #15678 (stack card 3/6 of #14478) — ruling B: the unit of a duration-shaped
// number lives in the key NAME. This file is the rule's sharpest case in the
// spec — FOUR durations on one security manifest carried FOUR DIFFERENT units
// (ms, seconds, days, hours) and none said so in its name. All four old
// spellings are `retiredKey()` tombstones inside live blocks, so the refusal
// carries the RENAME and each block's other members keep parsing beside it.
describe('Plugin security durations carry their unit (#15678)', () => {
  it('SandboxConfig REFUSES the retired `process.timeout` with the rename in the message', () => {
    const result = SandboxConfigSchema.safeParse({ process: { timeout: 30000 } });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'process.timeout');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('`SandboxConfig.process.timeout` was renamed to `timeoutMs`');
  });

  it.each([
    ['authentication.tokenExpiration', 'tokenExpirationSeconds', 3600,
      { authentication: { methods: ['jwt' as const], tokenExpiration: 3600 } }],
    ['auditLog.retention', 'retentionDays', 90,
      { auditLog: { retention: 90 } }],
  ])('KernelSecurityPolicy REFUSES the retired `%s` with the rename to `%s`', (old, next, _v, policy) => {
    const result = KernelSecurityPolicySchema.safeParse(policy);
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === old);
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain(`\`KernelSecurityPolicy.${old}\` was renamed to \`${next}\``);
  });

  it('accepts the suffixed policy keys beside the already-suffixed `windowMs`', () => {
    const parsed = KernelSecurityPolicySchema.parse({
      rateLimit: { maxRequests: 100, windowMs: 60000 },
      authentication: { methods: ['jwt' as const], tokenExpirationSeconds: 3600 },
      auditLog: { retentionDays: 90 },
    });
    expect(parsed.rateLimit?.windowMs).toBe(60000);
    expect(parsed.authentication?.tokenExpirationSeconds).toBe(3600);
    expect(parsed.auditLog?.retentionDays).toBe(90);
  });

  it('accepts the suffixed sandbox key beside its non-duration siblings', () => {
    const parsed = SandboxConfigSchema.parse({
      process: { allowSpawn: false, allowedCommands: ['git'], timeoutMs: 30000 },
    });
    expect(parsed.process?.timeoutMs).toBe(30000);
    expect(parsed.process?.allowSpawn).toBe(false);
  });

  // The pair the rule exists for: ONE bare name, TWO units, two kernel shapes.
  it('PluginSecurityManifest REFUSES `vulnerabilityDisclosure.responseTime` and names HOURS', () => {
    const result = PluginSecurityManifestSchema.safeParse({
      pluginId: 'com.acme.analytics',
      trustLevel: 'trusted' as const,
      permissions: { permissions: [] },
      sandbox: { level: 'strict' as const },
      vulnerabilityDisclosure: { responseTime: 24 },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find(
      (i) => i.path.join('.') === 'vulnerabilityDisclosure.responseTime',
    );
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain(
      '`PluginSecurityManifest.vulnerabilityDisclosure.responseTime` was renamed to '
      + '`responseTimeHours`',
    );
    // Not `responseTimeMs`: the identically-named health-report key IS
    // milliseconds, and confusing the two is a 3,600,000x error.
    expect(issue!.message).not.toContain('`responseTimeMs`');
    expect(issue!.message).toContain('the value (hours) is unchanged');
  });

  it('accepts `responseTimeHours` beside the unchanged `bugBounty`', () => {
    const parsed = PluginSecurityManifestSchema.parse({
      pluginId: 'com.acme.analytics',
      trustLevel: 'trusted' as const,
      permissions: { permissions: [] },
      sandbox: { level: 'strict' as const },
      vulnerabilityDisclosure: { responseTimeHours: 24, bugBounty: true },
    });
    expect(parsed.vulnerabilityDisclosure?.responseTimeHours).toBe(24);
    expect(parsed.vulnerabilityDisclosure?.bugBounty).toBe(true);
  });
});

// THE FIFTH DURATION, closed by #15939 ruling A — what this slot used to pin.
//
// Until this card, this slot held a NEGATIVE control: `resourceLimits.timeout`
// named its unit only in the JSDoc above it, a channel `check:duration-unit-keys`
// does not read (it reads `.describe()` and `.meta({ description })`), so the
// gate listed the key in its census without judging it and #15678 deliberately
// left it alone. The control existed so a later sweep could not read the four
// renames above as "every timeout on this file".
//
// #15939 IS that sweep, and it is the reason the control was written. Director
// seat ruling A (2026-09-11, maintainer 「同意」, decision batch #115) remediates
// the JSDoc-channel population per file, so the key is renamed here and this
// slot now pins the OPPOSITE fact: the bare spelling is refused with the rename
// prescription, and the suffixed spelling parses at the same magnitude. The
// guard succeeded by failing — ⛔ it was not deleted, weakened or skipped.
describe('RuntimeConfig.resourceLimits.timeout → timeoutMs (#15939 ruling A, #14478)', () => {
  it('REFUSES the retired `resourceLimits.timeout` with the rename to `timeoutMs`', () => {
    const result = RuntimeConfigSchema.safeParse({
      engine: 'process' as const,
      resourceLimits: { maxMemory: 1073741824, timeout: 60000 },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find(
      (i) => i.path.join('.') === 'resourceLimits.timeout',
    );
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toMatch(
      /`RuntimeConfig\.resourceLimits\.timeout` was renamed.*Rename the key to `timeoutMs`/s,
    );
    expect(issue!.message).toContain('the value (milliseconds) is unchanged');
  });

  it('accepts `timeoutMs` at the magnitude the retired key carried, beside its siblings', () => {
    const parsed = RuntimeConfigSchema.parse({
      engine: 'process' as const,
      resourceLimits: { maxMemory: 1073741824, maxCpu: 100, timeoutMs: 60000 },
    });
    expect(parsed.resourceLimits?.timeoutMs).toBe(60000);
    expect(parsed.resourceLimits).not.toHaveProperty('timeout');
    expect(parsed.resourceLimits?.maxMemory).toBe(1073741824);
    expect(parsed.resourceLimits?.maxCpu).toBe(100);
  });

  // The channel the whole of #15939 is about: the describe is what
  // `content/docs/references/**` renders, and it now names the unit.
  it('publishes the unit in the describe — the text the reference pages render', () => {
    const limits = RuntimeConfigSchema.shape.resourceLimits.unwrap();
    expect(limits.shape.timeoutMs.description).toBe('Maximum execution time in milliseconds');
  });

  // The two `timeout` keys on this file are DIFFERENT keys on different
  // shapes, and both are now retired to the same `timeoutMs` token. Each
  // refusal must name its own shape, or an upgrading author edits the wrong
  // block — the confusion `SandboxConfig.process.timeout`'s own tombstone
  // comment warned about while this key was still bare.
  it('names its own shape, not the sandbox one, in the prescription', () => {
    const runtime = RuntimeConfigSchema.safeParse({
      resourceLimits: { timeout: 60000 },
    });
    const sandbox = SandboxConfigSchema.safeParse({ process: { timeout: 30000 } });
    const runtimeMsg = runtime.error!.issues
      .find((i) => i.path.join('.') === 'resourceLimits.timeout')!.message;
    const sandboxMsg = sandbox.error!.issues
      .find((i) => i.path.join('.') === 'process.timeout')!.message;
    expect(runtimeMsg).toContain('`RuntimeConfig.resourceLimits.timeout`');
    expect(runtimeMsg).not.toContain('`SandboxConfig.process.timeout`');
    expect(sandboxMsg).toContain('`SandboxConfig.process.timeout`');
    expect(sandboxMsg).not.toContain('`RuntimeConfig.resourceLimits.timeout`');
  });
});
// #18124 — step 3 of ruling A on #18115. `KernelSecurityPolicy.cors.maxAge` is a
// CORS `Access-Control-Max-Age` mirror, so it takes the `externalVocabulary`
// route rather than a type or a rename: it is the SAME key as its already-declared
// twin `CorsConfig.maxAge` (`src/shared/http.zod.ts`), which carries exactly this
// marker and exactly this unit. The standard defines the header's value in
// seconds; renaming it to `maxAgeSeconds` would break the one-to-one reading
// between this policy and the header it emits.
//
// ⚠️ No gate can catch this key losing its marker, because a marker's absence is
// how an undeclared key looks — the census simply stops admitting it. This pin is
// the only guard, exactly as the twin's pin in `system/object-storage.test.ts` is.
describe('KernelSecurityPolicy.cors.maxAge declares seconds by mirror (#18124)', () => {
  const policy = {
    cors: {
      allowedOrigins: ['https://app.example.com'],
      allowedMethods: ['GET'],
      allowedHeaders: ['content-type'],
      maxAge: 86400,
    },
  };

  it('keeps the bare name and the value it always accepted', () => {
    expect(KernelSecurityPolicySchema.parse(policy).cors?.maxAge).toBe(86400);
  });

  it('emits the externalVocabulary marker and the unit through z.toJSONSchema', () => {
    const json = z.toJSONSchema(KernelSecurityPolicySchema, {
      target: 'draft-2020-12',
      io: 'input',
      unrepresentable: 'any',
    }) as {
      properties?: {
        cors?: { properties?: { maxAge?: { externalVocabulary?: unknown; description?: unknown } } };
      };
    };
    const maxAge = json.properties?.cors?.properties?.maxAge;
    expect(maxAge?.externalVocabulary).toBe('CORS `Access-Control-Max-Age` (WHATWG Fetch)');
    expect(maxAge?.description).toBe('Preflight cache duration in seconds');
  });
});
