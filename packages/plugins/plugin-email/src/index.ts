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

export { EmailServicePlugin, resolveDurableQueue, resolveAttachmentStore } from './email-plugin.js';
export type { EmailServicePluginOptions } from './email-plugin.js';
export {
  LogTransport,
  normalizeMessage,
  formatAddress,
  EMAIL_SEND_QUEUE,
  DEFAULT_TEMPLATE_LOCALE,
} from './email-service.js';
export {
  createSysEmailTemplateLoader,
  type TemplateLoaderEngine,
  type CreateTemplateLoaderOptions,
} from './template-loader.js';
export type {
  EmailServiceOptions,
  TemplateLoader,
  EmailTemplateRow,
  EmailPersistence,
  EmailQueueDelivery,
  EmailSendQueuePayload,
  DeliverAttemptOptions,
  RowToNormalizedOptions,
} from './email-service.js';
export {
  SYS_EMAIL_ATTACHMENT_LIMIT_BYTES,
  encodeAttachmentsForRow,
  decodeAttachmentsFromRow,
  decodeAttachmentsFromRowAsync,
  readAttachmentColumn,
  materializeAttachment,
  collectAttachmentParts,
  storageKeysInColumn,
  withContentReclaimed,
  encodeHeadersForRow,
  decodeHeadersFromRow,
  type PersistedEmailAttachment,
  type EncodedAttachments,
  type AttachmentSource,
  type AttachmentPart,
  type CollectedAttachments,
} from './sys-email-payload.js';
export {
  EMAIL_ATTACHMENT_KEY_PREFIX,
  EMAIL_ATTACHMENT_RECLAIM_QUEUE,
  EMAIL_ATTACHMENT_RECLAIM_GRACE_MS,
  attachmentStorageKey,
  offloadAttachmentsToStorage,
  deleteAttachmentKeys,
  fetchAttachmentContent,
  type EmailAttachmentStore,
  type EmailAttachmentStorage,
  type EmailAttachmentReclaimPayload,
  type AttachmentOffload,
} from './attachment-storage.js';
export {
  reclaimAttachmentContent,
  RECLAIM_OBJECT,
  TERMINAL_EMAIL_STATUSES,
  type AttachmentReclaimEngine,
  type AttachmentReclaimOutcome,
  type ReclaimAttachmentContentOptions,
} from './attachment-reclaim.js';
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
  sweepStrandedOutbox,
  OUTBOX_OBJECT,
  OUTBOX_SWEEP_MIN_AGE_MS,
  OUTBOX_SWEEP_LIMIT,
  type OutboxSweepResult,
  type OutboxSweepService,
  type SweepStrandedOutboxOptions,
} from './outbox-sweep.js';
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
