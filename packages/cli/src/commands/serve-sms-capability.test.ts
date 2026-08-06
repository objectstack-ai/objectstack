// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#5713 — what `SmsServicePlugin` is constructed with on the
 * `os serve` path, and what happens when the provider tag cannot deliver.
 *
 * The `sms` settings namespace declares `provider` as a `select` with an
 * options table (`log` / `aliyun` / `twilio`), #5131 enforces that table on the
 * write path, and #5204 closed the `SettingsService` env-override branch that
 * bypassed it. None of those three gates can see this path: `os serve` reads
 * `OS_SMS_PROVIDER` while assembling the kernel, *before* a settings service
 * exists, and handed the string straight to the plugin.
 *
 * Measured on `origin/main` before this change, `provider: 'twilo'` (a plausible
 * misspelling of `twilio`) reached `SmsServicePlugin.init`, threw inside
 * `makeSmsTransport`, was caught, and became `LogSmsTransport`:
 *
 *     booted_without_throw: true      transport_class: 'LogSmsTransport'
 *     isConfigured():       false     send() → { status: 'sent', messageId: 'dev-sms-…' }
 *
 * — a server that answers every OTP send "sent" and delivers nothing. That is
 * the declared-but-not-delivered shape of Prime Directive #10, and the same one
 * #5132 closed for mail in the neighbouring arm of this very loop.
 *
 * These pin the invariant in one piece: a configuration this server can deliver
 * through reaches the plugin unchanged (credentials included — they legitimately
 * arrive later, from the settings namespace at `kernel:ready`), and a provider
 * tag it cannot deliver through throws. The counterpart the throw depends on is
 * pinned too: an operator who does not want SMS sent says so with
 * `OS_SMS_PROVIDER=log`, and that still boots.
 */

import { describe, it, expect } from 'vitest';
import { SMS_TRANSPORT_PROVIDERS } from '@objectstack/service-sms';
import { resolveSmsCapabilityArg } from './serve.js';

describe('resolveSmsCapabilityArg', () => {
  it('defaults to the log provider when nothing is configured', () => {
    const { options } = resolveSmsCapabilityArg({}, {});
    expect(options).toMatchObject({ provider: 'log' });
    expect(options).not.toHaveProperty('providerOptions');
    expect(options).not.toHaveProperty('retries');
  });

  it('boots on an EXPLICIT provider=log — the way to say "this environment does not send SMS"', () => {
    // The premise of every throw below: refusing an undeliverable provider is
    // only fair because "no SMS from here" has its own spelling. If this ever
    // stops booting, the errors elsewhere in this file stop being actionable.
    expect(() => resolveSmsCapabilityArg({}, { OS_SMS_PROVIDER: 'log' })).not.toThrow();
    expect(resolveSmsCapabilityArg({}, { OS_SMS_PROVIDER: 'log' }).options)
      .toMatchObject({ provider: 'log' });
    // …including from objectstack.config.ts.
    expect(resolveSmsCapabilityArg({ provider: 'log' }, {}).options).toMatchObject({ provider: 'log' });
  });

  it('lets env beat config, and normalizes the case', () => {
    expect(resolveSmsCapabilityArg({ provider: 'aliyun' }, { OS_SMS_PROVIDER: 'twilio' }).options)
      .toMatchObject({ provider: 'twilio' });
    // `OS_SMS_PROVIDER=Twilio` is the same declaration — the guard runs on the
    // lower-cased value, never on the raw env string.
    expect(resolveSmsCapabilityArg({}, { OS_SMS_PROVIDER: 'Twilio' }).options)
      .toMatchObject({ provider: 'twilio' });
    expect(resolveSmsCapabilityArg({ provider: 'ALIYUN' }, {}).options)
      .toMatchObject({ provider: 'aliyun' });
  });

  it('passes a deliverable provider through WITHOUT demanding credentials', () => {
    // Unlike mail, SMS credentials are not a boot-time input: the `sms`
    // settings namespace binds them at kernel:ready. A bare provider tag is a
    // complete configuration here, so this arm refuses the tag and nothing
    // else — demanding keys would break every host that stores them in
    // Settings, which is the documented home for them.
    for (const provider of SMS_TRANSPORT_PROVIDERS) {
      expect(() => resolveSmsCapabilityArg({}, { OS_SMS_PROVIDER: provider }), provider).not.toThrow();
      expect(resolveSmsCapabilityArg({}, { OS_SMS_PROVIDER: provider }).options, provider)
        .toMatchObject({ provider });
    }
  });

  it('carries config.sms.providerOptions and retries through untouched', () => {
    const { options } = resolveSmsCapabilityArg(
      { provider: 'aliyun', providerOptions: { accessKeyId: 'ak', signName: '签名' }, retries: 2 },
      {},
    );
    expect(options).toMatchObject({
      provider: 'aliyun',
      providerOptions: { accessKeyId: 'ak', signName: '签名' },
      retries: 2,
    });
    // `retries: 0` is a real declaration (no retry), not an absence.
    expect(resolveSmsCapabilityArg({ retries: 0 }, {}).options).toMatchObject({ retries: 0 });
  });

  it('THROWS on a provider tag no transport can deliver — no silent LogSmsTransport (#5713)', () => {
    const boot = () => resolveSmsCapabilityArg({}, { OS_SMS_PROVIDER: 'twilo' });
    expect(boot).toThrow(/provider='twilo'/);
    // Consequence AND fix in the one message (AGENTS.md degradation-log-level).
    expect(boot).toThrow(/nothing would leave the box/);
    expect(boot).toThrow(/log \/ aliyun \/ twilio/);
    expect(boot).toThrow(/OS_SMS_PROVIDER=log/);
    // …and never the old silent rewrite.
    expect(boot).not.toThrow(/falling back to LogSmsTransport/);
  });

  it('refuses the same tag declared through config.sms.provider', () => {
    // A typo in objectstack.config.ts is the same declaration by another
    // channel — and the one an operator cannot fix with an env var.
    expect(() => resolveSmsCapabilityArg({ provider: 'aliyn' }, {}))
      .toThrow(/provider='aliyn'/);
    // Retired-looking and never-supported tags land in the same arm, and the
    // message names the vocabulary rather than guessing at an intent.
    for (const tag of ['sendgrid', 'aws-sns', 'tencent', 'smtp']) {
      expect(() => resolveSmsCapabilityArg({}, { OS_SMS_PROVIDER: tag }), tag)
        .toThrow(/log \/ aliyun \/ twilio/);
    }
  });

  it('reads its vocabulary from @objectstack/service-sms, not a second literal', () => {
    // #5094's lesson, pinned: if a transport is added to service-sms and this
    // file kept its own list, the new provider would be refused at boot while
    // the plugin could build it. The error message enumerates the exported
    // vocabulary, so this assertion goes red the day the two diverge.
    let message = '';
    try {
      resolveSmsCapabilityArg({}, { OS_SMS_PROVIDER: 'definitely-not-a-provider' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(SMS_TRANSPORT_PROVIDERS.join(' / '));
  });
});
