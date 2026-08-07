// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings-service.js';
import { SettingsLockedError, UnknownKeyError, UnknownNamespaceError, envKeyOf } from './settings-service.types.js';
import { NoopCryptoAdapter } from './crypto-adapter.js';
import { mailSettingsManifest, mailTestActionHandler } from './manifests/mail.manifest.js';
import { aiSettingsManifest } from './manifests/ai.manifest.js';
import { authSettingsManifest } from './manifests/auth.manifest.js';
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
    await svc.setMany('mail', { provider: 'resend', api_key: 're-secret-123', from_email: 'a@b.com' });
    const ns = await svc.getNamespace('mail');
    expect(ns.values.api_key.value).toBe('re-secret-123');
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
    await svc.setMany('mail', { provider: 'resend', api_key: 'top-secret', from_email: 'a@b.com' });
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
    // The handler ran and read the saved values (it echoes the provider) —
    // but this built-in is the FALLBACK, mounted only when no email plugin
    // is present, so it cannot send and must not claim it did (#5087). The
    // real sending handler is registered by @objectstack/plugin-email.
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('warning');
    expect(r.message).toContain('provider=smtp');
    expect(r.message).toMatch(/NO test message was sent/);
  });

  it('the fallback mail/test handler still rejects an incomplete config', async () => {
    // `setMany` already refuses to SAVE provider=smtp without a host, so the
    // incomplete state can only arrive through the env door — which is exactly
    // where it must still be caught.
    const svc = new SettingsService({ env: { OS_MAIL_PROVIDER: 'smtp' } });
    svc.registerManifest(mailSettingsManifest);
    svc.registerAction('mail', 'test', mailTestActionHandler);
    await svc.setMany('mail', { from_email: 'a@b.com' });
    const r = await svc.runAction('mail', 'test', null);
    expect(r).toMatchObject({ ok: false, severity: 'error' });
    expect(r.message).toContain('SMTP host is required');
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

/**
 * #5131 — a manifest's `options` table is enforced at SAVE time.
 *
 * Until this suite existed the enumeration was a front-end convention: the
 * console dropdown only ever emitted legal values, so an admin going through
 * the UI could not produce a bad one — but `PUT /api/settings/:ns` is an
 * authorizable public surface, and a script, a migration or AI-authored
 * bootstrap code could write any string at all into a `select` and have it
 * stored, read back, and improvised over by each consumer in turn.
 *
 * The load-bearing case is `mail.provider`: #5094/#5133 retired `sendgrid`
 * and `ses` from the option table because this server cannot deliver through
 * them, and that manifest-side tightening had no matching gate on the API
 * side — the very values just retired could be written straight back in.
 */
describe('SettingsService — save-time validation (declared options are enforced)', () => {
  const mailService = () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(mailSettingsManifest);
    return svc;
  };

  it('refuses a provider outside the declared table, naming the allowed set', async () => {
    const svc = mailService();
    // `sendgrid` left the table in #5094; before this gate it could be written
    // back the same afternoon it was retired.
    await expect(
      svc.setMany('mail', { provider: 'sendgrid', from_email: 'a@b.com' }),
    ).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [
        {
          field: 'provider',
          code: 'invalid_option',
          label: 'Provider',
          // The allowed set travels as a discrete constraint (ADR-0114), so a
          // client branches on the machine value instead of parsing our prose.
          constraint: { allowed: 'smtp, resend, postmark, log' },
          value: 'sendgrid',
        },
      ],
    });
    // Atomic: the rejected batch persisted nothing, not even the legal key.
    expect((await svc.get('mail', 'provider')).source).toBe('default');
    expect((await svc.get('mail', 'from_email')).value).toBeNull();
  });

  it('accepts every value the table does declare', async () => {
    for (const [provider, extra] of [
      ['smtp', { smtp_host: 'smtp.example.com' }],
      ['resend', { api_key: 're-key' }],
      ['postmark', { api_key: 'pm-key' }],
      ['log', {}],
    ] as const) {
      const svc = mailService();
      await expect(
        svc.setMany('mail', { provider, ...extra, from_email: 'a@b.com' }),
      ).resolves.toBeDefined();
      expect((await svc.get('mail', 'provider')).value).toBe(provider);
    }
  });

  it('checks the option table only when the patch TOUCHES the key', async () => {
    // A workspace that saved `sendgrid` while the option existed still carries
    // it. Simulated exactly as it happened: write under the OLD table, then
    // re-register the narrowed manifest (#5094) over the same namespace.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      ...mailSettingsManifest,
      specifiers: mailSettingsManifest.specifiers.map((s: any) =>
        s.key === 'provider'
          ? { ...s, options: [...s.options, { value: 'sendgrid', label: 'SendGrid' }] }
          : s,
      ),
    } as any);
    await svc.setMany('mail', { provider: 'sendgrid', api_key: 'sg-key', from_email: 'a@b.com' });
    svc.registerManifest(mailSettingsManifest);

    // The stale value is still there …
    expect((await svc.get('mail', 'provider')).value).toBe('sendgrid');
    // … and it does NOT lock the workspace out of editing anything else. A
    // patch that never mentions `provider` is not rejected on its account —
    // the opposite rule would make the settings page unusable for every
    // workspace carrying historical drift, which is worse than the gap.
    await expect(svc.setMany('mail', { from_name: 'Acme Ops' })).resolves.toBeDefined();
    expect((await svc.get('mail', 'from_name')).value).toBe('Acme Ops');
    // Only re-writing the key itself is refused.
    await expect(svc.setMany('mail', { provider: 'sendgrid' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{ field: 'provider', code: 'invalid_option' }],
    });
    // And a reset still clears it — an all-null patch is never blocked.
    await expect(svc.resetNamespace('mail')).resolves.toBeGreaterThan(0);
  });

  it('leaves the value alone when the specifier declares no option table', async () => {
    // `registerManifest` takes manifests as given (no Zod pass), so a
    // hand-built select without `options` reaches the validator. It cannot say
    // what is legal, so it stays lenient rather than rejecting every write.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'freeform',
      label: 'Freeform',
      specifiers: [{ type: 'select', key: 'mode', label: 'Mode' }],
    } as any);
    await expect(svc.setMany('freeform', { mode: 'whatever' })).resolves.toBeDefined();
  });

  it('enforces radio and multiselect from the same table, element-wise', async () => {
    // All three types are covered because the SPEC requires an `options` table
    // on all three; `radio`/`multiselect` have no producer manifest today and
    // would otherwise be a hole the first one to author them falls into.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'shapes',
      label: 'Shapes',
      specifiers: [
        { type: 'radio', key: 'tier', label: 'Tier',
          options: [{ value: 'free', label: 'Free' }, { value: 'pro', label: 'Pro' }] },
        { type: 'multiselect', key: 'channels', label: 'Channels',
          options: [{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }] },
      ],
    } as any);

    await expect(svc.setMany('shapes', { tier: 'enterprise' })).rejects.toMatchObject({
      fields: [{ field: 'tier', code: 'invalid_option', constraint: { allowed: 'free, pro' } }],
    });
    await expect(svc.setMany('shapes', { tier: 'pro' })).resolves.toBeDefined();

    // Every element is checked, and the rejected one is the one reported.
    await expect(
      svc.setMany('shapes', { channels: ['email', 'carrier-pigeon'] }),
    ).rejects.toMatchObject({
      fields: [{ field: 'channels', code: 'invalid_option', value: 'carrier-pigeon' }],
    });
    await expect(svc.setMany('shapes', { channels: ['email', 'sms'] })).resolves.toBeDefined();
    await expect(svc.setMany('shapes', { channels: [] })).resolves.toBeDefined();
  });

  it('matches option values by string form, so a number option survives JSON', async () => {
    // A stored value has been through JSON and, over REST, a form post: an
    // option declared `value: 30` legitimately reads back as '30'. Rejecting
    // that would enforce the transport rather than the enumeration.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'retention',
      label: 'Retention',
      specifiers: [
        { type: 'select', key: 'days', label: 'Days',
          options: [{ value: 7, label: '7' }, { value: 30, label: '30' }] },
        { type: 'select', key: 'archive', label: 'Archive',
          options: [{ value: true, label: 'On' }, { value: false, label: 'Off' }] },
      ],
    } as any);
    await expect(svc.setMany('retention', { days: 30 })).resolves.toBeDefined();
    await expect(svc.setMany('retention', { days: '30' })).resolves.toBeDefined();
    await expect(svc.setMany('retention', { archive: false })).resolves.toBeDefined();
    await expect(svc.setMany('retention', { days: 45 })).rejects.toMatchObject({
      fields: [{ field: 'days', code: 'invalid_option', constraint: { allowed: '7, 30' } }],
    });
  });

  it('never echoes the rejected value for an encrypted specifier', async () => {
    // `encrypted` is authorable on any specifier, and this message lands in
    // logs — so the offending value is named only where it is safe to name.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'vault',
      label: 'Vault',
      specifiers: [
        { type: 'select', key: 'key_ref', label: 'Key', encrypted: true,
          options: [{ value: 'primary', label: 'Primary' }] },
      ],
    } as any);
    const err = await svc.setMany('vault', { key_ref: 's3cr3t-handle' }).catch((e) => e);
    expect(err.code).toBe('SETTINGS_VALIDATION');
    expect(err.fields[0]).toMatchObject({ field: 'key_ref', code: 'invalid_option' });
    expect(err.fields[0].value).toBeUndefined();
    expect(err.message).not.toContain('s3cr3t-handle');
  });
});

