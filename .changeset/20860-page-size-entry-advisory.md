---
'@objectstack/spec': patch
---

fix(spec): the `ui-object-grid-page-size-positive-integer-refused` migration entry states what the platform does with a stored `object-grid` page size of `0` — the page saves and loads, and the finding is advisory on the CLI

Clause-②: no

**`ui-object-grid-page-size-positive-integer-refused` (protocol 18).** The entry's acceptance
criterion said that a stored page whose `object-grid` node carries `pageSize: 0` "is refused on
its next authoring-path save with a per-key issue at `pagination.pageSize`". Nothing on the
metadata save path judges a page component's `properties`. `PageComponentSchema.properties` is an
open record, and the one judge of the `ComponentPropsMap` row is the component-props gate, an
advisory rule that runs on the CLI only. Measured through `saveMetaItem`, the call behind
`PUT /api/v1/meta/page`: such a page saves (`success: true`, and the result carries no `advisories` member), is stored as an
active row and reads back with `pageSize: 0` intact. On the same page, `os validate`, `os build`
and `os lint` each report one advisory `component-props-invalid` finding at
`properties.pagination.pageSize` and no error. The criterion now says exactly that. It also names
the `pageSizeOptions` entry and the flat `pageSize` shorthand, which are reported the same way at
their own paths.

Text only: no entry id, conversion or matching logic changes, and `os migrate meta` rewrites
exactly what it rewrote before. The generated migration registry carries the corrected text. The
sibling entry `object-grid-default-filters-rule-array` already stated the advisory-only outcome
and is unchanged.
