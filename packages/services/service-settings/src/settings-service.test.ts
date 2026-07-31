// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { SettingsService } from './settings-service.js';
import { SettingsLockedError, UnknownKeyError, UnknownNamespaceError, envKeyOf } from './settings-service.types.js';
import { NoopCryptoAdapter } from './crypto-adapter.js';
import { mailSettingsManifest, mailTestActionHandler } from './manifests/mail.manifest.js';
import { aiSettingsManifest } from './manifests/ai.manifest.js';
import { brandingSettingsManifest } from './manifests/branding.manifest.js';
import { featureFlagsSettingsManifest } from './manifests/feature-flags.manifest.js';
import { SettingsManifestSchema } from '@objectstack/spec/system';

describe('reference manifests are spec-valid', () => {
  it('mail / branding / feature_flags pass schema', () => {
    expect(() => SettingsManifestSchema.parse(mailSettingsManifest)).not.toThrow();
    expect(() => SettingsManifestSchema.parse(brandingSettingsManifest)).not.toThrow();
    expect(() => SettingsManifestSchema.parse(featureFlagsSettingsManifest)).not.toThrow();
  });
});

describe('envKeyOf', () => {
  it('uppercases and underscores', () => {
    expect(envKeyOf('mail', 'smtp_host')).toBe('OS_MAIL_SMTP_HOST');
    expect(envKeyOf('feature_flags', 'ai-enabled')).toBe('OS_FEATURE_FLAGS_AI_ENABLED');
  });
});

describe('SettingsService — registry', () => {
  it('rejects unknown namespace', async () => {
    const svc = new SettingsService();
    await expect(svc.get('nope', 'x')).rejects.toBeInstanceOf(UnknownNamespaceError);
    expect(() => svc.getManifest('nope')).toThrow(UnknownNamespaceError);
  });

  it('rejects unknown key', async () => {
    const svc = new SettingsService();
    svc.registerManifest(brandingSettingsManifest);
    await expect(svc.get('branding', 'nope')).rejects.toBeInstanceOf(UnknownKeyError);
  });
});

describe('SettingsService — resolver precedence', () => {
  it('returns default when nothing set', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    const r = await svc.get('branding', 'workspace_name');
    expect(r.source).toBe('default');
    expect(r.value).toBe('ObjectStack');
    expect(r.locked).toBe(false);
  });

  it('returns tenant value after set()', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    await svc.set('branding', 'workspace_name', 'Acme');
    const r = await svc.get('branding', 'workspace_name');
    expect(r.source).toBe('tenant');
    expect(r.value).toBe('Acme');
    expect(r.locked).toBe(false);
  });

  it('env wins over tenant and locks the field', async () => {
    const svc = new SettingsService({ env: { OS_BRANDING_WORKSPACE_NAME: 'EnvCorp' } });
    svc.registerManifest(brandingSettingsManifest);
    await svc.set('branding', 'workspace_name', 'Tenant').catch(() => {});
    const r = await svc.get('branding', 'workspace_name');
    expect(r.source).toBe('env');
    expect(r.value).toBe('EnvCorp');
    expect(r.locked).toBe(true);
    expect(r.lockedReason).toContain('OS_BRANDING_WORKSPACE_NAME');
  });

  it('coerces env strings via default-type hint', async () => {
    const svc = new SettingsService({ env: { OS_FEATURE_FLAGS_AI_ENABLED: 'true' } });
    svc.registerManifest(featureFlagsSettingsManifest);
    const r = await svc.get('feature_flags', 'ai_enabled');
    expect(r.value).toBe(true);
  });

  it('rejects writes against env-locked keys', async () => {
    const svc = new SettingsService({ env: { OS_BRANDING_WORKSPACE_NAME: 'EnvCorp' } });
    svc.registerManifest(brandingSettingsManifest);
    await expect(svc.set('branding', 'workspace_name', 'X')).rejects.toBeInstanceOf(SettingsLockedError);
  });
});

