---
"@objectstack/objectql": minor
"@objectstack/spec": minor
---

fix(objectql,spec): refuse a `multi: true` update whose per-row `beforeUpdate` hooks write divergent key sets (#14099)

**BREAKING** accept-set narrowing on a published write path, shipped as `minor`
under the repo's launch-window convention for breaking changes. A `multi: true`
update that succeeds today is REFUSED when its `beforeUpdate` handlers assign
different sets of payload keys to different matched rows.

**What it fixes.** `driver.updateMany` takes one `SET` clause for N rows, so a
predicate update has exactly one payload (ADR-0058 Addendum II D3) — whatever a
`beforeUpdate` handler writes for one row was applied to every matched row. The
transition stamp is the shape this breaks, and it is the standard way to record
when a record entered a state:

```ts
// beforeUpdate — correct per record, silently wrong on a batch
if (previous.status !== 'done' && next.status === 'done') patch.completed_at = now;
```

Measured against published `17.2.0`: two rows, one open and one completed
earlier, updated in a single `multi: true` call. The already-completed row's
`completed_at` moved from `…:26.560Z` to `…:26.571Z`. It never transitioned,
nothing errored, and the corrupted row is byte-for-byte indistinguishable from
one genuinely completed late — so every on-time measure reading the column turns
a compliant record into a breach, with no audit entry and nothing in the data
that shows it happened. The whole class is exposed: `approved_at`, `closed_at`,
`shipped_at`, `first_responded_at`.

**What changed.** The engine still dispatches the before phase once per matched
row with that row's pre-image, and D3 still stands — the payload stays
batch-scoped and the engine never splits its own write. It now also RECORDS,
per row, the set of payload keys that row's hook chain assigned (the #14088
provenance recorder, armed once more per row). If two rows disagree, the whole
batch is refused before any write — not after the first row, not inside a
transaction that then rolls back — with the ADR-0112 envelope
`MULTI_UPDATE_HOOK_KEY_DIVERGENCE` (HTTP `400`,
`MultiUpdateHookKeyDivergenceError`), naming the object, the diverging keys and
the remedy. When every row's key set is identical the batch proceeds as one
`updateMany`, exactly as before.

**The criterion is the key SET, never the values.** That is what keeps honest
batches honest: objectql's own `sys_stamp_audit_update` builtin is registered on
`'*'` and reads the clock inside the per-record stamp, so an ordinary bulk
update writes `updated_at` on every row with different values. Every in-repo
`beforeUpdate` payload rewrite was measured on a mixed batch before this shipped
— the audit stamp (`['updated_at','updated_by']` on every row), plugin-pinyin's
companion projection (`['__search']` on every row) and service-storage's
copy-on-claim (`[]` on every row) — and all three are row-invariant, so none of
them is refused.

**Migration — how to write a per-record rewrite on a batch.** Two supported
routes, both available in this release:

1. **Route 2, from inside the handler.** Write the affected records with
   `ctx.api`, aimed with the per-row signals the hook sandbox now carries
   (`ctx.dispatch.mode === 'per-row'`, `ctx.input.id`, `ctx.input.options`),
   and leave the batch payload alone. ⚠️ Those signals are NOT in `17.2.0` —
   they land in this same release, which is why the refusal and its
   prescription ship together rather than the refusal arriving first.
2. **By-id updates from the caller.** Issue the updates per record when the
   value genuinely differs per record.

`objectstack-ai/hotcrm` and `objectstack-ai/duly` both carry hooks of this
shape and should take route 1: `duly`'s `duly_task.completed_at` stamp is the
measured instance, and hotcrm's `previous`-reading handlers are the same family.

**Known limit, carried openly rather than hidden.** A handler that writes the
SAME key on every row but with a per-row VALUE (a per-row derived priority, say)
still passes this test, and still applies the last dispatch's value to every
matched row. That is D3's declared cost; the two routes above are the exit for
it, and it is tracked as its own finding. ⛔ It is deliberately NOT closed by
comparing values: a value comparison refuses honest audit-stamp batches
non-deterministically (one clock read per row) and re-opens #14088's own
`completed_at: null` row, where a hook that writes the value the caller also
sent is indistinguishable from a hook that never touched the key.

<!-- adr-0087: not-required (no-migration-prescription) A runtime accept-set narrowing on the engine's predicate-update path: no authorable metadata key is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. The affected artifact is HOOK BODY CODE, whose per-row intent no mechanical rewrite can infer — choosing between a `ctx.api` per-row write and by-id updates is an authoring decision. The refusal itself is the notification channel, raised at the write site with the object, the diverging keys and both routes in the envelope. -->
