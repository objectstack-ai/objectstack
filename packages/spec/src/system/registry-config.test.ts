import { describe, it, expect } from 'vitest';
import {
  RegistrySyncPolicySchema,
  RegistryUpstreamSchema,
  RegistryConfigSchema,
} from './registry-config.zod';

describe('RegistrySyncPolicySchema', () => {
  it('should accept valid policies', () => {
    const policies = ['manual', 'auto', 'proxy'];
    policies.forEach((policy) => {
      expect(() => RegistrySyncPolicySchema.parse(policy)).not.toThrow();
    });
  });

  it('should reject invalid policies', () => {
    expect(() => RegistrySyncPolicySchema.parse('realtime')).toThrow();
    expect(() => RegistrySyncPolicySchema.parse('pull')).toThrow();
  });
});

describe('RegistryUpstreamSchema', () => {
  it('should accept valid upstream with defaults', () => {
    const upstream = RegistryUpstreamSchema.parse({
      url: 'https://registry.objectstack.com',
    });

    expect(upstream.url).toBe('https://registry.objectstack.com');
    expect(upstream.syncPolicy).toBe('auto');
    expect(upstream.timeoutMs).toBe(30000);
  });

  it('should accept full upstream configuration', () => {
    const upstream = RegistryUpstreamSchema.parse({
      url: 'https://registry.example.com',
      syncPolicy: 'manual',
      syncIntervalSeconds: 300,
      auth: {
        type: 'bearer',
        token: 'my-token',
      },
      tls: {
        enabled: true,
        verifyCertificate: false,
      },
      timeoutMs: 60000,
      retry: {
        maxAttempts: 5,
        backoff: 'linear',
      },
    });

    expect(upstream.syncPolicy).toBe('manual');
    expect(upstream.syncIntervalSeconds).toBe(300);
    expect(upstream.auth?.type).toBe('bearer');
    expect(upstream.tls?.verifyCertificate).toBe(false);
    expect(upstream.timeoutMs).toBe(60000);
    expect(upstream.retry?.maxAttempts).toBe(5);
  });

  it('should accept all auth types', () => {
    const types = ['none', 'basic', 'bearer', 'api-key', 'oauth2'];
    types.forEach((type) => {
      expect(() =>
        RegistryUpstreamSchema.parse({
          url: 'https://registry.example.com',
          auth: { type },
        }),
      ).not.toThrow();
    });
  });

  it('should accept all backoff strategies', () => {
    const strategies = ['fixed', 'linear', 'exponential'];
    strategies.forEach((backoff) => {
      expect(() =>
        RegistryUpstreamSchema.parse({
          url: 'https://registry.example.com',
          retry: { backoff },
        }),
      ).not.toThrow();
    });
  });

  it('should reject invalid url', () => {
    expect(() => RegistryUpstreamSchema.parse({ url: 'not-a-url' })).toThrow();
  });

  it('should reject syncIntervalSeconds below minimum', () => {
    expect(() =>
      RegistryUpstreamSchema.parse({
        url: 'https://registry.example.com',
        syncIntervalSeconds: 10,
      }),
    ).toThrow();
  });

  it('should reject timeoutMs below minimum', () => {
    expect(() =>
      RegistryUpstreamSchema.parse({
        url: 'https://registry.example.com',
        timeoutMs: 500,
      }),
    ).toThrow();
  });

  it('should reject missing url', () => {
    expect(() => RegistryUpstreamSchema.parse({})).toThrow();
  });
});

