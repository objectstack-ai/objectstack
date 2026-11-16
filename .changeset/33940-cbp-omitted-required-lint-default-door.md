---
'@objectstack/spec': patch
'@objectstack/lint': patch
---

fix(spec,lint): `os lint` reports an omitted `required` on a `controlled_by_parent` object's `master_detail` on the default strict `defineStack` door

Clause-②: yes
Metadata-protocol: none

The semantic migration entry `cbp-optional-master-admitted` (maintainer ruling A on the optional master, ADR-0055 §1 as amended) says that a raw parse reads an omitted `required` as the optional master and that `os lint` reports the omission at `error`, so the author writes `true` or `false`. On a project whose `objectstack.config.ts` calls `defineStack({ … })` with its default strict parse, `os lint` did not: the parse had already written `false` into the omitted key before any command loaded the stack, so `relationship/master-detail-required` read the explicit optional master and passed. Only `defineStack(…, { strict: false })` and a raw object config reached the finding.

**`@objectstack/spec`.** A strict `defineStack` now records, on each parsed `master_detail` field of a `controlled_by_parent` object whose authored definition writes no `required`, that the key was omitted. The new reader `masterDetailRequiredOmitted(field)` (`@objectstack/spec/data`) answers it. The record is a non-enumerable symbol on the field: it is not a key, so the field schema, `JSON.stringify` and the compiled `dist/objectstack.json` never see it, and any copy of the field drops it. Nothing parsed changes: `required` is still `false`, the stack still loads, and the runtime still reads the field as the optional master, as ruled.

**`@objectstack/lint`.** `relationship/master-detail-required` reads that record, so on the default door it now reports the omitted `required` on the object's only `master_detail` at `error`, with the same message, path and fix it already gave on `{ strict: false }`: write `required: true` (every detail names its master) or `required: false` (an optional master). An explicit `required: false` or `required: true` still lints clean. `os validate` and `os build` are unchanged.
