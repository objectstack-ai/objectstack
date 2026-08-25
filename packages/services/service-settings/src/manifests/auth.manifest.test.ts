// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import { SettingsService } from '../settings-service.js';
import { authSettingsManifest } from './auth.manifest.js';

describe('authSettingsManifest', () => {
  it('parses against SettingsManifestSchema', () => {
    expect(() => SettingsManifestSchema.parse(authSettingsManifest)).not.toThrow();
  });

  it('declares namespace=auth, scope=global, version=1', () => {
    const parsed = SettingsManifestSchema.parse(authSettingsManifest);
    expect(parsed.namespace).toBe('auth');
    expect(parsed.scope).toBe('global');
    expect(parsed.version).toBe(1);
  });

  it('exposes the open-source auth policy toggles', () => {
    const keys = (authSettingsManifest.specifiers as any[])
      .filter((s) => s.type === 'toggle')
      .map((s) => s.key)
      .sort();

    expect(keys).toEqual([
      'email_password_enabled',
      'google_enabled',
      'mfa_required',
      'password_reject_breached',
      'password_require_complexity',
      'require_email_verification',
      'signup_enabled',
    ]);
  });

  // #5152 / ADR-0093 D1 — `signup_enabled` says whether people may
  // self-register; this says what they join when they do. Without it a
  // self-hosted stack could not express `invite-only` at all: the policy was
  // an `AuthPlugin` constructor option and the CLI-injected plugin never
  // passed one.
  it('exposes membership_policy as a closed two-value select (#5152)', () => {
    const specs = authSettingsManifest.specifiers as any[];
    const policy = specs.find((s) => s.key === 'membership_policy');

    expect(policy.type).toBe('select');
    expect(policy.default).toBe('auto');
    // The option table is the enforcement surface, not a front-end
    // convention: `SettingsService.setMany` rejects a value outside it
    // (`invalid_option`), which is what keeps a script or AI-authored
    // bootstrap from writing a policy the reconciler has no branch for.
    expect(policy.options.map((o: any) => o.value)).toEqual(['auto', 'invite-only']);

    // Membership is decided on EVERY creation path — SSO just-in-time
    // provisioning, admin create-user and bulk import included — so it must
    // not be hidden behind the email/password provider the way the password
    // keys are. An SSO-only deployment is precisely the one that needs it.
    expect(policy.visible).toBeUndefined();
    expect(specs.filter((s) => s.type === 'group').map((s) => s.id)).toContain('membership');
  });

  it('refuses a membership policy outside the option table at the write API (#5152)', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(authSettingsManifest as any);

    await expect(svc.setMany('auth', { membership_policy: 'invite_only' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [
        {
          field: 'membership_policy',
          code: 'invalid_option',
          constraint: { allowed: 'auto, invite-only' },
        },
      ],
    });
    await expect(svc.setMany('auth', { membership_policy: 'invite-only' })).resolves.toBeDefined();
    expect((await svc.get('auth', 'membership_policy')).value).toBe('invite-only');
  });

  it('exposes password-policy + session number fields with bounds and defaults', () => {
    const specs = authSettingsManifest.specifiers as any[];
    const byKey = (k: string) => specs.find((s) => s.key === k);

    const min = byKey('password_min_length');
    expect(min.type).toBe('number');
    expect(min.default).toBe(8);
    expect(min.min).toBe(6);
    expect(min.max).toBe(64);

    expect(byKey('password_max_length').default).toBe(128);
    expect(byKey('session_expiry_days').default).toBe(7);
    expect(byKey('session_refresh_days').default).toBe(1);

    const groups = specs.filter((s) => s.type === 'group').map((s) => s.id);
    expect(groups).toContain('password_policy');
    expect(groups).toContain('sessions');
    expect(groups).toContain('anti_abuse');
  });

  it('exposes anti-abuse lockout + rate-limit number fields (ADR-0069 D2)', () => {
    const specs = authSettingsManifest.specifiers as any[];
    const byKey = (k: string) => specs.find((s) => s.key === k);

    const threshold = byKey('lockout_threshold');
    expect(threshold.type).toBe('number');
    expect(threshold.default).toBe(0); // off by default
    expect(threshold.min).toBe(0);

    expect(byKey('lockout_duration_minutes').default).toBe(15);
    expect(byKey('rate_limit_max').default).toBe(10);
    expect(byKey('rate_limit_window_seconds').default).toBe(60);
    expect(byKey('password_history_count').default).toBe(0);
    expect(byKey('password_expiry_days').default).toBe(0);
    expect(byKey('mfa_grace_period_days').default).toBe(7);
  });

  // #3690 — the same pair now drives the second factor's lockout, not just the
  // password stage's. Two-factor verification exists without email/password
  // sign-in, so gating the threshold on `email_password_enabled` would leave a
  // passwordless deployment unable to tune it at all.
  it('keeps the lockout pair reachable in passwordless deployments (#3690)', () => {
    const specs = authSettingsManifest.specifiers as any[];
    const byKey = (k: string) => specs.find((s) => s.key === k);

    expect(byKey('lockout_threshold').visible).toBeUndefined();
    // The duration is still meaningless with no threshold, so that condition
    // stays — but it must no longer depend on the password provider.
    expect(byKey('lockout_duration_minutes').visible).toBe('${data.lockout_threshold > 0}');

    // The help text is the only place an admin learns the threshold covers
    // both stages; the wiring is invisible otherwise.
    expect(byKey('lockout_threshold').description).toMatch(/two-factor/i);
  });

  it('exposes encrypted Google OAuth credential fields', () => {
    const keys = (authSettingsManifest.specifiers as any[])
      .map((s) => s.key)
      .filter(Boolean);

    expect(keys).toContain('google_client_id');
    expect(keys).toContain('google_client_secret');

    const clientId = (authSettingsManifest.specifiers as any[])
      .find((s) => s.key === 'google_client_id');
    const clientSecret = (authSettingsManifest.specifiers as any[])
      .find((s) => s.key === 'google_client_secret');

    expect(clientId.type).toBe('text');
    expect(clientId.visible).toBe("${data.google_enabled !== false}");
    expect(clientSecret.type).toBe('password');
    expect(clientSecret.encrypted).toBe(true);
    expect(clientSecret.visible).toBe("${data.google_enabled !== false}");
  });

  // [#11768] Audience posture (#11739, epic #11723) — the console switch
  // surface for `invite_only | email_domain | open`. The option table IS the
  // closed vocabulary: `setMany` (and the env-override door, which judges the
  // same table — #5204/#6580) refuses anything outside it, and the binding in
  // plugin-auth refuses off-vocabulary again with `isAudiencePosture` before
  // the value ever reaches `applyConfigPatch`.
  it('exposes audience_posture as a closed three-value select in its own group (#11768)', () => {
    const specs = authSettingsManifest.specifiers as any[];
    const posture = specs.find((s) => s.key === 'audience_posture');

    expect(posture.type).toBe('select');
    // UI default only — `bindAuthSettings` applies EXPLICIT values alone, so
    // this default never masks a deployment's boot-config declaration. It
    // matches the spec's undeclared default (the safe end).
    expect(posture.default).toBe('invite_only');
    expect(posture.options.map((o: any) => o.value)).toEqual([
      'invite_only',
      'email_domain',
      'open',
    ]);

    // The posture judges EVERY self-serve creation path — social-provider
    // OAuth included — so like `membership_policy` it must not be hidden
    // behind the email/password provider toggle.
    expect(posture.visible).toBeUndefined();
    expect(specs.filter((s) => s.type === 'group').map((s) => s.id)).toContain('audience');
  });

  it('gates the audience sibling fields on the posture that reads them (#11768)', () => {
    const specs = authSettingsManifest.specifiers as any[];
    const domains = specs.find((s) => s.key === 'audience_allowed_email_domains');
    const permissionSet = specs.find((s) => s.key === 'audience_self_registration_permission_set');

    expect(domains.type).toBe('textarea');
    expect(domains.visible).toBe("${data.audience_posture === 'email_domain'}");

    expect(permissionSet.type).toBe('text');
    expect(permissionSet.visible).toBe(
      "${data.audience_posture === 'email_domain' || data.audience_posture === 'open'}",
    );

    // Explicit-only application: neither sibling ships a default that could
    // read as an operator's declaration.
    expect(domains.default).toBeUndefined();
    expect(permissionSet.default).toBeUndefined();
  });

  it('refuses an audience posture outside the option table at the write API (#11768)', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(authSettingsManifest as any);

    // `invite-only` is the MEMBERSHIP policy spelling — the most plausible
    // typo for this select. The write path refuses it with the coded envelope
    // (ADR-0114 field vocabulary on the SETTINGS_VALIDATION error); silently
    // storing it would hand the binding a value it can only refuse at apply
    // time, after the console already said "saved".
    await expect(svc.setMany('auth', { audience_posture: 'invite-only' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [
        {
          field: 'audience_posture',
          code: 'invalid_option',
          constraint: { allowed: 'invite_only, email_domain, open' },
        },
      ],
    });
    await expect(svc.setMany('auth', { audience_posture: 'email_domain' })).resolves.toBeDefined();
    expect((await svc.get('auth', 'audience_posture')).value).toBe('email_domain');
  });
});
