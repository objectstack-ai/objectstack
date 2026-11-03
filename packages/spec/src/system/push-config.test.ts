// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Push transport configuration: the hosted relay (the default, no credential)
// or direct delivery (APNs token auth, FCM HTTP v1) for a white-label build.
// A block without `transport` reads as the relay unless it carries a vendor
// block, which reads as direct — the shape written before the relay existed
// keeps parsing as it did. The direct transport's two
// secrets — the APNs `.p8` signing key and the FCM service-account JSON — are
// named by reference only (ADR-0143 D3), so an inline secret is refused two
// ways: under the key an operator would reach for (refused by name, with the
// reference key as the prescription), and as the CONTENT of a reference (a
// PEM block or a JSON document is a secret pasted where its name belongs).

import { describe, it, expect } from 'vitest';
import {
  ApnsTransportConfigSchema,
  FcmTransportConfigSchema,
  PushDirectTransportConfigSchema,
  PushRelayTransportConfigSchema,
  PushServiceConfigSchema,
  PushVendorSchema,
} from './push-config.zod';

const APNS = {
  teamId: 'ABCDE12345',
  keyId: 'KEY1234567',
  topic: 'com.example.shell',
  environment: 'production',
  credentialRef: 'OS_PUSH_APNS_KEY',
} as const;

const FCM = { projectId: 'example-project', credentialRef: 'OS_PUSH_FCM_SERVICE_ACCOUNT' } as const;

const PEM = '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg\n-----END PRIVATE KEY-----';
const SERVICE_ACCOUNT_JSON = '{"type":"service_account","project_id":"example-project","private_key":"x"}';

describe('PushVendorSchema', () => {
  it('names exactly the two vendors core delivers through', () => {
    expect(PushVendorSchema.options).toEqual(['apns', 'fcm']);
  });
});

