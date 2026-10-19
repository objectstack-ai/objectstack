# @objectstack/service-mailbox

## 18.0.0-next.5

### Patch Changes

- Updated dependencies [fa26308]
- Updated dependencies [01fafde]
- Updated dependencies [26501ae]
- Updated dependencies [94e60c0]
- Updated dependencies [adb7910]
- Updated dependencies [69f342b]
- Updated dependencies [2ec6827]
- Updated dependencies [2ec6827]
- Updated dependencies [fb0d85b]
- Updated dependencies [4d12b23]
- Updated dependencies [ff48407]
- Updated dependencies [b7a688e]
  - @objectstack/spec@18.0.0-next.5
  - @objectstack/platform-objects@18.0.0-next.5
  - @objectstack/core@18.0.0-next.5
  - @objectstack/types@18.0.0-next.5
  - @objectstack/connector-imap@18.0.0-next.5

## 18.0.0-next.4

### Patch Changes

- Updated dependencies [b2e7870]
- Updated dependencies [eebaf3b]
- Updated dependencies [194a42d]
- Updated dependencies [bb7ccde]
- Updated dependencies [df000d4]
- Updated dependencies [646303e]
- Updated dependencies [f5ef054]
- Updated dependencies [f7af839]
- Updated dependencies [a237d7f]
- Updated dependencies [b0a1df0]
- Updated dependencies [eda6f14]
- Updated dependencies [2ee5861]
- Updated dependencies [e46ce7b]
- Updated dependencies [a19b2a7]
- Updated dependencies [2ac0616]
- Updated dependencies [1489952]
- Updated dependencies [030a7b8]
- Updated dependencies [b1845ed]
- Updated dependencies [99e9d29]
- Updated dependencies [70cfb12]
- Updated dependencies [8bfb17d]
- Updated dependencies [8215ff7]
- Updated dependencies [4f11af5]
- Updated dependencies [b036ac5]
- Updated dependencies [d537a31]
- Updated dependencies [6ec0e12]
- Updated dependencies [af284b0]
- Updated dependencies [14a8bd2]
- Updated dependencies [1e001c7]
- Updated dependencies [0b44840]
- Updated dependencies [ef65646]
- Updated dependencies [586705d]
- Updated dependencies [1173017]
- Updated dependencies [8baeda5]
- Updated dependencies [2ce2e36]
- Updated dependencies [584b422]
- Updated dependencies [62e2b6d]
- Updated dependencies [370833a]
- Updated dependencies [3a734e0]
- Updated dependencies [ba5bfe9]
- Updated dependencies [31e7d0b]
- Updated dependencies [741aa85]
- Updated dependencies [db1f1fd]
- Updated dependencies [cf540a7]
- Updated dependencies [f573976]
- Updated dependencies [f573976]
  - @objectstack/core@18.0.0-next.4
  - @objectstack/spec@18.0.0-next.4
  - @objectstack/platform-objects@18.0.0-next.4
  - @objectstack/types@18.0.0-next.4
  - @objectstack/connector-imap@18.0.0-next.4

## 18.0.0-next.3

### Patch Changes

- Updated dependencies [b15f8a1]
- Updated dependencies [4216796]
- Updated dependencies [c40a0dd]
- Updated dependencies [60f9baf]
- Updated dependencies [3fed1eb]
- Updated dependencies [a35f7a6]
- Updated dependencies [f606ba2]
- Updated dependencies [105902f]
- Updated dependencies [f901746]
- Updated dependencies [ee0e115]
- Updated dependencies [8684079]
- Updated dependencies [a69a40a]
- Updated dependencies [0a052e6]
- Updated dependencies [ae0ca66]
- Updated dependencies [23d0bc7]
- Updated dependencies [8776119]
- Updated dependencies [0a168a3]
- Updated dependencies [97b8e7a]
- Updated dependencies [af3873b]
- Updated dependencies [9cb9d95]
- Updated dependencies [f846cc2]
- Updated dependencies [30ce56e]
- Updated dependencies [2e0e451]
- Updated dependencies [1ecb08a]
- Updated dependencies [adad73f]
- Updated dependencies [77efc66]
- Updated dependencies [6422da5]
- Updated dependencies [8f4260f]
- Updated dependencies [d0fe050]
- Updated dependencies [dd11563]
- Updated dependencies [2c702fd]
- Updated dependencies [92fd343]
- Updated dependencies [bbdfc05]
- Updated dependencies [d050a8f]
- Updated dependencies [4ffdebe]
- Updated dependencies [d731b89]
- Updated dependencies [905f57b]
- Updated dependencies [66d2757]
- Updated dependencies [e246f06]
- Updated dependencies [a65a59b]
- Updated dependencies [8a83ceb]
- Updated dependencies [462d02f]
- Updated dependencies [45e6001]
- Updated dependencies [9f024d8]
  - @objectstack/spec@18.0.0-next.3
  - @objectstack/platform-objects@18.0.0-next.3
  - @objectstack/core@18.0.0-next.3
  - @objectstack/types@18.0.0-next.3
  - @objectstack/connector-imap@18.0.0-next.3

