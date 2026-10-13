# @objectstack/service-mailbox

Inbound mail for ObjectStack: the mirrored message, its links to an app's records, and the read gates that keep a mailbox's unmatched mail restricted.

> ⚠️ **Nothing ingests mail yet.** This release ships the objects and their read gates only. The IMAP connector and the ingest engine (deduplication, association stamping from the email fields an app flags with `mailAssociation`, and re-match) are not yet shipped, so no row is written by this package today.

## What this package provides

- **`MailboxServicePlugin`** — the provider of the `mailbox` capability. An app opts in with `requires: ['mailbox']`; it is not mounted by default. It registers three system objects, each `engine-owned` and served by the data API through `get` and `list` only:
  - **`sys_mailbox`** — a mailbox's identity: `name`, `address` and `owner_user_id`. Served only to holders of `manage_mailboxes` (`requiredPermissions`).
  - **`sys_mail_message`** — a faithful RFC 5322 mirror of one inbound message: participants, Message-ID and threading headers, subject, text and HTML bodies (the HTML body is stored as plain text, never rendered unsanitized), and attachments as `sys_attachment` rows. A message no record matched has `association_state: 'unassociated'` and waits in the mailbox's pool.
  - **`sys_mail_association`** — one row per link between a message and a record of the app's own objects (`object_name`, `record_id`), with the participant address and email field that matched.
- **Two read gates**, installed as data middleware on `find`, `findOne`, `count` and `aggregate`, so a list's `total` agrees with its rows:
  - a **message** is served to a caller who can read a record it is associated with, to the owner of its mailbox, or to a holder of `manage_mailboxes`. An unassociated message has no record to read, so an ordinary member is refused it as not found (`404 RECORD_NOT_FOUND`): the pool is restricted, never organization-wide;
  - an **association** is served to a caller who can read the record it names, or to a holder of `manage_mailboxes`.
- **`manage_mailboxes`** — an organization capability declared in `@objectstack/spec`. Platform administrators and organization administrators hold it by default; every other position only by explicit grant. Object grants and field-level security still apply to a holder.

## Usage

```typescript
import { defineStack } from '@objectstack/spec';

export default defineStack({
  // …
  requires: ['mailbox'],
});
```

Grant object read on `sys_mail_message` and `sys_mail_association` to the positions that should see mail on the records they can read; grant `manage_mailboxes` to the people who administer mailboxes and their unassociated pool.
