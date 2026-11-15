---
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

perf(objectql)!: a cascade delete removes a relation's children as one predicate delete per chunk

Clause-②: no (narrowing) — the published hook dispatch shape for cascaded children changes (`dispatch.mode` 'record' → 'per-row', `options.multi`, before-hooks run before the set delete); BREAKING banner + ADR-0087 disposition in the changeset; one CONTRACT_REVIEW_TIER review owed before the queue
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema is added, removed, renamed or re-shaped and no stored row is rewritten: what changes is the runtime hook dispatch shape the engine gives a cascaded child delete, so there is nothing for `objectstack migrate meta` to convert. -->

**BREAKING** for a delete-side hook that runs on a cascaded child and reads `ctx.dispatch.mode`, `ctx.input.options`, or the rows of the child's siblings.

Deleting a record now deletes the children each `cascade` relation reaches as ONE predicate delete per chunk of 500, `DELETE … WHERE id IN (…)`, through the predicate-delete arm a `multi: true` delete already takes. Before this, every child was its own by-id delete. Measured on the SQL-performance bench (one opportunity with 10 line items, the stock plugins loaded): 155 statements before, 57 after, on SQLite and on PostgreSQL alike.

What a hook on a cascaded child sees:

- FROM `ctx.dispatch.mode: 'record'` and `ctx.input.options` `{ where: { id } }` TO `ctx.dispatch.mode: 'per-row'`, with `ctx.dispatch.index` its position in the chunk and `ctx.input.options` carrying `where: { id: { $in: [...] } }` and `multi: true`. `ctx.input.id` and `ctx.previous` still name the child's own row, and `ctx.referentialCascadeDelete` is still `true` on every per-row context, in both phases, grandchildren included.
- FROM `ctx.result` in a cascaded child's `afterDelete` being the driver's by-id answer TO `ctx.result` absent, as on every per-row delete context. Read `ctx.previous` for the deleted row.
- The one behaviour that flips: the chunk runs every child's `beforeDelete`, then the one set delete, then every child's `afterDelete`. Before, each child ran before → delete → after in turn. So a `beforeDelete` hook that counts a child's remaining siblings now sees them ALL present, where it used to see one fewer at each step. Judge the whole batch instead: on `ctx.input.options.multi === true` read the target set from `ctx.input.options.where` (the shipped last-administrator guard does exactly this, and reaches the same verdict as before), or use `ctx.referentialCascadeDelete === true` to tell the cascade from a hand delete.
- A chunk the caller's scope narrows falls back to today's by-id deletes for that chunk, so the caller still meets the same refusal and the whole cascade rolls back: a child the caller may not delete, which a predicate delete would skip, and a child the caller may not read, which the by-id delete refuses through its re-read of the row (the cascade asks the caller's read door for each chunk's ids before batching it). Such a chunk keeps today's shape, `'record'` with no `multi`, so one cascade can show both shapes. A driver with no `deleteMany`, a floored external driver, and a cascade into the organization object (deleted by id or not at all) keep the by-id path too.

Unchanged: one `data.record.deleted` realtime event per child (never the bulk `data.records.deleted`); a refusal from any child's hook, or a permission refusal, rolls the whole cascade back; the recycle bin keeps one entry per root; the bulk per-row hook ceiling is never reached (a chunk is 500, the ceiling 10,000). On a runtime that cannot roll back, a refusal raised after a chunk's set delete (a failed roll-up recompute) now finds the whole chunk deleted, where the per-child walk had deleted only the children before the refusal.