## 18.0.0-next.2

### Minor Changes

- b60eb78: Inbound mail reads a forward quoted inline in the body: a message an organization user forwards inline from Gmail, Outlook or Apple Mail now associates with the records its original participants match
  
  Clause-②: no
  
  - **What is read.** The "Forwarded message" block each of the three clients writes into the text/plain body, with its English labels: Gmail's `---------- Forwarded message ---------` block (From, Date, Subject, To, Cc), the block Outlook on the web and Microsoft 365 write under a line of 32 underscores (From, Sent, To, Cc, Subject), and Apple Mail's `Begin forwarded message:` block (From, Subject, Date, To, Cc, Reply-To). Its From, Reply-To, To and Cc addresses join the participant set in `match_addresses` under the source `inline`, after the outer and attachment entries. `rematch` replays them with the rest of the stored set and never reads the body again.
  - **Only an organization user's forward is read.** The block is read only when the message's From names one address and that address is the email of a user (`sys_user`, ASCII case-insensitive) who is a member (`sys_member`) of the mailbox's organization. A forward from anyone else, a member of another organization included, is matched on its own headers only. Where the identity objects are not registered (no auth plugin is composed), no inline forward is read, and the first message that carries one says so in the log.
  - **An unrecognised block pools.** A block the parser does not recognise is not guessed at: labels of another client or locale (Gmail in German writes `Von:`), a header line wrapped onto two lines, a block with no date line, a forward quoted by a reply, or a message with an HTML body only. The message is matched on its other participants, so a forward whose only match was in the block waits in the pool. Only the first block in the body is read; a forward quoted inside that forward is not.
- 05e3b8e: Inbound mail stores its attachments: each attachment of an ingested message, and each message it forwards as an attachment as an `.eml` file, is stored through the `file-attachments` service as a file of the message's `sys_mail_message` row
  
  Clause-②: no
  
  - **What is stored, and where.** Every part of a stored message besides its text and HTML bodies (inline parts included, and each forwarded `message/rfc822` or `message/global` part as the `.eml` file it travels as) becomes one `sys_file` and one `sys_attachment` whose parent is the message's own `sys_mail_message` row, written by `IFileAttachmentService.attachFile` in the mailbox's organization after the row, and only for a message the call stored, so a re-delivered copy adds no attachment.
  - **Without the storage capability.** A kernel that composes no `file-attachments` service (registered by `@objectstack/service-storage`) stores each message without its attachments, and says so once in the log.
  - **Refused attachments.** A part the service refuses, such as one over the `max_upload_mb` upload size limit, is logged at `error` with its file name and the refusal, and the message and its other attachments are still stored.
  - **For a host that constructs `MailIngestService` itself.** It takes the service as the optional `attachments` resolver (`MailboxServicePlugin` supplies it), and its `MailIngestLogger` now needs `error`, as `MailSyncLogger` already does.

### Patch Changes

