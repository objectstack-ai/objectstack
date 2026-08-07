// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// The `sms` settings dropdown ↔ this package's transports (#5773).
//
// The invariant, made executable: **every provider an admin can select must be
// one this package can actually deliver through, and every provider this
// package can deliver through must be selectable.** Two halves of one fact, and
// the mail side has already paid for both of them coming apart (#5094):
// `sendgrid` / `ses` were offered by `mail.manifest.ts` with no transport
// behind them — the form validated, the save succeeded, and no mail was ever
// sent — while `resend`, which had a working transport all along, could not be
// picked at all.
//
// The sms sides are, today, exactly equal. That is the whole reason this file
// exists: nothing was holding them equal. `sms.manifest.ts` carried one literal
// list and `transports/index.ts` carried another, maintained independently, and
// a drift in either direction would have shipped in silence — an admin picking
// a provider that logs instead of sending (the #5713 failure, from the settings
// face rather than the `OS_SMS_PROVIDER` face), or a working transport nobody
// can reach.
//
// This is deliberately a CROSS-PACKAGE assertion rather than a third mirrored
// literal. A list pinned inside this package can be "fixed" by editing the
// other list, which is precisely how two hand-maintained copies drift.
// `@objectstack/service-settings` is therefore a **devDependency** here —
// test-only, no runtime edge, and no cycle: service-settings' dependency
// closure (core, metadata-core, platform-objects, spec, types) does not contain
// this package. Same shape and same direction as the mail precedent, where
// `plugin-email` (the transport owner) holds
// `mail-manifest-providers.contract.test.ts` and devDepends on the settings
// service. The registry of manifests must not have to know every provider
// implementation; the provider proves it satisfies the published contract.

import { describe, it, expect } from 'vitest';
import { smsSettingsManifest } from '@objectstack/service-settings';
import {
  makeSmsTransport,
  SMS_TRANSPORT_PROVIDERS,
  isSmsTransportProvider,
  type MakeSmsTransportOptions,
} from './transports/index.js';
import { LogSmsTransport } from './sms-service.js';
import { AliyunSmsTransport } from './transports/aliyun.js';
import { TwilioSmsTransport } from './transports/twilio.js';

/**
 * The `provider` specifier, read off the shipped manifest.
 *
 * Every read in this file is scoped to `key === 'provider'` on purpose: the
 * `sms` namespace is expected to grow keys that have nothing to do with the
 * transport vocabulary (#2814 adds `daily_quota` / `daily_quota_per_tenant`
 * number specifiers to this same manifest). Those carry no `options` table and
 * a different key, so they never enter this assertion surface — adding them
 * neither needs a change here nor can break these tests.
 */
function providerSpecifier(): Record<string, any> {
  const spec = (smsSettingsManifest.specifiers as Array<Record<string, any>>).find(
    (s) => s.key === 'provider',
  );
  expect(spec, 'sms manifest must declare a `provider` specifier').toBeDefined();
  return spec!;
}

/** The `provider` select's option values. */
function providerOptions(): string[] {
  const options = providerSpecifier().options as Array<{ value: string }> | undefined;
  expect(options, 'the `provider` specifier must declare an `options` table').toBeDefined();
  return options!.map((o) => o.value);
}

/**
 * Per-provider fixture: the minimal credentials that let the provider be built
 * for real, and the transport class it must build INTO.
 *
 * Keeping the expected class beside the build args (rather than as a row of
 * standalone `toBeInstanceOf` assertions) is what stops this file from becoming
 * the third hand-maintained copy of the vocabulary it exists to police: the
 * table's key set is asserted equal to `SMS_TRANSPORT_PROVIDERS` below, so a
 * provider added to the vocabulary without a fixture fails here instead of
 * quietly going unexercised.
 */
const PROVIDER_FIXTURES: Record<
  string,
  { args: MakeSmsTransportOptions; transport: abstract new (...args: any[]) => unknown }
> = {
  log: { args: { provider: 'log' }, transport: LogSmsTransport },
  aliyun: {
    args: {
      provider: 'aliyun',
      options: { accessKeyId: 'LTAI_test', accessKeySecret: 'test-secret', signName: 'ObjectStack' },
    },
    transport: AliyunSmsTransport,
  },
  twilio: {
    args: {
      provider: 'twilio',
      options: { accountSid: 'AC_test', authToken: 'test-token', from: '+15005550006' },
    },
    transport: TwilioSmsTransport,
  },
};

