---
"@objectstack/plugin-security": minor
"@objectstack/objectql": minor
---

fix(plugin-security)!: the insert-side RLS `check` is evaluated on the row that will be STORED — after `beforeInsert` — instead of on the caller's raw payload (#16608)

**BREAKING** — an accept-set narrowing on the write gate's refusal behaviour. An insert that is admitted today can be refused after this change.

`check` validates the row a write produces — the PostgreSQL `WITH CHECK` analog. `update` reached that row by merging the caller's pre-image with the change set. `insert` could not: it has no pre-image, and the security middleware runs BEFORE the engine's operation, so its post-image was `opCtx.data` — the caller's payload as it arrived, ahead of `applyFieldDefaults` and ahead of every `beforeInsert` hook.

A denormalised scoping field is exactly what an RLS predicate compares (ADR-0055: a predicate cannot traverse a lookup) and exactly what an app stamps server-side so a caller cannot choose it. Judging the raw payload therefore inverted the policy in both directions, measured on 17.3.0 with a real engine, a real `SecurityPlugin` and both drivers:

- **the derived value was not on the image**, so the only way to pass a `check` over it was for the caller to SEND the value the hook exists to make un-sendable. Same identity, same object, same second: the payload carrying the stamped field returned 201, the identical payload leaving it to the hook returned 403 — and the stored row was identical either way.
- **the sent value WAS on the image and was then overwritten**, so an insert naming an in-scope organization while pointing at a parent in ANOTHER organization PASSED the check and stored the parent's organization. That is a row whose stored scope the caller does not hold, and it is why this is a narrowing rather than a widening: today it is admitted, after this change it is refused with nothing stored.

Ruled 2026-09-07 (maintainer, verbatim 「同意」, director seat, summon #17, decision batch #3). The refused alternative — keep the order and write the contract that a checked field must arrive from the caller, plus an `os validate` rule to police it — institutionalises the contradiction and needs a permanent lint to hold it in place.

**What changed, mechanically.** `OperationContext` gains `postHookWriteImageCheck` (`@objectstack/objectql`), an optional judgement an enforcement layer installs and `ObjectQL.insert` runs once the `beforeInsert` chain has produced the row — after the post-hook declared-field door and before every producer with a side effect (the secret channel, the autonumber, validation, the statement), so a refusal still costs nothing. `@objectstack/plugin-security` installs its compiled `check` filter there for `insert` instead of matching it against `opCtx.data`; `update` is unchanged. The compiled filter is still built in the middleware, where the caller's permission sets, the ADR-0090 D10 delegator's, the staged membership and the request context are all resolved — only the IMAGE is deferred. A middleware that installed the judgement and finds the seam was never run refuses the write and logs at ERROR: an unjudged write is not an allowed one.

**Who is affected.** Only objects governed by a permission set that EXPLICITLY declares `check`, on single-row inserts by a non-system caller — the gate's existing scope, unchanged. Two behaviour changes to expect, and they are the two halves of the same correction: an insert that left a hook-stamped field off the payload now succeeds where it used to be refused, and an insert whose hook-stamped field lands outside the caller's scope is now refused where it used to be admitted. Callers that were duplicating the stamp to get past the gate keep working and may stop.

The invariant this buys, which nothing offered before: **a stored row always satisfies the insert `check`**, whatever the caller sent.