- Updated dependencies [0d3ea29]
- Updated dependencies [f9b4217]
- Updated dependencies [87d0619]
- Updated dependencies [4e0838d]
- Updated dependencies [584e737]
- Updated dependencies [301eec6]
- Updated dependencies [5547ad4]
- Updated dependencies [0f05907]
- Updated dependencies [086fa46]
- Updated dependencies [b1e9280]
- Updated dependencies [05ab9ef]
- Updated dependencies [1d79556]
- Updated dependencies [07b27b3]
- Updated dependencies [d0c09e4]
- Updated dependencies [1692cd1]
- Updated dependencies [73c7dc4]
- Updated dependencies [8693110]
- Updated dependencies [ad5a7d7]
- Updated dependencies [dd29bbe]
- Updated dependencies [dd29bbe]
- Updated dependencies [6f21216]
- Updated dependencies [2372e0a]
- Updated dependencies [5afa1e0]
- Updated dependencies [56b2612]
- Updated dependencies [1418de4]
- Updated dependencies [7a96bf8]
- Updated dependencies [daafae6]
- Updated dependencies [3f0a307]
- Updated dependencies [5fd2c76]
- Updated dependencies [be48c5e]
- Updated dependencies [57994c3]
- Updated dependencies [23e689d]
- Updated dependencies [bc0538a]
- Updated dependencies [d176b0a]
- Updated dependencies [c5dd7fc]
- Updated dependencies [4feb2d0]
- Updated dependencies [1ac24f2]
- Updated dependencies [462dff3]
- Updated dependencies [8044f4d]
- Updated dependencies [c03077e]
- Updated dependencies [069fd40]
- Updated dependencies [941c78a]
  - @objectstack/platform-objects@18.0.0-next.2
  - @objectstack/spec@18.0.0-next.2
  - @objectstack/core@18.0.0-next.2
  - @objectstack/types@18.0.0-next.2
  - @objectstack/connector-imap@18.0.0-next.2

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
- 8258181: Inbound mail has an ingest seam: `MailIngestService`, the kernel service `mailbox`, turns one raw RFC 822 message into one `sys_mail_message` row, associates it at ingest with the records whose `mailAssociation` email fields hold a participant's address, and re-matches a mailbox on request
  
  Clause-②: yes (the package gains an exported ingest entry point it does not export today; a widening of the public surface)
  
  - **`ingest({ mailboxId, raw, receivedAt? }, context)`** reads one message and answers `stored`, `duplicate` or `suppressed`. Only the system context may call it: a message enters a mailbox from its mail source, never from a user.
    - **Participants.** The addresses of From, Sender, Reply-To, To and Cc, plus the same five headers of a message forwarded as an attachment (a `message/rfc822` part of the received message). The mailbox's own address is left out. The set is stored on the row in `match_addresses`, a JSON list of `{ address, source }` where `source` is `outer` or `attachment`. A forward quoted inline in the body is not read yet, and `inline` is declared so a later reader of it can store its addresses.
    - **Association.** The message is linked, one `sys_mail_association` row each (`matched_by: 'ingest'`), to every record of every object with an `email` field declaring `mailAssociation: true` whose value equals a participant address (ASCII case-insensitive), inside the mailbox's organization only. A flagged object with no organization column is skipped and logged once. No app code and no resolver service is involved. A message nothing matches is stored `association_state: 'unassociated'`: the restricted pool.
    - **Dedupe.** One row per message per mailbox. The key is `mid:` plus the SHA-256 of the Message-ID, or `hdr:` plus the SHA-256 of the header block as received for a message without one. A second fetch answers `duplicate` and writes nothing, and the unique key settles a concurrent pair.
    - **Threading.** `message_id`, `in_reply_to` and `reference_ids` hold the RFC 5322 ids with their angle brackets stripped.
    - **Suppression.** No row is written for an auto-reply (`Auto-Submitted` other than `no`, `Precedence: bulk`, `junk` or `list`, `X-Autoreply` or `X-Autorespond` other than `no`) or a bounce (`multipart/report; report-type=delivery-status`).
  - **`rematch({ mailboxId, messageIds? }, context)`** replays each message's stored participant set against the records that exist now. It adds the missing links (`matched_by: 'rematch'`) and moves a pool message to `associated` once it has one. It never removes a link. A stored set that is not the stored shape is reported in `unreadable` and not matched. The system context may run it, and so may the mailbox's owner and a `manage_mailboxes` holder in the mailbox's organization. Anyone else is refused with `PERMISSION_DENIED` (403), and another organization's mailbox answers `RECORD_NOT_FOUND` (404).
  - **New exports:** `MailIngestService`, `MAILBOX_SERVICE`, `MailboxServiceError` (`code` and `status`), `MAIL_MATCH_ADDRESS_SOURCES`, `MAIL_SUPPRESSION_REASONS`, and the types `MailIngestInput`, `MailIngestResult`, `MailRematchInput`, `MailRematchResult`, `MailboxCallerContext`, `MailIngestEngine`, `MailIngestLogger`, `MailAssociationMatch`, `MailMatchAddress`, `MailMatchAddressSource`, `MailSuppressionReason`, `MailboxServiceErrorCode` and `RawMailMessage`. `MailboxServicePlugin` registers the service in `init()`.
  - **New dependencies:** `postal-mime` (MIT-0, no dependencies of its own, ES module and CommonJS builds) reads the MIME structure, the encoded words and the address lists. `@objectstack/types`, already installed through `@objectstack/core`, supplies the keyset walk the re-match pages with.
  - **Not yet:** no mail source feeds the seam (the IMAP connector ships separately), and attachments are not stored, so a message forwarded as an attachment keeps the forwarder's own text and not the forwarded message's body.

