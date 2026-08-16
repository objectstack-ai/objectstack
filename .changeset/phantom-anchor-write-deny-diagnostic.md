---
'@objectstack/plugin-sharing': minor
---

A write refused because a federated object's `owner_id` is the platform's phantom anchor now says so, once per object (#8418).

**No verdict changes.** `checkEdit` / `checkDelete` stay fail-closed exactly as shipped — this adds a diagnostic and nothing else. Maintainer ruling 2026-08-13 (option C on #8418): keep `deny`, make the refusal visible.

What was wrong: on an ADR-0015 federated object with no author-declared `owner_id`, the registry injects the anchor but the platform provisions no column behind it, so the ownership fast path selects `owner_id` off a remote table that does not have it. The SQL driver's recovery ladder DISCARDS a projection naming an unresolvable column and re-runs `select('*')` instead of raising — so `matchesOwnerScope` receives a good row that simply has no `owner_id` key, reads `owner == null`, and refuses. Because nothing threw, `writeGateFailClosed` was never reached and **nothing was logged anywhere**: the operator got a bare 403 with no trace, at every write depth (`org` included — the null-owner short-circuit runs before the scope is consulted). Only a `modifyAllRecords` holder could still write.

`SharingService` now emits `PHANTOM_ANCHOR_WRITE_DENY_NOTICE` at `warn` on that path, naming the object, the owner field and the caller, with both remedies in the wording: declare the real remote owner column, or move the object off an owner-scoped sharing model. The constant is exported so a deployment can match on it.

Deduped **per object**, for the service's lifetime. The condition is a property of the registered schema, identical for every row and every caller, so a bulk write emits one line rather than one per row and one misconfiguration is not multiplied by the principal count.

It fires only on the phantom anchor, never on an ordinary owner-less row: the discrimination is `hasPhantomOwnerAnchor` provenance (is this `owner_id` the platform's injected constant, or a column the author declared?), not `owner == null` and not an `external` test. A federated object with a real declared remote owner column keeps scoping normally and stays silent.

The diagnostic cannot cost a write — it returns `void`, its caller ignores it, and a throwing logger is swallowed, so no ordering of schema lookup, latch and logger can move a verdict.

Also corrected in passing: this package attributed the driver's non-throwing unknown-column recovery to **SQLite specifically**. That understated it — the projection rung is gated by the driver's single shared `isUnresolvableColumnError` predicate, which spells all three dialects it speaks (`no such column`, `column … does not exist`, and since #8926 `Unknown column '…'`), so the silent refusal reproduced on every supported dialect. Wording only; no driver change.
