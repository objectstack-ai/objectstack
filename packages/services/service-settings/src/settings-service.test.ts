// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings-service.js';
import {
  SettingsCryptoUnavailableError,
  SettingsLockedError,
  UnknownKeyError,
  UnknownNamespaceError,
  envKeyOf,
} from './settings-service.types.js';
import type { CryptoAdapter } from './crypto-adapter.js';
import { mailSettingsManifest, mailTestActionHandler } from './manifests/mail.manifest.js';
import { aiSettingsManifest } from './manifests/ai.manifest.js';
import { authSettingsManifest } from './manifests/auth.manifest.js';
import { localizationSettingsManifest } from './manifests/localization.manifest.js';
import { companySettingsManifest } from './manifests/company.manifest.js';
import { brandingSettingsManifest } from './manifests/branding.manifest.js';
import { featureFlagsSettingsManifest } from './manifests/feature-flags.manifest.js';
import { builtinSettingsManifests } from './manifests/index.js';
import { evaluateVisibility, visibilitySource } from './visibility-eval.js';
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

/**
 * Stands in for a real, injected `CryptoAdapter` (a KMS-backed one in
 * production). What matters to the write path is the DECLARATION — an adapter
 * that says it protects its input is trusted to, exactly as a KMS adapter is —
 * so the wrapping itself is deliberately trivial and reversible in-test.
 */
class ReversibleTestAdapter implements CryptoAdapter {
  readonly confidential = true;
  async encrypt(plaintext: string): Promise<string> {
    return 'kms:' + Buffer.from(plaintext, 'utf8').toString('base64');
  }
  async decrypt(ciphertext: string): Promise<string> {
    return Buffer.from(ciphertext.replace(/^kms:/, ''), 'base64').toString('utf8');
  }
  digest(): string {
    return 'fnv32:deadbeef';
  }
}

