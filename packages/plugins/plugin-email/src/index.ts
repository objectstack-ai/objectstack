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
export type { EmailServiceOptions, TemplateLoader, EmailTemplateRow, EmailPersistence } from './email-service.js';
export { renderTemplate, requireVars, htmlToText } from './template-engine.js';
export {
  ResendTransport,
  PostmarkTransport,
  SmtpTransport,
  makeTransport,
  smtpOptionsFromMailSettings,
  type ResendTransportOptions,
  type PostmarkTransportOptions,
  type SmtpTransportOptions,
  type MakeTransportOptions,
  type EmailTransportProvider,
} from './transports/index.js';
export {
  bootstrapDeclaredEmailTemplates,
  upsertDeclaredEmailTemplate,
  deactivateDeclaredEmailTemplate,
  mapTemplateToRow,
  EMAIL_TEMPLATE_OBJECT,
  type BootstrapDeclaredEmailTemplatesResult,
} from './bootstrap-declared-email-templates.js';
export {
  bindEmailTemplateProvenanceStamp,
  unbindEmailTemplateProvenanceStamp,
  EMAIL_TEMPLATE_PROVENANCE_PACKAGE,
} from './email-template-provenance.js';
export {
  AUTH_PASSWORD_RESET_TEMPLATE,
  AUTH_VERIFY_EMAIL_TEMPLATE,
  AUTH_MAGIC_LINK_TEMPLATE,
  AUTH_INVITATION_TEMPLATE,
  AUTH_TWO_FACTOR_OTP_TEMPLATE,
  BUILTIN_AUTH_TEMPLATES,
} from './templates/auth-templates.js';
