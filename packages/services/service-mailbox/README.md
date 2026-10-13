# @objectstack/service-mailbox

Inbound mail for ObjectStack: the mirrored message, its links to an app's records, and the read gates that keep a mailbox's unmatched mail restricted.

> ⚠️ **No mail source is connected yet.** This package ships the objects, their read gates and the ingest seam that writes them. The IMAP connector that fetches a mailbox's mail and hands each message to the seam is not yet shipped, so on a deployment today no message arrives unless server code calls the seam itself.

## What this package provides

- **`MailboxServicePlugin`** — the provider of the `mailbox` capability. An app opts in with `requires: ['mailbox']`; it is not mounted by default. It registers three system objects, each `engine-owned` and served by the data API through `get` and `list` only:
  - **`sys_mailbox`** — a mailbox's identity: `name`, `address` and `owner_user_id`. Served only to holders of `manage_mailboxes` (`requiredPermissions`).
  - **`sys_mail_message`** — a faithful RFC 5322 mirror of one inbound message: participants, Message-ID and threading headers, subject, text and HTML bodies (the HTML body is stored as plain text, never rendered unsanitized), and attachments as `sys_attachment` rows. A message no record matched has `association_state: 'unassociated'` and waits in the mailbox's pool.
  - **`sys_mail_association`** — one row per link between a message and a record of the app's own objects (`object_name`, `record_id`), with the participant address and email field that matched.
- **Two read gates**, installed as data middleware on `find`, `findOne`, `count` and `aggregate`, so a list's `total` agrees with its rows:
  - a **message** is served to a caller who can read a record it is associated with, to the owner of its mailbox, or to a holder of `manage_mailboxes`. An unassociated message has no record to read, so an ordinary member is refused it as not found (`404 RECORD_NOT_FOUND`): the pool is restricted, never organization-wide;
  - an **association** is served to a caller who can read the record it names, or to a holder of `manage_mailboxes`.
- **`manage_mailboxes`** — an organization capability declared in `@objectstack/spec`. Platform administrators and organization administrators hold it by default; every other position only by explicit grant. Object grants and field-level security still apply to a holder.
- **The ingest seam** — `MailIngestService`, registered as the kernel service `mailbox` (`MAILBOX_SERVICE`):
  - **`ingest({ mailboxId, raw, receivedAt? }, context)`** reads one raw RFC 822 message and writes at most one `sys_mail_message` row, answering `stored`, `duplicate` or `suppressed`:
    - **participants** are the addresses of From, Sender, Reply-To, To and Cc, plus the same headers of a message forwarded as an attachment (a `message/rfc822` part). The mailbox's own address is left out. They are stored on the row in `match_addresses`, each with its source (`outer` or `attachment`). A forward quoted inline in the body is not read yet;
    - **association** — every record of every object whose email field declares `mailAssociation: true` and holds one of those addresses (ASCII case-insensitive) is linked to the message, inside the mailbox's organization only, with one `sys_mail_association` row each (`matched_by: 'ingest'`). A message no record matches waits in the pool (`association_state: 'unassociated'`);
    - **dedupe** — one row per message per mailbox, keyed on the Message-ID (or, for a message without one, on its header block as received), so a second fetch answers `duplicate` and writes nothing;
    - **threading** — `message_id`, `in_reply_to` and `reference_ids` hold the ids of RFC 5322 §3.6.4, angle brackets stripped;
    - **suppression** — an auto-reply (`Auto-Submitted` other than `no`, `Precedence: bulk|junk|list`, `X-Autoreply`, `X-Autorespond`) or a bounce (`multipart/report; report-type=delivery-status`) is not stored at all.

    Only the system context may ingest: a message enters a mailbox from its mail source, never from a user.
  - **`rematch({ mailboxId, messageIds? }, context)`** replays each message's stored participant set against the records that exist now and adds the links that are missing (`matched_by: 'rematch'`), moving a pool message to `associated` once it has one. It never removes a link. The system context may run it, and so may the mailbox's owner and a `manage_mailboxes` holder of the mailbox's organization; anyone else is refused (`PERMISSION_DENIED`), and another organization's mailbox is not found (`RECORD_NOT_FOUND`).
  - Attachments are not stored yet, so a message forwarded as an attachment is stored with the forwarder's own text, and the forwarded message's body is not kept.

## Usage

```typescript
import { defineStack } from '@objectstack/spec';

export default defineStack({
  // …
  requires: ['mailbox'],
});
```

Flag the email fields that identify a correspondent:

```typescript
import { ObjectSchema, Field } from '@objectstack/spec/data';

export const Contact = ObjectSchema.create({
  name: 'crm_contact',
  label: 'Contact',
  fields: {
    email: Field.email({ label: 'Email', mailAssociation: true }),
  },
});
```

Grant object read on `sys_mail_message` and `sys_mail_association` to the positions that should see mail on the records they can read; grant `manage_mailboxes` to the people who administer mailboxes and their unassociated pool.
