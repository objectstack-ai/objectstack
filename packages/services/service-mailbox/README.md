# @objectstack/service-mailbox

Inbound mail for ObjectStack: the mirrored message, its links to an app's records, and the read gates that keep a mailbox's unmatched mail restricted.

> ⚠️ **Mail arrives only where an IMAP account source is composed.** The capability boot (`requires: ['mailbox']`) constructs the plugin with no options, so it mounts the objects, their read gates and the ingest seam, and syncs no mailbox — it says so once at boot. Compose the plugin yourself with `imap.accountFor` (below) to poll mailboxes.
>
> ⚠️ **Attachments are not stored.** Nothing on the server writes `sys_attachment` rows today, so a message's attachments — and the body of a message forwarded as an attachment — are not kept; only its participants are read.

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
    - **participants** are the addresses of From, Sender, Reply-To, To and Cc, plus the same headers of a message forwarded as an attachment (a `message/rfc822` part, or its internationalized twin `message/global`, RFC 6532). At most `MAX_FORWARDED_PARTS` (20) forwarded parts of one message are read; the rest, and any part the MIME parser refuses, take no part in matching, and the message is stored without them (a warning names how many). The mailbox's own address is left out. They are stored on the row in `match_addresses`, each with its source (`outer` or `attachment`). A forward quoted inline in the body is not read yet;
    - **association** — every record of every object whose email field declares `mailAssociation: true` and holds one of those addresses (ASCII case-insensitive) is linked to the message, inside the mailbox's organization only, with one `sys_mail_association` row each (`matched_by: 'ingest'`). A message no record matches waits in the pool (`association_state: 'unassociated'`);
    - **dedupe** — one row per message per mailbox, keyed on the Message-ID (or, for a message without one, on its header block as received), so a second fetch answers `duplicate` and writes nothing;
    - **threading** — `message_id`, `in_reply_to` and `reference_ids` hold the ids of RFC 5322 §3.6.4, angle brackets stripped;
    - **suppression** — an auto-reply (`Auto-Submitted` other than `no`, `Precedence: bulk|junk|list`, `X-Autoreply`, `X-Autorespond`) or a bounce (`multipart/report; report-type=delivery-status`) is not stored at all.

    Only the system context may ingest: a message enters a mailbox from its mail source, never from a user.
  - **`rematch({ mailboxId, messageIds? }, context)`** replays each message's stored participant set against the records that exist now and adds the links that are missing (`matched_by: 'rematch'`), moving a pool message to `associated` once it has one. It never removes a link. The system context may run it, and so may the mailbox's owner and a `manage_mailboxes` holder of the mailbox's organization; anyone else is refused (`PERMISSION_DENIED`), and another organization's mailbox is not found (`RECORD_NOT_FOUND`).
  - Attachments are not stored yet, so a message forwarded as an attachment is stored with the forwarder's own text, and the forwarded message's body is not kept.
- **The IMAP sync** — `MailboxSyncService`, composed with `MailboxServicePlugin({ imap })` and run as the interval job `mailbox:imap-sync` on the composed job service (`requires: ['job']`):
  - for every mailbox your `accountFor` answers, it opens a **read-only** session on its IMAP account through `@objectstack/connector-imap` — the folder is opened with `EXAMINE` and bodies are fetched with `BODY.PEEK[]`, so the mailbox is never altered — and hands each message above the stored cursor, in UID order, to `ingest` under the system context. Dedupe, threading, association, the pool and suppression are the seam's, unchanged;
  - **the cursor** is kept on the mailbox row — `imap_folder`, `imap_uid_validity`, `imap_last_uid`, `imap_synced_at` — and written by the sync only. A cursor taken under another UIDVALIDITY, or in another folder, is discarded and the folder is read from its start; every message already stored then answers `duplicate`;
  - the cursor moves after each batch, past every message stored, already stored, suppressed or deliberately skipped. A store failure stops the run below the failed message, so the next run retries it. A message above `maxMessageBytes` (32 MiB by default) or one the seam refuses as unreadable is skipped and logged at `error`, once, with its UID — it stays in the IMAP folder;
  - runs are bounded (`maxMessagesPerRun`, 500 by default), and each fetch by count and by listed bytes (`batchSize`, 25, and `maxBatchBytes`, 64 MiB). The session refuses any literal above `maxMessageBytes` plus a 64 KiB framing envelope, so a server that omits or understates a message's size cannot hand over more: the batch is read again one message at a time on a fresh session, that message is skipped as `too_large` and logged, and the rest keeps arriving. One mailbox is never synced twice at once in one process, and two processes syncing it at once store nothing twice;
  - a run in which a mailbox could not be synced (an unreachable server, a refused credential) reports `degraded` to the job service, and logs the mailbox and the reason. Without a job service the boot says so, and `plugin.syncService.syncAll({ isSystem: true })` runs a pass on your own schedule.
- **No credential is stored by this package.** The account and its credential come from your `accountFor`, asked per mailbox per run, so they live wherever your host keeps secrets (the environment, a vault) — the way every open connector takes its credential.

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

Poll a shared mailbox over IMAP — compose the plugin with an account source, and a job service:

```typescript
import { defineStack } from '@objectstack/spec';
import { MailboxServicePlugin } from '@objectstack/service-mailbox';
import { staticCredentials } from '@objectstack/connector-imap';

export default defineStack({
  // …
  requires: ['job'],
  plugins: [
    new MailboxServicePlugin({
      imap: {
        // Asked per mailbox per run; answer null for a mailbox this host does not sync.
        accountFor: (mailbox) =>
          mailbox.address === 'sales@corp.example'
            ? {
                account: { id: mailbox.id, username: 'sales@corp.example', imap: { host: 'imap.corp.example' } },
                credentials: staticCredentials({ type: 'password', password: process.env.OS_MAILBOX_SALES_PASSWORD! }),
                folder: 'INBOX',
              }
            : null,
        pollIntervalMs: 60_000,
      },
    }),
  ],
});
```

The `sys_mailbox` row itself (its organization, address and owner) is written by server code under the system context; this package ships no administration screen for it.
