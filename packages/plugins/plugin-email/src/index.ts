// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/plugin-email
 *
 * Outbound email delivery for ObjectStack. Registers an `IEmailService`
 * implementation backed by a pluggable `IEmailTransport` (SMTP via
 * nodemailer, SendGrid, Resend, SES, …) and persists each attempt to
 * the `sys_email` system object for audit / activity-stream display.
 */

export { EmailServicePlugin } from './email-plugin.js';
export type { EmailServicePluginOptions } from './email-plugin.js';
export { LogTransport, normalizeMessage, formatAddress } from './email-service.js';