/**
 * #5204 — the option table is enforced on the ENV side too.
 *
 * The symmetric half of the suite above. `setMany` has checked the declared
 * table since #5131, but `get()` produced an effective value by a second route
 * that never consulted it: an `OS_*` override was reshaped by the default's type
 * (`coerceEnvValue`) and returned straight out of the top of the cascade with
 * `locked: true`. So the values #5094/#5133 retired from `mail.provider` could
 * walk back in through the one door with no gate on it —
 * `OS_MAIL_PROVIDER=sendgrid` reached the mail plugin unchallenged — and a plain
 * typo (`OS_BRANDING_THEME_MODE=drak`) was served to every consumer as a normal
 * value with a normal-looking provenance.
 *
 * Per the ruling on #5204 an offending override is IGNORED, not repaired: the
 * value falls through to the next cascade layer, and the read API reports THAT
 * layer honestly instead of claiming `source: 'env'` for a value not in force.
 */
describe('SettingsService — env overrides are checked against declared options (#5204)', () => {
  /** Capture the loud channel without stubbing the console. */
  const spyLogger = () => {
    const errors: string[] = [];
    return { errors, logger: { error: (m: string) => void errors.push(m) } };
  };

  it('ignores an out-of-table env value and resolves the manifest default instead', async () => {
    const { errors, logger } = spyLogger();
    // The issue's own example: a typo, one transposition away from 'dark'.
    const svc = new SettingsService({ env: { OS_BRANDING_THEME_MODE: 'drak' }, logger });
    svc.registerManifest(brandingSettingsManifest);

    const r = await svc.get('branding', 'theme_mode');
    expect(r.value).toBe('system'); // the manifest default, not 'drak'
    expect(r.source).toBe('default');
    // The override is not in force, so it does not lock anything either.
    expect(r.locked).toBe(false);
    expect(r.lockedReason).toBeUndefined();
    // And it contributes NO cascade entry — an `env` entry here would be read as
    // a layer that supplied (and locked) the value.
    expect(r.cascadeChain?.some((e) => e.scope === 'env')).toBe(false);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OS_BRANDING_THEME_MODE');
    expect(errors[0]).toContain('drak');
    expect(errors[0]).toContain('light, dark, system'); // the legal value set
    expect(errors[0]).toContain('IGNORED');
  });

  it('falls back to the next cascade layer, not straight to the default', async () => {
    // "Ignored" means the env layer is skipped, not that the whole cascade is.
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_BRANDING_THEME_MODE: 'drak' }, logger });
    svc.registerManifest(brandingSettingsManifest);
    await svc.set('branding', 'theme_mode', 'dark');

    const r = await svc.get('branding', 'theme_mode');
    expect(r.value).toBe('dark');
    expect(r.source).toBe('tenant');
    expect(r.locked).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('still lets a value the table DOES declare win at the top of the cascade', async () => {
    // The regression pin for the untouched path: a legal override keeps its
    // precedence, its `locked: true`, and its reason string.
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_BRANDING_THEME_MODE: 'dark' }, logger });
    svc.registerManifest(brandingSettingsManifest);

    const r = await svc.get('branding', 'theme_mode');
    expect(r.value).toBe('dark');
    expect(r.source).toBe('env');
    expect(r.locked).toBe(true);
    expect(r.lockedReason).toContain('OS_BRANDING_THEME_MODE');
    expect(r.cascadeChain?.[0]).toMatchObject({ scope: 'env', effective: true });
    expect(errors).toHaveLength(0);
  });

  it('an IN-FORCE override still pins the key against writes', async () => {
    // The other half of the `locked` contract, unchanged: what `get()` reports as
    // locked, `setMany` refuses. Pinned here so the coherence fix below cannot be
    // over-applied into "env never locks anything".
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_BRANDING_THEME_MODE: 'dark' }, logger });
    svc.registerManifest(brandingSettingsManifest);
    expect((await svc.get('branding', 'theme_mode')).locked).toBe(true);
    await expect(svc.set('branding', 'theme_mode', 'light')).rejects.toBeInstanceOf(
      SettingsLockedError,
    );
  });

  it('a REJECTED override pins nothing — read and write agree the key is editable', async () => {
    // Both halves of `locked` are judged by the same rule, so they cannot
    // disagree. Before this, `setMany` locked on the mere PRESENCE of the env
    // var: the read side would have said `locked: false` while the save threw
    // `SETTINGS_LOCKED`, leaving the key configurable by nothing at all — env
    // value ignored, UI refused — a lockout only an env edit could clear.
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_BRANDING_THEME_MODE: 'drak' }, logger });
    svc.registerManifest(brandingSettingsManifest);

    expect((await svc.get('branding', 'theme_mode')).locked).toBe(false);
    // …and the write the read surface just advertised as possible really is.
    await expect(svc.set('branding', 'theme_mode', 'light')).resolves.toBeDefined();
    const after = await svc.get('branding', 'theme_mode');
    expect(after.value).toBe('light');
    expect(after.source).toBe('tenant');
  });

  it('closes the #5094 door: OS_MAIL_PROVIDER cannot smuggle a retired provider back in', async () => {
    // THE load-bearing case. `sendgrid` and `ses` left `mail.provider` in
    // #5094/#5133 because this server cannot deliver through them; #5131 stopped
    // them at the write path on the same day, and this is the other door.
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_MAIL_PROVIDER: 'sendgrid' }, logger });
    svc.registerManifest(mailSettingsManifest);

    const r = await svc.get('mail', 'provider');
    expect(r.value).toBe('smtp'); // the manifest default
    expect(r.source).toBe('default');
    expect(errors[0]).toContain('smtp, resend, postmark, log');
    // The consequence is spelled out, not left to the reader.
    expect(errors[0]).toContain('does NOT take effect');
    expect(errors[0]).toContain('OS_MAIL_PROVIDER');
  });

  it('leaves keys with no declared option table completely alone', async () => {
    // The OPTION check must not widen past `select`/`radio`/`multiselect` with
    // a table. Note the two values below are legal on every axis, so this stays
    // a pin for the option check specifically: `branding.workspace_name` is
    // free text to the enumeration but does declare `minLength: 1,
    // maxLength: 60`, and since #5932 that window IS enforced on this same path
    // — `EnvCorp` (7) simply sits inside it. `feature_flags.ai_enabled` is a
    // toggle and declares no window at all.
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({
      env: {
        OS_BRANDING_WORKSPACE_NAME: 'EnvCorp', // no option table; length 7 of [1, 60]
        OS_FEATURE_FLAGS_AI_ENABLED: 'true',   // boolean — coerced, not enumerated
      },
      logger,
    });
    svc.registerManifest(brandingSettingsManifest);
    svc.registerManifest(featureFlagsSettingsManifest);

    const name = await svc.get('branding', 'workspace_name');
    expect(name.value).toBe('EnvCorp');
    expect(name.source).toBe('env');
    expect(name.locked).toBe(true);

    const flag = await svc.get('feature_flags', 'ai_enabled');
    expect(flag.value).toBe(true);
    expect(flag.source).toBe('env');

    expect(errors).toHaveLength(0);
  });

  it('reports the misconfiguration at registration, before anything reads the key', async () => {
    // An override that will never take effect is a misconfigured deployment, and
    // the operator should learn at boot rather than whenever someone first opens
    // the settings page (or never, for a key nothing reads this process).
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_MAIL_PROVIDER: 'ses' }, logger });
    expect(errors).toHaveLength(0);

    svc.registerManifest(mailSettingsManifest);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OS_MAIL_PROVIDER');
    expect(errors[0]).toContain('ses');
  });

  it('registration REPORTS but never refuses — a stale pin must not block a boot', async () => {
    // The upgrade trap: `sendgrid` was a legal value the day the deployment was
    // written. Turning today's narrower table into a crash-on-start would punish
    // exactly the operator the message is trying to help.
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_MAIL_PROVIDER: 'sendgrid' }, logger });
    expect(() => svc.registerManifest(mailSettingsManifest)).not.toThrow();
    // The service is fully usable afterwards, including writes to the same key.
    await expect(
      svc.setMany('mail', { provider: 'smtp', smtp_host: 's.example.com', from_email: 'a@b.com' }),
    ).resolves.toBeDefined();
  });

  it('says it ONCE, not once per read', async () => {
    // `getNamespace` resolves every specifier on every settings page load, so a
    // per-read line would be a firehose — and AGENTS.md's "Degradation log
    // levels" names training people to skim `error` as the mirror-image failure.
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_BRANDING_THEME_MODE: 'drak' }, logger });
    svc.registerManifest(brandingSettingsManifest); // one report here
    for (let i = 0; i < 5; i++) await svc.get('branding', 'theme_mode');
    await svc.getNamespace('branding');
    await svc.getNamespace('branding');
    expect(errors).toHaveLength(1);
  });

  it('reports a DIFFERENT bad value that appears after registration', async () => {
    // The dedupe is keyed on the value, not just the var name: `this.env` may be
    // a live `process.env` reference, so a newly-set bad override must not
    // inherit an earlier line's silence.
    const { errors, logger } = spyLogger();
    const env: Record<string, string | undefined> = { OS_BRANDING_THEME_MODE: 'drak' };
    const svc = new SettingsService({ env, logger });
    svc.registerManifest(brandingSettingsManifest);
    expect(errors).toHaveLength(1);

    env.OS_BRANDING_THEME_MODE = 'lite';
    const r = await svc.get('branding', 'theme_mode');
    expect(r.source).toBe('default');
    expect(errors).toHaveLength(2);
    expect(errors[1]).toContain('lite');
  });

  it('the read surface reports the layer actually in force, never a phantom env', async () => {
    // What `GET /api/settings/:ns` serves. Reporting `source: 'env'` with
    // `locked: true` for a value that was discarded would tell an admin the
    // field is pinned by the deployment and not editable — about a value nothing
    // is using.
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_BRANDING_THEME_MODE: 'drak' }, logger });
    svc.registerManifest(brandingSettingsManifest);
    await svc.set('branding', 'theme_mode', 'light');

    const payload = await svc.getNamespace('branding');
    expect(payload.values.theme_mode).toMatchObject({
      value: 'light',
      source: 'tenant',
      locked: false,
    });
    expect(payload.values.theme_mode.cascadeChain?.some((e) => e.scope === 'env')).toBe(false);
    // A sibling key with a legal env override is unaffected in the same payload.
    expect(payload.values.workspace_name.source).toBe('default');
  });

  it('falls back to console.error when no logger is injected', async () => {
    // A service built without a kernel (unit tests, control-plane mock, boot
    // before the logger exists) must still report — going silent there is the
    // very failure #5204 is about.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const svc = new SettingsService({ env: { OS_BRANDING_THEME_MODE: 'drak' } });
      svc.registerManifest(brandingSettingsManifest);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]![0])).toContain('OS_BRANDING_THEME_MODE');
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects the WHOLE multiselect override when any one member is undeclared', async () => {
    // No manifest ships a `multiselect` today, so this is the shape the first one
    // to do so will meet. Partial acceptance is deliberately not on the table: it
    // would synthesise a combination nobody configured.
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({
      // A JSON array, because that is what `coerceEnvValue` produces when the
      // declared default is an array — verified, not assumed.
      env: { OS_DIGEST_CHANNELS: '["email","carrier_pigeon"]' },
      logger,
    });
    svc.registerManifest({
      namespace: 'digest',
      version: 1,
      label: 'Digest',
      scope: 'tenant',
      readPermission: 'setup.access',
      writePermission: 'setup.access',
      specifiers: [
        {
          type: 'multiselect',
          key: 'channels',
          label: 'Channels',
          required: false,
          default: ['email'],
          options: [
            { value: 'email', label: 'Email' },
            { value: 'sms', label: 'SMS' },
          ],
        },
      ],
    } as any);

    const r = await svc.get('digest', 'channels');
    // `email` was legal, but the override is dropped whole — not narrowed to it.
    expect(r.value).toEqual(['email']); // the manifest default, which happens to match
    expect(r.source).toBe('default');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('carrier_pigeon');
    expect(errors[0]).toContain('email, sms');
  });

  it('accepts a multiselect override whose every member is declared', async () => {
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_DIGEST_CHANNELS: '["email","sms"]' }, logger });
    svc.registerManifest({
      namespace: 'digest', version: 1, label: 'Digest', scope: 'tenant',
      readPermission: 'setup.access', writePermission: 'setup.access',
      specifiers: [
        { type: 'multiselect', key: 'channels', label: 'Channels', required: false,
          default: ['email'],
          options: [{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }] },
      ],
    } as any);

    const r = await svc.get('digest', 'channels');
    expect(r.value).toEqual(['email', 'sms']);
    expect(r.source).toBe('env');
    expect(r.locked).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('compares by string form, so a numeric option survives the env round-trip', async () => {
    // An env var is always a string and `coerceEnvValue` turns it back into a
    // number when the default is numeric. Comparing raw would reject the legal
    // value `30`; the table is compared in string form for exactly this reason.
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_RETENTION_WINDOW_DAYS: '30' }, logger });
    svc.registerManifest({
      namespace: 'retention', version: 1, label: 'Retention', scope: 'tenant',
      readPermission: 'setup.access', writePermission: 'setup.access',
      specifiers: [
        { type: 'select', key: 'window_days', label: 'Window', required: false, default: 7,
          options: [{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }] },
      ],
    } as any);

    const r = await svc.get('retention', 'window_days');
    expect(r.value).toBe(30);
    expect(r.source).toBe('env');
    expect(errors).toHaveLength(0);
  });

  it('never echoes the rejected value for an encrypted specifier', async () => {
    // An option value is not a secret, but `encrypted` is authorable on ANY
    // specifier, and this message lands in logs. Same rule as the save path.
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_VAULT_KEY_REF: 's3cr3t-handle' }, logger });
    svc.registerManifest({
      namespace: 'vault', version: 1, label: 'Vault', scope: 'tenant',
      readPermission: 'setup.access', writePermission: 'setup.access',
      specifiers: [
        { type: 'select', key: 'key_ref', label: 'Key reference', required: false,
          encrypted: true,
          options: [{ value: 'primary', label: 'Primary' }, { value: 'backup', label: 'Backup' }] },
      ],
    } as any);

    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toContain('s3cr3t-handle');
    // …but it still names the var and the legal set, so the message stays useful.
    expect(errors[0]).toContain('OS_VAULT_KEY_REF');
    expect(errors[0]).toContain('primary, backup');
  });
});