describe('PushServiceConfigSchema — the transport', () => {
  it('reads an empty block as the hosted relay, the default', () => {
    expect(PushServiceConfigSchema.parse({})).toEqual({ transport: 'relay' });
  });

  it('accepts the relay with no endpoint, and with a staging endpoint', () => {
    expect(PushServiceConfigSchema.parse({ transport: 'relay' })).toEqual({ transport: 'relay' });
    const staging = { transport: 'relay', endpoint: 'https://push-relay.staging.example.com/v1/deliveries' } as const;
    expect(PushServiceConfigSchema.parse(staging)).toEqual(staging);
  });

  it('refuses a relay endpoint that is not https', () => {
    const parsed = PushServiceConfigSchema.safeParse({ transport: 'relay', endpoint: 'http://push-relay.example.com' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['endpoint']);
    expect(parsed.error?.issues[0]?.message).toMatch(/^The push relay endpoint is an https URL/);
  });

  it('accepts direct delivery with both vendor blocks, or either alone', () => {
    const both = { transport: 'direct', apns: APNS, fcm: FCM } as const;
    expect(PushServiceConfigSchema.parse(both)).toEqual(both);
    expect(PushServiceConfigSchema.safeParse({ transport: 'direct', apns: { ...APNS, environment: 'sandbox' } }).success).toBe(true);
    expect(PushServiceConfigSchema.safeParse({ transport: 'direct', fcm: FCM }).success).toBe(true);
  });

  // The shape this schema had before the relay existed: vendor blocks and no
  // `transport`. It keeps parsing, and reads as direct.
  it.each([
    ['both vendor blocks', { apns: APNS, fcm: FCM }],
    ['apns alone', { apns: APNS }],
    ['fcm alone', { fcm: FCM }],
  ] as const)('reads a block with %s and no transport as direct', (_name, config) => {
    expect(PushServiceConfigSchema.parse(config)).toEqual({ transport: 'direct', ...config });
  });

  it('refuses a vendor block inside a relay block, by name, pointing at direct', () => {
    for (const [key, block] of [['apns', APNS], ['fcm', FCM]] as const) {
      const parsed = PushServiceConfigSchema.safeParse({ transport: 'relay', [key]: block });
      expect(parsed.success).toBe(false);
      const issues = parsed.error?.issues ?? [];
      expect(issues).toHaveLength(1);
      expect(issues[0]?.code).toBe('unrecognized_keys');
      expect(issues[0]?.path).toEqual([]);
      expect((issues[0] as { keys?: string[] }).keys).toEqual([key]);
      expect(issues[0]?.message).toContain('Not authorable on the relay push transport.');
      expect(issues[0]?.message).toContain("transport: 'direct'");
    }
  });

  it.each(['credentialRef', 'token', 'apiKey'])('refuses a credential under %j inside a relay block, by name', (key) => {
    const parsed = PushServiceConfigSchema.safeParse({ transport: 'relay', [key]: 'OS_PUSH_RELAY_KEY' });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('authenticates this server by its cloud binding credential');
  });

  it('refuses a direct block with no vendor block, so no credentialRef', () => {
    const parsed = PushServiceConfigSchema.safeParse({ transport: 'direct' });
    expect(parsed.success).toBe(false);
    const issues = parsed.error?.issues ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('custom');
    expect(issues[0]?.path).toEqual([]);
    expect(issues[0]?.message).toMatch(/^A direct push transport names at least one vendor block \(`apns` or `fcm`\)/);
  });

  it('refuses a direct vendor block written without its credentialRef', () => {
    const { credentialRef: _omitted, ...apnsWithoutRef } = APNS;
    const parsed = PushServiceConfigSchema.safeParse({ transport: 'direct', apns: apnsWithoutRef });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path)).toEqual([['apns', 'credentialRef']]);
  });

  it('refuses an endpoint on a direct block, pointing at the relay', () => {
    const parsed = PushServiceConfigSchema.safeParse({ transport: 'direct', fcm: FCM, endpoint: 'https://push-relay.example.com' });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain("write `transport: 'relay'`");
  });

  it('refuses a transport outside relay / direct', () => {
    const parsed = PushServiceConfigSchema.safeParse({ transport: 'hms' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.code).toBe('invalid_union');
  });

  it('refuses an unknown key on the direct block', () => {
    const parsed = PushServiceConfigSchema.safeParse({ transport: 'direct', fcm: FCM, hms: {} });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('judges each transport block on its own too', () => {
    expect(PushRelayTransportConfigSchema.parse({})).toEqual({ transport: 'relay' });
    expect(PushDirectTransportConfigSchema.parse({ fcm: FCM })).toEqual({ transport: 'direct', fcm: FCM });
    expect(PushDirectTransportConfigSchema.safeParse({}).success).toBe(false);
  });
});

describe('PushServiceConfigSchema — direct vendor blocks', () => {
  it.each([
    'OS_PUSH_APNS_KEY',
    'push/apns-signing-key',
    'vault:push.apns.p8',
  ])('accepts the reference form %j', (credentialRef) => {
    expect(ApnsTransportConfigSchema.safeParse({ ...APNS, credentialRef }).success).toBe(true);
    expect(FcmTransportConfigSchema.safeParse({ ...FCM, credentialRef }).success).toBe(true);
  });

  it.each(['key', 'privateKey', 'p8'])('refuses an inline APNs key under %j, by name', (key) => {
    const parsed = ApnsTransportConfigSchema.safeParse({ ...APNS, [key]: PEM });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('credentialRef');
  });

  it.each(['serviceAccount', 'serviceAccountJson', 'privateKey'])('refuses an inline FCM credential under %j, by name', (key) => {
    const parsed = FcmTransportConfigSchema.safeParse({ ...FCM, [key]: SERVICE_ACCOUNT_JSON });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('credentialRef');
  });

  it.each([
    ['APNs', 'keyRef'],
    ['FCM', 'serviceAccountRef'],
  ] as const)('answers the %s near-miss %j with credentialRef, the house key for a secret reference', (transport, key) => {
    const block = transport === 'APNs' ? APNS : FCM;
    const schema = transport === 'APNs' ? ApnsTransportConfigSchema : FcmTransportConfigSchema;
    const { credentialRef, ...rest } = block;
    const parsed = schema.safeParse({ ...rest, [key]: credentialRef });
    expect(parsed.success).toBe(false);
    const issues = parsed.error?.issues ?? [];
    expect(issues.some((i) => i.code === 'unrecognized_keys' && i.message.includes('credentialRef'))).toBe(true);
  });

  it('refuses a PEM block pasted into the APNs credentialRef', () => {
    const parsed = ApnsTransportConfigSchema.safeParse({ ...APNS, credentialRef: PEM });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['credentialRef']);
  });

  it('refuses a service-account JSON document pasted into the FCM credentialRef', () => {
    const parsed = FcmTransportConfigSchema.safeParse({ ...FCM, credentialRef: SERVICE_ACCOUNT_JSON });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['credentialRef']);
  });

  it('refuses an environment outside sandbox / production', () => {
    const parsed = ApnsTransportConfigSchema.safeParse({ ...APNS, environment: 'development' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['environment']);
  });
});

// Declared ahead of its reader (ADR-0049): nothing reads this shape until the
// push channel plugin ships, and each block says so in its description.
describe('push transport configuration is declared, not yet read', () => {
  it.each([
    ['PushServiceConfigSchema', PushServiceConfigSchema],
    ['PushRelayTransportConfigSchema', PushRelayTransportConfigSchema],
    ['PushDirectTransportConfigSchema', PushDirectTransportConfigSchema],
    ['ApnsTransportConfigSchema', ApnsTransportConfigSchema],
    ['FcmTransportConfigSchema', FcmTransportConfigSchema],
  ] as const)('%s carries the PLANNED marker', (_name, schema) => {
    expect(schema.description).toMatch(/^\[PLANNED — /);
  });
});
