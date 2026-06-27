// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import { authSettingsManifest } from './auth.manifest';

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
      'password_reject_breached',
      'require_email_verification',
      'signup_enabled',
    ]);
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
});