describe('RegistryConfigSchema', () => {
  it('should accept valid config with defaults', () => {
    const config = RegistryConfigSchema.parse({
      type: 'private',
    });

    expect(config.type).toBe('private');
    expect(config.visibility).toBe('private');
  });

  it('should accept all registry types', () => {
    const types = ['public', 'private', 'hybrid'];
    types.forEach((type) => {
      expect(() => RegistryConfigSchema.parse({ type })).not.toThrow();
    });
  });

  it('should accept full configuration', () => {
    const config = RegistryConfigSchema.parse({
      type: 'hybrid',
      upstream: [
        { url: 'https://registry.objectstack.com' },
      ],
      scope: ['@my-corp', '@enterprise'],
      defaultScope: '@my-corp',
      storage: {
        backend: 's3',
        path: 'my-bucket/plugins',
        credentials: { region: 'us-east-1' },
      },
      visibility: 'internal',
      accessControl: {
        requireAuthForRead: true,
        requireAuthForWrite: true,
        allowedPrincipals: ['team-core', 'team-platform'],
      },
      cache: {
        enabled: true,
        ttlSeconds: 7200,
        maxSize: 1073741824,
      },
      mirrors: [
        { url: 'https://mirror1.example.com', priority: 1 },
        { url: 'https://mirror2.example.com', priority: 2 },
      ],
    });

    expect(config.upstream).toHaveLength(1);
    expect(config.scope).toEqual(['@my-corp', '@enterprise']);
    expect(config.storage?.backend).toBe('s3');
    expect(config.visibility).toBe('internal');
    expect(config.accessControl?.requireAuthForRead).toBe(true);
    expect(config.cache?.ttlSeconds).toBe(7200);
    expect(config.mirrors).toHaveLength(2);
  });

  it('should accept all storage backends', () => {
    const backends = ['local', 's3', 'gcs', 'azure-blob', 'oss'];
    backends.forEach((backend) => {
      expect(() =>
        RegistryConfigSchema.parse({
          type: 'private',
          storage: { backend },
        }),
      ).not.toThrow();
    });
  });

  it('should accept all visibility options', () => {
    const options = ['public', 'private', 'internal'];
    options.forEach((visibility) => {
      expect(() =>
        RegistryConfigSchema.parse({ type: 'private', visibility }),
      ).not.toThrow();
    });
  });

  it('should use access control defaults', () => {
    const config = RegistryConfigSchema.parse({
      type: 'private',
      accessControl: {},
    });

    expect(config.accessControl?.requireAuthForRead).toBe(false);
    expect(config.accessControl?.requireAuthForWrite).toBe(true);
  });

  it('should reject missing type', () => {
    expect(() => RegistryConfigSchema.parse({})).toThrow();
  });

  it('should reject invalid type', () => {
    expect(() => RegistryConfigSchema.parse({ type: 'distributed' })).toThrow();
  });
});

// #15679 (stack card 4/6 of #14478) — ruling B. All three old spellings are
// `retiredKey()` tombstones; asserted on the issue CODE and the prescription,
// never on a bare `toThrow()`. `RegistryUpstream` is the sharpest case in this
// card: it declared a SECONDS interval and a MILLISECONDS timeout twenty-five
// lines apart, both bare, and the `min(1000)` bound on the timeout reads as one
// second under the right unit and sixteen minutes under the wrong one — both in
// range, so no parse could have caught the mistake.
describe('registry duration keys carry their unit (#15679)', () => {
  const url = 'https://registry.example.com';

  it('REFUSES the retired `syncInterval` with the rename in the message', () => {
    const result = RegistryUpstreamSchema.safeParse({ url, syncInterval: 300 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'syncInterval');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('`RegistryUpstream.syncInterval` was renamed to `syncIntervalSeconds`');
  });

  it('REFUSES the retired `timeout` with the rename in the message', () => {
    const result = RegistryUpstreamSchema.safeParse({ url, timeout: 60000 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'timeout');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('`RegistryUpstream.timeout` was renamed to `timeoutMs`');
  });

  it('REFUSES the retired `cache.ttl` with the rename in the message', () => {
    const result = RegistryConfigSchema.safeParse({ type: 'private', cache: { enabled: true, ttl: 7200 } });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'cache.ttl');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('`RegistryConfig.cache.ttl` was renamed to `ttlSeconds`');
  });

  it('accepts the renamed keys and keeps every default and bound', () => {
    const upstream = RegistryUpstreamSchema.parse({ url, syncIntervalSeconds: 300, timeoutMs: 60000 });
    expect(upstream.syncIntervalSeconds).toBe(300);
    expect(upstream.timeoutMs).toBe(60000);
    expect(RegistryUpstreamSchema.parse({ url }).timeoutMs).toBe(30000);
    expect(RegistryUpstreamSchema.safeParse({ url, syncIntervalSeconds: 10 }).success).toBe(false);
    expect(RegistryUpstreamSchema.safeParse({ url, timeoutMs: 500 }).success).toBe(false);
    expect(RegistryConfigSchema.parse({ type: 'private', cache: { enabled: true } }).cache?.ttlSeconds).toBe(3600);
  });
});