describe('SettingsService — encryption round-trip', () => {
  // #8026 — this case used to inject `new NoopCryptoAdapter()`, which the write
  // path now REFUSES (base64 is encoding, not encryption). Re-pointed rather
  // than deleted or merely re-spelled: its subject is the injected-adapter seam
  // (`opts.crypto` still holds and returns an encrypted value), and a fixture
  // pinned to the refused limb would have kept passing only because nothing was
  // being stored. The refusal itself is pinned in
  // `settings-crypto-fail-closed.test.ts`; what stays here is the positive half.
  it('persists encrypted=true values via crypto adapter', async () => {
    const svc = new SettingsService({ env: {}, crypto: new ReversibleTestAdapter() });
    svc.registerManifest(mailSettingsManifest);
    await svc.setMany('mail', { provider: 'resend', api_key: 're-secret-123', from_email: 'a@b.com' });
    const ns = await svc.getNamespace('mail');
    expect(ns.values.api_key.value).toBe('re-secret-123');
    expect(ns.values.api_key.source).toBe('global');
  });

  it('an adapter that declares no confidentiality is refused, whatever its class', async () => {
    // Not a NoopCryptoAdapter — the gate reads the DECLARATION, so a bespoke
    // development adapter opting out is refused on the same terms.
    const declaredWeak: CryptoAdapter = {
      confidential: false,
      encrypt: async (p) => 'weak:' + p,
      decrypt: async (c) => c.replace(/^weak:/, ''),
      digest: () => 'fnv32:00000000',
    };
    const svc = new SettingsService({ env: {}, crypto: declaredWeak });
    svc.registerManifest(mailSettingsManifest);
    await expect(
      svc.setMany('mail', { provider: 'resend', api_key: 're-secret-123', from_email: 'a@b.com' }),
    ).rejects.toBeInstanceOf(SettingsCryptoUnavailableError);
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
      // #8026 — the subject is the audit event's masked digest, which only
      // exists for a value that was actually persisted; the adapter declares
      // confidentiality so the write is allowed to happen at all.
      crypto: new ReversibleTestAdapter(),
      audit: {
        record: (e) => {
          events.push(e);
        },
      },
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
    // #8026 — same reason as `mailService` below: the provider configs these
    // cases save carry a declared secret (`cloudflare_api_key`), which the
    // write path will not persist through an adapter that provides no
    // confidentiality. The subject here is required/visible validation.
    const svc = new SettingsService({ env: {}, crypto: new ReversibleTestAdapter() });
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
    // #8026 — these cases write `api_key` (a declared secret) only as part of a
    // complete provider config; their subject is the option table. The write
    // path now refuses a secret when nothing can encrypt it, so the fixture
    // declares an adapter that can, and the option-table assertions stay about
    // the option table.
    const svc = new SettingsService({ env: {}, crypto: new ReversibleTestAdapter() });
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
    // (#8026 — `crypto` for the same reason as `mailService`: the seed write
    // carries `api_key`.)
    const svc = new SettingsService({ env: {}, crypto: new ReversibleTestAdapter() });
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

/**
 * #6199 — `step`, the fifth and last of `SpecifierSchema`'s value constraints,
 * is enforced on the same two paths as the other four.
 *
 * The reading that settles it is the schema's own. `step` is declared under the
 * SAME "numeric bounds and step" doc comment as `min`/`max`, so it is authored
 * as a BOUND, and #5932's ruling — a declared bound binds — transfers with it.
 * The competing reading, that `step` is only
 * an `input[type=number]` arrow increment and never says other values are
 * illegal, was checked and does not survive contact: `step` had ZERO read
 * points at the time this landed — nothing in `packages/services/
 * service-settings`, nothing anywhere else in this repo, and nothing in
 * `objectui` — so under that reading the key would be enforcing presentation
 * for a renderer that does not exist. A declaration with no consumer at all is
 * the ADR-0049 hole, not a UI affordance.
 *
 * The consequence was real and was accepted at ruling time: `ai.temperature`
 * then declared `min: 0, max: 2, step: 0.1`, so `0.15` — a perfectly sensible
 * temperature for the model behind it — was refused. The manifest owner's
 * question that ruling left open was answered by #6550: the grid came OFF the
 * ai manifest (temperature's true domain is continuous on [0, 2]), so the
 * fixtures below are synthetic step-declaring specifiers. The machinery they
 * pin is unchanged and still binds any key that declares `step`; the real ai
 * manifest's post-#6550 behaviour is pinned in `manifests/ai.manifest.test.ts`.
 */
describe('SettingsService — the declared step grid is enforced at save time (#6199)', () => {
  /**
   * Three shapes the grid arrives in: with a window (the `ai.temperature`
   * shape), with no window at all, and anchored somewhere other than zero.
   */
  const gridManifest = {
    namespace: 'grid',
    version: 1,
    label: 'Grid',
    scope: 'tenant',
    readPermission: 'setup.access',
    writePermission: 'setup.access',
    specifiers: [
      { type: 'slider', key: 'temperature', label: 'Temperature', required: false,
        default: 0.7, min: 0, max: 2, step: 0.1 },
      { type: 'number', key: 'bare', label: 'Bare', required: false, step: 5 },
      { type: 'number', key: 'odd', label: 'Odd', required: false, min: 1, max: 9, step: 2 },
    ],
  } as any;

  const gridService = () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(gridManifest);
    return svc;
  };

  it('refuses a value that misses the grid, naming the step', async () => {
    const svc = gridService();
    await expect(svc.setMany('grid', { temperature: 0.15 })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [
        {
          field: 'temperature',
          // No `FieldErrorCode` member names a grid breach, so it takes
          // `invalid_value` — the catalog's declared slot for "rejected for a
          // reason no other member names" (ADR-0114). The same verdict
          // `rest-server.ts` already reaches for Zod's `not_multiple_of`, which
          // is this exact condition arriving from the other direction.
          code: 'invalid_value',
          label: 'Temperature',
          // The spacing AND its anchor: a client cannot reconstruct the grid
          // from the step alone, and this specifier's base is its `min`.
          constraint: { step: 0.1, min: 0 },
          value: 0.15,
        },
      ],
    });
    // Atomic: the rejected batch persisted nothing.
    expect((await svc.get('grid', 'temperature')).source).toBe('default');
  });

  it('accepts the decimal multiples binary floating point cannot represent exactly', async () => {
    // THE reason an exact modulo is the wrong implementation. Not every decimal
    // multiple misses — `2 / 0.1` and `0.2 / 0.1` happen to land exactly — which
    // is precisely what makes the trap dangerous: it fires on SOME values of a
    // grid and not others, so a naive check looks correct until an author picks
    // the wrong temperature. The two pinned below are values the console's own
    // slider emits, and `n % step === 0` refuses both.
    expect(0.7 / 0.1).not.toBe(7);  // 6.999999999999999
    expect(1.2 / 0.1).not.toBe(12); // 11.999999999999998
    // The tolerance is relative (1e-9 of the magnitudes involved) — six orders
    // of magnitude above the ~1e-15 a few double operations accumulate, and
    // eight below the 3e-1 relative miss of a genuinely off-grid `0.15`.
    const svc = gridService();
    for (const v of [0, 0.1, 0.2, 0.3, 0.1 + 0.2, 0.7, 0.9, 1.1, 1.2, 1.9, 2]) {
      await expect(
        svc.setMany('grid', { temperature: v }),
        `${v} sits on the 0.1 grid and must be accepted`,
      ).resolves.toBeDefined();
    }
  });

  it('refuses the off-grid neighbours of those same values', async () => {
    // The other half of the tolerance pin: it must still be a check. Each of
    // these is a half-step away from a legal value, not a rounding artefact.
    const svc = gridService();
    for (const v of [0.05, 0.15, 0.25, 0.75, 1.99]) {
      await expect(
        svc.setMany('grid', { temperature: v }),
        `${v} misses the 0.1 grid and must be refused`,
      ).rejects.toMatchObject({
        code: 'SETTINGS_VALIDATION',
        fields: [{ field: 'temperature', code: 'invalid_value' }],
      });
    }
  });

  it('anchors the grid at the declared min, not at zero', async () => {
    // The HTML step-base convention, and the only one that makes the
    // declaration mean what it reads as: `min: 1, step: 2` names the ODD
    // numbers. Anchoring at 0 regardless would invert this specifier entirely
    // — it would accept exactly the values the author excluded.
    const svc = gridService();
    for (const v of [1, 3, 5, 9]) {
      await expect(svc.setMany('grid', { odd: v }), `${v} is on the min-anchored grid`)
        .resolves.toBeDefined();
    }
    for (const v of [2, 4, 8]) {
      await expect(svc.setMany('grid', { odd: v }), `${v} is off the min-anchored grid`)
        .rejects.toMatchObject({
          fields: [{ field: 'odd', code: 'invalid_value', constraint: { step: 2, min: 1 } }],
        });
    }
  });

  it('falls back to a zero anchor when the specifier declares no min', async () => {
    const svc = gridService();
    await expect(svc.setMany('grid', { bare: 0 })).resolves.toBeDefined();
    await expect(svc.setMany('grid', { bare: 15 })).resolves.toBeDefined();
    await expect(svc.setMany('grid', { bare: -10 })).resolves.toBeDefined();
    await expect(svc.setMany('grid', { bare: 12 })).rejects.toMatchObject({
      // No `min` was declared, so none travels in the constraint either — the
      // client is told the spacing and nothing invented.
      fields: [{ field: 'bare', code: 'invalid_value', constraint: { step: 5 } }],
    });
  });

  it('reports the WINDOW before the grid when a value breaches both', async () => {
    // `validatePatch` emits at most one `FieldError` per key, so the ordering
    // decides what the author is told. The window is the coarser, more
    // actionable fact: `temperature: 40` is twenty times the declared maximum,
    // and answering "it misses the 0.1 grid" — true, and useless — would bury
    // that.
    const svc = gridService();
    await expect(svc.setMany('grid', { temperature: 40.05 })).rejects.toMatchObject({
      fields: [{ field: 'temperature', code: 'max_value', constraint: { min: 0, max: 2 } }],
    });
    await expect(svc.setMany('grid', { temperature: -0.05 })).rejects.toMatchObject({
      fields: [{ field: 'temperature', code: 'min_value' }],
    });
  });

  it('checks the grid only when the patch TOUCHES the key', async () => {
    // The #5131/#5932 gate, inherited for the same reason and one more: a grid
    // gets COARSENED over a product's life (a 0.05 slider re-declared at 0.1),
    // and a workspace holding a value that was legal when it was written must
    // still be able to edit its unrelated settings.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      ...gridManifest,
      specifiers: gridManifest.specifiers.map((s: any) =>
        s.key === 'temperature' ? { ...s, step: 0.05 } : s,
      ),
    } as any);
    await svc.setMany('grid', { temperature: 0.15 });
    svc.registerManifest(gridManifest); // the coarsened grid

    // The stale value is still there …
    expect((await svc.get('grid', 'temperature')).value).toBe(0.15);
    // … and a patch that never mentions it is not rejected on its account.
    await expect(svc.setMany('grid', { bare: 10 })).resolves.toBeDefined();
    expect((await svc.get('grid', 'bare')).value).toBe(10);
    // Only re-writing the key itself is refused.
    await expect(svc.setMany('grid', { temperature: 0.15 })).rejects.toMatchObject({
      fields: [{ field: 'temperature', code: 'invalid_value' }],
    });
    // And a reset still clears it — an all-null patch is never blocked.
    await expect(svc.resetNamespace('grid')).resolves.toBeGreaterThan(0);
    expect((await svc.get('grid', 'temperature')).value).toBe(0.7); // back to the default
  });

  it('compares a number that arrived as a string, so a form post is not enforced-as-transport', async () => {
    const svc = gridService();
    await expect(svc.setMany('grid', { temperature: '0.2' })).resolves.toBeDefined();
    await expect(svc.setMany('grid', { temperature: '0.15' })).rejects.toMatchObject({
      fields: [{ field: 'temperature', code: 'invalid_value' }],
    });
  });

  it('leaves a value it cannot compare alone — that is a different constraint', async () => {
    // Same posture the window check takes: the value's SHAPE is `invalid_type`'s
    // business. `Number(true)` is 1 and `Number([])` is 0, so coercing here
    // would invent a grid verdict about a shape this check never judges.
    const svc = gridService();
    await expect(svc.setMany('grid', { temperature: true })).resolves.toBeDefined();
    await expect(svc.setMany('grid', { temperature: 'warm' })).resolves.toBeDefined();
    await expect(svc.setMany('grid', { temperature: [] })).resolves.toBeDefined();
    await expect(svc.setMany('grid', { temperature: { v: 0.15 } })).resolves.toBeDefined();
    // Empty is `required`'s business, not the grid's.
    await expect(svc.setMany('grid', { temperature: null })).resolves.toBeDefined();
  });

  it('treats a step that is not a positive spacing as no grid at all', async () => {
    // `anchor + k * 0` is a single point, and a negative spacing names the same
    // grid as its absolute value while reading as an author error. Neither is a
    // grid, so neither records one — the same disposition an option-bearing
    // specifier with no table gets. Registration REPORTS and never refuses
    // (#5204); an impossible grid has nothing to report, because it rejects no
    // write and misconfigures no deployment.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'nogrid', version: 1, label: 'No grid', scope: 'tenant',
      readPermission: 'setup.access', writePermission: 'setup.access',
      specifiers: [
        { type: 'number', key: 'zero', label: 'Zero', step: 0 },
        { type: 'number', key: 'negative', label: 'Negative', step: -0.1 },
        { type: 'number', key: 'nan', label: 'NaN', step: Number.NaN },
        // A bad step must not swallow the window declared beside it.
        { type: 'number', key: 'windowed', label: 'Windowed', min: 0, max: 10, step: 0 },
      ],
    } as any);
    for (const key of ['zero', 'negative', 'nan']) {
      await expect(svc.setMany('nogrid', { [key]: 3.14159 }), `${key} declares no grid`)
        .resolves.toBeDefined();
    }
    await expect(svc.setMany('nogrid', { windowed: 3.14159 })).resolves.toBeDefined();
    await expect(svc.setMany('nogrid', { windowed: 99 })).rejects.toMatchObject({
      fields: [{ field: 'windowed', code: 'max_value' }],
    });
  });

  it('never echoes the off-grid value for an encrypted specifier', async () => {
    // Same rule as `invalid_option` and the window codes, same reason: a grid is
    // not a secret, but `encrypted` is authorable on any specifier and this
    // message travels back through the API and into logs.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'vaultgrid', version: 1, label: 'Vault grid', scope: 'tenant',
      readPermission: 'setup.access', writePermission: 'setup.access',
      specifiers: [
        { type: 'number', key: 'shard', label: 'Shard', encrypted: true, min: 0, step: 100 },
      ],
    } as any);
    const err = await svc.setMany('vaultgrid', { shard: 12345 }).catch((e) => e);
    expect(err.code).toBe('SETTINGS_VALIDATION');
    expect(err.fields[0]).toMatchObject({ field: 'shard', code: 'invalid_value' });
    expect(err.fields[0].value).toBeUndefined();
    expect(err.message).not.toContain('12345');
    // The grid still travels, so the caller learns what to do.
    expect(err.fields[0].constraint).toMatchObject({ step: 100, min: 0 });
  });

  // Until #6550 this block also pinned the one real declaration the gate
  // bound: `ai.temperature`'s `step: 0.1` refusing `0.15`. That ruling took
  // the grid off the ai manifest (temperature's true domain is continuous),
  // so the real-manifest pin MOVED with the declaration — both doors'
  // post-#6550 behaviour is pinned in `manifests/ai.manifest.test.ts`, and
  // the grid machinery keeps binding through the synthetic fixtures above.
});

