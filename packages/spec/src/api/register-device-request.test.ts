// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The device registration request is WIDENED for the push channel (ADR-0012
// §6): it gains an optional `vendor`, `appId` and `locale`. Pure widening, so
// the body every client sends today must keep parsing unchanged, and the new
// members are optional. The one value the widening refuses is a vendor
// outside the pair core delivers through (`apns` / `fcm`); other vendors are
// alternate channel plugins (ADR-0012 §6), not values of this field.

import { describe, it, expect } from 'vitest';
import {
  RegisterDeviceRequestSchema,
  RegisterDeviceResponseSchema,
  UnregisterDeviceRequestSchema,
  UnregisterDeviceResponseSchema,
} from './protocol.zod';

describe('RegisterDeviceRequestSchema (push device registry)', () => {
  it('still parses the minimal body a client sends today, unchanged', () => {
    const body = { token: 'fcm_token_xyz', platform: 'android' };
    const parsed = RegisterDeviceRequestSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(body);
  });

  it('still parses the full pre-widening body (deviceId and name stay optional members)', () => {
    const body = { token: 't', platform: 'ios', deviceId: 'install-1', name: 'iPhone' };
    expect(RegisterDeviceRequestSchema.parse(body)).toEqual(body);
  });

  it('round-trips the widened members: vendor, appId, locale', () => {
    const body = {
      token: 'apns-device-token',
      platform: 'ios',
      vendor: 'apns',
      deviceId: 'install-1',
      appId: 'com.example.shell',
      locale: 'zh-CN',
      name: 'iPhone',
    } as const;
    const parsed = RegisterDeviceRequestSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(body);
    expect(RegisterDeviceRequestSchema.parse({ token: 't', platform: 'android', vendor: 'fcm' }).vendor).toBe('fcm');
  });

  it('applies no default for an absent vendor: the server derives it from platform', () => {
    // No `.default()` on purpose: the derivation (ios → apns, android → fcm)
    // is the server's, stated in the describe, and the bare alias stays
    // isomorphic (type-alias-convention.pin.test.ts).
    const parsed = RegisterDeviceRequestSchema.parse({ token: 't', platform: 'ios' });
    expect('vendor' in parsed).toBe(false);
  });

  // web has no default vendor, and the schema does not tie a vendor to a
  // platform: a web registration names either one. Refusing a web body WITHOUT
  // vendor is the route's (the server device-registry slice), not this schema's.
  it.each(['apns', 'fcm'] as const)('admits a web registration naming vendor %s', (vendor) => {
    const body = { token: 't', platform: 'web', vendor } as const;
    expect(RegisterDeviceRequestSchema.parse(body)).toEqual(body);
  });

  it.each(['hms', 'xiaomi', 'web_push', 'APNS', ''])('refuses vendor %j (core delivers through apns / fcm only)', (vendor) => {
    const parsed = RegisterDeviceRequestSchema.safeParse({ token: 't', platform: 'android', vendor });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['vendor']);
    expect(parsed.error?.issues[0]?.code).toBe('invalid_value');
  });

  // The locale a push is rendered in must be a tag a translation bundle can
  // answer: the house LocaleSchema, the shape every other locale key takes.
  it.each(['zh_CN', 'Chinese', 'zh-CN ', ''])('refuses locale %j (not a BCP-47 language tag)', (locale) => {
    const parsed = RegisterDeviceRequestSchema.safeParse({ token: 't', platform: 'ios', locale });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['locale']);
    expect(parsed.error?.issues[0]?.code).toBe('invalid_format');
  });

  it.each(['en', 'zh-CN', 'zh-Hans-CN', 'es-419'])('accepts locale %j', (locale) => {
    expect(RegisterDeviceRequestSchema.safeParse({ token: 't', platform: 'ios', locale }).success).toBe(true);
  });

  it('keeps the response and unregister shapes as they were', () => {
    expect(RegisterDeviceResponseSchema.parse({ deviceId: 'install-1', success: true }))
      .toEqual({ deviceId: 'install-1', success: true });
    expect(UnregisterDeviceRequestSchema.parse({ deviceId: 'install-1' })).toEqual({ deviceId: 'install-1' });
    expect(UnregisterDeviceResponseSchema.parse({ success: true })).toEqual({ success: true });
  });
});

// Declared ahead of its producer (ADR-0049): no route serves the device
// schemas until the server device-registry slice lands, and each says so.
describe('device registration schemas are declared, not yet served', () => {
  it.each([
    ['RegisterDeviceRequestSchema', RegisterDeviceRequestSchema],
    ['RegisterDeviceResponseSchema', RegisterDeviceResponseSchema],
    ['UnregisterDeviceRequestSchema', UnregisterDeviceRequestSchema],
    ['UnregisterDeviceResponseSchema', UnregisterDeviceResponseSchema],
  ] as const)('%s carries the PLANNED marker', (_name, schema) => {
    expect(schema.description).toMatch(/^\[PLANNED — /);
  });
});
