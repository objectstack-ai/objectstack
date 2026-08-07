---
"@objectstack/objectql": patch
---

fix(objectql): a `sys_file` hydrate read fault is no longer indistinguishable from "this record has no file" (#6116)

A file-field value stored as an opaque `sys_file` id is enriched on read into
`{ id, name, size, mimeType, url }`. That one batched lookup sat behind a bare
`catch { return records }`: **every** failure — connection drop, timeout,
permission denial, query error, and the benign "the table was never
provisioned" — was answered with the same silent pass-through of un-hydrated
ids. Consumers (UI, export) then receive a bare id where a file reference was
due and render it as *no attachment*, so a live outage looked exactly like a
record that genuinely holds no file. That is the ADR-0110 D3 shape — a fault
wearing the appearance of legitimate absent data — carried here on a functional
surface rather than a durability one.

**Fail-open behaviour is unchanged, deliberately.** A file-metadata read that
fails must not take down the record read that asked for it, so the ids still
pass through un-hydrated and no read starts throwing. This is a
diagnosability fix: what changes is that the two reasons stop being the same
silence.

The catch now discriminates by error **type**, through the shared
`isMissingTableError` predicate (`@objectstack/metadata/errors`) — the same
call the engine's autonumber seeding already makes, never a hand-rolled
`code === '42P01'` copy:

- **table never provisioned** — the storage plugin is present but schema sync
  has not run. There are genuinely no committed rows, so the un-hydrated
  answer *is* the truth: passed through in silence, exactly as before, so an
  app whose storage schema is not yet synced gains no per-read noise.
- **every other read failure** — the rows may well exist and simply were not
  seen. One `warn` now names the parent object, the fields left un-hydrated,
  how many ids went unresolved, the driver's own error, the consequence (those
  ids will render as "no file" for this read) and the fix (check
  storage/database availability, then re-read). Said once per read, not once
  per record or per id.

`warn` rather than `error` per the repo's degradation-log-level rule: nothing
on this path claims to have persisted anything, the answer is visibly smaller
for this response only, and the next successful read repairs it.

Note for operators reading logs: the generic read handler one frame up already
logged `Find operation failed` for the failed sub-read. That line is unchanged
and is not a substitute — it is emitted identically for the benign and the
non-benign failure and describes the `sys_file` sub-read only, never the parent
object, the fields, or the degraded answer that was nevertheless returned.
