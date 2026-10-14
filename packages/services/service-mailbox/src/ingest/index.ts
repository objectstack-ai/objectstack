// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The inbound-mail ingest seam: raw RFC 822 message → `sys_mail_message` row
 * and its `sys_mail_association` links, plus the explicit re-match.
 */

export {
  MAILBOX_SERVICE,
  MailIngestService,
  MailboxServiceError,
  type MailIngestEngine,
  type MailIngestLogger,
  type MailIngestInput,
  type MailIngestResult,
  type MailRematchInput,
  type MailRematchResult,
  type MailboxCallerContext,
  type MailboxServiceErrorCode,
} from './mail-ingest-service.js';
export { MAIL_MATCH_ADDRESS_SOURCES, type MailMatchAddress, type MailMatchAddressSource } from './match-addresses.js';
export type { MailAssociationMatch } from './match-records.js';
export type { RawMailMessage } from './parse-message.js';
export { MAIL_SUPPRESSION_REASONS, type MailSuppressionReason } from './suppression.js';