/**
 * #6199, env half — the grid is judged at the ONE decision point
 * (`effectiveEnvOverride`), for the reason #5204 is on file: the same
 * comparison in two places is how the env half came to disagree with the save
 * half in the first place. `step` rides `DeclaredBounds` and
 * `firstRangeViolation`, so it reaches both doors by construction.
 *
 * The fixture is synthetic since #6550 took the grid off `ai.temperature`
 * (this machinery needs a step-declaring key to bind, and the repo no longer
 * ships one); it keeps the exact shape `ai.temperature` had at ruling time.
 * The real ai manifest's env door is pinned in `manifests/ai.manifest.test.ts`.
 */
describe('SettingsService — env overrides are checked against the declared step grid (#6199)', () => {
  const gridEnvManifest = {
    namespace: 'gridenv',
    version: 1,
    label: 'Grid env',
    scope: 'global',
    readPermission: 'setup.access',
    writePermission: 'setup.access',
    specifiers: [
      { type: 'slider', key: 'temperature', label: 'Temperature', required: false,
        default: 0.7, min: 0, max: 2, step: 0.1 },
    ],
  } as any;

  const spyLogger = () => {
    const errors: string[] = [];
    return { errors, logger: { error: (m: string) => void errors.push(m) } };
  };

  it('ignores an off-grid OS_GRIDENV_TEMPERATURE and resolves the manifest default instead', async () => {
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_GRIDENV_TEMPERATURE: '0.15' }, logger });
    svc.registerManifest(gridEnvManifest);

    const r = await svc.get('gridenv', 'temperature');
    expect(r.value).toBe(0.7); // the manifest default, not 0.15
    expect(r.source).toBe('default');
    // Not in force, so it pins nothing either — read and write agree.
    expect(r.locked).toBe(false);
    expect(r.cascadeChain?.some((e) => e.scope === 'env')).toBe(false);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OS_GRIDENV_TEMPERATURE');
    // The grid breach gets its OWN sentence, not the window template: the value
    // sits squarely inside `min 0, max 2`, so "is outside the declared step"
    // would be a false description of what happened.
    expect(errors[0]).toContain('does not sit on the declared step grid');
    expect(errors[0]).toContain('step 0.1');
    expect(errors[0]).toContain('IGNORED');
    expect(errors[0]).toContain('does NOT take effect');
  });

  it('an on-grid override still wins at the top of the cascade and locks the key', async () => {
    // The regression pin for the untouched path — the check must not turn into
    // "env never applies to a stepped key". `1.2` is another float trap:
    // `1.2 / 0.1` is `11.999999999999998`.
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_GRIDENV_TEMPERATURE: '1.2' }, logger });
    svc.registerManifest(gridEnvManifest);

    const r = await svc.get('gridenv', 'temperature');
    expect(r.value).toBe(1.2);
    expect(r.source).toBe('env');
    expect(r.locked).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('reports the misconfiguration at registration, and says it ONCE', async () => {
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_GRIDENV_TEMPERATURE: '0.15' }, logger });
    expect(errors).toHaveLength(0);
    svc.registerManifest(gridEnvManifest);
    expect(errors).toHaveLength(1);
    for (let i = 0; i < 5; i++) await svc.get('gridenv', 'temperature');
    await svc.getNamespace('gridenv');
    expect(errors).toHaveLength(1);
  });

  it('a REJECTED override pins nothing — the key stays editable', async () => {
    // The `locked` coherence rule #5204 established, extended to the grid for
    // free BECAUSE both are judged at the one point: a key configurable by
    // nothing (env ignored, UI refused) would be a lockout only an env edit
    // could clear.
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_GRIDENV_TEMPERATURE: '0.15' }, logger });
    svc.registerManifest(gridEnvManifest);

    expect((await svc.get('gridenv', 'temperature')).locked).toBe(false);
    await expect(svc.setMany('gridenv', { temperature: 0.9 })).resolves.toBeDefined();
    const after = await svc.get('gridenv', 'temperature');
    expect(after.value).toBe(0.9);
    expect(after.source).toBe('global'); // the fixture is `scope: 'global'`
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

