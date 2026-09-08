---
'@objectstack/metadata': patch
---

fix(metadata): keep the original notification instant when migrating `sys_notification` to the event model (#16312)

`migrateSysNotificationToEvent` materializes each legacy inbox row into a
`sys_inbox_message` and a `sys_notification_receipt`, back-dating both to the
notification's own `created_at`. Both writes passed no options bag, so they
relied on the audit binder's create-side `record.created_at ?? now` — the
laundering #15964 removed, on the maintainer ruling of 2026-09-06. Without
that accident, every migrated inbox row and receipt is stamped with the moment
the migration RAN: a user's whole bell history collapses to "all arrived
today".

The two writes now declare `{ context: { preserveAudit: true } }`, the explicit
historical-import channel the same ruling deliberately kept (#3493; it is what
REST import's `treatAsHistorical` sets). This is not a bypass of audit — it is
the door audit left open for a historical import. No exported symbol, schema or
config key moves.

**Release ordering.** `@objectstack/objectql`'s side of #15964 is itself still
an unreleased changeset, so no published version of this migration has ever
written the flattened timeline. Releasing the two together keeps it that way.

**If a deployment did run it from a build that has both halves**, the original
timeline is recoverable rather than lost: the source `sys_notification` rows
are rewritten in place, never deleted or archived, and `created_at` is not
among the legacy columns the run clears — so the notification's own instant is
still on the event row and reachable from both new rows through
`notification_id`.
