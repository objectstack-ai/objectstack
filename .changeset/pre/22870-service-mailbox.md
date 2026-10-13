---
'@objectstack/spec': minor
'@objectstack/service-mailbox': minor
'@objectstack/core': minor
'@objectstack/plugin-security': minor
'@objectstack/plugin-audit': patch
'@objectstack/service-storage': patch
'@objectstack/cli': patch
'@objectstack/verify': patch
---

Inbound mail lands as a capability: `requires: ['mailbox']` registers the mirrored message `sys_mail_message`, its record links `sys_mail_association` and the mailbox directory `sys_mailbox`, with an unassociated pool restricted to mailbox owners and the new `manage_mailboxes` capability

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