describe('SettingsService — encryption round-trip', () => {
  it('persists encrypted=true values via crypto adapter', async () => {
    const svc = new SettingsService({ env: {}, crypto: new NoopCryptoAdapter() });
    svc.registerManifest(mailSettingsManifest);
    await svc.setMany('mail', { provider: 'sendgrid', api_key: 'sg-secret-123', from_email: 'a@b.com' });
    const ns = await svc.getNamespace('mail');
    expect(ns.values.api_key.value).toBe('sg-secret-123');
    expect(ns.values.api_key.source).toBe('global');
  });
});

describe('SettingsService — global scope', () => {
  it('mail manifest defaults to global scope', () => {
    expect(mailSettingsManifest.scope).toBe('global');
  });

  it('returns source="global" for platform-wide values', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(mailSettingsManifest);
    await svc.setMany('mail', { provider: 'smtp', smtp_host: 'smtp.example.com', from_email: 'ops@example.com' });
    const r = await svc.get('mail', 'from_email');
    expect(r.source).toBe('global');
    expect(r.value).toBe('ops@example.com');
    expect(r.locked).toBe(false);
  });

  it('global value is visible from any user context (no per-user isolation)', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(mailSettingsManifest);
    await svc.setMany('mail', { provider: 'smtp', smtp_host: 'smtp.example.com', from_email: 'ops@example.com' }, { userId: 'u1' });
    const fromU2 = await svc.get('mail', 'from_email', { userId: 'u2' });
    expect(fromU2.source).toBe('global');
    expect(fromU2.value).toBe('ops@example.com');
  });

  it('env still wins over global', async () => {
    const svc = new SettingsService({ env: { OS_MAIL_FROM_EMAIL: 'env@example.com' } });
    svc.registerManifest(mailSettingsManifest);
    await svc.set('mail', 'from_email', 'global@example.com').catch(() => {});
    const r = await svc.get('mail', 'from_email');
    expect(r.source).toBe('env');
    expect(r.value).toBe('env@example.com');
    expect(r.locked).toBe(true);
  });
});

describe('SettingsService — audit sink', () => {
  it('records masked digest for encrypted values', async () => {
    const events: any[] = [];
    const svc = new SettingsService({
      env: {},
      audit: { record: (e) => events.push(e) },
    });
    svc.registerManifest(mailSettingsManifest);
    await svc.setMany('mail', { provider: 'sendgrid', api_key: 'top-secret', from_email: 'a@b.com' });
    const apiKeyEvent = events.find((e) => e.key === 'api_key');
    expect(apiKeyEvent).toBeTruthy();
    expect(apiKeyEvent.encrypted).toBe(true);
    expect(apiKeyEvent.valueDigest).toMatch(/^<encrypted:fnv32:/);
  });
});

describe('SettingsService — getNamespace', () => {
  it('returns manifest + values for every key', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(featureFlagsSettingsManifest);
    const payload = await svc.getNamespace('feature_flags');
    expect(payload.manifest.namespace).toBe('feature_flags');
    expect(payload.values.ai_enabled.value).toBe(false);
    expect(payload.values.inline_comments.value).toBe(true);
  });
});

describe('SettingsService — listManifests permission filter', () => {
  it('hides manifests for callers without read permission', () => {
    const svc = new SettingsService();
    svc.registerManifest(brandingSettingsManifest);
    svc.registerManifest(mailSettingsManifest);
    expect(svc.listManifests({ permissions: [] }).length).toBe(2); // empty = passthrough
    // branding stays on setup.access (tenant-scoped); mail now requires
    // manage_platform_settings (global-scoped).
    expect(svc.listManifests({ permissions: ['setup.access'] }).length).toBe(1);
    expect(svc.listManifests({ permissions: ['manage_platform_settings'] }).length).toBe(1);
    expect(
      svc.listManifests({ permissions: ['setup.access', 'manage_platform_settings'] }).length,
    ).toBe(2);
    expect(svc.listManifests({ permissions: ['other'] }).length).toBe(0);
  });
});

