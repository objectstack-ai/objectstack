// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ISmsTransport } from '@objectstack/spec/contracts';
import { LogSmsTransport } from '../sms-service.js';
import { AliyunSmsTransport } from './aliyun.js';
import { TwilioSmsTransport } from './twilio.js';

export { AliyunSmsTransport, type AliyunSmsTransportOptions } from './aliyun.js';
export { TwilioSmsTransport, type TwilioSmsTransportOptions } from './twilio.js';

/**
 * The provider vocabulary — every tag `makeSmsTransport` below can build, and
 * nothing else. It is the **one** literal: the `SmsProviderTag` type is derived
 * from it, the `switch` is exhaustive over it, and callers that have to judge an
 * operator-supplied provider string (the CLI's `sms` capability arm, #5713) read
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
 * `isEmailTransportProvider` in `@objectstack/plugin-email`, and used by the CLI
 * for the same reason: a provider that cannot deliver must be refused where the
 * operator declared it, not silently downgraded where it is materialised.
 */
export function isSmsTransportProvider(value: unknown): value is SmsProviderTag {
  return typeof value === 'string'
    && (SMS_TRANSPORT_PROVIDERS as readonly string[]).includes(value);
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
