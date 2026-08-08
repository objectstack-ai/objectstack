---
"@objectstack/metadata-core": minor
"@objectstack/metadata-protocol": minor
"@objectstack/objectql": patch
---

fix(metadata-protocol): a `/meta` object read serves the effective runtime schema, whichever layer answered (#6562)

`GET /api/v1/meta/object/:name` answered a **different set of fields** depending
on which link of its resolution chain produced the answer, for the same object:

- **registry-backed** → the schema AFTER `applySystemFields`, so it carried the
  injected system columns — `created_at`, `created_by`, `updated_at`,
  `updated_by`, `organization_id`, `owner_id`, `owning_business_unit_id` — even
  when the author declared none of them;
- **overlay-backed** (a `sys_metadata` customization row, or a MetadataService
  body) → the stored document VERBATIM, so every one of those columns was simply
  absent.

Whether an object carries an overlay is invisible to the caller, so the same
request reported the platform's own columns or not, and nothing in the response
said which had happened. `/meta` is the machine-readable contract clients and AI
authors code against: an author reading an overlay-backed object saw no
`created_at` / `owner_id` / `organization_id` and reasonably concluded the
columns do not exist — while every one of them is real in the database,
filterable, orderable, and enforced read-only on write.

**Every `/meta` object read exit now serves the effective schema.** The
single-item read, the list, the cached/ETag branch, both draft reads and the
layered read's `effective` layer all report the injected columns, with the same
`readonly` / `system` markers the engine enforces (`owner_id` stays
`readonly: false` — ownership is transferable). This is the presence half of the
seam #4513 closed the value half of.

Three things deliberately did **not** change:

- **`?layers=1`'s `overlay` layer stays byte-verbatim.** Injection happens at the
  read exits only, so Studio's "what you customised" diff never shows a column
  nobody wrote. Only `effective` is injected.
- **A `GET` → `PUT` round-trip still persists a byte-identical body** (#4326).
  The write path gained the strip counterpart: a field byte-identical to the
  platform's own definition is removed again on save, so a served document handed
  straight back stores exactly what it stored before — same checksum, same
  history diff. A declared `owner_id` carrying the author's own label is *not*
  the platform's definition and survives untouched.
- **A declared system column stays the author's.** Injection only ever adds a
  column nobody declared; it never rewrites one that was.

Which columns an object carries is `resolveInjectedSystemColumns`
(`@objectstack/spec/data`, #5378) — the same derivation `applySystemFields`
consumes — so every opt-out (`systemFields: false`, `managedBy: 'better-auth'`,
`systemFields.audit`/`.tenant`, `tenancy.enabled: false`, the per-tier
`ownership` table, the `sys_*` namespace) is answered in one place and re-derived
in none. **What** each column looks like moves to `@objectstack/metadata-core`
(`AUDIT_FIELD_DEFS` and the three tenancy/ownership anchors, re-exported from
`@objectstack/objectql` so the symbols still resolve there) — the same relocation,
for the same dependency cycle, as the audit-governance table in #4513:
`@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the read
path could not import the definitions from the registry that provisions them.
One table now feeds the injection pass and the read exits, so they cannot drift.

One key is deliberately not carried onto a served document: `organization_id`'s
`indexed`. It is not a `FieldSchema` key — removed in the 16.x line (#2377,
ADR-0049) and rejected by name by the strict schema — and its only consumer is
`driver-mongodb`'s schema builder, which reads the registered schema and never a
served document. It stays at the injection site; that the registry-backed read
answers `_diagnostics: { valid: false }` because of it is filed as #6810.