describe('SettingsService — [Finding-1] enforced (HTTP-boundary) authz', () => {
  const admin = { enforced: true, permissions: ['setup.access', 'setup.write'] };
  const anon = { enforced: true };

  it('listManifests: an enforced caller with no capability sees NOTHING (no pass-through)', () => {
    const svc = new SettingsService();
    svc.registerManifest(brandingSettingsManifest);
    // Trusted (non-enforced) empty ctx still passes through …
    expect(svc.listManifests({ permissions: [] }).length).toBe(1);
    // … but an enforced empty ctx does not.
    expect(svc.listManifests(anon).length).toBe(0);
    expect(svc.listManifests(admin).length).toBe(1);
  });

  it('getNamespace: enforced read requires the manifest readPermission', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest); // readPermission: setup.access
    await expect(svc.getNamespace('branding', anon)).rejects.toMatchObject({ code: 'SETTINGS_FORBIDDEN' });
    await expect(svc.getNamespace('branding', admin)).resolves.toBeTruthy();
    // Trusted in-process caller (no enforced) is never gated.
    await expect(svc.getNamespace('branding', {})).resolves.toBeTruthy();
  });

  it('setMany: enforced write requires the manifest writePermission (the closed hole)', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest); // writePermission: setup.write
    // No capability → denied.
    await expect(svc.setMany('branding', { workspace_name: 'X' }, anon)).rejects.toMatchObject({ code: 'SETTINGS_FORBIDDEN' });
    // Read-only capability is NOT enough to write.
    await expect(
      svc.setMany('branding', { workspace_name: 'X' }, { enforced: true, permissions: ['setup.access'] }),
    ).rejects.toMatchObject({ code: 'SETTINGS_FORBIDDEN' });
    // Full write capability → allowed.
    await expect(svc.setMany('branding', { workspace_name: 'X' }, admin)).resolves.toBeTruthy();
    // Trusted in-process caller (no enforced) writes without a capability.
    await expect(svc.setMany('branding', { workspace_name: 'Y' }, {})).resolves.toBeTruthy();
  });

  it('runAction: enforced action requires the write capability', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    svc.registerAction('branding', 'ping', () => ({ ok: true, message: 'pong' }));
    await expect(svc.runAction('branding', 'ping', null, anon)).rejects.toMatchObject({ code: 'SETTINGS_FORBIDDEN' });
    await expect(svc.runAction('branding', 'ping', null, admin)).resolves.toMatchObject({ ok: true });
  });
});

describe('SettingsService — runAction', () => {
  it('returns an error for unregistered actions', async () => {
    const svc = new SettingsService();
    svc.registerManifest(mailSettingsManifest);
    const r = await svc.runAction('mail', 'nope', null);
    expect(r.ok).toBe(false);
  });

  it('invokes registered handler with current values', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(mailSettingsManifest);
    svc.registerAction('mail', 'test', mailTestActionHandler);
    await svc.setMany('mail', { provider: 'smtp', smtp_host: 'smtp.x', from_email: 'a@b.com' });
    const r = await svc.runAction('mail', 'test', null);
    expect(r.ok).toBe(true);
  });

  it('catches handler exceptions', async () => {
    const svc = new SettingsService();
    svc.registerManifest(brandingSettingsManifest);
    svc.registerAction('branding', 'boom', () => {
      throw new Error('kaboom');
    });
    const r = await svc.runAction('branding', 'boom', null);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('kaboom');
  });
});

describe('SettingsService — resetNamespace / built-in reset action', () => {
  it('clears persisted rows so values fall back to defaults', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    await svc.set('branding', 'workspace_name', 'Acme');
    expect((await svc.get('branding', 'workspace_name')).source).toBe('tenant');

    const cleared = await svc.resetNamespace('branding');
    expect(cleared).toBe(1);
    const r = await svc.get('branding', 'workspace_name');
    expect(r.source).toBe('default');
    expect(r.value).toBe('ObjectStack');
  });

  it('leaves env-locked keys untouched', async () => {
    const svc = new SettingsService({ env: { OS_BRANDING_WORKSPACE_NAME: 'EnvCorp' } });
    svc.registerManifest(brandingSettingsManifest);
    await expect(svc.resetNamespace('branding')).resolves.toBe(0);
    const r = await svc.get('branding', 'workspace_name');
    expect(r.source).toBe('env');
    expect(r.value).toBe('EnvCorp');
  });

  it('runAction falls back to the built-in reset when no handler is registered', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    await svc.set('branding', 'workspace_name', 'Acme');

    const r = await svc.runAction('branding', 'reset', null);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Cleared 1');
    expect((await svc.get('branding', 'workspace_name')).source).toBe('default');
  });

  it('a registered reset handler overrides the built-in', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    svc.registerAction('branding', 'reset', async () => ({ ok: true, severity: 'info', message: 'custom' }));
    const r = await svc.runAction('branding', 'reset', null);
    expect(r.message).toBe('custom');
  });
});