/**
 * #5932 — a manifest's declared value WINDOW is enforced at SAVE time.
 *
 * The third member of the family `required`/`pattern` (#4224) and `options`
 * (#5131) already belong to. `SpecifierSchema` has declared five value
 * constraints since it existed — `pattern`, `min`, `max`, `minLength`,
 * `maxLength` — and `validatePatch` read exactly one of them. The other four
 * had no reader anywhere on the write path: 42 specifiers across the shipped
 * manifests declared a window, and every one of those windows was decoration.
 *
 * The load-bearing case is `auth.password_min_length`. It declares `min: 6`,
 * the console renders a number input with that floor, and `PUT
 * /api/settings/auth` accepted `1` — or `-3` — and stored it, whereupon
 * better-auth's password policy honoured the stored number. The declaration was
 * the only thing claiming a floor existed, and nothing at all was holding it.
 */
describe('SettingsService — save-time validation (declared value windows are enforced, #5932)', () => {
  /** The issue's own probe manifest, verbatim. */
  const boundsManifest = {
    namespace: 'probe',
    version: 1,
    label: 'Probe',
    scope: 'tenant',
    readPermission: 'setup.access',
    writePermission: 'setup.access',
    specifiers: [
      { type: 'number', key: 'quota', label: 'Quota', required: false, default: 10, min: 0, max: 100 },
      { type: 'text', key: 'code', label: 'Code', required: false, minLength: 2, maxLength: 4 },
      { type: 'slider', key: 'ratio', label: 'Ratio', required: false, default: 0.5, min: 0, max: 1 },
    ],
  } as any;

  const probeService = () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(boundsManifest);
    return svc;
  };

  it('refuses a number below the declared min, naming the window', async () => {
    const svc = probeService();
    await expect(svc.setMany('probe', { quota: -500 })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [
        {
          field: 'quota',
          // The `FieldErrorCode` member that mirrors the breached property
          // (ADR-0114 D2) — the same one `record-validator.ts` emits for the
          // same breach on a field def.
          code: 'min_value',
          label: 'Quota',
          // BOTH declared bounds travel as a discrete constraint, which is the
          // shape `errors.zod.ts` documents by example (`{ min: 0, max: 120 }`
          // on a `max_value`): a client rendering the input needs the whole
          // window, not only the side that was breached.
          constraint: { min: 0, max: 100 },
          value: -500,
        },
      ],
    });
    // Atomic: the rejected batch persisted nothing.
    expect((await svc.get('probe', 'quota')).source).toBe('default');
  });

  it('refuses a number above the declared max', async () => {
    const svc = probeService();
    await expect(svc.setMany('probe', { quota: 999999 })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{ field: 'quota', code: 'max_value', constraint: { min: 0, max: 100 }, value: 999999 }],
    });
  });

  it('refuses a string shorter than minLength and longer than maxLength', async () => {
    const svc = probeService();
    await expect(svc.setMany('probe', { code: 'X' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [
        {
          field: 'code',
          code: 'min_length',
          // `actual` rides along for the length codes, the way the record
          // validator already emits it — a client formatting "3 of 4 max"
          // should not have to measure the string it just sent back.
          constraint: { minLength: 2, maxLength: 4, actual: 1 },
        },
      ],
    });
    await expect(svc.setMany('probe', { code: 'ABCDEFGHIJ' })).rejects.toMatchObject({
      fields: [
        { field: 'code', code: 'max_length', constraint: { minLength: 2, maxLength: 4, actual: 10 } },
      ],
    });
  });

  it('refuses a slider outside its declared window', async () => {
    const svc = probeService();
    await expect(svc.setMany('probe', { ratio: 42 })).rejects.toMatchObject({
      fields: [{ field: 'ratio', code: 'max_value', constraint: { min: 0, max: 1 } }],
    });
  });

  it('accepts every value inside the window, bounds INCLUSIVE', async () => {
    // `min`/`max` name the window's members, not the values just outside it —
    // an off-by-one here would reject `password_history_count: 0` (declared
    // `min: 0`, and the value that DISABLES the check) on every workspace.
    const svc = probeService();
    await expect(svc.setMany('probe', { quota: 0 })).resolves.toBeDefined();
    await expect(svc.setMany('probe', { quota: 100 })).resolves.toBeDefined();
    await expect(svc.setMany('probe', { quota: 50 })).resolves.toBeDefined();
    await expect(svc.setMany('probe', { code: 'ab' })).resolves.toBeDefined();
    await expect(svc.setMany('probe', { code: 'abcd' })).resolves.toBeDefined();
    await expect(svc.setMany('probe', { ratio: 0 })).resolves.toBeDefined();
    await expect(svc.setMany('probe', { ratio: 1 })).resolves.toBeDefined();
  });

  it('compares a number that arrived as a string, so a form post is not enforced-as-transport', async () => {
    // Same rule the option table applies for the same reason: a stored value
    // has been through JSON and, over REST, a form post.
    const svc = probeService();
    await expect(svc.setMany('probe', { quota: '50' })).resolves.toBeDefined();
    await expect(svc.setMany('probe', { quota: '999999' })).rejects.toMatchObject({
      fields: [{ field: 'quota', code: 'max_value' }],
    });
  });

  it('checks the window only when the patch TOUCHES the key', async () => {
    // The #5131 gate, inherited. Bounds get TIGHTENED over a product's life, so
    // a workspace can hold a value that was legal when it was written — here,
    // written under `max: 1000` and re-registered under `max: 100`. It must not
    // be locked out of its own settings page over that.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      ...boundsManifest,
      specifiers: boundsManifest.specifiers.map((s: any) =>
        s.key === 'quota' ? { ...s, max: 1000 } : s,
      ),
    } as any);
    await svc.setMany('probe', { quota: 900 });
    svc.registerManifest(boundsManifest); // the narrowed window

    // The stale value is still there …
    expect((await svc.get('probe', 'quota')).value).toBe(900);
    // … and a patch that never mentions `quota` is not rejected on its account.
    await expect(svc.setMany('probe', { code: 'abc' })).resolves.toBeDefined();
    expect((await svc.get('probe', 'code')).value).toBe('abc');
    // Only re-writing the key itself is refused.
    await expect(svc.setMany('probe', { quota: 900 })).rejects.toMatchObject({
      fields: [{ field: 'quota', code: 'max_value' }],
    });
    // And a reset still clears it — an all-null patch is never blocked.
    await expect(svc.resetNamespace('probe')).resolves.toBeGreaterThan(0);
    expect((await svc.get('probe', 'quota')).value).toBe(10); // back to the default
  });

  it('leaves a specifier that declares no window completely alone', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'freeform', version: 1, label: 'Freeform', scope: 'tenant',
      readPermission: 'setup.access', writePermission: 'setup.access',
      specifiers: [
        { type: 'number', key: 'anything', label: 'Anything' },
        { type: 'text', key: 'note', label: 'Note' },
      ],
    } as any);
    await expect(svc.setMany('freeform', { anything: -1e9 })).resolves.toBeDefined();
    await expect(svc.setMany('freeform', { note: '' })).resolves.toBeDefined();
    await expect(svc.setMany('freeform', { note: 'x'.repeat(5000) })).resolves.toBeDefined();
  });

  it('leaves a value it cannot compare alone — that is a different constraint', async () => {
    // Policing the value's SHAPE is `invalid_type`/`invalid_number`, a different
    // constraint with a different owner. Coercing here would be worse than
    // silent: `Number(true)` is 1 and `Number([])` is 0, so a boolean written to
    // a `min: 6` key would be REJECTED as "1" — inventing a verdict about a
    // shape this check was never asked to judge.
    const svc = probeService();
    await expect(svc.setMany('probe', { quota: true })).resolves.toBeDefined();
    await expect(svc.setMany('probe', { quota: 'not-a-number' })).resolves.toBeDefined();
    await expect(svc.setMany('probe', { code: 12345 })).resolves.toBeDefined();
    // Empty is `required`'s business, not the window's — a blank text field
    // under `minLength: 2` is "unset", not "too short".
    await expect(svc.setMany('probe', { code: '' })).resolves.toBeDefined();
    await expect(svc.setMany('probe', { code: null })).resolves.toBeDefined();
  });

  it('never echoes the out-of-window value for an encrypted specifier', async () => {
    // Same rule as `invalid_option`, same reason: a bound is not a secret, but
    // `encrypted` is authorable on any specifier and this message travels back
    // through the API and into logs.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'vault', version: 1, label: 'Vault', scope: 'tenant',
      readPermission: 'setup.access', writePermission: 'setup.access',
      specifiers: [
        { type: 'text', key: 'token', label: 'Token', encrypted: true, minLength: 32 },
      ],
    } as any);
    const err = await svc.setMany('vault', { token: 's3cr3t' }).catch((e) => e);
    expect(err.code).toBe('SETTINGS_VALIDATION');
    expect(err.fields[0]).toMatchObject({ field: 'token', code: 'min_length' });
    expect(err.fields[0].value).toBeUndefined();
    expect(err.message).not.toContain('s3cr3t');
    // The window still travels, so the caller learns what to do.
    expect(err.fields[0].constraint).toMatchObject({ minLength: 32, actual: 6 });
  });

  it('reports one FieldError per key — the first constraint the value broke', async () => {
    // `required` and `invalid_option` already `continue` once they have spoken;
    // the window check keeps that contract so a client is handed one verdict to
    // render rather than a pile it must rank itself.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'both', version: 1, label: 'Both', scope: 'tenant',
      readPermission: 'setup.access', writePermission: 'setup.access',
      specifiers: [
        { type: 'text', key: 'slug', label: 'Slug', pattern: '^[a-z]+$', minLength: 5 },
      ],
    } as any);
    const err = await svc.setMany('both', { slug: 'AB' }).catch((e) => e);
    expect(err.fields).toHaveLength(1);
    expect(err.fields[0].code).toBe('invalid_format'); // pattern is checked first
  });

  it('closes the password-policy hole end-to-end on the real auth manifest', async () => {
    // THE case the issue was filed for. `auth.password_min_length` declares
    // `min: 6, max: 64`; before this gate a `PUT /api/settings/auth` writing `1`
    // was accepted, stored, and honoured by better-auth's password policy.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(authSettingsManifest);

    await expect(svc.setMany('auth', { password_min_length: 1 })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [
        {
          field: 'password_min_length',
          code: 'min_value',
          label: 'Minimum password length',
          constraint: { min: 6, max: 64 },
          value: 1,
        },
      ],
    });
    // Nothing was stored — the floor is still whatever the manifest says.
    expect((await svc.get('auth', 'password_min_length')).value).toBe(8);
    // Negatives, the other half of the issue's table.
    await expect(svc.setMany('auth', { password_history_count: -1 })).rejects.toMatchObject({
      fields: [{ field: 'password_history_count', code: 'min_value', constraint: { min: 0, max: 24 } }],
    });
    await expect(svc.setMany('auth', { password_expiry_days: -1 })).rejects.toMatchObject({
      fields: [{ field: 'password_expiry_days', code: 'min_value' }],
    });
    // …and a legal tightening still goes through.
    await expect(svc.setMany('auth', { password_min_length: 12 })).resolves.toBeDefined();
    expect((await svc.get('auth', 'password_min_length')).value).toBe(12);
  });

  it('covers the rest of the six password-policy keys the issue tabulated', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(authSettingsManifest);
    // `password_min_classes` is visible only with complexity on, so the patch
    // carries the toggle it depends on — otherwise the TOUCH gate skips it as
    // an invisible specifier, which is the required/visible contract, not a hole.
    await expect(
      svc.setMany('auth', { password_require_complexity: true, password_min_classes: 9 }),
    ).rejects.toMatchObject({
      fields: [{ field: 'password_min_classes', code: 'max_value', constraint: { min: 1, max: 4 } }],
    });
    await expect(svc.setMany('auth', { password_max_length: 4 })).rejects.toMatchObject({
      fields: [{ field: 'password_max_length', code: 'min_value', constraint: { min: 16, max: 256 } }],
    });
  });
});

