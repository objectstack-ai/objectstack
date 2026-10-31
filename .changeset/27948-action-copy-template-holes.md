---
'@object-ui/core': patch
---

feat(core): an action's param dialog `description`, each param's `helpText` and an `outcomeMessages` entry fill `{{ }}` template holes, and still fill `${…}`

Clause-②: no
Metadata-protocol: none

Step 1 of objectstack#27948 (ruling A, renderer first): the five action copy keys move to one hole syntax, ADR-0032's `{{ }}` template slot. `confirmText` and `successMessage` already read it; the other three read only `${…}`, so the confirm question an author moves from `confirmText` to `description` (as the spec asks for an action with params) printed its `{{ record.x }}` hole raw.

- **Param dialog `description` and `helpText`.** The `interpolate` the runner hands the param-collection handler fills a `{{ }}` hole through the template engine over `record` (the row on a row dispatch, the page's record on the record header) and the action's static `params`, the roots `confirmText` reads. Formatters work (`{{ amount | currency:USD }}`).
- **`outcomeMessages`.** An entry's `{{ }}` holes are filled over `result` (the handler's payload) and `record`, the roots `successMessage` reads.
- **`${…}` keeps working** on all three until the spec closes these slots (step 2). One dialect per sentence: a sentence with a `{{ }}` hole is filled by the template engine alone and a `${…}` token in it stays text; a sentence with none keeps its `${…}` reading.

What to do: nothing. Copy written with `${…}` reads as before; new copy can use `{{ }}`.
