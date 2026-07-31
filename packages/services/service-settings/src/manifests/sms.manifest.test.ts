// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import { smsSettingsManifest, smsTestActionHandler } from './sms.manifest.js';

describe('sms settings manifest', () => {
  it('parses against SettingsManifestSchema', () => {
    expect(() => SettingsManifestSchema.parse(smsSettingsManifest)).not.toThrow();
  });

  it('is a global-scope namespace guarded by manage_platform_settings', () => {
    expect(smsSettingsManifest.namespace).toBe('sms');
    expect(smsSettingsManifest.scope).toBe('global');
    expect(smsSettingsManifest.readPermission).toBe('manage_platform_settings');
    expect(smsSettingsManifest.writePermission).toBe('manage_platform_settings');
  });

  it('marks provider secrets as encrypted password specifiers', () => {
    const byKey = new Map(
      (smsSettingsManifest.specifiers as any[]).filter((s) => s.key).map((s) => [s.key, s]),
    );
    for (const secret of ['aliyun_access_key_secret', 'twilio_auth_token']) {
      expect(byKey.get(secret)?.type).toBe('password');
      expect(byKey.get(secret)?.encrypted).toBe(true);
    }
  });
});

describe('smsTestActionHandler (fallback)', () => {
  it('accepts the log provider', async () => {
    const r = await smsTestActionHandler({ values: { provider: 'log' }, ctx: {} as any });
    expect(r.ok).toBe(true);
  });

  it('requires aliyun credentials', async () => {
    const r = await smsTestActionHandler({ values: { provider: 'aliyun' }, ctx: {} as any });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/AccessKey/);
  });

  it('requires a twilio sender', async () => {
    const r = await smsTestActionHandler({
      values: { provider: 'twilio', twilio_account_sid: 'AC1', twilio_auth_token: 't' },
      ctx: {} as any,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/From number|Messaging Service/);
  });
});
