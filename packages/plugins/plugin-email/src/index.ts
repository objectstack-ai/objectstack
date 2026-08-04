// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/plugin-email
 *
 * Outbound email delivery for ObjectStack. Registers an `IEmailService`
 * implementation backed by a pluggable `IEmailTransport` — SMTP via
 * nodemailer, Resend, Postmark — and persists each attempt to the
 * `sys_email` system object for audit / activity-stream display.
 *
 * The list above is exhaustive on purpose: it used to read "SendGrid, …",
 * which no transport here has ever implemented (#5094). SendGrid and Amazon
 * SES are delivered through `SmtpTransport` against their published SMTP
 * endpoints. `EMAIL_TRANSPORT_PROVIDERS` is the machine-readable form.
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
  EMAIL_TRANSPORT_PROVIDERS,
  API_KEY_EMAIL_PROVIDERS,
  RETIRED_EMAIL_PROVIDERS,
  isEmailTransportProvider,
  emailProviderRequiresApiKey,
  retiredProviderGuidance,
  unsupportedProviderFix,
  type ResendTransportOptions,
  type PostmarkTransportOptions,
  type SmtpTransportOptions,
  type MakeTransportOptions,
  type EmailTransportProvider,
  type ApiKeyEmailProvider,
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
