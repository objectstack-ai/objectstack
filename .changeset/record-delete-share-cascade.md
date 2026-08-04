---
"@objectstack/plugin-sharing": patch
---

fix(sharing): deleting a record now revokes every `sys_record_share` row on it, whatever the source (#5103)

A share row says "principal P has level L on (object O, record R)". Delete R and
the row describes nothing — yet until now it stayed in the table forever.

#4779 (PR #5102) bound an `afterDelete` for this, but inside the sharing-RULE
package, where two conditions fenced it in: it revokes only `source: 'rule'`
rows, and it binds only on objects that appear in `sys_sharing_rule`. So an
object that uses nothing but MANUAL shares — a `sharingModel: 'private'` object
with no rule ever configured — had no delete hook at all, and **manual share +
record delete = a permanent orphan**.

Today the harm is bounded, and only because record ids are never reused: the
`record_id IN (…)` predicate `buildReadFilter` emits matches nothing. Nothing
enforces that assumption. A custom primary key, an import that preserves ids, or
any future id recycling turns every one of those rows into a real privilege
escalation — a new record landing on a recycled id inherits the dead record's
recipients outright. Secondarily, `sys_record_share` grew without bound and
Setup's Record Shares list showed rows pointing at nothing.

**What changed**

- **A record-delete cascade on every sharing-capable object.** `plugin-sharing`
  binds one `beforeDelete`/`afterDelete` pair with no object filter and judges
  the object's sharing posture from its `sharingModel` metadata *per delete*.
  Nothing is enumerated at boot, so nothing goes stale: an object that gains
  `sharingModel` at runtime is covered on its very next delete, with no rebind.
  Bounded deletes (a scalar id, an `$in` list, or a predicate matching at most
  1000 rows) are revoked synchronously and set-based; an unbounded one queues an
  object-scoped orphan sweep instead. System-context deletes cascade too.
- **A boot-time orphan sweep keyed on record existence.** On
  `kernel:bootstrapped`, share rows whose RECORD no longer exists are revoked —
  historical orphans, rows a failed hook missed, and the one posture the cascade
  deliberately skips (an unmarked system object). This is a different question
  from the existing `sweepOrphanedRuleGrants`, which asks whether the RULE row
  still exists and therefore can never see a manual share. Bounded per boot:
  keyset pages, one batched existence probe per object per page, and a scan cap
  that reports when it stopped early. An object whose existence probe FAILS has
  its rows left in place — "could not ask" is never read as "the record is gone".

**What did not change**

Rule *recompute* still never touches a manual share. That boundary (#5102) is
the point: while the record exists, a manual grant is a human decision no rule
evaluation may overrule. Only the record's DELETION revokes it, and only because
there is no longer anything to have access to.

New exports for hosts that compose the plugin by hand:
`bindRecordShareCascade` / `unbindRecordShareCascade`,
`objectCanCarryRecordShares`, `SharingService.revokeSharesForDeletedRecords`,
`SharingService.sweepOrphanedRecordShares`, and `effectiveSharingModel`. Nothing
was removed or renamed; the standard `SharingServicePlugin` composition needs no
changes.