describe('sms settings dropdown ↔ sms transports', () => {
  // The two directions are separate `it`s so each drift fails on its own and
  // names its own values, rather than one set-equality that reds for both and
  // leaves the reader to work out which way it went.

  it('offers no provider the transports cannot build (⊆)', () => {
    const buildable: readonly string[] = SMS_TRANSPORT_PROVIDERS;
    const orphanOptions = providerOptions().filter((p) => !buildable.includes(p));
    expect(
      orphanOptions,
      `sms.manifest.ts offers provider(s) with no transport behind them: ${JSON.stringify(orphanOptions)}. `
        + `An admin can select one, the form validates, the save succeeds — and every send is silently `
        + `downgraded to LogSmsTransport (the #5094 defect shape). Either add a transport to `
        + `SMS_TRANSPORT_PROVIDERS / makeSmsTransport, or drop the option.`,
    ).toEqual([]);
  });

  it('hides no provider the transports can build (⊇)', () => {
    const offered = providerOptions();
    const unreachable = SMS_TRANSPORT_PROVIDERS.filter((p) => !offered.includes(p));
    expect(
      unreachable,
      `SMS_TRANSPORT_PROVIDERS can deliver through provider(s) the settings page never lists: `
        + `${JSON.stringify(unreachable)}. That is the 'resend' half of #5094 — a working transport `
        + `nobody can pick. Add the option to the \`provider\` select in sms.manifest.ts.`,
    ).toEqual([]);
  });

  it('lists each provider exactly once', () => {
    // Set equality above cannot see a duplicated option value; the rendered
    // dropdown would show the same provider twice.
    const offered = providerOptions();
    const duplicated = offered.filter((p, i) => offered.indexOf(p) !== i);
    expect(duplicated, `duplicate option value(s) in the \`provider\` select: ${JSON.stringify(duplicated)}`)
      .toEqual([]);
  });

  it('exercises every provider in the vocabulary — no fixture, no coverage', () => {
    // Deliberately a RUNTIME assertion rather than typing the table as
    // `Record<SmsProviderTag, …>`: this package's tsconfig excludes its own
    // test files (its TEST_DEBT entry in scripts/check-type-check-coverage.mjs),
    // so a type-level exhaustiveness check written here would be evaluated by
    // no tsc program at all — green forever, deletable without a trace. That is
    // the phantom-check shape #5286 is about; an assertion vitest runs is not.
    expect(new Set(Object.keys(PROVIDER_FIXTURES))).toEqual(new Set(SMS_TRANSPORT_PROVIDERS));
  });

  it('builds the right transport class for every option the dropdown offers', () => {
    for (const provider of providerOptions()) {
      const fixture = PROVIDER_FIXTURES[provider];
      expect(fixture, `no build recipe for offered provider '${provider}'`).toBeDefined();
      // Not just "did not throw" — the right transport class per tag. A
      // `switch` arm that fell through to the wrong constructor would pass a
      // bare truthiness check and deliver through the wrong vendor.
      expect(
        makeSmsTransport(fixture!.args),
        `provider '${provider}' must build a ${fixture!.transport.name}`,
      ).toBeInstanceOf(fixture!.transport);
    }
  });

  it('defaults to a provider that is both offered and buildable', () => {
    const fallback = providerSpecifier().default;
    // `log` is the one option that does not deliver — and it does not pretend
    // to: the label says "no real delivery". SMS has no credential-free real
    // transport, so the default has to be the visible opt-out rather than a
    // vendor that would fail on the first send.
    expect(fallback).toBe('log');
    expect(providerOptions()).toContain(fallback);
    expect(isSmsTransportProvider(fallback)).toBe(true);
  });
});

describe('isSmsTransportProvider ↔ the same option list', () => {
  // The CLI's start-up refusal of an out-of-table `OS_SMS_PROVIDER` (#5713,
  // PR #5771) judges operator input with this predicate. It and the settings
  // dropdown must be the same vocabulary, or the two configuration faces of one
  // provider choice disagree about what is configurable.

  it('accepts every provider the dropdown offers', () => {
    for (const provider of providerOptions()) {
      expect(isSmsTransportProvider(provider), `dropdown offers '${provider}' but the predicate refuses it`)
        .toBe(true);
    }
  });

  it('refuses values the dropdown does not offer', () => {
    // `twilo` is the real typo #5713 opens with: it reached makeSmsTransport,
    // threw, was caught, and became a LogSmsTransport that answered every OTP
    // send `status: 'sent'`.
    for (const bogus of ['twilo', 'aliyun_sms', 'sendgrid', '', 'LOG']) {
      expect(isSmsTransportProvider(bogus), `'${bogus}' must not narrow to a provider tag`).toBe(false);
      expect(providerOptions()).not.toContain(bogus);
    }
  });

  it('refuses to build a provider outside the vocabulary', () => {
    expect(() => makeSmsTransport({ provider: 'twilo' as never }))
      .toThrow(/unknown provider 'twilo'/);
  });
});
