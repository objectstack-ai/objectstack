// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IEmailTransport } from '@objectstack/spec/contracts';
import { SmtpTransport } from './transports/smtp.js';
import { ResendTransport } from './transports/resend.js';
import { PostmarkTransport } from './transports/postmark.js';

/**
 * The statement Setup → Email makes about the LIVE transport. The page's form
 * shows what is stored, and that can differ from what is live: the out-of-the-box
 * `mail` namespace stores provider `smtp` with an empty host while every message
 * goes to the development log and is recorded as sent. The settings service
 * places this statement at the top of the page (`registerLiveStatus`).
 *
 * Same shape as service-settings' `SettingsLiveStatus`. It is restated here
 * because this plugin reaches the settings service through a structural surface
 * and takes no package dependency on it.
 */
export interface LiveMailTransportStatus {
  label: string;
  bannerText: string;
  bannerSeverity: 'info' | 'warning';
}

/** The part of `EmailService` the statement reads. */
export interface LiveMailTransportSource {
  /** `IEmailService.isConfigured`: does mail sent through the service get delivered? */
  isConfigured(): boolean;
  options: { transport: IEmailTransport };
}

/** A name an administrator recognises for the live transport. */
function transportName(transport: IEmailTransport): string {
  if (transport instanceof SmtpTransport) {
    const { host, port } = transport.describe() as { host?: unknown; port?: unknown };
    return `SMTP (${String(host)}:${String(port)})`;
  }
  if (transport instanceof ResendTransport) return 'Resend';
  if (transport instanceof PostmarkTransport) return 'Postmark';
  return 'a transport supplied by the host application';
}

/**
 * Describe the live transport from `isConfigured()`, read at call time, so the
 * statement follows a transport rebuilt from the `mail` namespace.
 *
 * `isConfigured()` decides the branch: `false` means no mail leaves this machine,
 * whatever the form says. The transport is read only to name it.
 */
export function describeLiveMailTransport(source: LiveMailTransportSource): LiveMailTransportStatus {
  if (!source.isConfigured()) {
    return {
      label: 'No mail leaves this machine',
      bannerSeverity: 'warning',
      bannerText: 'The live transport is the development log. Every message this server sends '
        + '(invitations, password resets, notifications) is recorded in `sys_email` as sent, '
        + 'but none is delivered to anyone. To deliver mail, choose a provider below, complete '
        + 'its settings and save.',
    };
  }
  const name = transportName(source.options.transport);
  return {
    label: `Mail is delivered through ${name}`,
    bannerSeverity: 'info',
    bannerText: `The live transport is ${name}. Messages this server sends are handed to it for `
      + 'delivery. A single send can still fail; "Send test email" below reports the provider\'s own answer.',
  };
}
