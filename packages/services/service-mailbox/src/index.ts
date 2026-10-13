// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

export { MailboxServicePlugin, MAILBOX_SERVICE_MANIFEST_ID } from './mailbox-service-plugin.js';
export { SysMailbox, SysMailMessage, SysMailAssociation } from './objects/index.js';
export {
  MAILBOX_ADMIN_CAPABILITY,
  MAIL_MESSAGE_OBJECT,
  MAIL_ASSOCIATION_OBJECT,
  MAILBOX_OBJECT,
  MAIL_GATE_SCAN_LIMIT,
  computeMailMessageFilter,
  computeMailAssociationFilter,
  installMailReadVisibility,
  type MailGateEngine,
  type MailGateLogger,
  type MailReadMiddlewareCtx,
} from './mail-read-visibility.js';
export {
  MAILBOX_SERVICE,
  MailIngestService,
  MailboxServiceError,
  MAIL_MATCH_ADDRESS_SOURCES,
  MAIL_SUPPRESSION_REASONS,
  type MailAssociationMatch,
  type MailIngestEngine,
  type MailIngestLogger,
  type MailIngestInput,
  type MailIngestResult,
  type MailMatchAddress,
  type MailMatchAddressSource,
  type MailRematchInput,
  type MailRematchResult,
  type MailSuppressionReason,
  type MailboxCallerContext,
  type MailboxServiceErrorCode,
  type RawMailMessage,
} from './ingest/index.js';
