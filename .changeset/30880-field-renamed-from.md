---
'@objectstack/spec': minor
'@objectstack/driver-sql': patch
'@objectstack/metadata-core': patch
---

feat(spec): a field declares the key or keys it was renamed from — `renamedFrom` on `FieldSchema`

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up #30885 — `skills/**` does not teach the key yet: it is declared ahead of the upgrade step that carries the data (rename execution, #30885), and that step owns the skills line; this diff documents it in `content/docs/data-modeling/fields.mdx` and the generated references

A package author can now say that a field was renamed, so that an upgrade knows a rename from a drop-and-add. On the new field, write the old key: `account_name: Field.text({ label: 'Account Name', renamedFrom: ['company'] })`. A field renamed twice lists both earlier keys. This is the manifest half of the rename mapping ruled on epic objectstack-ai/cloud#3652 (Q3 「默认拒绝，需显式映射（推荐）」, and on where the mapping lives, 「写进清单 renamedFrom」), and it supersedes item 5 of objectstack#24443's ruling A ("No rename spelling is added to the spec").

- **`@objectstack/spec`: `FieldSchema.renamedFrom: string[]`, optional.** Each entry is an earlier key of this same field, in the field-key grammar (lowercase snake_case). The parse refuses, in one located issue naming the object, the field and the old key: an entry that is not a field key (judged by `FieldSchema`), and, in `ObjectSchema`'s refinement beside the stage-field check, an entry that is the field's own key, an entry repeated within one list, an entry that another field of the same object still declares (the old name is still in use), and an old key that two fields of the same object both claim. Type compatibility between the old column and the new field is not judged at parse: it depends on the installed version, so the upgrade plan judges it. An object that does not write the key parses exactly as before; nothing materializes.
- **Declared ahead of its readers.** Nothing in this release reads the key at upgrade or anywhere else. The upgrade plan (#30884) and the rename execution (#30885) read it; until the execution ships, no upgrade carries a column on this declaration. The liveness ledger records the row as `planned`, naming #30885 as the reader that flips it to `live`.
- **Publish-time consequence.** `FieldSchema` is strict, so an artifact that carries `renamedFrom` is refused, as an unrecognized key, by every runtime older than this release. A package that adds the key needs an installing runtime at this release or later; a package that does not write it is unaffected.
- **`@objectstack/driver-sql` and `@objectstack/metadata-core`: the key is classified in the two maps pinned exhaustive over `FieldSchema`.** The SQL driver's builtin-column classification files it as `storage` (on `id`, `created_at` or `updated_at` the platform's own column takes no data from an old one, so the builtin-column diagnostic reports it as discarded there). The field-level security scrub keeps it: the parse refuses any entry that names a live field, so no entry can name a field a caller is denied.
