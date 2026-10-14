// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/connector-imap
 *
 * The IMAP connector of the inbound-mail programme (design record on #8998):
 * PROTOCOL AND AUTH ONLY. It opens a read-only IMAP4rev1 session on a mail
 * account and hands back what a folder holds — UIDs, sizes and the messages
 * byte for byte. What a message means (parsing, dedupe, association,
 * suppression) and where the folder cursor is kept belong to the mailbox
 * sync in `@objectstack/service-mailbox`, its one consumer.
 *
 * Unlike the automation connectors (`connector-rest`, `connector-slack`, …) it
 * registers no `connector_action` handlers and ships no plugin: nothing in a
 * flow calls IMAP, the mailbox service does.
 *
 * The account and credential abstraction ({@link MailAccount},
 * {@link MailCredentialProvider}) is shaped for the per-user mailbox; the
 * shared mailbox is its first implementor (decision 4). The in-process server
 * double for tests is the `./testing` entry.
 */

export {
  staticCredentials,
  type ImapEndpoint,
  type ImapSecurity,
  type MailAccount,
  type MailCredential,
  type MailCredentialProvider,
} from './account.js';
export { ImapError, type ImapErrorKind } from './imap-error.js';
export { IMAP_MAX_RESPONSE_LITERALS } from './imap-wire.js';
export {
  DEFAULT_IMAP_MAX_COMMAND_BYTES,
  DEFAULT_IMAP_MAX_LITERAL_BYTES,
  DEFAULT_IMAP_TIMEOUT_MS,
  IMAP_MAX_LINE_BYTES,
  IMAP_RESPONSE_OVERHEAD_BYTES,
  openImapSession,
  type ImapFolderStatus,
  type ImapMessage,
  type ImapMessageSize,
  type ImapSession,
  type ImapSessionOptions,
} from './imap-session.js';
