---
"@objectstack/service-storage": minor
---

feat(storage): legacy file-value backfill — ADR-0104 D3 wave 2 (PR-6)

`backfillFileReferences()` converts the pre-reference forms a `file`/`image`/
`avatar`/`video`/`audio` field may hold — an inline metadata blob
(`{url, name, size, …}`) or a bare URL string — into the reference form: an
opaque `sys_file` id, owned by the record's field.

What it will and will not convert:

- **A URL naming this platform's own resolver** (`…/storage/files/:id`) already
  identifies a `sys_file`; the field is rewritten to the bare id and no bytes
  move.
- **A `data:` URI** carries its bytes inline; they are uploaded, a `sys_file` is
  registered, and the field is rewritten to its id.
- **An external URL** is reported, never converted. Re-hosting third-party
  content is a bandwidth, licensing and privacy decision that is not a
  migration's to make — ADR-0104 R7 retires these toward an explicit `url`
  field, which under AI authoring is the point: it stops "managed file" and
  "external link" being the same declaration.

**Dry run by default** — nothing is written unless `apply` is set, and the
dry-run report has the same shape as the applied one so the plan can be reviewed
and diffed. **Idempotent** — a value already in reference form is recorded and
left alone, so a partially-completed run is safe to repeat.

The backfill never writes the ownership columns itself: it rewrites the record,
and the claim hooks observe that write and record ownership. One claiming path,
so there is nothing that can disagree with itself. Run
`verifyFileReferences()` afterwards to confirm the two agree — that
reconciliation is the gate the irreversible collection change must pass.