/**
 * #5712 — a declared `valueDomain` moves the enforcement boundary onto the
 * standard's membership, save-time half.
 *
 * The 2026-08-06 ruling (reading 1): the curated `options` tables on
 * `localization.timezone` / `localization.currency` are UI convenience lists;
 * the boundary is the STANDARD domain (IANA / ISO 4217). #5131's
 * exhaustive-options semantics survive untouched wherever no domain is
 * declared — that regression pin lives in this block too, because the
 * registry-backed tables (`mail.provider`, `sms.provider`) are exactly the
 * shape that must NOT loosen.
 */
describe('SettingsService — a declared valueDomain is the save-time boundary (#5712)', () => {
  const localizationService = () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(localizationSettingsManifest);
    return svc;
  };

  it("accepts the card's own repro: Europe/Zurich and CHF through the write door", async () => {
    const svc = localizationService();
    await expect(
      svc.setMany('localization', { timezone: 'Europe/Zurich', currency: 'CHF' }),
    ).resolves.toBeDefined();
    expect((await svc.get('localization', 'timezone')).value).toBe('Europe/Zurich');
    expect((await svc.get('localization', 'currency')).value).toBe('CHF');
  });

  it('accepts the probe edges supportedValuesOf would have rejected', async () => {
    // The #5933 trap, exercised end to end: `UTC` is the manifest's own
    // default, `Asia/Kolkata` a curated option, `Europe/Kyiv` the current
    // IANA spelling ICU still lists under its old name.
    const svc = localizationService();
    for (const tz of ['UTC', 'Asia/Kolkata', 'Europe/Kyiv']) {
      await expect(
        svc.setMany('localization', { timezone: tz }),
        `${tz} is a legal IANA zone and must be accepted`,
      ).resolves.toBeDefined();
    }
  });

  it('still accepts every curated option value on both keys', async () => {
    // Degrading `options` to a suggestion list must not reject anything the
    // dropdown itself offers.
    const svc = localizationService();
    const specs = localizationSettingsManifest.specifiers as any[];
    for (const key of ['timezone', 'currency']) {
      for (const opt of specs.find((s) => s.key === key).options) {
        await expect(
          svc.setMany('localization', { [key]: opt.value }),
          `curated ${key} option ${opt.value} must stay accepted`,
        ).resolves.toBeDefined();
      }
    }
  });

  it('refuses garbage loudly, with the code and the domain in the constraint', async () => {
    const svc = localizationService();
    for (const tz of ['Mars/Olympus', 'ZZ']) {
      await expect(svc.setMany('localization', { timezone: tz })).rejects.toMatchObject({
        code: 'SETTINGS_VALIDATION',
        fields: [
          {
            field: 'timezone',
            // No `FieldErrorCode` member names a standard-domain breach, so it
            // takes `invalid_value` — the catalog's slot for "rejected for a
            // reason no other member names" (ADR-0114), the #6199 precedent.
            // NOT `invalid_option`: the declared options are exactly the list
            // a domain-bearing value may legitimately be outside of.
            code: 'invalid_value',
            label: 'Default timezone',
            constraint: { valueDomain: 'iana_time_zone' },
            value: tz,
          },
        ],
      });
    }
    await expect(svc.setMany('localization', { currency: 'XYZ' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [
        { field: 'currency', code: 'invalid_value', constraint: { valueDomain: 'iso_4217_currency' } },
      ],
    });
    // Atomic: nothing landed.
    expect((await svc.get('localization', 'timezone')).source).toBe('default');
  });

  it('default_country: the domain refuses what the pattern admits (#5712 third case)', async () => {
    const svc = localizationService();
    // In the domain, outside any curated list — accepted.
    await expect(svc.setMany('localization', { default_country: 'CH' })).resolves.toBeDefined();
    // Shape-valid, assigned to nobody: `ZZ` passes `^[A-Za-z]{2}$`, the domain
    // refuses it. `UK` is the CLDR alias that is not an ISO 3166-1 code.
    for (const cc of ['ZZ', 'UK']) {
      await expect(svc.setMany('localization', { default_country: cc })).rejects.toMatchObject({
        fields: [
          { field: 'default_country', code: 'invalid_value', constraint: { valueDomain: 'iso_3166_alpha2' } },
        ],
      });
    }
    // Shape breach still speaks FIRST, in `pattern`'s own vocabulary — the
    // coarser, more actionable fact (the window-before-grid ordering argument).
    await expect(svc.setMany('localization', { default_country: 'ZZZ' })).rejects.toMatchObject({
      fields: [{ field: 'default_country', code: 'invalid_format' }],
    });
  });

  it('a specifier WITHOUT valueDomain keeps exhaustive options — the #5131 regression pin', async () => {
    // The registry-backed shape (`mail.provider`, `sms.provider`): its table
    // IS the supported set, and declaring no domain must keep it that way,
    // byte-for-byte. Pinned on the mail manifest itself plus a localization
    // key that deliberately declares no domain.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(mailSettingsManifest);
    await expect(svc.setMany('mail', { provider: 'sendgrid' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{ field: 'provider', code: 'invalid_option' }],
    });

    const loc = localizationService();
    await expect(loc.setMany('localization', { first_day_of_week: 'thursday' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{ field: 'first_day_of_week', code: 'invalid_option' }],
    });
  });

  it('an unenforceable domain on a hand-built manifest falls back to #5131, not to accept-everything', async () => {
    // `registerManifest` takes manifests as given (no Zod pass). A misspelt
    // domain must leave the exhaustive-options check in force — the safe side
    // of the fork — never open the select to arbitrary strings.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'typo', version: 1, label: 'Typo', scope: 'tenant',
      readPermission: 'setup.access', writePermission: 'setup.access',
      specifiers: [
        { type: 'select', key: 'zone', label: 'Zone', required: false,
          valueDomain: 'iana_timezone', // not a vocabulary member
          options: [{ value: 'UTC', label: 'UTC' }] },
      ],
    } as any);
    await expect(svc.setMany('typo', { zone: 'UTC' })).resolves.toBeDefined();
    await expect(svc.setMany('typo', { zone: 'Europe/Zurich' })).rejects.toMatchObject({
      fields: [{ field: 'zone', code: 'invalid_option' }],
    });
  });

  it('judges a multiselect element-wise against the domain', async () => {
    // No shipped manifest authors this shape yet; covered anyway because the
    // alternative is that the first one to do so re-opens the hole (the same
    // reason OPTION_BEARING_TYPES covers radio/multiselect).
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'multi', version: 1, label: 'Multi', scope: 'tenant',
      readPermission: 'setup.access', writePermission: 'setup.access',
      specifiers: [
        { type: 'multiselect', key: 'currencies', label: 'Currencies', required: false,
          valueDomain: 'iso_4217_currency',
          options: [{ value: 'USD', label: 'USD' }] },
      ],
    } as any);
    await expect(svc.setMany('multi', { currencies: ['USD', 'CHF'] })).resolves.toBeDefined();
    await expect(svc.setMany('multi', { currencies: ['USD', 'XYZ'] })).rejects.toMatchObject({
      fields: [{ field: 'currencies', code: 'invalid_value', value: 'XYZ' }],
    });
  });

  it('never echoes the rejected value for an encrypted specifier', async () => {
    // Same redaction rule as `invalid_option` and the #6199 grid, same reason.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'vaultdom', version: 1, label: 'Vault domain', scope: 'tenant',
      readPermission: 'setup.access', writePermission: 'setup.access',
      specifiers: [
        { type: 'text', key: 'region_code', label: 'Region code', encrypted: true,
          valueDomain: 'iso_3166_alpha2' },
      ],
    } as any);
    const err = await svc.setMany('vaultdom', { region_code: 'ZZ' }).catch((e) => e);
    expect(err.code).toBe('SETTINGS_VALIDATION');
    expect(err.fields[0]).toMatchObject({ field: 'region_code', code: 'invalid_value' });
    expect(err.fields[0].value).toBeUndefined();
    expect(err.message).not.toContain('ZZ');
    // The domain still travels, so the caller learns what to do.
    expect(err.fields[0].constraint).toMatchObject({ valueDomain: 'iso_3166_alpha2' });
  });

  it('checks the domain only when the patch TOUCHES the key', async () => {
    // The #5131/#5932/#6199 gate, inherited by construction: a stored value
    // that pre-dates enforcement must not lock the workspace out of its
    // unrelated settings.
    const svc = new SettingsService({ env: {} });
    // Register a domain-less shape of the manifest, store a value the domain
    // would refuse, then swap the real (domain-bearing) manifest in.
    svc.registerManifest({
      ...localizationSettingsManifest,
      specifiers: (localizationSettingsManifest.specifiers as any[]).map((s) =>
        s.key === 'timezone' ? { ...s, valueDomain: undefined, options: [...s.options, { value: 'Mars/Olympus', label: 'Mars' }] } : s,
      ),
    } as any);
    await svc.setMany('localization', { timezone: 'Mars/Olympus' });
    svc.registerManifest(localizationSettingsManifest);

    // The stale value is still there …
    expect((await svc.get('localization', 'timezone')).value).toBe('Mars/Olympus');
    // … and a patch that never mentions it is not rejected on its account.
    await expect(svc.setMany('localization', { currency: 'CHF' })).resolves.toBeDefined();
    // Only re-writing the key itself is refused.
    await expect(svc.setMany('localization', { timezone: 'Mars/Olympus' })).rejects.toMatchObject({
      fields: [{ field: 'timezone', code: 'invalid_value' }],
    });
  });
});

