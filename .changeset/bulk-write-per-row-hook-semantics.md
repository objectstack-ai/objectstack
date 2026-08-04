---
"@objectstack/objectql": minor
"@objectstack/example-showcase": patch
---

feat(objectql)!: a predicate bulk write evaluates and fires after-hooks PER ROW (#5038)

The 2026-08-04 maintainer ruling on #4800 / #4862, recorded as ADR-0058's
bulk-write addendum: **a bulk write is N record changes**, so every record-scoped
declaration on it is evaluated per row — `record` = that row's state, `previous` =
that row's pre-write state. Validation predicates have worked this way since
#3106; hook `condition`s and the record-change flow triggers riding the same
lifecycle hooks now join them.

**What was broken.** A `multi: true` update reaches `driver.updateMany`, which
resolves an affected COUNT. The lifecycle hook fired **once**, `previous` was
never assigned (only the single-id branch fetched a prior row), and `record`
degraded to the write's bare payload. So the transition condition the docs, the
formula skill and ten showcase flows all teach —
`status == "done" && previous.status != "done"` — could not be evaluated on a
bulk write. Hook conditions rejected the write (#4775/#5037); record-change flow
triggers were **silent**, firing zero times or once for a record that did not
exist. A missing audit row is the one failure nobody goes looking for.

**What changed.** The engine's bulk `update` / `delete` branches now read the
matched row set **once** — the same `driver.find` #3106 already issues, with
"this object has after-hooks" added to its demand test — and dispatch
`afterUpdate` / `afterDelete` once per matched row, each on a context with the
**single-record shape**: `input.id` = the row, `previous` = its pre-image,
`result` = its state. That is #2922's batch-INSERT ruling restated, and it is why
this fix has no code in the consumers: `hook-wrappers`' `record`/`previous`
bindings, the record-change trigger's context builder and plugin-audit's diff all
read those same fields and became correct at the producer.

- **Per-row dispatch is uniform across after-hooks.** It is deliberately NOT
  keyed on whether a condition mentions `previous` — the ruling rejected that as
  a hidden rule that would make a hook's firing count depend on its condition
  text.
- **`ctx.result` per row is the ROW**, composed as `row ⊕ payload` from the
  pre-image already in hand, so the batch still costs one extra query, not one
  per row. A bulk DELETE has no post-state: its per-row context sets no `result`,
  and consumers fall back to `previous`.
- **`onError` needed no new meaning** — it governs a handler on a record-scoped
  context, which is now what it always gets: `abort` fails the operation, `log`
  swallows that row and the batch continues.
- **A ceiling, enforced as a refusal.** Past 10 000 matched rows a predicate
  write against an object with after-hooks is rejected *before* the driver call
  (`ERR_BULK_PER_ROW_HOOK_LIMIT`), so nothing is written. It is never downgraded
  to one dispatch for the batch — that would skip the hook for N-1 rows silently.

**Breaking for hook authors, in the direction the contract declares.** An
after-hook on an object that takes predicate writes now runs once per matched row
instead of once per batch: a notification hook sends N messages, a
cache-invalidation hook runs N times. Objects with no after-hooks are untouched
and pay for no extra read. The write's own contract is unchanged — a predicate
write still resolves the affected count and still publishes ONE aggregate
`data.records.updated` (#4639).

**`before*` hooks stay batch-scoped, and that is not a gap.** `beforeUpdate` /
`beforeDelete` fire once for the whole batch because they may still rewrite the
payload, and one `updateMany` carries one payload. #5037's `HookConditionError`
and its `limitation` discriminator therefore **survive, rescoped to that
dispatch** — with a message that no longer promises an expiry that has already
happened, names the phase as the reason, and points at the matching `after*`
event where the same condition evaluates per row as authored. It also now names a
record-change flow trigger as a real route: #5037 refused to, on measured
evidence that the trigger shared the same unbound `previous`; that fact changed.

Docs (`data-modeling/formulas.mdx`) and `skills/objectstack-formula` §5 are
updated to teach one transition shape for both write forms, with the `before*`
exception called out.
