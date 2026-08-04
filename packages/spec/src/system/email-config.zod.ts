// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * Email Service Configuration Protocol
 *
 * Operator-facing configuration that selects the outbound email
 * transport for the EmailServicePlugin. Provider is a `provider` tag
 * + provider-specific settings; concrete `IEmailTransport`
 * implementations live in `@objectstack/plugin-email/transports/*`.
 *
 * Resolution order in `serve.ts`:
 *   1. `config.email.*` from objectstack.config.ts
 *   2. `OS_EMAIL_*` environment variables (override per setting)
 *   3. Default → provider='log' (LogTransport, no real send)
 *
 * SMTP delivery is built in (ADR-0012): select it with provider='smtp'
 * and supply the connection through `options` (host / port / secure /
 * user / password) or the matching OS_EMAIL_SMTP_HOST / _PORT /
 * _SECURE / _USER / _PASSWORD environment variables.
 */

/**
 * Outbound transport selector.
 *
 * - `log`     — LogTransport (development / CI; prints, no real delivery).
 * - `resend`  — Resend HTTPS API (https://resend.com). Requires `apiKey`.
 * - `postmark`— Postmark HTTPS API (https://postmarkapp.com). Requires `apiKey`.
 * - `smtp`    — any SMTP relay, self-hosted or managed. Shipped inside
 *               `@objectstack/plugin-email` as `SmtpTransport` (ADR-0012);
 *               its `nodemailer` dependency is a lazy import, so a
 *               deployment that never selects `smtp` never loads it.
 *               Connection settings live in `options` — see
 *               {@link EmailServiceConfigSchema}.
 *
 * This list is the operator-facing half of one vocabulary: the other half is
 * `EMAIL_TRANSPORT_PROVIDERS` in `@objectstack/plugin-email`, the array
 * `makeTransport` switches on. A cross-package contract test in that package
 * holds the two equal in both directions, because a value declared here with
 * no transport behind it advertises a provider no deployment can deliver
 * through — the declared-but-not-delivered defect of #5087 / #5094 — and a
 * transport missing from here is a capability authors are told they cannot
 * have.
 *
 * `sendgrid` and `ses` are deliberately NOT members: no HTTP-API transport for
 * either was ever implemented. Both publish an SMTP endpoint, so both are
 * configured as provider='smtp' — for SES, host `email-smtp.REGION.amazonaws.com`
 * with SES SMTP credentials (generated in the SES console; they are not AWS
 * access keys).
 */
export const EmailProviderSchema = lazySchema(() => z.enum(['log', 'resend', 'postmark', 'smtp']));
export type EmailProvider = z.infer<typeof EmailProviderSchema>;

export const EmailAddressConfigSchema = lazySchema(() => z.object({
  name: z.string().optional().describe('Display name (e.g. "Acme CRM")'),
  address: z.string().email().describe('RFC-5322 address'),
}));
export type EmailAddressConfig = z.infer<typeof EmailAddressConfigSchema>;

export const EmailServiceConfigSchema = lazySchema(() => z.object({
  /**
   * Transport provider. Defaults to `'log'` so unconfigured deployments
   * still boot — but mail will not actually be delivered.
   */
  provider: EmailProviderSchema.default('log')
    .describe('Transport to deliver through (OS_EMAIL_PROVIDER env). Default log — boots, sends nothing'),

  /**
   * API key for the selected provider (`resend` / `postmark`). Read
   * from `OS_EMAIL_API_KEY` env var when omitted. Ignored for `log`.
   */
  apiKey: z.string().optional().describe('Provider API key (or OS_EMAIL_API_KEY env)'),

  /**
   * Default `From` address used when a `send()` call omits `from`.
   * Required for any non-`log` provider; without it every send fails
   * VALIDATION_FAILED. `OS_EMAIL_FROM` env (`name <addr>` syntax)
   * supplies this when config is omitted.
   */
  defaultFrom: EmailAddressConfigSchema.optional(),

  /** Number of retry attempts on transport failure. Default 0. */
  retries: z.number().int().min(0).max(10).optional().describe('Retry attempts on transport throw'),

  /**
   * Persist each delivery attempt to `sys_email`. Default true; set
   * false for high-volume or PII-sensitive deployments that route
   * audit through their own pipeline.
   */
  persist: z.boolean().optional().describe('Persist to sys_email (default true)'),

  /**
   * Provider-specific extras. Free-form object the selected transport
   * consumes; the keys each provider reads are:
   *
   * - `smtp` — `host` (required), `port`, `secure`, `user`, `password`.
   *   Each mirrors one environment variable, and env wins:
   *   `OS_EMAIL_SMTP_HOST` / `_PORT` / `_SECURE` / `_USER` / `_PASSWORD`.
   *   Booting provider='smtp' with no host resolved from either source is
   *   a hard error, never a silent fall back to `log`.
   * - `postmark` — `messageStream`.
   * - `log` / `resend` — nothing.
   */
  options: z.record(z.string(), z.unknown()).optional()
    .describe(
      'Provider-specific extras. smtp: host (required) / port / secure / user / password, '
      + 'mirroring OS_EMAIL_SMTP_HOST / _PORT / _SECURE / _USER / _PASSWORD. postmark: messageStream',
    ),
}));
export type EmailServiceConfig = z.infer<typeof EmailServiceConfigSchema>;