### Patch Changes

- Updated dependencies [dac99c2]
- Updated dependencies [66949b7]
- Updated dependencies [7958bdf]
- Updated dependencies [87e902d]
- Updated dependencies [3d830b7]
- Updated dependencies [777eed2]
- Updated dependencies [ed03834]
- Updated dependencies [5f37d36]
- Updated dependencies [1912af4]
- Updated dependencies [76815b9]
- Updated dependencies [4d1e4a8]
- Updated dependencies [4cc3ff9]
- Updated dependencies [c056979]
- Updated dependencies [4f68ba1]
- Updated dependencies [107853c]
- Updated dependencies [543b33d]
- Updated dependencies [b529a5c]
- Updated dependencies [1623faf]
- Updated dependencies [b4d573a]
- Updated dependencies [3c1a046]
- Updated dependencies [37510aa]
- Updated dependencies [c857a93]
- Updated dependencies [345d1be]
- Updated dependencies [430e5f5]
- Updated dependencies [14a13bc]
- Updated dependencies [ca0bdbc]
- Updated dependencies [572ecfb]
- Updated dependencies [707b3cd]
- Updated dependencies [6673c80]
- Updated dependencies [5e725b8]
- Updated dependencies [eeb95f7]
- Updated dependencies [d89f491]
- Updated dependencies [dc39326]
- Updated dependencies [775ed65]
- Updated dependencies [e4ec6ec]
- Updated dependencies [325a92e]
  - @objectstack/spec@18.0.0-next.1
  - @objectstack/platform-objects@18.0.0-next.1
  - @objectstack/core@18.0.0-next.1
  - @objectstack/connector-imap@18.0.0-next.1
  - @objectstack/types@18.0.0-next.1

## 18.0.0-next.0

### Minor Changes

- 1e62f71: Inbound mail lands as a capability: `requires: ['mailbox']` registers the mirrored message `sys_mail_message`, its record links `sys_mail_association` and the mailbox directory `sys_mailbox`, with an unassociated pool restricted to mailbox owners and the new `manage_mailboxes` capability
  
  Clause-②: yes (widening)
  
  - **`@objectstack/spec`.** Two closed vocabularies each gain one entry; every stack and permission set that parsed before parses unchanged.
    - **`mailbox`** is a platform capability token (`PLATFORM_CAPABILITY_TOKENS`, provider `@objectstack/service-mailbox`, open edition). It is not on the always-on slate: an app that wants mailboxes declares `requires: ['mailbox']`.
    - **`manage_mailboxes`** is a curated organization capability (`PLATFORM_CAPABILITIES`), held by default by platform administrators (`ADMIN_FULL_ACCESS_CAPABILITIES`). Its holder reads the mailbox directory, and every mirrored message and association of its organization past the mail read gates, the unassociated pool included. Object grants and field-level security still apply to a holder.
  - **`@objectstack/service-mailbox`** (new). `MailboxServicePlugin` owns the three objects (ADR-0029 D1/D2: registered only where the capability is required) and installs two read gates on the data middleware, so a list's `total` agrees with its rows:
    - `sys_mail_message`, the RFC 5322 mirror of one inbound message (participants, Message-ID and threading headers, subject, text and HTML bodies, attachments as `sys_attachment` rows). A row is served to a caller who can read a record one of its associations names, to the owner of the mailbox it arrived in, or to a `manage_mailboxes` holder. A message no record matched (`association_state: 'unassociated'`) is therefore refused to an ordinary member as not found (`404 RECORD_NOT_FOUND`), never shown organization-wide.
    - `sys_mail_association`, one row per (message, record) link with the participant address and email field that matched. A row is served to a caller who can read the record it names, or to a `manage_mailboxes` holder.
    - `sys_mailbox`, the mailbox's address and owner, served only to a `manage_mailboxes` holder (`requiredPermissions`).
    - All three are `engine-owned` and the data API serves `get` and `list` only. The HTML body is plain text (`textarea`), never rendered markup. Nothing writes these rows yet: the IMAP connector and the ingest engine, which stamp associations from the email fields an app flags with `mailAssociation`, ship next in this package.
  - **`@objectstack/core`.** `resolveReadableParentIds` ("which of these parent records can the caller read", one caller-scoped engine read per parent object) is exported, so every parent-derived read gate asks the one evaluator. `CAPABILITY_PROVIDERS` gains the `mailbox` row.
  - **`@objectstack/plugin-security`.** `organization_admin` (and its derived no-bypass variant) holds `manage_mailboxes`: an organization administrator reads its own organization's mailboxes and pool.
  - **`@objectstack/plugin-audit`, `@objectstack/service-storage`.** The comment, activity, ledger and attachment gates import `resolveReadableParentIds` from `@objectstack/core` instead of carrying their own copies. The two copies were byte-identical, so no gate's answer changes.
  - **`@objectstack/cli`, `@objectstack/verify`.** Both depend on `@objectstack/service-mailbox`, so `objectstack serve` and `bootStack` mount the provider an app's `requires: ['mailbox']` names. The ADR-0131 organization-ownership inventory carries a row for each new object.