describe('SettingsService — save-time validation (required/visible/pattern)', () => {
  function aiService(): SettingsService {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(aiSettingsManifest);
    return svc;
  }

  it('rejects a provider switch whose required visible fields are empty', async () => {
    const svc = aiService();
    // The exact incident: provider=cloudflare saved with an empty API key.
    await expect(
      svc.setMany('ai', {
        provider: 'cloudflare',
        cloudflare_account_id: '2846eb40a60f4738e292b90dcd8cce10',
        cloudflare_api_key: '',
      }),
    ).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      // `FieldError[]` since #4224 — the constraint is named by `code`, not
      // only described in the prose of `message` (ADR-0114).
      fields: [
        {
          field: 'cloudflare_api_key',
          code: 'required',
          message: expect.stringContaining('required'),
        },
      ],
    });
    // Nothing was persisted — the batch is atomic.
    expect((await svc.get('ai', 'provider')).source).toBe('default');
  });

  it('rejects switching provider without supplying its required fields at all', async () => {
    const svc = aiService();
    await expect(svc.setMany('ai', { provider: 'cloudflare' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: expect.arrayContaining([
        expect.objectContaining({ field: 'cloudflare_account_id', code: 'required' }),
        expect.objectContaining({ field: 'cloudflare_api_key', code: 'required' }),
      ]),
    });
  });

  it('accepts a complete provider config', async () => {
    const svc = aiService();
    await expect(
      svc.setMany('ai', {
        provider: 'cloudflare',
        cloudflare_account_id: '2846eb40a60f4738e292b90dcd8cce10',
        cloudflare_api_key: 'cfut_secret',
      }),
    ).resolves.toBeDefined();
  });

  it('does not validate fields hidden for the selected provider', async () => {
    const svc = aiService();
    // openai_api_key is required:true but invisible when provider=memory.
    await expect(svc.setMany('ai', { provider: 'memory' })).resolves.toBeDefined();
  });

  it('leaves unrelated single-key writes untouched', async () => {
    const svc = aiService();
    // trace_enabled has no required/visible coupling to provider fields.
    await expect(svc.setMany('ai', { trace_enabled: true })).resolves.toBeDefined();
  });

  it('enforces the gateway model id pattern (provider/model)', async () => {
    const svc = aiService();
    await expect(
      svc.setMany('ai', { provider: 'gateway', gateway_model: 'gpt-4o' }),
    ).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      // A pattern miss is `invalid_format`, and the pattern it missed travels
      // as a discrete `constraint` rather than only inside the sentence.
      fields: [
        {
          field: 'gateway_model',
          code: 'invalid_format',
          message: expect.stringContaining('format'),
          constraint: { pattern: expect.any(String) },
        },
      ],
    });
    await expect(
      svc.setMany('ai', { provider: 'gateway', gateway_model: 'anthropic/claude-sonnet-4.6' }),
    ).resolves.toBeDefined();
  });

  it('still allows resets (all-null patches) of incomplete namespaces', async () => {
    const svc = aiService();
    await svc.setMany('ai', {
      provider: 'cloudflare',
      cloudflare_account_id: 'acc',
      cloudflare_api_key: 'key',
    });
    await expect(svc.resetNamespace('ai')).resolves.toBeGreaterThan(0);
    expect((await svc.get('ai', 'provider')).source).toBe('default');
  });
});

describe('SettingsService — user-scoped values', () => {
  it('isolates writes by ctx.userId', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'prefs',
      version: 1,
      label: 'Prefs',
      scope: 'user',
      specifiers: [{ type: 'text', key: 'nick', label: 'Nickname', required: false, default: 'anon' }],
    } as any);
    await svc.set('prefs', 'nick', 'alice', { userId: 'u1' });
    await svc.set('prefs', 'nick', 'bob', { userId: 'u2' });
    expect((await svc.get('prefs', 'nick', { userId: 'u1' })).value).toBe('alice');
    expect((await svc.get('prefs', 'nick', { userId: 'u2' })).value).toBe('bob');
    expect((await svc.get('prefs', 'nick', { userId: 'u3' })).value).toBe('anon');
  });
});

