// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The server origin a push names (ruling B on the push delivery decision
// card): the Console sends the origin it was loaded from when it registers
// the device, the device row keeps it, and the push data carries it back, so
// a mobile shell with several saved servers opens the tap on the right one.
// Three optional members, one rule: what one accepts the other two accept,
// and what one refuses the other two refuse, with the same code and message.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { RegisterDeviceRequestSchema } from '../api/protocol.zod';
import { PushDeliveryDataSchema } from '../api/push-delivery.zod';
import { UserDeviceSchema } from './push-device.zod';
import { PUSH_SERVER_ORIGIN_MESSAGE } from './push-server-origin';

const REGISTRATION = { token: 'apns-device-token', platform: 'ios' } as const;
const DEVICE = {
  deviceId: 'install-1',
  userId: 'usr_1',
  vendor: 'apns',
  token: 'apns-device-token',
  platform: 'ios',
  enabled: true,
} as const;
const DELIVERY = { notificationId: 'ntf_1', route: '/opportunity/123' } as const;
const CARRIER_BODY = {
  RegisterDeviceRequestSchema: REGISTRATION,
  UserDeviceSchema: DEVICE,
  PushDeliveryDataSchema: DELIVERY,
} as const;

// Leaves the key out when no origin is given, so the optional leg sends the body clients send today.
const withOrigin = <T extends object>(body: T, origin?: string) => (origin === undefined ? body : { ...body, origin });

const CARRIERS = [
  ['RegisterDeviceRequestSchema', (origin?: string) => RegisterDeviceRequestSchema.safeParse(withOrigin(REGISTRATION, origin))],
  ['UserDeviceSchema', (origin?: string) => UserDeviceSchema.safeParse(withOrigin(DEVICE, origin))],
  ['PushDeliveryDataSchema', (origin?: string) => PushDeliveryDataSchema.safeParse(withOrigin(DELIVERY, origin))],
] as const;

describe.each(CARRIERS)('%s.origin', (_name, parse) => {
  it('is optional: the body without it parses unchanged', () => {
    const parsed = parse();
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty('origin');
    expect(parsed.data).toEqual(withOrigin(CARRIER_BODY[_name]));
  });

  it.each([
    'https://crm.example.com',
    'http://localhost:3000',
    'https://xn--fiq228c.example:8443',
    'http://192.168.1.20:3000',
    'http://[::1]:3000',
  ])('round-trips the Console origin %j', (origin) => {
    const parsed = parse(origin);
    expect(parsed.success).toBe(true);
    expect((parsed.data as { origin?: string }).origin).toBe(origin);
  });

  it.each([
    // A path, a trailing slash, a query or a fragment: an origin has none.
    'https://crm.example.com/',
    'https://crm.example.com/console',
    'https://crm.example.com?x=1',
    'https://crm.example.com#top',
    // Another scheme.
    'ftp://crm.example.com',
    'wss://crm.example.com',
    'javascript:alert(1)',
    // A bare host, with or without a port, and a protocol-relative one.
    'crm.example.com',
    'localhost:3000',
    '//crm.example.com',
    // Not the canonical form window.location.origin answers.
    'HTTPS://crm.example.com',
    'https://CRM.example.com',
    'https://user@crm.example.com',
    'https://crm.example.com:',
    ' https://crm.example.com',
    '',
  ])('refuses %j with the one origin refusal', (origin) => {
    const parsed = parse(origin);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toHaveLength(1);
    expect(parsed.error?.issues[0]).toMatchObject({
      path: ['origin'],
      code: 'invalid_format',
      message: PUSH_SERVER_ORIGIN_MESSAGE,
    });
  });
});

describe('the three origin members are one contract', () => {
  it('publishes the same pattern in each JSON Schema', () => {
    const patterns = [RegisterDeviceRequestSchema, UserDeviceSchema, PushDeliveryDataSchema].map((schema) => {
      const json = z.toJSONSchema(schema, { io: 'input' }) as unknown as { properties: { origin: { pattern?: string } }; required?: string[] };
      expect(json.required ?? []).not.toContain('origin');
      return json.properties.origin.pattern;
    });
    expect(patterns[0]).toBeTruthy();
    expect(new Set(patterns).size).toBe(1);
  });

  it('marks no member PLANNED: the server stores the origin and every push carries it back', () => {
    // The device registry stores the registration's origin on sys_user_device and the push
    // channel copies it into the push data (service-messaging), so all three members are served.
    expect(RegisterDeviceRequestSchema.shape.origin.description).not.toMatch(/PLANNED/);
    expect(UserDeviceSchema.shape.origin.description).not.toMatch(/PLANNED/);
    expect(PushDeliveryDataSchema.shape.origin.description).not.toMatch(/PLANNED/);
    expect(PushDeliveryDataSchema.description).not.toMatch(/PLANNED/);
  });
});
