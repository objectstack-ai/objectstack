// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The stored device shape of the push device registry (ADR-0012 §6, narrowed
// to core). It belongs to a user alone (no organization member), names one of
// the two core vendors, and keeps a dead token's row disabled with the time
// the vendor reported it.

import { describe, it, expect } from 'vitest';
import { UserDeviceSchema } from './push-device.zod';
import { RegisterDeviceRequestSchema } from '../api/protocol.zod';

const DEVICE = {
  deviceId: 'install-1',
  userId: 'usr_1',
  vendor: 'apns',
  token: 'apns-device-token',
  platform: 'ios',
  appId: 'com.example.shell',
  locale: 'zh-CN',
  name: 'iPhone',
  enabled: true,
  lastSeenAt: '2026-11-02T08:00:00.000Z',
} as const;

describe('UserDeviceSchema', () => {
  it('round-trips an enabled device', () => {
    expect(UserDeviceSchema.parse(DEVICE)).toEqual(DEVICE);
  });

  it('round-trips a device whose token the vendor reported dead', () => {
    const dead = { ...DEVICE, enabled: false, invalidatedAt: '2026-11-02T09:00:00.000Z' };
    expect(UserDeviceSchema.parse(dead)).toEqual(dead);
  });

  it('needs only the identity, the vendor, the token, the platform and enabled', () => {
    const minimal = { deviceId: 'install-2', userId: 'usr_1', vendor: 'fcm', token: 't', platform: 'android', enabled: true };
    expect(UserDeviceSchema.parse(minimal)).toEqual(minimal);
  });

  it.each(['deviceId', 'userId', 'vendor', 'token', 'platform', 'enabled'] as const)('requires %s', (key) => {
    const { [key]: _dropped, ...rest } = DEVICE;
    const parsed = UserDeviceSchema.safeParse(rest);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([key]);
  });

  it.each(['hms', 'web_push', 'APNS'])('refuses vendor %j (core delivers through apns / fcm only)', (vendor) => {
    const parsed = UserDeviceSchema.safeParse({ ...DEVICE, vendor });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['vendor']);
  });

  it.each(['zh_CN', 'Chinese', 'zh-CN '])('refuses locale %j (not a BCP-47 language tag)', (locale) => {
    const parsed = UserDeviceSchema.safeParse({ ...DEVICE, locale });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['locale']);
    expect(parsed.error?.issues[0]?.code).toBe('invalid_format');
  });

  it('refuses an invalidation time that is not an ISO-8601 instant', () => {
    const parsed = UserDeviceSchema.safeParse({ ...DEVICE, enabled: false, invalidatedAt: 'yesterday' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['invalidatedAt']);
  });

  it('names the same platforms its registration does', () => {
    expect(UserDeviceSchema.shape.platform.options).toEqual(RegisterDeviceRequestSchema.shape.platform.options);
    expect(UserDeviceSchema.shape.platform.options).toEqual(['ios', 'android', 'web']);
  });

  it('has no organization member: a device belongs to its user alone', () => {
    expect(Object.keys(UserDeviceSchema.shape)).not.toContain('organizationId');
  });

  it('carries no PLANNED marker: the device registry stores it', () => {
    expect(UserDeviceSchema.description).toBeTruthy();
    expect(UserDeviceSchema.description).not.toMatch(/PLANNED/);
  });
});
