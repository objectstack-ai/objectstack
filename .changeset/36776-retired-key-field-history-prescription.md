---
'@objectstack/spec': patch
---

fix(spec): the `enable.trash`, `versioning`, `audit`, `auditTrail`, `trackChanges` and `feedTracked` refusals point at the field-history model that runs, not at `trackHistory`

Clause-②: no
Metadata-protocol: none

Four retired-key refusals and two field-key renames told an author to use per-field `trackHistory` for field history. On a field, `trackHistory` only opts a media or structured-JSON type into old → new values, and `false` turns nothing off; on the object, `enable.trackHistory` opens the history ledger, not the values. So an author following the refusal set a flag that did not do what it said.

The `enable.trash` and `versioning` refusals now say that field history is on by default: a changed field's old → new values show on the record activity timeline, except a media or structured-JSON field, which opts in with `fieldHistory: true`; `enable.fieldHistory: false` turns them off for the object, and a field opts out with its own `fieldHistory: false`. A `lifecycle` policy stays the answer for retention. The field-key refusals for `audit` and `auditTrail` say to delete the key, because values already show by default, and name `fieldHistory: false` as the field's off switch (`fieldHistory: true` opts a media or structured-JSON field in).

The field spellings `trackChanges` and `feedTracked`, which were refused with a rename to `trackHistory`, now get the same answer as `tracked`: values show by default, `fieldHistory: false` turns them off for the field (`true` opts a media or structured-JSON field in), and `enable.fieldHistory: false` turns them off for every field on the object.

Wording only: every key that was refused is still refused, and nothing is newly refused. Nothing to migrate.
