// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * SMS Service Configuration — the stack definition's `sms` block.
 *
 * There was no SMS configuration schema in the spec before this file. The
 * shape below is typed from what its one reader reads:
 * `resolveSmsCapabilityArg` in `@objectstack/service-sms`, which
 * `objectstack serve` and `bootStack` both construct `SmsServicePlugin`
 * through. It reads three keys off `config.sms`:
 *
 * | key | secret? | here |
 * |---|---|---|
 * | `provider` | no — a transport tag | admitted ({@link SmsProviderSchema}); `OS_SMS_PROVIDER` wins |
 * | `retries` | no | admitted |
 * | `providerOptions` | YES — every non-`log` transport requires a credential inside it (Twilio `authToken`, Aliyun `accessKeySecret`) | refused by name |
 *
 * `providerOptions` is refused WHOLE rather than narrowed to its non-secret
 * members, and the difference from mail's `options` is measured, not a
 * preference. The mail reader layers `OS_EMAIL_SMTP_*` over `config.email.options`
 * per key, so a file carrying host and user composes with an environment
 * carrying the password. The SMS reader hands `providerOptions` to the
 * transport as written, and nothing merges an environment credential into it:
 * a Twilio or Aliyun transport built from the non-secret members alone cannot
 * be constructed, so the plugin falls back to its log transport. A narrowed
 * `providerOptions` would therefore be a declared key no deployment could ever
 * deliver through. SMS provider settings — credentials included — live in the
 * `sms` settings namespace (Setup → Settings → SMS Delivery), whose every key
 * accepts its `OS_SMS_*` environment override, and the refusal says so.
 *
 * Why the credentials stop at this door at all: the stack definition is what
 * `objectstack build` compiles into the artifact, and artifacts are published.
 */

/**
 * SMS transport selector — the tags `@objectstack/service-sms` can build a
 * transport for.
 *
 * - `log`    — LogSmsTransport (development; logs, never delivers).
 * - `aliyun` — Aliyun SMS (template-only).
 * - `twilio` — Twilio Programmable Messaging.
 *
 * This list is the authoring-contract side of one vocabulary: the other sides
 * are `SMS_TRANSPORT_PROVIDERS` in `@objectstack/service-sms` (the array
 * `makeSmsTransport` switches on) and the `sms` settings manifest's provider
 * options. A cross-package contract test in `@objectstack/cli`, which depends
 * on both packages, holds this enum equal to `SMS_TRANSPORT_PROVIDERS` in both
 * directions — a tag declared here with no transport behind it would be a
 * provider no deployment can deliver through, and the reader refuses it at boot.
 */
export const SmsProviderSchema = lazySchema(() => z.enum(['log', 'aliyun', 'twilio']));
export type SmsProvider = z.input<typeof SmsProviderSchema>;

/**
 * The one prescription for SMS provider settings written into a stack
 * definition — the key that carries them, and the credential names an author
 * might write flat on the block.
 */
const STACK_SMS_PROVIDER_SETTINGS_PRESCRIPTION =
  'Not authorable here. SMS provider settings carry the provider credentials (Twilio auth token, Aliyun '
  + 'AccessKey secret), and a stack definition is compiled into the published artifact. Configure them in '
  + 'Setup → Settings → SMS Delivery, or through that namespace\'s environment overrides: OS_SMS_PROVIDER plus '
  + 'OS_SMS_TWILIO_ACCOUNT_SID / OS_SMS_TWILIO_AUTH_TOKEN / OS_SMS_TWILIO_FROM_NUMBER (Twilio) or '
  + 'OS_SMS_ALIYUN_ACCESS_KEY_ID / OS_SMS_ALIYUN_ACCESS_KEY_SECRET / OS_SMS_ALIYUN_SIGN_NAME (Aliyun).';

/**
 * `sms` of a stack definition — the non-secret members `resolveSmsCapabilityArg`
 * reads off `config.sms`. See the file header for the census.
 */
export const StackSmsConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'the stack `sms` block',
    history:
      'This block is strict from birth — a stack definition carried no `sms` key before it, so an unknown '
      + 'key here was never accepted.',
    guidance: {
      providerOptions: STACK_SMS_PROVIDER_SETTINGS_PRESCRIPTION,
      authToken: STACK_SMS_PROVIDER_SETTINGS_PRESCRIPTION,
      accessKeySecret: STACK_SMS_PROVIDER_SETTINGS_PRESCRIPTION,
    },
  },
  {
    /**
     * The tag `SmsServicePlugin` is constructed with. The credentials never
     * come from here, so for `aliyun` / `twilio` the delivering transport is
     * the one the `sms` settings namespace builds at `kernel:ready` — from its
     * own `provider` setting (`OS_SMS_PROVIDER` is that setting's override as
     * well as this key's).
     */
    provider: SmsProviderSchema.optional()
      .describe(
        'SMS transport tag (OS_SMS_PROVIDER env wins). Default log. Credentials never come from the stack: '
        + 'the delivering aliyun / twilio transport is built at kernel:ready from the sms settings namespace '
        + '(Setup → Settings → SMS Delivery, or its OS_SMS_* env overrides), whose own provider setting decides',
      ),
    /** Retry attempts on transport throw. Default 0. */
    retries: z.number().int().min(0).optional().describe('Retry attempts on transport throw (default 0)'),
  },
));
export type StackSmsConfig = z.input<typeof StackSmsConfigSchema>;
/** Post-parse shape of {@link StackSmsConfig} — defaults applied, transforms run (ADR-0122). */
export type StackSmsConfigParsed = z.infer<typeof StackSmsConfigSchema>;
