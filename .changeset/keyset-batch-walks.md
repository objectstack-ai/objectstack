---
"@objectstack/types": patch
"@objectstack/objectql": patch
"@objectstack/service-storage": patch
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-pinyin-search": patch
---

fix(batch): the background walks seek instead of counting, so they stop skipping rows (#4363)

#4363 made a single paged read a partition of its result set. It could not make
a *walk* one: seven background scans paged with a growing `offset` while writing
to the very rows they were reading, and an offset counts into a set those writes
are changing. Rows slide past the cursor and are never visited.

That is not a slow page in any of these — it is a wrong answer wearing the shape
of a clean run:

- **`rebuildApproverIndex`** built its desired state by walking
  `sys_approval_request WHERE status = 'pending'` with no `orderBy` at all, then
  **deleted** every index row that state did not explain. A skipped request
  meant an approver silently dropped from someone's queue. (The loop beside it
  ordered by `created_at` — not unique, so its pages were never a partition
  either.)
- **`verifyFileReferences`** decides which files nothing references. A record it
  never visits is reported as an unreferenced file.
- **`backfillFileReferences`** and the **pinyin companion backfill** rewrite
  each row they read, so their own writes were shifting the set out from under
  the cursor. Records were left unconverted and unsearchable by a run that
  reported success.
- **`scanValueShapes`** exists to vouch that no stored value is off-shape, and
  it opens a migration gate on that evidence.

All of them now go through `keysetWalk` (`@objectstack/types`): order by a
unique key, and seek past the last one instead of counting from the start. A
row's key does not move when the row is updated, and cannot be shifted when
another is deleted, so the walk is stable under exactly the mutation these
functions perform. It is also O(n) rather than O(n²/page) — measured on
Postgres over 2M rows, deep pages cost ~1.1 s by offset against ~0.09 s by seek.

One deliberate non-conversion: the REST **export** stream keeps its offset. It
honors a caller-chosen sort, and a keyset walk would have to re-order the export
by `id` to seek — changing what the user asked for to fix a cost. Its pages are
already a partition since #4363; only the depth cost remains.

`keysetWalk` merges the cursor with `$and` rather than spreading it into the
caller's filter, so a walk whose own `where` constrains the key column
(`{ id: { $in: [...] } }`) keeps that constraint instead of having it silently
overwritten. When a `max` cap is set it reads one row beyond the cap to tell
"the cap stopped us" from "the source ended exactly there" — without that, a
walk that read everything still reports `truncated`, and a caller acting on it
goes looking for rows that were never withheld.

The storage suites' fake engines now **throw** on an `offset` instead of serving
one, so the conversion is pinned rather than merely passing.