/**
 * #5932, env half — the declared window is enforced on the ENV side too, at the
 * ONE decision point the option table is already judged at.
 *
 * This is the explicit ruling on the issue: #5204 exists because the same
 * comparison lived in two places and the two drifted, so the window check goes
 * through `effectiveEnvOverride` rather than opening a second implementation on
 * the env path. Consequences follow from that single point, not from a second
 * copy of the policy: a rejected override is IGNORED (never repaired), it
 * contributes no cascade entry, it pins nothing, and it is reported once.
 */
describe('SettingsService — env overrides are checked against declared windows (#5932)', () => {
  const spyLogger = () => {
    const errors: string[] = [];
    return { errors, logger: { error: (m: string) => void errors.push(m) } };
  };

  it('ignores OS_AUTH_PASSWORD_MIN_LENGTH=1 and resolves the manifest default instead', async () => {
    // The issue's own env repro: the same value the save path now refuses,
    // arriving through the one door that had no gate on it.
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_AUTH_PASSWORD_MIN_LENGTH: '1' }, logger });
    svc.registerManifest(authSettingsManifest);

    const r = await svc.get('auth', 'password_min_length');
    expect(r.value).toBe(8); // the manifest default, not 1
    expect(r.source).toBe('default');
    // Not in force, so it pins nothing either — read and write agree.
    expect(r.locked).toBe(false);
    expect(r.cascadeChain?.some((e) => e.scope === 'env')).toBe(false);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OS_AUTH_PASSWORD_MIN_LENGTH');
    expect(errors[0]).toContain('min 6, max 64');
    expect(errors[0]).toContain('IGNORED');
    expect(errors[0]).toContain('does NOT take effect');
  });

  it('an in-window override still wins at the top of the cascade and locks the key', async () => {
    // The regression pin for the untouched path — the check must not turn into
    // "env never applies to a bounded key".
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_AUTH_PASSWORD_MIN_LENGTH: '12' }, logger });
    svc.registerManifest(authSettingsManifest);

    const r = await svc.get('auth', 'password_min_length');
    expect(r.value).toBe(12);
    expect(r.source).toBe('env');
    expect(r.locked).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('a REJECTED override pins nothing — the key stays editable', async () => {
    // The `locked` coherence rule #5204 established, extended to the second
    // family for free BECAUSE both are judged at the one point: a key
    // configurable by nothing (env ignored, UI refused) would be a lockout only
    // an env edit could clear.
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_AUTH_PASSWORD_MIN_LENGTH: '1' }, logger });
    svc.registerManifest(authSettingsManifest);

    expect((await svc.get('auth', 'password_min_length')).locked).toBe(false);
    await expect(svc.set('auth', 'password_min_length', 10)).resolves.toBeDefined();
    const after = await svc.get('auth', 'password_min_length');
    expect(after.value).toBe(10);
    expect(after.source).toBe('global'); // the auth manifest is `scope: 'global'`
  });

  it('rejects a too-long text override by the same rule', async () => {
    // `branding.workspace_name` declares `minLength: 1, maxLength: 60`.
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({
      env: { OS_BRANDING_WORKSPACE_NAME: 'N'.repeat(61) },
      logger,
    });
    svc.registerManifest(brandingSettingsManifest);

    const r = await svc.get('branding', 'workspace_name');
    expect(r.source).toBe('default');
    expect(r.locked).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('min 1, max 60 characters');
    expect(errors[0]).toContain('outside the declared length');
  });

  it('reports the misconfiguration at registration, before anything reads the key', async () => {
    // Same contract as the option table: a boot-time line for an override that
    // will never take effect, including for keys nothing reads this process.
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_AUTH_PASSWORD_MIN_LENGTH: '1' }, logger });
    expect(errors).toHaveLength(0);
    svc.registerManifest(authSettingsManifest);
    expect(errors).toHaveLength(1);
  });

  it('registration REPORTS but never refuses — a stale pin must not block a boot', async () => {
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_AUTH_PASSWORD_MIN_LENGTH: '1' }, logger });
    expect(() => svc.registerManifest(authSettingsManifest)).not.toThrow();
    await expect(svc.setMany('auth', { password_min_length: 10 })).resolves.toBeDefined();
  });

  it('says it ONCE, not once per read', async () => {
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_AUTH_PASSWORD_MIN_LENGTH: '1' }, logger });
    svc.registerManifest(authSettingsManifest);
    for (let i = 0; i < 5; i++) await svc.get('auth', 'password_min_length');
    await svc.getNamespace('auth');
    expect(errors).toHaveLength(1);
  });

  it('never echoes the rejected value for an encrypted specifier', async () => {
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_VAULT_TOKEN: 's3cr3t' }, logger });
    svc.registerManifest({
      namespace: 'vault', version: 1, label: 'Vault', scope: 'tenant',
      readPermission: 'setup.access', writePermission: 'setup.access',
      specifiers: [
        { type: 'text', key: 'token', label: 'Token', required: false, encrypted: true, minLength: 32 },
      ],
    } as any);

    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toContain('s3cr3t');
    expect(errors[0]).toContain('OS_VAULT_TOKEN');
    expect(errors[0]).toContain('min 32 characters');
  });

  it('leaves an env value it cannot compare alone', async () => {
    // A `number` specifier with no declared default: `coerceEnvValue` has no
    // type hint, so the raw string survives. A non-numeric one is not judged
    // here — the same "different constraint, different owner" rule the save
    // path takes.
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_LOOSE_COUNT: 'lots' }, logger });
    svc.registerManifest({
      namespace: 'loose', version: 1, label: 'Loose', scope: 'tenant',
      readPermission: 'setup.access', writePermission: 'setup.access',
      specifiers: [{ type: 'number', key: 'count', label: 'Count', min: 0, max: 10 }],
    } as any);

    const r = await svc.get('loose', 'count');
    expect(r.value).toBe('lots');
    expect(r.source).toBe('env');
    expect(errors).toHaveLength(0);
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
