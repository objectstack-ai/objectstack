---
"@objectstack/driver-sql": patch
---

fix(driver-sql): a failed index read is an error, not an empty index list (#7332)

`SqlDriver.introspectIndexes` wrapped its **entire** dialect dispatch — the
SQLite, Postgres and MySQL branches alike — in one bare `catch {}` and then
returned its accumulator in whatever half-built state it had reached. The caller
could not tell *"this table genuinely has no such index"* from *"the read failed
and I am guessing"*.

Drift detection consumed that same function. `diffManagedIndexes` takes its
declared-index-missing branch on exactly that input, so a transient failure —
SQLITE_BUSY, a WAL read landing mid-flush, any I/O hiccup — was not surfaced as
an error. It was laundered into a confident, specific and **false** report:

```
product: metadata declares index 'idx_product_code' (code) but the database
has no such index — run "os migrate apply" to create it.
```

…about an index that was there the whole time.

**The swallow is kept where its justification holds, and only there.** That
justification — *"let creation handle conflicts"* — is sound at
`getExistingIndexNames`, whose caller `syncDeclaredIndexes` corrects an
optimistic wrong reading by attempting the create and absorbing the
"already exists" error; a throw there would take a whole boot down on a
transient read. Detection has no such backstop, and inherited the swallow only
because #3728 wired a second consumer onto the same function. `introspectIndexes`
therefore now **throws by default** and takes an explicit
`{ onFailure: 'partial' }` opt-in, which the creation seam passes and nothing
else does.

**What changes for you.** Nothing on the creation path: boot still tolerates a
failed index read and still converges the schema. On the detection path, a
failure that was previously invisible is now reported as one — `os migrate plan`
and `os migrate apply` print it and exit non-zero instead of rendering a plan
built on a partial reading, and boot-time drift handling logs
`could not introspect '<table>' for drift detection` (a handler
`reconcileAndWarnDrift` already carried) instead of a false drift warning. This
matches the sibling read in the same detect path, `introspectColumns`, which has
never swallowed.

Measured, and worth stating plainly: no consumer ever acted **destructively** on
the false reading. Dropping entries from the physical list is monotone — the
`replace_unique_index`, `drop_index` and `recreate_index` remedies all require an
index to be *present*, so a short read can only ever remove a destructive
proposal, never arm one. The defect was a confidently wrong report, not a
dangerous one.
