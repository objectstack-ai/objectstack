---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `ensureOverlayIndex` probes before it drops, and says what it could not enforce (#6418)

`sys_metadata`'s overlay-uniqueness migration ran **DROP then CREATE**:

```text
DROP INDEX IF EXISTS idx_sys_metadata_overlay_active   ← always succeeds
CREATE UNIQUE INDEX  idx_sys_metadata_overlay_active … ← may fail
```

with nothing that puts the dropped index back, and both `catch` blocks empty. On
the dialects that *do* support the form (SQLite / PostgreSQL), a `CREATE` that
failed on existing rows therefore left the table with **no** unique index at all
— and no line in the log. ADR-0005 overlay uniqueness is the base of metadata
correctness: with two ACTIVE rows for one
`(type, name, organization_id, package_id)`, which one `getMetaItem` returns is
undefined.

The degradation branch could not save it either. It fired only when the driver's
message matched `/partial|where clause|syntax/i`, which duplicate-row errors
(`UNIQUE constraint failed` / `duplicate key value`) do not — so the one failure
that is about DATA fell through to a bare `// best-effort` comment. MySQL was
safe only by accident: `DROP INDEX IF EXISTS` is not legal MySQL, so the drop
failed first and the old index survived.

**The order is now probe-first**, ported from the sibling
`view-definition-active-index.ts` (#5839 / #6417) and extracted into a shared
`partial-index-probe.ts` both migrations use: build the partial UNIQUE under a
throwaway probe name, and only once that has demonstrably succeeded drop the
real name and rebuild it. On any dialect or dataset that cannot take the form,
whatever index was protecting the table is left exactly as it was — degraded to
yesterday's behaviour, never below it. Both sections get this treatment
(`…_overlay_active` and `…_overlay_draft`), and the two are independent so a
failure on one no longer decides the other.

**The empty catches are replaced by ADR-0120 D4's disposition**: classify the
failure, keep the previous index, name the key that is not enforced and what
that costs, ship the exact query that lists the offending rows, point at
`os migrate plan`, and let the boot continue — reported at `error`, because what
goes missing is an integrity guarantee the platform states it enforces while
everything else keeps looking healthy.

Two things deliberately do **not** change. The key spelling stays byte-identical
(`(type, name, organization_id, COALESCE(package_id, ''))`) — this is an
ordering and reporting fix, not a re-keying. And the dialect fallback stays a
**non-UNIQUE** composite index: one ACTIVE row and one DRAFT row for the same
key legitimately coexist on this table, so a full UNIQUE would reject legal
data. What changes about the fallback is that it is now issued additively
(`IF NOT EXISTS`, no preceding drop, so it can never replace a stronger index)
and that the report says plainly what is and is not enforced.