/**
 * #5712, env half — the domain is judged at the ONE decision point
 * (`effectiveEnvOverride`), for the reason #5204 is on file: the same
 * comparison in two places is how the env half came to disagree with the save
 * half in the first place. Loud error + fallback, never silent (#5204's
 * contract, unchanged).
 */
describe('SettingsService — env overrides are judged against the declared valueDomain (#5712)', () => {
  const spyLogger = () => {
    const errors: string[] = [];
    return { errors, logger: { error: (m: string) => void errors.push(m) } };
  };

  it("honors the card's env repro: OS_LOCALIZATION_TIMEZONE=Europe/Zurich wins the cascade", async () => {
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_LOCALIZATION_TIMEZONE: 'Europe/Zurich' }, logger });
    svc.registerManifest(localizationSettingsManifest);

    const r = await svc.get('localization', 'timezone');
    expect(r.value).toBe('Europe/Zurich');
    expect(r.source).toBe('env');
    expect(r.locked).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('honors OS_LOCALIZATION_CURRENCY=CHF the same way', async () => {
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_LOCALIZATION_CURRENCY: 'CHF' }, logger });
    svc.registerManifest(localizationSettingsManifest);

    const r = await svc.get('localization', 'currency');
    expect(r.value).toBe('CHF');
    expect(r.source).toBe('env');
    expect(errors).toHaveLength(0);
  });

  it('ignores garbage loudly and resolves the next cascade layer instead', async () => {
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_LOCALIZATION_TIMEZONE: 'Mars/Olympus' }, logger });
    svc.registerManifest(localizationSettingsManifest);

    const r = await svc.get('localization', 'timezone');
    expect(r.value).toBe('UTC'); // the manifest default, not the garbage
    expect(r.source).toBe('default');
    // Not in force, so it pins nothing either — read and write agree (#5204).
    expect(r.locked).toBe(false);
    expect(r.cascadeChain?.some((e) => e.scope === 'env')).toBe(false);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OS_LOCALIZATION_TIMEZONE');
    expect(errors[0]).toContain('is not a valid IANA time zone identifier');
    expect(errors[0]).toContain("Rejected value: 'Mars/Olympus'");
    expect(errors[0]).toContain('IGNORED');
    expect(errors[0]).toContain('does NOT take effect');
  });

  it('rejects OS_LOCALIZATION_CURRENCY=XYZ loudly, once, at registration', async () => {
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_LOCALIZATION_CURRENCY: 'XYZ' }, logger });
    expect(errors).toHaveLength(0);
    svc.registerManifest(localizationSettingsManifest);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ISO 4217');
    for (let i = 0; i < 5; i++) await svc.get('localization', 'currency');
    expect(errors).toHaveLength(1); // said ONCE (#5204 dedupe)
  });

  it('a REJECTED override pins nothing — the key stays editable', async () => {
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_LOCALIZATION_TIMEZONE: 'Mars/Olympus' }, logger });
    svc.registerManifest(localizationSettingsManifest);

    expect((await svc.get('localization', 'timezone')).locked).toBe(false);
    await expect(svc.setMany('localization', { timezone: 'Europe/Zurich' })).resolves.toBeDefined();
    expect((await svc.get('localization', 'timezone')).value).toBe('Europe/Zurich');
  });

  it('env door for a domain-less select keeps exhaustive options — the #5131/#5204 regression pin', async () => {
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_LOCALIZATION_DATE_FORMAT: 'DD>MM>YYYY' }, logger });
    svc.registerManifest(localizationSettingsManifest);

    const r = await svc.get('localization', 'date_format');
    expect(r.value).toBe('YYYY-MM-DD'); // the default — the override is not in force
    expect(r.source).toBe('default');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('is not a declared option for');
  });

  it('env door checks default_country membership too — the third case, both doors', async () => {
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({
      env: { OS_LOCALIZATION_DEFAULT_COUNTRY: 'ZZ' }, logger,
    });
    svc.registerManifest(localizationSettingsManifest);

    const r = await svc.get('localization', 'default_country');
    expect(r.value).toBe('US'); // the manifest default
    expect(r.source).toBe('default');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ISO 3166-1');

    // And a legal non-default is honored.
    const { logger: okLogger, errors: okErrors } = spyLogger();
    const ok = new SettingsService({ env: { OS_LOCALIZATION_DEFAULT_COUNTRY: 'CH' }, logger: okLogger });
    ok.registerManifest(localizationSettingsManifest);
    expect((await ok.get('localization', 'default_country')).value).toBe('CH');
    expect(okErrors).toHaveLength(0);
  });
});

