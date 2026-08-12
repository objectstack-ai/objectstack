// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import { SettingsService } from '../settings-service.js';
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

  it('declares the #2814 daily send quota as an unlimited-by-default number', () => {
    const spec = (smsSettingsManifest.specifiers as any[]).find((s) => s.key === 'daily_quota');
    expect(spec, 'sms manifest must declare a `daily_quota` specifier').toBeDefined();
    expect(spec.type).toBe('number');
    // `0 = no limit` is the shipped posture: adding a cost ceiling must not
    // change what an existing deployment sends the moment it upgrades.
    expect(spec.default).toBe(0);
    expect(spec.required).toBe(false);
    // A NUMBER key carries no `options` table, so it never touches the #5204
    // env-rejection surface (that path is keyed on `optionTables`) and needs
    // nothing from a `valueDomain` specifier (#5933).
    expect(spec.options).toBeUndefined();
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
    const r = await smsTestActionHandler({
      namespace: 'sms',
      actionId: 'test',
      values: { provider: 'log' },
      ctx: {},
    });
    expect(r.ok).toBe(true);
  });

  it('requires aliyun credentials', async () => {
    const r = await smsTestActionHandler({
      namespace: 'sms',
      actionId: 'test',
      values: { provider: 'aliyun' },
      ctx: {},
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/AccessKey/);
  });

  it('requires a twilio sender', async () => {
    const r = await smsTestActionHandler({
      namespace: 'sms',
      actionId: 'test',
      values: { provider: 'twilio', twilio_account_sid: 'AC1', twilio_auth_token: 't' },
      ctx: {},
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/From number|Messaging Service/);
  });
});

describe('sms.daily_quota through the settings resolver', () => {
  it('is readable, defaults to 0 and reports its cascade source', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(smsSettingsManifest);
    const resolved = await svc.get('sms', 'daily_quota');
    expect(resolved.value).toBe(0);
    expect(resolved.locked).toBeFalsy();
  });

  it('honours the OS_SMS_DAILY_QUOTA env override, coerced to a NUMBER (#5204 gate)', async () => {
    // The env-override gate is per-key and automatic: `envKeyOf('sms',
    // 'daily_quota')` is `OS_SMS_DAILY_QUOTA`, and `coerceEnvValue` reshapes
    // the raw string by the DEFAULT's type — which is why the manifest's
    // `default: 0` has to be a number literal and not `'0'`.
    const svc = new SettingsService({ env: { OS_SMS_DAILY_QUOTA: '2500' } });
    svc.registerManifest(smsSettingsManifest);
    const resolved = await svc.get('sms', 'daily_quota');
    expect(resolved.value).toBe(2500);
    expect(typeof resolved.value).toBe('number');
    expect(resolved.locked).toBe(true);
    expect(resolved.source).toBe('env');
  });

  it('passes a non-numeric env override through as a string — the CONSUMER clamps it (#5932)', async () => {
    // `coerceEnvValue` returns the raw string when it will not parse, and
    // `validatePatch` does not enforce the manifest's `min` today, so the
    // service layer is the only place this can be caught. `normalizeDailyQuota`
    // is what actually rejects it; this pins that the settings layer really
    // does hand the garbage over rather than filtering it.
    const svc = new SettingsService({ env: { OS_SMS_DAILY_QUOTA: 'unlimited' } });
    svc.registerManifest(smsSettingsManifest);
    const resolved = await svc.get('sms', 'daily_quota');
    expect(resolved.value).toBe('unlimited');
  });
});
