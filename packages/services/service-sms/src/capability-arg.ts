// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What `SmsServicePlugin` is constructed with on a served boot: the
 * deployment's SMS configuration (`config.sms`, `OS_SMS_*`), read into the
 * plugin's options — and refused when no transport this package ships can
 * deliver through it.
 *
 * ## Why this lives here, and not in `@objectstack/cli` or `@objectstack/core`
 *
 * It was written in `os serve`'s command body (`@objectstack/cli`), reading the
 * provider vocabulary from this package by the same rule as the mail one
 * (#5713): the reader has to refuse exactly the tags `makeSmsTransport` cannot
 * build. For one configuration, `@objectstack/verify`'s `bootStack` composes
 * what `serve` composes (#22301, ruling A) — the SMS provider included, built
 * from the same configuration — and the handle cannot import the CLI. The rule
 * for which token gets which argument moved to `@objectstack/core`
 * (`resolveCapabilityArgument`), which cannot import this package (this package
 * depends on it). So the reader lives beside the vocabulary it refuses against,
 * and `resolveCapabilityArgument` reads it off this module — the module every
 * boot already loads to construct `SmsServicePlugin`. `@objectstack/cli`
 * re-exports it from here. ⛔ Never a second copy beside a reader.
 */

import { isSmsTransportProvider, SMS_TRANSPORT_PROVIDERS } from './transports/index.js';

/** Constructor options for `SmsServicePlugin`, as the capability loop builds them. */
export interface SmsCapabilityArg {
  options: Record<string, unknown>;
}

/**
 * Resolve `SmsServicePlugin` constructor options from `config.sms` + `OS_SMS_*`
 * env, and **refuse a provider tag no transport can deliver through** (#5713).
 *
 * The refusal is the point. Credentials for a real provider normally arrive from
 * the `sms` settings namespace at `kernel:ready`, so this function deliberately
 * does NOT demand them — a bare `OS_SMS_PROVIDER=twilio` on a host whose Twilio
 * keys are stored in Settings is a complete, working configuration and passes
 * through untouched. What it refuses is the one thing settings can never repair:
 * a provider *tag* outside `SMS_TRANSPORT_PROVIDERS`.
 *
 * That tag used to travel all the way into the plugin, which caught the
 * `makeSmsTransport: unknown provider 'twilo'` throw and substituted
 * `LogSmsTransport` behind the operator's back. Measured on `origin/main` before
 * this change, `new SmsServicePlugin({ provider: 'twilo' }).init(ctx)`:
 *
 *   - boots without throwing, registers the `sms` service;
 *   - transport = `LogSmsTransport`, `isConfigured() === false`;
 *   - one `logger.warn` line, then `send()` answers
 *     `{ status: 'sent', messageId: 'dev-sms-…' }`.
 *
 * So a phone-OTP sign-in tells the user "code sent" and nothing leaves the box —
 * the same declared-but-not-delivered shape #5132 closed for mail one layer up,
 * and the same door #5204 closed on the `SettingsService` env branch. This path
 * never reaches `SettingsService`: it runs at kernel-assembly time, before the
 * settings service exists, which is exactly why the `sms` namespace's `select`
 * options table (`sms.manifest.ts`) could not see it.
 *
 * The plugin's fallback is left alone on purpose. For a *known* provider with
 * incomplete constructor credentials it is correct — the settings bind can still
 * swap in a working transport — and it stays the last line of defence for hosts
 * that construct `SmsServicePlugin` themselves. `os serve` simply stops handing
 * it input it cannot use.
 *
 * `OS_SMS_PROVIDER=log` (the default) is how an environment says "this box does
 * not send SMS", which is what makes refusing the rest fair.
 */
export function resolveSmsCapabilityArg(
  cfgSms: Record<string, any> = {},
  env: NodeJS.ProcessEnv = process.env,
): SmsCapabilityArg {
  const provider = String(env.OS_SMS_PROVIDER || cfgSms.provider || 'log').toLowerCase();
  if (!isSmsTransportProvider(provider)) {
    throw new Error(
      `provider='${provider}' is not a transport this server can deliver through, so every OTP and `
      + "notification SMS would be answered status: 'sent' and nothing would leave the box — "
      + `pick one of ${SMS_TRANSPORT_PROVIDERS.join(' / ')} (Settings → SMS Delivery → Provider). `
      + 'On this boot path the provider is OS_SMS_PROVIDER or config.sms.provider; set '
      + 'OS_SMS_PROVIDER=log if this environment is not meant to send SMS.',
    );
  }
  return {
    options: {
      provider,
      ...(cfgSms.providerOptions ? { providerOptions: cfgSms.providerOptions } : {}),
      ...(cfgSms.retries != null ? { retries: cfgSms.retries } : {}),
    },
  };
}