/**
 * #6579 — `company.country` adopts `iso_3166_alpha2`, the fourth case of the
 * hole #5712 closed on localization: the description promised ISO 3166-1 all
 * along while `^[A-Za-z]{2}$` constrained shape only, so `ZZ` (assigned to
 * nobody) and `UK` (a CLDR alias, not an ISO 3166-1 code) passed the write
 * door. Same enforcement machinery, same verdicts — these pins only cover the
 * adoption, not the machinery (that lives in the #5712 blocks above).
 */
describe('SettingsService — company.country adopts iso_3166_alpha2 (#6579)', () => {
  const companyService = () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(companySettingsManifest);
    return svc;
  };

  it('write door: admits an assigned code, refuses ZZ/UK with the domain in the constraint', async () => {
    const svc = companyService();
    await expect(svc.setMany('company', { country: 'CH' })).resolves.toBeDefined();
    expect((await svc.get('company', 'country')).value).toBe('CH');
    for (const cc of ['ZZ', 'UK']) {
      await expect(svc.setMany('company', { country: cc })).rejects.toMatchObject({
        code: 'SETTINGS_VALIDATION',
        fields: [
          {
            field: 'country',
            code: 'invalid_value',
            label: 'Country',
            constraint: { valueDomain: 'iso_3166_alpha2' },
            value: cc,
          },
        ],
      });
    }
  });

  it('shape breach still speaks first, in the pattern vocabulary', async () => {
    // `pattern` stays on the specifier: shape and membership narrow
    // independently, and the shape verdict is the coarser, more actionable
    // fact (the same window-before-grid ordering argument as #5712).
    const svc = companyService();
    await expect(svc.setMany('company', { country: 'ZZZ' })).rejects.toMatchObject({
      fields: [{ field: 'country', code: 'invalid_format' }],
    });
  });

  it('pins the deliberate tightening: lowercase `us` moves from pattern-accept to domain-reject', async () => {
    // Before the adoption `^[A-Za-z]{2}$` admitted `us`; domain membership is
    // exact uppercase, as ISO 3166-1 spells its codes — the same tightening
    // #5712 recorded for `localization.default_country`. No in-repo runtime
    // reader consumes `company.country` today, so the risk grade matches.
    const svc = companyService();
    await expect(svc.setMany('company', { country: 'us' })).rejects.toMatchObject({
      fields: [
        { field: 'country', code: 'invalid_value', constraint: { valueDomain: 'iso_3166_alpha2' } },
      ],
    });
  });

  it('env door judges OS_COMPANY_COUNTRY against the domain too — both doors move together', async () => {
    // Domain membership ONLY: the env door does not enforce `pattern` for
    // company keys — that gap is #6580's card, deliberately untouched here.
    const errors: string[] = [];
    const svc = new SettingsService({
      env: { OS_COMPANY_COUNTRY: 'ZZ' },
      logger: { error: (m: string) => void errors.push(m) },
    });
    svc.registerManifest(companySettingsManifest);

    const r = await svc.get('company', 'country');
    // Not in force: `country` declares no default, so the read resolves to the
    // empty default layer rather than the rejected override.
    expect(r.source).toBe('default');
    expect(r.value).toBeNull();
    expect(r.locked).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OS_COMPANY_COUNTRY');
    expect(errors[0]).toContain('ISO 3166-1');

    // And a legal member is honored.
    const okErrors: string[] = [];
    const ok = new SettingsService({
      env: { OS_COMPANY_COUNTRY: 'CH' },
      logger: { error: (m: string) => void okErrors.push(m) },
    });
    ok.registerManifest(companySettingsManifest);
    const okR = await ok.get('company', 'country');
    expect(okR.value).toBe('CH');
    expect(okR.source).toBe('env');
    expect(okErrors).toHaveLength(0);
  });
});

