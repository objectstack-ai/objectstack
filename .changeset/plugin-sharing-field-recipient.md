---
"@objectstack/plugin-sharing": minor
---

feat(plugin-sharing): the `field` sharing recipient is enforced — expanded once per matched record

`ShareRecipientType` gained `field` on the spec side (#14103, maintainer ruling
B): `sharedWith: { type: 'field', value: '<user-field-name>' }` shares each
record the rule's criteria match with the user or users named by that column
on the record. This is the executor half (#15072):

- `SharingRuleService` reads the named user-typed column on each matched
  record. A `multiple: true` column shares with every user it names; a single-
  user column with the one it names. **Fail-closed on empty**: a null or empty
  column materialises no grant — never a match-all principal, never a fallback
  to the record owner. `field` is the only recipient resolved per record; every
  other kind (`user`, `team`, `position`, `business_unit`,
  `unit_and_subordinates`) still expands once per rule.
- The grants re-materialise on the record's own write: the existing
  `afterUpdate` hook has no changed-field gating, so an update that touches only
  the recipient column re-runs the per-record reconcile, which revokes the
  stale grant and materialises the new one. No second trigger was added.
- The whole-rule pass (`evaluateRule` — the background re-grant after an
  unbounded bulk write, the `kernel:bootstrapped` backfill and the REST evaluate
  endpoint) derives per-record (record, user) pairs for a `field` rule instead
  of a matched-records × recipients product, so the rule is as correct after a
  bulk write and a restart as it is inline. The recipient-axis revoke
  (`revokeRuleGrantsForRetiredRecipients`) declines `field` rules — they have no
  rule-wide recipient set to retire against.
- The declared-rule bootstrap seeds `field` rules (previously skipped with a
  warning), the `sys_sharing_rule.recipient_type` select accepts `field`, and
  `defineRule` refuses a `field` recipient whose `recipientId` is not a field
  name (the same grammar the spec applies at parse).
- An active `field` rule whose column the object does not declare as user-typed
  grants nobody and says so once per rule.

There is no `manager` recipient: "the owner's manager" is a user field the
application stores on the record, named by a `field` recipient.
