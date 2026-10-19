# @objectstack/connector-imap

## 18.0.0-next.5

No changes in this release.

## 18.0.0-next.4

No changes in this release.

## 18.0.0-next.3

No changes in this release.

## 18.0.0-next.2

No changes in this release.

## 18.0.0-next.1

### Minor Changes

- 3d830b7: Inbound mail has a mail source: the new `@objectstack/connector-imap` reads a mailbox over IMAP, and `@objectstack/service-mailbox` polls each mailbox's folder into its ingest seam, keeping a UID cursor on `sys_mailbox`
  
  Clause-②: yes (a new published package, `@objectstack/connector-imap`, and its exports; new exports and plugin options in `@objectstack/service-mailbox`, and four new fields on its published `sys_mailbox` object)
  
  - **`@objectstack/connector-imap` (new) — protocol and authentication only.**
    - `openImapSession({ account, credentials, timeoutMs?, maxLiteralBytes?, maxCommandBytes? })` opens a read-only IMAP4rev1 session: `examine(folder)` (`EXAMINE`, never `SELECT`; answers `uidValidity`, `uidNext`, `exists`), `listMessages(fromUid)`, `fetchMessages(uids)` (`BODY.PEEK[]`, so no message is marked `\Seen`), `logout()` and `close()`. A folder opened without a UIDVALIDITY is refused.
    - The account and credential abstraction is shaped for the per-user mailbox: a `MailAccount` (`{ id, username, imap: { host, port?, security? } }`) and a `MailCredentialProvider` that resolves the account's credential each time a session opens. `staticCredentials(credential)` answers one fixed credential.
    - A `password` credential is sent with `AUTHENTICATE PLAIN` when the server offers it, otherwise `LOGIN`; an `oauth2` access token with `AUTHENTICATE XOAUTH2`. A server that refuses `LOGIN` and offers no `PLAIN` is refused before anything is sent.
    - `security: 'tls'` (the default) is implicit TLS with the certificate verified. A plaintext connection (`security: 'none'`) is refused to any host but loopback, before a socket opens.
    - Failures are `ImapError` with a `kind`: `configuration`, `connection`, `timeout`, `authentication`, `refused`, `protocol` or `oversized`.
    - An IMAP server is treated as an untrusted peer. A line above 4 MiB, a literal above `maxLiteralBytes` (64 MiB by default), a response of more than `IMAP_MAX_RESPONSE_LITERALS` (32) literals, and more than `maxCommandBytes` of responses to one command (128 MiB by default) are refused as `oversized` before the excess is kept, and the connection is closed.
    - `@objectstack/connector-imap/testing` exports `ImapServerDouble`, an in-process IMAP server on loopback for tests.
    - No runtime dependencies.
  - **`@objectstack/service-mailbox` — the IMAP sync.**
    - `new MailboxServicePlugin({ imap: { accountFor, pollIntervalMs?, batchSize?, maxMessagesPerRun?, maxMessageBytes?, maxBatchBytes? } })` schedules the interval job `mailbox:imap-sync` on the composed job service. For each mailbox `accountFor` answers (asked per mailbox per run; `null` for a mailbox the host does not sync), it fetches the messages above the stored cursor, in UID order, and hands each one to `ingest` under the system context. Dedupe, association, the pool and auto-reply suppression are unchanged.
    - Without `imap` — the capability boot constructs the plugin with no options — no mailbox is synced, and the boot says so once. With `imap` but no job service, the boot warns, and `plugin.syncService.syncAll({ isSystem: true })` runs a pass on the host's own schedule. A run in which a mailbox could not be synced reports `degraded` to the job service.
    - `sys_mailbox` gains the cursor, written by the sync only: `imap_folder`, `imap_uid_validity`, `imap_last_uid` and `imap_synced_at`. A cursor taken under another UIDVALIDITY, or in another folder, is discarded and the folder is read from its start; the messages already stored answer `duplicate`. No credential is stored on the object: the account and its credential come from `accountFor`.
    - The cursor moves after each batch past every message stored, already stored, suppressed or skipped. A store failure stops the run below the failed message, so the next run retries it. A message above `maxMessageBytes` (32 MiB by default) or one the seam refuses as unreadable is skipped and logged at `error` with its UID.
    - A batch is bounded by count (`batchSize`, 25) and by listed bytes (`maxBatchBytes`, 64 MiB). The session's literal bound is `maxMessageBytes` plus a 64 KiB framing envelope, so a server that omits or understates a message's size cannot hand over more. That message is skipped as `too_large`, after the batch is read again one message at a time on a fresh session, and the rest of the mailbox keeps arriving.
    - A forwarded `message/global` part (RFC 6532, the internationalized `message/rfc822`) is now read as an `attachment` source, the same as `message/rfc822`.
    - New exports: `MailboxSyncService`, `MAILBOX_SYNC_JOB`, `DEFAULT_MAILBOX_POLL_INTERVAL_MS`, `DEFAULT_SYNC_FOLDER`, `DEFAULT_SYNC_BATCH_SIZE`, `DEFAULT_SYNC_MAX_MESSAGES_PER_RUN`, `DEFAULT_SYNC_MAX_MESSAGE_BYTES`, `DEFAULT_SYNC_MAX_BATCH_BYTES`, `SYNC_LITERAL_ENVELOPE_BYTES`, and the types `MailboxServicePluginOptions`, `MailboxImapSyncOptions`, `MailboxAccountResolver`, `MailboxImapAccount`, `MailboxSyncTarget`, `MailboxSyncResult`, `MailboxSyncAllResult`, `MailboxSyncSkipReason`, `MailboxSyncServiceOptions`, `MailSyncEngine` and `MailSyncLogger`.
    - This supersedes the ingest seam entry's "no mail source feeds the seam": the IMAP sync does. Attachments are still not stored.