/**
 * #7169 — an unparseable `visible` predicate REFUSES the save.
 *
 * The producer/consumer split: `packages/spec`'s `settings-manifest.zod.ts`
 * types both visibility slots as `ExpressionInputSchema`, which normalizes a
 * bare string to `{ dialect: 'cel', source }` — so the spec LABELS these values
 * CEL. `visibility-eval.ts` is not CEL. An author writing the dialect the spec
 * declares got a `VisibilityParseError`, and `validatePatch` used to answer it
 * with `catch { continue }` — skipping the whole specifier, so `required`,
 * `options`, `pattern`, `valueDomain` and the value window all stopped being
 * enforced on that key, with no diagnostic anywhere.
 *
 * Maintainer ruling (2026-08-10): fail closed at save time. These cases pin
 * that, and they are written to go RED on the fail-open implementation —
 * restoring `catch { continue }` turns every one of them into an accepted
 * write. A `rejects.toThrow()`-shaped assertion could not do that (the
 * fail-open path throws nothing at all), so each asserts the ADR-0112/0114
 * envelope the surface actually emits: `code: 'SETTINGS_VALIDATION'` on the
 * error, `code: 'invalid_value'` on the field entry, and the offending
 * predicate under `constraint.visible`. The matching HTTP `status` (400) is
 * pinned at the route boundary in `settings-routes.test.ts`, which is where
 * this surface's status lives.
 */
