---
"@objectstack/plugin-sharing": patch
---

fix(plugin-sharing): recompute sharing rules for predicate (`multi`) writes — stale `sys_record_share` grants no longer survive a bulk update (#4779)

`bindRuleHooks` located the rows to recompute from a single record id:

```ts
const id = String(data?.id ?? ctx?.input?.id ?? '');
if (!id) return;
```

`ObjectQL.update()` only populates `input.id` when `where.id` is a scalar. A
predicate write (`multi: true`) routes to `updateMany`, leaves `input.id`
undefined, and carries no id in its payload — so **every bulk write skipped
sharing-rule recompute entirely**.

The consequence is a fail-open on the authorization side. A criteria-based rule
materialises `sys_record_share` rows; an admin then bulk-updates those records
out of the criteria (`{ where: { region: 'east' }, multi: true, data: { region:
'west' } }`); nothing recomputes, the grant rows stay in the table, and the
recipients keep the read/edit access the rule no longer implies. Same family as
#4757 (`sys_attachment`) and #4778 (approval locks), but better hidden — a stale
grant is indistinguishable from a legitimate one. The reverse direction (bulk
update **into** a rule's criteria never granting) was broken too.

**What changes**

The hooks now key off the write's ROW SET instead of one id. `beforeUpdate` /
`beforeDelete` resolve the affected rows from the predicate and stash them on
the shared hook context (the `before` hook is where it must happen — the write
is what makes those rows unfindable); the `after` hook acts on them:

- **Bounded set (≤ 1000 rows, `RULE_RECOMPUTE_ROW_CAP`)** — `evaluateAllForRecord`
  per row, synchronously. Diff-based, so this covers both directions: rows moved
  out of a rule's criteria are revoked, rows moved in are granted.
- **Unbounded set** (over the cap, `multi: true` with no `where` at all, or a
  resolve that failed) — every `source: 'rule'` grant on the object is revoked
  **synchronously** in one set-based statement, and the deserved grants are
  restored **asynchronously** by reconciling the object's rules.

**The write is never refused.** Refusing would turn an internal recompute bound
into a business-visible limit on how many rows an admin may update, reported by
a subsystem they never configured. The asymmetry it trades on instead:
over-granting is a security incident, under-granting is an availability wobble.
So the safety half is always synchronous and complete, and only the expensive
restoration half is deferred.

**Operational note.** After a bulk write whose row set could not be bounded,
recipients may briefly lose access to records they still qualify for, until the
background re-grant finishes. It is logged with the object and the reason. The
re-grant is in-process; if it is lost to a crash, the plugin's existing
`kernel:bootstrapped` backfill re-runs the same idempotent reconcile on the next
start, and any subsequent `sys_sharing_rule` write reconciles too.

**Also fixed:** the rule hooks now bind `afterDelete` and retire the deleted
records' rule grants. Nothing else could: `evaluateRule` iterates records that
still exist, so a grant whose record is gone was unreachable by every reconcile
path and outlived restarts. Harmless only while record ids are never reused —
an assumption nothing in the platform enforces.

New on `SharingRuleService`: `revokeRuleGrantsForObject`,
`revokeRuleGrantsForRecords` and `evaluateAllRulesForObject`. Manual
(`source: 'manual'`) shares are never touched by any of them.
