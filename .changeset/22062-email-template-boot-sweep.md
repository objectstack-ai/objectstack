---
'@objectstack/plugin-email': patch
---

The declared-email-template boot sweep reads the stored rows in bulk and no longer rewrites a template that has not changed

Clause-②: no

Every boot used to look each effective email template up on its own and rewrite its
`sys_email_template` row unconditionally: one lookup, one UPDATE and the engine's two read-backs
per template, whether or not anything had changed. Measured on `ObjectQL` over `SqlDriver`
(better-sqlite3), a steady boot over 450 unchanged templates sent 1,800 statements; it now sends 3
reads and no write (79 templates: 316 statements, now 1).

- The sweep reads the stored rows for the declared names in `$in` pages of 200 names. Each
  `(name, locale)` takes the first row the read returns, in the order the driver gives the
  per-template lookup, so a slot several organizations hold resolves to the same row as before.
- A template the bulk read did not answer (new since the last boot, a read cut short at its row
  bound, or a failed read) is looked up on its own before anything is inserted, as before.
- A `managed_by: 'package'` row that already holds every column the template projects is not
  rewritten. `upsertDeclaredEmailTemplate` now returns `false` for it, and
  `bootstrapDeclaredEmailTemplates` counts it under `skipped`, the value both already document for
  a row deliberately not written. A row with any other provenance is handled exactly as before:
  admin-owned and customized rows are never written, and a legacy row with no `managed_by` is
  rewritten and adopted.

An org-scoped template edit still survives the next boot. Signatures and accepted input are unchanged.
