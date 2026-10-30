// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import type { CryptoAdapter } from '../crypto-adapter.js';
import { SettingsService } from '../settings-service.js';
import { en } from '../translations/index.js';
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

  // The sign-up toggle and the audience posture are two doors in series on the
  // email/password sign-up route: plugin-auth binds `signup_enabled` to
  // `emailAndPassword.disableSignUp` and the posture to the audience gate, and
  // a registrant passes only when both admit. ON beside "Invitation only"
  // therefore means "the form is open to invited addresses", which the page
  // must say rather than leave reading as a contradiction.
  it('signup_enabled states its conjunction with every audience posture, and stays a door of its own', () => {
    const specs = authSettingsManifest.specifiers as any[];
    const signup = specs.find((s) => s.key === 'signup_enabled');
    const posture = specs.find((s) => s.key === 'audience_posture');

    // The runtime's own default: no explicit value leaves `disableSignUp`
    // unset, so the route is open.
    expect(signup.default).toBe(true);
    // Never hidden behind the posture: under `invite_only` it still decides
    // whether an invited address may register through the form, so a value
    // hidden there would close or open that door out of the admin's sight.
    expect(signup.visible).toBe('${data.email_password_enabled !== false}');

    // The help names every posture the select declares, read from the option
    // table, so a posture added later reds here until the help covers it. It
    // names each one the way the page shows it, by the option's label, never
    // by the stored key (#27853).
    expect(typeof signup.description).toBe('string');
    for (const option of posture.options as Array<{ value: string; label: string }>) {
      const shown = option.label.split(' — ')[0].replace(/ only$/, '');
      expect(signup.description, `signup_enabled help names posture ${option.value}`).toContain(shown);
      expect(signup.description, `signup_enabled help spells no key ${option.value}`).not.toMatch(
        new RegExp(`\\b${option.value}\\b`),
      );
    }
    expect(signup.description).toContain(posture.label);
  });

  // plugin-auth registers Google only when the toggle is on AND a client ID and
  // secret both resolve, from the stored keys or from GOOGLE_CLIENT_ID /
  // GOOGLE_CLIENT_SECRET, which the settings service cannot see. The page can
  // only say so; the help is where it does — in an administrator's words, the
  // server configuration, not the env var names (#27853).
  it('google_enabled keeps the runtime default and says the server configuration completes it', () => {
    const specs = authSettingsManifest.specifiers as any[];
    const google = specs.find((s) => s.key === 'google_enabled');

    // `true` is what the runtime assumes for an undeclared toggle; a `false`
    // default would read OFF on a deployment that signs in with Google through
    // the env credentials, and hide its stored credentials behind `visible`.
    expect(google.default).toBe(true);
    expect(google.description).toContain('server configuration');
    expect(google.description).not.toContain('GOOGLE_CLIENT_');
  });

  // The console resolves `settings.auth.keys.<key>.label` / `.help` from the
  // served bundle BEFORE the manifest literal, in every locale, English
  // included. An `en` entry that lags the manifest therefore shadows it: the
  // corrected text never reaches an English admin.
  it('the en bundle carries the manifest label and help verbatim for the sign-up and Google toggles', () => {
    const specs = authSettingsManifest.specifiers as any[];
    const keys = (en.settings as any).auth.keys;
    for (const key of ['signup_enabled', 'google_enabled']) {
      const spec = specs.find((s) => s.key === key);
      expect(keys[key].label, `${key} label`).toBe(spec.label);
      expect(keys[key].help, `${key} help`).toBe(spec.description);
    }
  });
});

/**
 * A confidential stand-in, so the stored-credential control below can hold the
 * `password`-typed secret: the write path refuses a secret-valued key on an
 * adapter that declares no confidentiality.
 */
class ConfidentialTestAdapter implements CryptoAdapter {
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

// plugin-auth offers Google once the toggle is on and a client ID and secret
// both resolve, saved here or from GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET,
// with the env pair winning. The settings service reads only OS_* names, so
// it cannot see that pair; a `required` on the two keys made it refuse
// `google_enabled: true` on every deployment whose credentials come from it.
describe('authSettingsManifest — Google credentials may come from the server (not required)', () => {
  // FAKE values. This is the env map such a deployment hands the service.
  const ENV_CREDENTIALS = {
    GOOGLE_CLIENT_ID: 'fake-env-client-id.apps.googleusercontent.test',
    GOOGLE_CLIENT_SECRET: 'fake-env-client-secret',
  };
  const serviceWith = (env: Record<string, string>) => {
    const svc = new SettingsService({ env, crypto: new ConfidentialTestAdapter() });
    svc.registerManifest(authSettingsManifest as any);
    return svc;
  };

  it('declares neither credential key required', () => {
    const specs = authSettingsManifest.specifiers as any[];
    for (const key of ['google_client_id', 'google_client_secret']) {
      expect(specs.find((s) => s.key === key).required, key).toBe(false);
    }
  });

  it('saves Google ON with both credential fields empty, from unset and after an OFF', async () => {
    const svc = serviceWith({ ...ENV_CREDENTIALS });

    await expect(svc.setMany('auth', { google_enabled: true })).resolves.toBeDefined();
    const { values } = await svc.getNamespace('auth');
    expect(values.google_enabled).toMatchObject({ value: true, source: 'global' });
    // Nothing is stored for the pair, so plugin-auth resolves it from the env.
    expect(values.google_client_id?.source).toBe('default');
    expect(values.google_client_secret?.source).toBe('default');

    // The admin's round trip: OFF, then back ON.
    await expect(svc.setMany('auth', { google_enabled: false })).resolves.toBeDefined();
    await expect(svc.setMany('auth', { google_enabled: true })).resolves.toBeDefined();
    expect(await svc.get('auth', 'google_enabled')).toMatchObject({ value: true, source: 'global' });
  });

  it('control: a stored credential pair still saves and reads back', async () => {
    const svc = serviceWith({});

    await expect(
      svc.setMany('auth', {
        google_enabled: true,
        google_client_id: 'fake-stored-client-id',
        google_client_secret: 'fake-stored-client-secret',
      }),
    ).resolves.toBeDefined();
    expect(await svc.get('auth', 'google_client_id')).toMatchObject({
      value: 'fake-stored-client-id',
      source: 'global',
    });
    expect(await svc.get('auth', 'google_client_secret')).toMatchObject({
      value: 'fake-stored-client-secret',
      source: 'global',
    });
  });
});
