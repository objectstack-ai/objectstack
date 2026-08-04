// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IEmailTransport } from '@objectstack/spec/contracts';
import { LogTransport } from '../email-service.js';
import { ResendTransport } from './resend.js';
import { PostmarkTransport } from './postmark.js';
import { SmtpTransport, type SmtpTransportOptions } from './smtp.js';

export { ResendTransport, type ResendTransportOptions } from './resend.js';
export { PostmarkTransport, type PostmarkTransportOptions } from './postmark.js';
export { SmtpTransport, smtpOptionsFromMailSettings, type SmtpTransportOptions } from './smtp.js';

/**
 * Transport tags this package can materialise — the single source of truth,
 * available at runtime as well as to the type system.
 *
 * It is a value and not just a union because the settings page's provider
 * dropdown must be held equal to it: `mail.manifest.ts` offering a provider
 * this array does not carry is the declared-but-not-delivered defect of #5094
 * (SendGrid / Amazon SES), and this array carrying one the dropdown does not
 * offer is the same invariant broken the other way (`resend`, which worked all
 * along and could not be selected). Both directions are asserted in
 * `mail-manifest-providers.contract.test.ts`.
 *
 * Adding a value here without adding a `case` to {@link makeTransport} does not
 * compile; adding one to either without listing it on the settings page fails
 * that test. Keep it that way.
 */
export const EMAIL_TRANSPORT_PROVIDERS = ['log', 'resend', 'postmark', 'smtp'] as const;

/** Transport tags this package can materialise. */
export type EmailTransportProvider = (typeof EMAIL_TRANSPORT_PROVIDERS)[number];

/** Narrow an arbitrary stored/DB value to a provider this package supports. */
export function isEmailTransportProvider(value: unknown): value is EmailTransportProvider {
  return typeof value === 'string'
    && (EMAIL_TRANSPORT_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Provider tags the settings page used to offer and this package never
 * implemented, mapped to the migration that replaces them (#5094).
 *
 * They are kept here, rather than simply forgotten, because the *stored* value
 * outlives the dropdown: a workspace that saved `sendgrid` in an earlier
 * release still resolves `provider: 'sendgrid'` on every boot. Answering that
 * with a bare "unknown provider" would be technically true and useless — the
 * operator needs to know that mail is not going out and what to change, and
 * both providers publish an SMTP endpoint that works today.
 */
export const RETIRED_EMAIL_PROVIDERS: Readonly<Record<string, string>> = Object.freeze({
  sendgrid:
    "no SendGrid HTTP-API transport was ever implemented. Use provider='smtp' with host "
    + "smtp.sendgrid.net, port 587, username 'apikey' and your SendGrid API key as the password.",
  ses:
    "no Amazon SES HTTP-API transport was ever implemented. Use provider='smtp' with host "
    + 'email-smtp.<region>.amazonaws.com, port 587, and SES SMTP credentials (generated in the '
    + 'SES console — they are NOT your AWS access keys).',
});

/** Migration guidance for a retired provider tag, or `undefined` if it is not one. */
export function retiredProviderGuidance(provider: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(RETIRED_EMAIL_PROVIDERS, provider)
    ? RETIRED_EMAIL_PROVIDERS[provider]
    : undefined;
}

/**
 * One sentence naming what to do about a provider this package cannot build —
 * the retired-provider migration when there is one, otherwise the list of tags
 * that do work. Shared by every site that has to refuse such a value so they
 * cannot drift apart.
 */
export function unsupportedProviderFix(provider: string): string {
  return retiredProviderGuidance(provider)
    ?? `pick one of ${EMAIL_TRANSPORT_PROVIDERS.join(' / ')} (Settings → Mail → Provider).`;
}

export interface MakeTransportOptions {
  provider: EmailTransportProvider;
  apiKey?: string;
  /**
   * Provider-specific options. For `smtp` this is {@link SmtpTransportOptions}
   * (`host` / `port` / `secure` / `user` / `password`); for `postmark`,
   * `messageStream`; etc.
   */
  options?: Record<string, unknown>;
  logger?: { info: (msg: string, meta?: any) => void };
}

/**
 * Build an IEmailTransport from a provider tag + opts. Used by
 * EmailServicePlugin to materialise the transport selected by
 * `EmailServiceConfig.provider`.
 *
 * Throws — never degrades to `LogTransport` — when the selected provider
 * cannot be built: `resend`/`postmark` without an `apiKey`, `smtp` without
 * a `host`. A transport that silently becomes a no-op while the caller
 * believes mail is configured is the defect #5087 exists to close.
 *
 * A provider outside {@link EMAIL_TRANSPORT_PROVIDERS} throws too, and the
 * message carries the fix: the SMTP migration for a retired tag, the supported
 * list otherwise. The `default` arm is unreachable by type, and reached in
 * practice by values that predate the type — a `provider` column written when
 * the settings page offered more than it could deliver (#5094).
 */
export function makeTransport(opts: MakeTransportOptions): IEmailTransport {
  const { provider, apiKey, options = {}, logger } = opts;
  switch (provider) {
    case 'log':
      return new LogTransport(logger);
    case 'resend':
      if (!apiKey) throw new Error("makeTransport: provider='resend' requires apiKey (OS_EMAIL_API_KEY)");
      return new ResendTransport({ apiKey, ...(options as any) });
    case 'postmark':
      if (!apiKey) throw new Error("makeTransport: provider='postmark' requires apiKey (OS_EMAIL_API_KEY)");
      return new PostmarkTransport({ apiKey, ...(options as any) });
    case 'smtp': {
      const smtp = options as Partial<SmtpTransportOptions>;
      if (!smtp?.host) {
        throw new Error(
          "makeTransport: provider='smtp' requires a host "
          + '(OS_EMAIL_SMTP_HOST, config.email.options.host, or Settings → Mail → Host)',
        );
      }
      return new SmtpTransport({ ...smtp, host: smtp.host, logger });
    }
    default:
      throw new Error(
        `makeTransport: unsupported provider '${provider}' — ${unsupportedProviderFix(String(provider))}`,
      );
  }
}