### Patch Changes

- Updated dependencies [317cddd]
- Updated dependencies [fec87e7]
- Updated dependencies [c28f317]
- Updated dependencies [2e10c9a]
- Updated dependencies [67b669e]
- Updated dependencies [0253192]
- Updated dependencies [0253192]
- Updated dependencies [48cca4a]
- Updated dependencies [bfc15d2]
- Updated dependencies [2ff0825]
- Updated dependencies [7aa8d51]
- Updated dependencies [95a8435]
- Updated dependencies [60bcfe7]
- Updated dependencies [d112087]
- Updated dependencies [4806b18]
- Updated dependencies [1802315]
- Updated dependencies [06cc45d]
- Updated dependencies [8c5aa50]
- Updated dependencies [7de0265]
- Updated dependencies [7895671]
- Updated dependencies [b389e43]
- Updated dependencies [c8b062f]
- Updated dependencies [117d34d]
- Updated dependencies [6729e10]
- Updated dependencies [1920cf3]
- Updated dependencies [41d0d40]
- Updated dependencies [c52bfb4]
- Updated dependencies [c7d6037]
- Updated dependencies [72b26ed]
- Updated dependencies [2d21b9c]
- Updated dependencies [f66fdc7]
- Updated dependencies [9fdb127]
- Updated dependencies [615c696]
- Updated dependencies [968acc8]
- Updated dependencies [111ffff]
- Updated dependencies [12b9daf]
- Updated dependencies [d85615d]
- Updated dependencies [6a06e3b]
- Updated dependencies [0e9e7b7]
- Updated dependencies [0af4f66]
- Updated dependencies [9a0401f]
- Updated dependencies [9c93ce6]
- Updated dependencies [77a94d8]
- Updated dependencies [ac9f8bd]
- Updated dependencies [879bd38]
- Updated dependencies [04e776b]
- Updated dependencies [1c563af]
- Updated dependencies [a7df552]
- Updated dependencies [2f70c22]
- Updated dependencies [78f841b]
- Updated dependencies [c565813]
- Updated dependencies [d5a14dd]
- Updated dependencies [93125ae]
- Updated dependencies [56c8844]
- Updated dependencies [d4680d2]
- Updated dependencies [cdeabec]
- Updated dependencies [d7c5c33]
- Updated dependencies [a87d8be]
- Updated dependencies [15ec50e]
- Updated dependencies [db4c45b]
- Updated dependencies [51290bc]
- Updated dependencies [ad381fd]
- Updated dependencies [4e4111c]
- Updated dependencies [2b61f2d]
- Updated dependencies [8f2e808]
- Updated dependencies [3b49318]
- Updated dependencies [4e9fe9f]
- Updated dependencies [9ad3d24]
- Updated dependencies [326a90a]
- Updated dependencies [9fe7448]
- Updated dependencies [2e11d90]
- Updated dependencies [0b7ba4d]
- Updated dependencies [4578c56]
- Updated dependencies [c512c25]
- Updated dependencies [215e662]
- Updated dependencies [3d886ee]
- Updated dependencies [d8d0711]
- Updated dependencies [f6e1d49]
- Updated dependencies [e9a1f5c]
- Updated dependencies [40a6ee5]
- Updated dependencies [5910b5e]
- Updated dependencies [7098aca]
- Updated dependencies [97610a5]
- Updated dependencies [081e6a0]
- Updated dependencies [1884948]
- Updated dependencies [3089848]
- Updated dependencies [e23eccb]
- Updated dependencies [ac8f2c5]
- Updated dependencies [746637e]
- Updated dependencies [db9cf80]
- Updated dependencies [e75dced]
- Updated dependencies [9af0005]
- Updated dependencies [440bed6]
- Updated dependencies [b2549a8]
- Updated dependencies [ee8751d]
- Updated dependencies [96e4be4]
- Updated dependencies [35ef501]
- Updated dependencies [faf6348]
- Updated dependencies [557ae7c]
- Updated dependencies [6a3fe25]
- Updated dependencies [7731d70]
- Updated dependencies [3073b72]
- Updated dependencies [c76edeb]
- Updated dependencies [5b12503]
- Updated dependencies [514bf3c]
- Updated dependencies [20e7d52]
- Updated dependencies [b3a3634]
- Updated dependencies [3e72f93]
- Updated dependencies [f89b5f5]
- Updated dependencies [d25b187]
- Updated dependencies [0e00d36]
- Updated dependencies [d748ae8]
- Updated dependencies [dab6bf4]
- Updated dependencies [ed1de8c]
- Updated dependencies [a00cf99]
- Updated dependencies [a00cf99]
- Updated dependencies [5fb1746]
- Updated dependencies [29a163f]
- Updated dependencies [e223152]
- Updated dependencies [9f5eca5]
- Updated dependencies [9963322]
- Updated dependencies [b27b894]
- Updated dependencies [874a38d]
- Updated dependencies [02d9f69]
- Updated dependencies [f53f14b]
- Updated dependencies [a800912]
- Updated dependencies [d973c34]
- Updated dependencies [156ddfa]
- Updated dependencies [5081090]
- Updated dependencies [b6eb25f]
- Updated dependencies [165587e]
- Updated dependencies [e04759d]
- Updated dependencies [ea9fd99]
- Updated dependencies [b32ee3e]
- Updated dependencies [91f46d0]
- Updated dependencies [e5899a6]
- Updated dependencies [d7b26df]
- Updated dependencies [490cb6d]
- Updated dependencies [e865300]
- Updated dependencies [ec7c7e0]
- Updated dependencies [c74d843]
- Updated dependencies [6d5191e]
- Updated dependencies [85edd61]
- Updated dependencies [e84aeb3]
- Updated dependencies [322ff1e]
- Updated dependencies [7b0a9c9]
- Updated dependencies [5fc57b3]
- Updated dependencies [fe58bbc]
- Updated dependencies [c4e7fa5]
- Updated dependencies [581ca7d]
- Updated dependencies [3f0b6f2]
- Updated dependencies [b7cd1af]
- Updated dependencies [9814035]
- Updated dependencies [55382dc]
- Updated dependencies [b1d701b]
- Updated dependencies [efcbac7]
- Updated dependencies [51f36e7]
- Updated dependencies [31b5a5f]
- Updated dependencies [20028df]
- Updated dependencies [69d4218]
- Updated dependencies [5ce6773]
- Updated dependencies [9432bac]
- Updated dependencies [3f69471]
- Updated dependencies [e5687cb]
- Updated dependencies [1e62f71]
- Updated dependencies [ec7f7f8]
- Updated dependencies [038d4c9]
- Updated dependencies [147a0d1]
- Updated dependencies [1959aac]
- Updated dependencies [e1deaef]
- Updated dependencies [3071d3e]
- Updated dependencies [1badd31]
- Updated dependencies [55828c5]
- Updated dependencies [7856110]
- Updated dependencies [9b37edb]
- Updated dependencies [a22e67b]
- Updated dependencies [62ce45d]
- Updated dependencies [39e93ef]
- Updated dependencies [02bec6c]
- Updated dependencies [719183f]
- Updated dependencies [8464380]
- Updated dependencies [252a582]
- Updated dependencies [f931e76]
- Updated dependencies [e5f9f01]
- Updated dependencies [ef1fcb2]
- Updated dependencies [ace0a53]
- Updated dependencies [8311650]
- Updated dependencies [de70e97]
- Updated dependencies [74c4b34]
- Updated dependencies [e040b8c]
- Updated dependencies [f451a59]
- Updated dependencies [ba95607]
- Updated dependencies [b53b949]
- Updated dependencies [ea9fd99]
- Updated dependencies [1e44436]
- Updated dependencies [2acff87]
- Updated dependencies [299a2c6]
- Updated dependencies [e23eccb]
- Updated dependencies [bf492c8]
- Updated dependencies [c7a3234]
  - @objectstack/spec@18.0.0-next.0
  - @objectstack/core@18.0.0-next.0
  - @objectstack/platform-objects@18.0.0-next.0
