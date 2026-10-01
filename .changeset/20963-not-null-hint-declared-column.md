---
'@objectstack/rest': patch
---

fix(rest): the `hint` on a NOT NULL refusal leads with the remedy for a column that requires a value, and names schema drift only as a condition, so an author who declared `storage: { notNull: true }` is no longer sent to `os migrate` (#20963)

Clause-②: no

A field that declares `storage: { notNull: true }` without `required` is a column
the database keeps NOT NULL on purpose (ADR-0113). A write with no value for it,
through `POST /api/v1/data/:object` or `PATCH /api/v1/data/:object/:id`, is
refused by the database and answers `400 VALIDATION_FAILED` with a `required`
finding for the field. That answer was right. Its `hint` said the field is
optional in the metadata and "the physical schema has drifted from metadata",
and told the caller to run `os migrate`, which changes nothing for a column
declared NOT NULL.

The `hint` now reads: "The database column for 'FIELD' requires a value: provide
it, or declare the field `required` in the object metadata. If the object
declares neither `required` nor `storage: { notNull: true }` for 'FIELD', the
physical schema has drifted from metadata instead: run 'os migrate' to reconcile
(or reset the dev database)." The first sentence holds for every NOT NULL
refusal. The second names the drift case under the condition that makes it drift.

**What is not affected.** The status, `code`, `error`, `fields` and `object` of
the answer are unchanged, and no key is added. The import row is untouched: it
does not carry a `hint`. Nothing reads the field map to tell the two cases
apart, so the `hint` stays advice for the author to read against the object's
declaration.