describe('SettingsService — unparseable `visible` fails closed (#7169)', () => {
  /** A manifest whose `api_key` predicate is CEL the evaluator cannot parse. */
  function celService(): SettingsService {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'celns',
      label: 'CEL namespace',
      specifiers: [
        { type: 'select', key: 'provider', label: 'Provider',
          options: [{ value: 'openai', label: 'OpenAI' }, { value: 'memory', label: 'Memory' }] },
        // CEL membership via the stdlib — the exact spelling `ExpressionInputSchema`
        // declares is legal, and the grammar reports `unsupported identifier "in"`.
        { type: 'text', key: 'api_key', label: 'API key', required: true,
          visible: "${data.provider in ['openai']}" },
      ],
    } as any);
    return svc;
  }

  it('refuses the write and names the predicate', async () => {
    const svc = celService();
    const err = await svc.setMany('celns', { provider: 'openai', api_key: 'sk-live' }).catch((e) => e);
    expect(err.code).toBe('SETTINGS_VALIDATION');
    expect(err.fields).toEqual([
      expect.objectContaining({
        field: 'api_key',
        code: 'invalid_value',
        label: 'API key',
        constraint: { visible: "data.provider in ['openai']" },
      }),
    ]);
    // The parse reason travels in the sentence, so the author is told WHAT to fix.
    expect(err.fields[0].message).toContain('unsupported identifier "in"');
    expect(err.fields[0].message).toContain('visible');
  });

  it('fires on the half-filled form that never touches the broken key — the incident', async () => {
    // The console posts only its dirty keys, so the empty `required` field is
    // absent from the patch. This is the case a TOUCH gate would let through,
    // and it is the one #7169 measured: fail-open, the save lands clean with
    // `api_key` empty and `required` never consulted.
    const svc = celService();
    const err = await svc.setMany('celns', { provider: 'openai' }).catch((e) => e);
    expect(err.code).toBe('SETTINGS_VALIDATION');
    expect(err.fields[0]).toMatchObject({ field: 'api_key', code: 'invalid_value' });
    // Nothing was persisted — the batch is atomic.
    expect((await svc.get('celns', 'provider')).source).toBe('default');
  });

  it('refuses a predicate rooted anywhere but `data`, which carries no deps to gate on', async () => {
    // `referencedKeys` is a `data.<ident>` scan, so a `record.`-rooted predicate
    // yields no dependencies at all. Nothing about the patch can make this key
    // look relevant, which is why the refusal is unconditional.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'rootns',
      label: 'Root namespace',
      specifiers: [
        { type: 'text', key: 'unrelated', label: 'Unrelated' },
        { type: 'text', key: 'gated', label: 'Gated', required: true,
          visible: "${record.status == 'open'}" },
      ],
    } as any);
    const err = await svc.setMany('rootns', { unrelated: 'x' }).catch((e) => e);
    expect(err.code).toBe('SETTINGS_VALIDATION');
    expect(err.fields[0]).toMatchObject({
      field: 'gated',
      code: 'invalid_value',
      constraint: { visible: "record.status == 'open'" },
    });
  });

  it('still lets a broken namespace be RESET — the escape hatch', async () => {
    // An all-null patch returns before the specifier loop, so a workspace whose
    // manifest carries a bad predicate is never locked out of clearing it.
    const svc = celService();
    await expect(svc.resetNamespace('celns')).resolves.toBeGreaterThanOrEqual(0);
    await expect(svc.setMany('celns', { provider: null, api_key: null })).resolves.toBeDefined();
  });

  it('leaves parseable predicates alone', async () => {
    // Control: the same manifest with the grammar's own spelling. `==` IS in the
    // grammar, so plain CEL that stays inside it was never affected.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'okns',
      label: 'OK namespace',
      specifiers: [
        { type: 'select', key: 'provider', label: 'Provider',
          options: [{ value: 'openai', label: 'OpenAI' }, { value: 'memory', label: 'Memory' }] },
        { type: 'text', key: 'api_key', label: 'API key', required: true,
          visible: "${data.provider == 'openai'}" },
      ],
    } as any);
    await expect(svc.setMany('okns', { provider: 'memory' })).resolves.toBeDefined();
    await expect(svc.setMany('okns', { provider: 'openai' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [expect.objectContaining({ field: 'api_key', code: 'required' })],
    });
  });

  it('reports every broken specifier, not just the first', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'twobad',
      label: 'Two bad',
      specifiers: [
        { type: 'text', key: 'a', label: 'A', visible: '${data.x.map(y => y)}' },
        { type: 'text', key: 'b', label: 'B', visible: '${window.location}' },
      ],
    } as any);
    const err = await svc.setMany('twobad', { a: '1' }).catch((e) => e);
    expect(err.fields.map((f: any) => f.field)).toEqual(['a', 'b']);
    expect(err.fields.every((f: any) => f.code === 'invalid_value')).toBe(true);
  });
});

/**
 * #7169 — the in-repo instance of the same fail-open, and its repair.
 *
 * `auth.lockout_duration_minutes` declares `min: 1, max: 1440` and carries
 * `visible: '${data.lockout_threshold > 0}'`. The grammar had no relational
 * operator, so on `origin/main` the predicate threw, `catch { continue }`
 * skipped the specifier, and the declared window was enforced on nobody —
 * measured: `-5` and `99999` both saved clean, while the `visible`-free sibling
 * `rate_limit_max` was refused correctly by the same branch.
 */
describe('auth lockout window is enforced again (#7169)', () => {
  function authService(): SettingsService {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(authSettingsManifest);
    return svc;
  }

  it('enforces min/max once the lockout is switched on', async () => {
    await expect(
      authService().setMany('auth', { lockout_threshold: 5, lockout_duration_minutes: 99999 }),
    ).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [expect.objectContaining({ field: 'lockout_duration_minutes', code: 'max_value' })],
    });
    await expect(
      authService().setMany('auth', { lockout_threshold: 5, lockout_duration_minutes: -5 }),
    ).rejects.toMatchObject({
      fields: [expect.objectContaining({ field: 'lockout_duration_minutes', code: 'min_value' })],
    });
    await expect(
      authService().setMany('auth', { lockout_threshold: 5, lockout_duration_minutes: 30 }),
    ).resolves.toBeDefined();
  });

  it('still skips the window while the field is genuinely hidden', async () => {
    // `lockout_threshold: 0` disables the lockout, so the duration field is not
    // rendered and not validated — the predicate now EVALUATES to false instead
    // of failing to parse, which is a different reason for the same outcome and
    // the one the manifest intended.
    await expect(
      authService().setMany('auth', { lockout_threshold: 0, lockout_duration_minutes: 99999 }),
    ).resolves.toBeDefined();
  });

  it('every bundled manifest predicate parses, so no builtin namespace is refused', async () => {
    // The corpus measurement, kept as a regression: 94 `visible` predicates
    // across the 10 bundled manifests, and a fail-closed save path means any
    // one of them falling outside the grammar bricks writes to its namespace.
    for (const manifest of builtinSettingsManifests as Array<Record<string, any>>) {
      for (const spec of manifest.specifiers ?? []) {
        if (typeof spec.visible === 'undefined') continue;
        expect(
          () => evaluateVisibility(spec.visible, {}),
          `${manifest.namespace}.${spec.key ?? '(layout)'}: ${visibilitySource(spec.visible)}`,
        ).not.toThrow();
      }
    }
  });
});
