// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IEmailTransport } from '@objectstack/spec/contracts';
import { LogTransport } from '../email-service.js';
import { ResendTransport } from './resend.js';
import { PostmarkTransport } from './postmark.js';
import { SmtpTransport, type SmtpTransportOptions } from './smtp.js';

export { ResendTransport, type ResendTransportOptions } from './resend.js';
export { PostmarkTransport, type PostmarkTransportOptions } from './postmark.js';
export { SmtpTransport, smtpOptionsFromMailSettings, type SmtpTransportOptions } from './smtp.js';

/** Transport tags this package can materialise. */
export type EmailTransportProvider = 'log' | 'resend' | 'postmark' | 'smtp';

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
      throw new Error(`makeTransport: unknown provider '${provider}'`);
  }
}