describe('SettingsService — Phase 1 change events + client', () => {
  it('fires settings:changed on set with namespace, key, scope, action', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(mailSettingsManifest);
    const events: any[] = [];
    const off = svc.subscribe('mail', (e) => events.push(e));

    await svc.set('mail', 'from_email', 'a@b.c');
    await svc.set('mail', 'from_email', null);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ namespace: 'mail', key: 'from_email', scope: 'global', action: 'set' });
    expect(events[1]).toMatchObject({ namespace: 'mail', key: 'from_email', scope: 'global', action: 'reset' });
    expect(typeof events[0].at).toBe('string');

    off();
    await svc.set('mail', 'from_email', 'x@y.z');
    expect(events).toHaveLength(2);
  });

  it('filters subscribers by namespace', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(mailSettingsManifest);
    svc.registerManifest(brandingSettingsManifest);
    const mailEvents: any[] = [];
    const allEvents: any[] = [];
    svc.subscribe('mail', (e) => mailEvents.push(e));
    svc.subscribe(undefined, (e) => allEvents.push(e));

    await svc.set('mail', 'from_email', 'a@b.c');
    await svc.set('branding', 'workspace_name', 'X');

    expect(mailEvents).toHaveLength(1);
    expect(allEvents).toHaveLength(2);
  });

  it('createClient exposes reactive snapshot that refreshes after set', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(mailSettingsManifest);
    await svc.set('mail', 'from_email', 'initial@x.y');

    const client = await svc.createClient<{ from_email?: string; provider?: string }>('mail');
    expect(client.current.from_email).toBe('initial@x.y');
    expect(client.get('provider')).toBe('smtp');

    await svc.set('mail', 'from_email', 'updated@x.y');
    // Allow microtask drain so the subscriber callback completes.
    await new Promise((r) => setImmediate(r));
    expect(client.current.from_email).toBe('updated@x.y');

    client.dispose();
  });

  it('createClient honours an explicit parser', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(mailSettingsManifest);
    await svc.set('mail', 'smtp_port', 2525);

    const client = await svc.createClient<{ smtp_port: number; provider: string }>('mail', {
      parse: (raw) => ({
        smtp_port: Number(raw.smtp_port ?? 0),
        provider: String(raw.provider ?? 'smtp'),
      }),
    });
    expect(client.current).toEqual({ smtp_port: 2525, provider: 'smtp' });
  });

  it('handler exceptions do not break the writer', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(mailSettingsManifest);
    svc.subscribe('mail', () => {
      throw new Error('listener boom');
    });
    // Must not throw despite the bad listener.
    await expect(svc.set('mail', 'from_email', 'ok@x.y')).resolves.toBeDefined();
  });
});

