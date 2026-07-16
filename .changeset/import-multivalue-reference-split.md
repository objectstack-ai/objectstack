---
'@objectstack/rest': patch
---

fix(rest): split multi-value fields on import so `multiple: true` columns resolve per-token (#3063)

The bulk-import coercion (`import-coerce.ts`) resolved a reference cell as a
single value regardless of the field's `multiple` flag: a `multiple: true`
lookup/user cell like `张焊工;李质检` was passed whole to name resolution and
always failed with `no <object> matches "张焊工;李质检"`, so every multi-value
association had to be back-filled by hand in the record UI after import.

Coercion now mirrors objectql's `isMultiValueField` predicate. A field whose
stored value is an array — an inherently-multi type (multiselect/checkboxes/tags)
or a multi-capable type flagged `multiple: true` (per the spec: select, lookup,
file, image; `radio` shares select's branch and `user` shares lookup's) — has
its cell split on the export separator (`, ` / `;` / `、` / newline) and each
token coerced individually:

- **lookup / user (`multiple: true`)** — resolve each name token to an id, store
  the id array; an unmatched/ambiguous token reports the **specific token**
  (`no sys_user matches "查无此人"`) instead of the whole string.
- **select / radio (`multiple: true`)** — match each token against the options,
  store the option-value array.
- **file / image (`multiple: true`)** — split into an id/url array.

Single-value fields and the non-multi-capable reference types (master_detail /
reference / tree) are unchanged — a stray `multiple: true` on them stays a
single resolved value, matching the engine.
