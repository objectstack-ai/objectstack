// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Push transport configuration (APNs token auth, FCM HTTP v1). Its two
// secrets — the APNs `.p8` signing key and the FCM service-account JSON — are
// named by reference only (ADR-0143 D3), so an inline secret is refused two
// ways: under the key an operator would reach for (refused by name, with the
// reference key as the prescription), and as the CONTENT of a reference (a
// PEM block or a JSON document is a secret pasted where its name belongs).

import { describe, it, expect } from 'vitest';
import {
  ApnsTransportConfigSchema,
  FcmTransportConfigSchema,
  PushServiceConfigSchema,
  PushVendorSchema,
} from './push-config.zod';

const APNS = {
  teamId: 'ABCDE12345',
  keyId: 'KEY1234567',
  topic: 'com.example.shell',
  environment: 'production',
  keyRef: 'OS_PUSH_APNS_KEY',
} as const;

const FCM = { projectId: 'example-project', serviceAccountRef: 'OS_PUSH_FCM_SERVICE_ACCOUNT' } as const;

const PEM = '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg\n-----END PRIVATE KEY-----';
const SERVICE_ACCOUNT_JSON = '{"type":"service_account","project_id":"example-project","private_key":"x"}';

describe('PushVendorSchema', () => {
  it('names exactly the two vendors core delivers through', () => {
    expect(PushVendorSchema.options).toEqual(['apns', 'fcm']);
  });
});

describe('PushServiceConfigSchema', () => {
  it('accepts both transports configured by reference', () => {
    const config = { apns: APNS, fcm: FCM };
    expect(PushServiceConfigSchema.parse(config)).toEqual(config);
  });

  it('accepts either transport alone, and the sandbox environment', () => {
    expect(PushServiceConfigSchema.safeParse({ apns: { ...APNS, environment: 'sandbox' } }).success).toBe(true);
    expect(PushServiceConfigSchema.safeParse({ fcm: FCM }).success).toBe(true);
  });

  it.each([
    'OS_PUSH_APNS_KEY',
    'push/apns-signing-key',
    'vault:push.apns.p8',
  ])('accepts the reference form %j', (keyRef) => {
    expect(ApnsTransportConfigSchema.safeParse({ ...APNS, keyRef }).success).toBe(true);
    expect(FcmTransportConfigSchema.safeParse({ ...FCM, serviceAccountRef: keyRef }).success).toBe(true);
  });

  it.each(['key', 'privateKey', 'p8'])('refuses an inline APNs key under %j, by name', (key) => {
    const parsed = ApnsTransportConfigSchema.safeParse({ ...APNS, [key]: PEM });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('keyRef');
  });

  it.each(['serviceAccount', 'serviceAccountJson', 'privateKey'])('refuses an inline FCM credential under %j, by name', (key) => {
    const parsed = FcmTransportConfigSchema.safeParse({ ...FCM, [key]: SERVICE_ACCOUNT_JSON });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('serviceAccountRef');
  });

  it('refuses a PEM block pasted into keyRef', () => {
    const parsed = ApnsTransportConfigSchema.safeParse({ ...APNS, keyRef: PEM });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['keyRef']);
  });

  it('refuses a service-account JSON document pasted into serviceAccountRef', () => {
    const parsed = FcmTransportConfigSchema.safeParse({ ...FCM, serviceAccountRef: SERVICE_ACCOUNT_JSON });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['serviceAccountRef']);
  });

  it('refuses an environment outside sandbox / production', () => {
    const parsed = ApnsTransportConfigSchema.safeParse({ ...APNS, environment: 'development' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['environment']);
  });

  it('refuses an unknown transport key on the block', () => {
    const parsed = PushServiceConfigSchema.safeParse({ fcm: FCM, hms: {} });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.code).toBe('unrecognized_keys');
  });
});
