---
"@objectstack/objectql": patch
---

fix(engine): a granted child write no longer 500s because the parent's roll-up recompute ran as the caller

Creating a child record returned **HTTP 500 after the row had already been
written** whenever the child fed a roll-up `summary` on a parent the caller may
not edit — the ordinary parent/child shape for tasks, line items, comments and
time entries. A client that retried (or a user who clicked Save again) created a
duplicate row
([#7673](https://github.com/objectstack-ai/objectstack/issues/7673),
[#7719](https://github.com/objectstack-ai/objectstack/issues/7719)).

`recomputeSummaries` issued the parent roll-up write under the **caller's**
execution context, so an engine-derived write was authorized as if the caller had
asked for it. On the showcase app a plain member holding `showcase_task: create +
read` hit it on every `POST` and `PATCH`: the recompute of
`showcase_project.task_count` raised `PERMISSION_DENIED`, the engine recorded it
as a recompute failure, and the call site rethrew it as `SummaryRecomputeError`
(`ERR_SUMMARY_RECOMPUTE`) — which REST maps to a 500. The access matrix and
`/security/explain` both said `create: true`, so a declared-and-granted operation
failed on a permission check about a record the caller never asked to touch.

**The recompute now runs system-elevated**, on all three call sites (insert,
update, delete). A roll-up is engine-derived state, not a caller write: the
permission decision that matters — may this caller write the **child** — has
already been made by the time the recompute runs. The elevation is a
`sudo()`-shaped derivative of the caller's context, so an open transaction
handle, `tenantId` and `timezone` still ride along; it is the same posture the
roll-up's two other writers already held (the insert-time seed and the
`summary-nulls` backfill), so all three writers of a summary column now agree
about who owns it.

Two quieter defects go with it, both of which only showed where the caller
*could* write the parent and the recompute therefore "succeeded":

- the aggregate was computed over the caller's **row-level-visible subset**, so
  the parent's column was silently rewritten to one reader's view of the child
  collection;
- an author-declared `readonly: true` roll-up column was dropped by the
  write-path read-only strip (which runs on `!context.isSystem`), so the summary
  never landed at all.

This does not widen what a caller may read or write. The parent's row is still
governed by the caller's grants (a direct update of the parent is refused exactly
as before), the summary column stays subject to the parent's field-level security
on read, and the only value this path can move is the one the author declared as
a function of the child collection. `ERR_SUMMARY_RECOMPUTE` is unchanged and
still surfaces genuinely failed recomputes (a driver or network failure that
outlives its retries), which is what the seed loader and import runner branch on.
