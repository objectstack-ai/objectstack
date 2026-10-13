// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/** The IMAP sync: a mailbox's folder → the ingest seam, above its stored cursor. */

export {
  DEFAULT_SYNC_BATCH_SIZE,
  DEFAULT_SYNC_FOLDER,
  DEFAULT_SYNC_MAX_MESSAGE_BYTES,
  DEFAULT_SYNC_MAX_BATCH_BYTES,
  DEFAULT_SYNC_MAX_MESSAGES_PER_RUN,
  MailboxSyncService,
  SYNC_LITERAL_ENVELOPE_BYTES,
  type MailboxAccountResolver,
  type MailboxImapAccount,
  type MailboxSyncAllResult,
  type MailboxSyncResult,
  type MailboxSyncServiceOptions,
  type MailboxSyncSkipReason,
  type MailboxSyncTarget,
  type MailSyncEngine,
  type MailSyncLogger,
} from './mailbox-sync-service.js';