describe('SettingsService — Phase 2 cascade chain + lock', () => {
  it('exposes the full cascade chain on ResolvedSettingValue', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'prefs',
      version: 1,
      label: 'Prefs',
      scope: 'user',
      specifiers: [{ type: 'text', key: 'nick', label: 'Nick', required: false, default: 'anon' }],
    } as any);

    // Default only.
    let r = await svc.get<string>('prefs', 'nick', { userId: 'u1' });
    expect(r.value).toBe('anon');
    expect(r.source).toBe('default');
    expect(r.cascadeChain?.map((e) => e.scope)).toEqual(['default']);
    expect(r.cascadeChain?.find((e) => e.effective)?.scope).toBe('default');

    // Add user row → chain has user then default; user wins.
    await svc.set('prefs', 'nick', 'alice', { userId: 'u1' });
    r = await svc.get<string>('prefs', 'nick', { userId: 'u1' });
    expect(r.source).toBe('user');
    expect(r.cascadeChain?.map((e) => e.scope)).toEqual(['user', 'default']);
    expect(r.cascadeChain?.find((e) => e.effective)?.scope).toBe('user');
  });

  it('locked upper-scope row blocks lower-scope writes', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'feat',
      version: 1,
      label: 'Features',
      scope: 'tenant',
      specifiers: [{ type: 'toggle', key: 'beta', label: 'Beta', required: false, default: false }],
    } as any);

    // Write the global lock directly via the memory store (simulating
    // a platform admin write that the regular API would route to scope='global').
    await (svc as any).upsertRow({
      namespace: 'feat',
      key: 'beta',
      scope: 'global',
      user_id: null,
      value: true,
      value_enc: null,
      encrypted: false,
      locked: true,
      locked_reason: 'Platform policy: beta features disabled in production.',
    });

    // get() reports the lock and the effective value.
    const r = await svc.get<boolean>('feat', 'beta');
    expect(r.value).toBe(true);
    expect(r.source).toBe('global');
    expect(r.locked).toBe(true);
    expect(r.lockedReason).toMatch(/Platform policy/);
    expect(r.cascadeChain?.[0]).toMatchObject({ scope: 'global', locked: true });

    // Tenant-scope set must be rejected with SETTINGS_LOCKED.
    await expect(svc.set('feat', 'beta', false)).rejects.toMatchObject({
      code: 'SETTINGS_LOCKED',
    });
  });
});

describe('SettingsService — Phase 3 sys_secret + crypto provider + audit', () => {
  it('routes encrypted writes through sys_secret when wired', async () => {
    const { InMemoryCryptoProvider } = await import('./in-memory-crypto-provider.js');
    const secretRows = new Map<string, any>();
    const auditRows: any[] = [];

    const svc = new SettingsService({
      env: {},
      cryptoProvider: new InMemoryCryptoProvider(),
      secretStore: {
        async insert(row) { secretRows.set(row.id, row); return { id: row.id }; },
        async get(id) { return secretRows.get(id) ?? null; },
        async update(id, patch) { secretRows.set(id, { ...secretRows.get(id), ...patch }); },
      },
      auditWriter: { write: (e) => { auditRows.push(e); } },
    });
    svc.registerManifest(mailSettingsManifest);

    await svc.set('mail', 'api_key', 'super-secret-key', { tenantId: 't1' });

    // sys_secret got the cipher; sys_setting only holds the handle id.
    expect(secretRows.size).toBe(1);
    const [secret] = [...secretRows.values()];
    expect(secret.namespace).toBe('mail');
    expect(secret.key).toBe('api_key');
    expect(secret.alg).toBe('aes-256-gcm');
    expect(secret.ciphertext).not.toContain('super-secret-key');

    // Round-trip read returns the plaintext.
    const r = await svc.get<string>('mail', 'api_key', { tenantId: 't1' });
    expect(r.value).toBe('super-secret-key');

    // Audit writer received the set event with a non-leaking digest.
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      namespace: 'mail',
      key: 'api_key',
      action: 'set',
      encrypted: true,
    });
    expect(auditRows[0].newHash).toMatch(/^sha256:/);
    expect(auditRows[0].newHash).not.toContain('super-secret-key');
  });

  it('AAD binding rejects ciphertexts swapped across (namespace,key)', async () => {
    const { InMemoryCryptoProvider } = await import('./in-memory-crypto-provider.js');
    const provider = new InMemoryCryptoProvider();
    const handle = await provider.encrypt('value', { namespace: 'mail', key: 'api_key' });
    // Same handle, wrong context → must throw.
    await expect(
      provider.decrypt(handle, { namespace: 'mail', key: 'smtp_password' }),
    ).rejects.toThrow();
  });

  it('rotateKey bumps version while preserving plaintext + handle id', async () => {
    const { InMemoryCryptoProvider } = await import('./in-memory-crypto-provider.js');
    const provider = new InMemoryCryptoProvider();
    const ctx = { namespace: 'mail', key: 'api_key' };
    const h1 = await provider.encrypt('hello', ctx);
    const h2 = await provider.rotateKey(h1, ctx);
    expect(h2.id).toBe(h1.id);
    expect(h2.version).toBe(h1.version + 1);
    expect(h2.ciphertext).not.toBe(h1.ciphertext);
    expect(await provider.decrypt(h2, ctx)).toBe('hello');
  });
});
