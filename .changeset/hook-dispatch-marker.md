---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/plugin-sharing": patch
"@objectstack/service-storage": patch
---

fix(spec,objectql,sharing,storage): a hook can tell a per-row bulk dispatch from a single-record write again (#6966)

A predicate (`multi: true`) write dispatches its lifecycle hooks **once per
matched row** — `after*` since #5038, `before*` since #5574 — on a context
deliberately indistinguishable from a single-id write's, so a handler written
for one record works unchanged on a batch. That indistinguishability is the
feature, and it also erased the only signal several handlers had.

Before #5574 a bulk `before*` fired once with `input.id` present-but-`undefined`,
so "`input.id` is empty" meant "this call stands for N rows". Guards across the
platform were written on it. Every one of them **silently inverted** rather than
failing: a per-row context has an id, so the guard now answers "single write" for
every row of a batch. Two further assumptions broke with it — that the engine
reuses one `HookContext` across a write's before/after pair, and that `after*`
work keyed on the write's row set runs once.

### New: `HookContext.dispatch`

The engine now states the fact rather than leaving it to be inferred:

```ts
ctx.dispatch // { mode: 'record' | 'per-row', index: number, scope: object } | undefined
```

- `mode` — `'record'` when the call is the caller's whole write; `'per-row'`
  when it is one of N.
- `index` — position in the fan-out. `index === 0` is how a handler does
  batch-scoped work once instead of N times.
- `scope` — scratch shared by **every** dispatch of one write, both phases, same
  object identity. This is the seam handlers used to get by stashing on the
  context itself, which only ever worked because a single-id write reuses one
  context across its pair.

Bound at every write dispatch site — insert, update, delete, both phases.
Optional, and an absent marker reads as "not a per-row dispatch", so a handler
reads `ctx.dispatch?.mode === 'per-row'` and existing code keeps its behaviour.
Reads carry no marker: a read has no fan-out.

It is deliberately **not** the `isPredicateBulkWrite` discriminator #5574
retired. That one was removed under ADR-0049 for having neither a producer nor a
reachable consumer — it inferred "bulk" from `input.id` and `options.multi` at
the consumer, which is exactly what `asScalarId` stays unexported to prevent
(#4434 / #4550). This one is produced by the engine at the point the dispatch
ladder is decided, and the platform's own handlers read it.

### Behaviour fixed

**Sharing rules and the record-share cascade (`@objectstack/plugin-sharing`).**
The `before*` hook stashes the write's affected row set for the `after*` hook to
act on. On a predicate write that stash was landing on a per-row context the
`after` phase never saw, so `readAffectedRows` answered `resolve-failed` and both
subscribers took their safe branch: every bulk update or delete on a ruled object
revoked **all** of that object's rule grants and queued a full asynchronous
re-grant — once per matched row, with the repeats racing each other's re-grants.
Access was never widened (the trade is the ruling's "over-granting is an
incident, under-granting is a wobble" direction), but a bounded write now takes
the bounded path again: the rows are unioned as the engine hands them over, the
cap still applies to the union, and the `after*` work runs once per write.

**File-reference ownership (`@objectstack/service-storage`).** The `beforeDelete`
hook that pre-resolved ids for a `where`-shaped delete was dead on every path,
and `afterDelete` was falling back to one `sys_file` lookup **per row** where the
batch fits one `$in`. Both are fixed by the marker, and the pre-resolution query
is gone entirely — the engine has already matched the rows and hands them over.
The `beforeUpdate` copy-on-claim pass no longer runs once per row against a
batch-scoped payload, which also removes a row-conditioned rewrite of a shared
`SET` clause (out of contract under ADR-0058 Addendum II D3).

No authored metadata changes, and no write's result, event or return contract
changes.
