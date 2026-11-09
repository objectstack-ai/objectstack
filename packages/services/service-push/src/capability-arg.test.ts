// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `resolvePushCapabilityArg` — what `objectstack serve` and `bootStack`
 * construct `PushServicePlugin` with when a stack declares `requires: ['push']`:
 * the stack's `push` key, parsed, or a refusal before the kernel boots.
 *
 * The refusals are the point. A relay configuration (an absent key and `{}`
 * included) on a deployment that declared it has no control plane can never
 * deliver, so serving it would mount the push channel and answer every push as
 * if it were sent; and a compiled artifact can carry an inline secret that
 * `defineStack` would have refused, so the boot judges it again. Each refusal
 * names the remedy, and none echoes a secret value. Anywhere else the relay
 * boots: an unbound server binds while it runs.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { resolvePushCapabilityArg } from './capability-arg.js';
import { PushServicePlugin, PUSH_RELAY_AIR_GAPPED_MESSAGE } from './push-plugin.js';
import { PushService } from './push-service.js';

const APNS = { teamId: 'TEAM123456', keyId: 'KEY1234567', topic: 'com.example.app', environment: 'production' as const, credentialRef: 'APNS_KEY' };
const FCM = { projectId: 'example-app', credentialRef: 'FCM_ACCOUNT' };

describe('resolvePushCapabilityArg — the direct transport is built', () => {
  it('hands the plugin the parsed config, transport filled in', () => {
    expect(resolvePushCapabilityArg({ transport: 'direct', apns: APNS, fcm: FCM })).toEqual({
      options: { config: { transport: 'direct', apns: APNS, fcm: FCM } },
    });
    // A vendor block with no transport reads as direct, as the schema says.
    expect(resolvePushCapabilityArg({ fcm: FCM }).options.config).toEqual({ transport: 'direct', fcm: FCM });
  });

  it('the argument constructs a PushServicePlugin that registers the push service', async () => {
    const services = new Map<string, unknown>();
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const ctx = { registerService: (name: string, s: unknown) => services.set(name, s), logger } as never;
    await new PushServicePlugin(resolvePushCapabilityArg({ apns: APNS }).options).init(ctx);
    expect(services.get('push')).toBeInstanceOf(PushService);
    expect((services.get('push') as PushService).vendors()).toEqual(['apns']);
  });
});

const RELAY_CASES = [
  ['an absent push key', undefined],
  ['null', null],
  ['the empty block', {}],
  ["transport: 'relay'", { transport: 'relay' }],
  ['a staging relay endpoint', { transport: 'relay', endpoint: 'https://relay.staging.example.com' }],
] as const;

describe('resolvePushCapabilityArg — the relay is built', () => {
  beforeEach(() => vi.stubEnv('OS_CLOUD_URL', ''));
  afterEach(() => vi.unstubAllEnvs());

  it.each(RELAY_CASES)('%s hands the plugin the relay block, bound or not', (_name, push) => {
    expect(resolvePushCapabilityArg(push).options.config.transport).toBe('relay');
  });

  it('keeps an explicit relay endpoint', () => {
    expect(resolvePushCapabilityArg({ endpoint: 'https://relay.staging.example.com' }).options.config).toEqual({
      transport: 'relay',
      endpoint: 'https://relay.staging.example.com',
    });
  });
});

describe('resolvePushCapabilityArg — the relay is refused on a deployment with no control plane', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(RELAY_CASES)('%s is refused under OS_CLOUD_URL=off, naming the air gap, the inbox and the direct transport', (_name, push) => {
    vi.stubEnv('OS_CLOUD_URL', 'off');
    const read = () => resolvePushCapabilityArg(push);
    expect(read).toThrow(PUSH_RELAY_AIR_GAPPED_MESSAGE);
    expect(read).toThrow(/declared it has no control plane/);
    expect(read).toThrow(/in-app inbox/);
    expect(read).toThrow(/transport: 'direct'/);
    // Where the operator writes it on this boot path.
    expect(read).toThrow(/stack definition's push key/);
  });

  it('a direct block still boots under OS_CLOUD_URL=off: it needs no control plane', () => {
    vi.stubEnv('OS_CLOUD_URL', 'off');
    expect(resolvePushCapabilityArg({ apns: APNS }).options.config.transport).toBe('direct');
  });
});

describe('resolvePushCapabilityArg — a configuration the schema refuses fails the boot', () => {
  it('an inline APNs key, written beside credentialRef, is refused by name — the value is never echoed', () => {
    const read = () => resolvePushCapabilityArg({ transport: 'direct', apns: { ...APNS, key: 'PRIVATE KEY BODY' } });
    expect(read).toThrow(/push configuration cannot be delivered through/);
    expect(read).toThrow(/push\.apns: Unrecognized key/);
    expect(read).toThrow(/`credentialRef`/);
    expect(read).not.toThrow(/PRIVATE KEY BODY/);
  });

  it('with no transport, the refusal is opened to the direct member — the guidance is not lost to "Invalid input"', () => {
    const read = () => resolvePushCapabilityArg({ apns: { teamId: 'TEAM123456', keyId: 'KEY1234567', topic: 'com.example.app', environment: 'production', key: 'PRIVATE KEY BODY' } });
    expect(read).toThrow(/push\.apns: Unrecognized key/);
    expect(read).toThrow(/never written inline/);
    expect(read).not.toThrow(/Invalid input"?$/);
    expect(read).not.toThrow(/relay push transport/);
    expect(read).not.toThrow(/PRIVATE KEY BODY/);
  });

  it('a PEM block pasted into credentialRef is refused at its path, value not echoed', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIGT\n-----END PRIVATE KEY-----';
    const read = () => resolvePushCapabilityArg({ apns: { ...APNS, credentialRef: pem } });
    expect(read).toThrow(/push\.apns\.credentialRef: This names the APNs \.p8 signing key in the secrets layer and never contains it/);
    expect(read).not.toThrow(/MIGT/);
  });

  it('a credential on a relay block is refused with the relay guidance', () => {
    expect(() => resolvePushCapabilityArg({ transport: 'relay', apiKey: 'x' })).toThrow(/Not authorable on the relay push transport/);
  });

  it('a direct block with no vendor block is refused — it would deliver to nothing', () => {
    expect(() => resolvePushCapabilityArg({ transport: 'direct' })).toThrow(/names at least one vendor block/);
  });
});
