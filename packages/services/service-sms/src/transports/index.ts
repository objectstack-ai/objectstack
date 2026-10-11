// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ISmsTransport } from '@objectstack/spec/contracts';
import { LogSmsTransport } from '../sms-service.js';
import { AliyunSmsTransport, type AliyunSmsTransportOptions } from './aliyun.js';
import { TwilioSmsTransport, type TwilioSmsTransportOptions } from './twilio.js';

export { AliyunSmsTransport, type AliyunSmsTransportOptions } from './aliyun.js';
export { TwilioSmsTransport, type TwilioSmsTransportOptions } from './twilio.js';

/**
 * The provider vocabulary — every tag `makeSmsTransport` below can build, and
 * nothing else. It is the **one** literal: the `SmsProviderTag` type is derived
 * from it, the `switch` is exhaustive over it, and callers that have to judge an
 * operator-supplied provider string (`resolveSmsCapabilityArg` in
 * `../capability-arg.ts`, #5713 — written in the CLI until #22301) read
 * it from here rather than restating the list.
 *
 * Two literals describing one vocabulary is how the mail settings dropdown and
 * the mail transports drifted apart (#5094) — `sendgrid`/`ses` were offered with
 * no transport behind them while `resend` had a working transport nobody could
 * pick. The SMS boot path had the same shape from the other side: `os serve`
 * passed `OS_SMS_PROVIDER` straight into `SmsServicePlugin` with nothing to
 * compare it against, so a typo (`twilo`) reached `makeSmsTransport`, threw
 * there, was caught, and became `LogSmsTransport` — a server that answers every
 * OTP send `status: 'sent'` and delivers nothing.
 */
export const SMS_TRANSPORT_PROVIDERS = ['log', 'aliyun', 'twilio'] as const;

/** A provider tag `makeSmsTransport` can materialise a transport for. */
export type SmsProviderTag = (typeof SMS_TRANSPORT_PROVIDERS)[number];

/**
 * Narrow an unknown value to a buildable provider tag. The counterpart of
 * `isEmailTransportProvider` in `@objectstack/plugin-email`, and used by
 * `resolveSmsCapabilityArg` for the same reason: a provider that cannot deliver must be refused where the
 * operator declared it, not silently downgraded where it is materialised.
 */
export function isSmsTransportProvider(value: unknown): value is SmsProviderTag {
  return typeof value === 'string'
    && (SMS_TRANSPORT_PROVIDERS as readonly string[]).includes(value);
}

/** A provider tag whose transport delivers, so it takes credentials. */
export type SmsDeliveringProvider = Exclude<SmsProviderTag, 'log'>;

/**
 * Every setting a delivering provider's transport is built from: keyed by its
 * `sms` settings-namespace key, valued by the transport option it fills.
 *
 * This is the ONE table both configuration faces read, so one `OS_SMS_*`
 * variable means one thing on both:
 *
 *   - the settings face, at `kernel:ready`: `SmsServicePlugin` translates the
 *     namespace snapshot through it, and `SettingsService` has already resolved
 *     each key's env override (`OS_SMS_` + the key, upper-cased) into that
 *     snapshot;
 *   - the constructor face, at boot: `resolveSmsCapabilityArg` reads the same
 *     variables into `providerOptions`, env over `config.sms.providerOptions`
 *     per credential, as the mail resolver does.
 *
 * `capability-arg.config-parity.contract.test.ts` holds each row equal to the
 * keys the `sms` settings manifest declares for that provider, and the two
 * faces equal to each other.
 */
export const SMS_PROVIDER_SETTING_KEYS = {
  aliyun: {
    aliyun_access_key_id: 'accessKeyId',
    aliyun_access_key_secret: 'accessKeySecret',
    aliyun_sign_name: 'signName',
    aliyun_template_code: 'defaultTemplateCode',
  },
  twilio: {
    twilio_account_sid: 'accountSid',
    twilio_auth_token: 'authToken',
    twilio_from_number: 'from',
    twilio_messaging_service_sid: 'messagingServiceSid',
  },
} as const satisfies {
  aliyun: Record<string, keyof AliyunSmsTransportOptions>;
  twilio: Record<string, keyof TwilioSmsTransportOptions>;
} & Record<SmsDeliveringProvider, Record<string, string>>;

/**
 * Read one provider's settings into transport options through
 * {@link SMS_PROVIDER_SETTING_KEYS}. `read` answers a setting key's raw value;
 * a value that is not a non-blank string is absent, and a present one is
 * trimmed.
 */
export function smsProviderOptionsFrom(
  provider: SmsDeliveringProvider,
  read: (settingKey: string) => unknown,
): Record<string, string> {
  const options: Record<string, string> = {};
  for (const [settingKey, option] of Object.entries(SMS_PROVIDER_SETTING_KEYS[provider])) {
    const raw = read(settingKey);
    if (typeof raw === 'string' && raw.trim().length > 0) options[option] = raw.trim();
  }
  return options;
}

export interface MakeSmsTransportOptions {
  provider: SmsProviderTag;
  /** Provider-specific credentials/options (see the transport option types). */
  options?: Record<string, unknown>;
  logger?: { info: (msg: string, meta?: any) => void };
}

/**
 * Build an ISmsTransport from a provider tag + opts. Used by
 * SmsServicePlugin to materialise the transport selected by config /
 * the `sms` settings namespace.
 *
 * Throws when a non-`log` provider is missing required credentials.
 */
export function makeSmsTransport(opts: MakeSmsTransportOptions): ISmsTransport {
  const { provider, options = {}, logger } = opts;
  switch (provider) {
    case 'log':
      return new LogSmsTransport(logger);
    case 'aliyun':
      return new AliyunSmsTransport(options as any);
    case 'twilio':
      return new TwilioSmsTransport(options as any);
    default:
      throw new Error(`makeSmsTransport: unknown provider '${provider}'`);
  }
}
