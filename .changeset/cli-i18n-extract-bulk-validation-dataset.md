---
'@objectstack/cli': minor
---

`os lint` and `os i18n extract` walk the three key families #14253 added — bulk
actions, validation messages and datasets — so the coverage ratchet can see them

#14253 gave three authored display surfaces their first bundle keys and a
resolver for each. Nothing on the CLI side walked them, and that costs twice:

1. `os i18n extract` scaffolded none of them, so a translator had to know the
   keys existed and hand-write them.
2. **`check:i18n-coverage` could not see them.** That ratchet measures against
   what `collectExpectedEntries` produces, so a family the walk never visits
   contributes nothing to it — the number stays green while the surface it
   claims to describe grows. Third instance of the same shape (#11485 after
   #11287, #13109 after `translatePage` learned nested children).

The three families, each emitted at the address its resolver reads:

| family | keys | resolver |
| --- | --- | --- |
| bulk actions | `objects.<o>._views.<v>.bulkActions.<def>.{label,confirmText,confirmLabel,params.<p>.{label,help,placeholder}}` | `translateView` → `translateBulkActionDefs` |
| validation messages | `objects.<o>._validations.<rule>.message` | the ObjectQL rule evaluator, via `objectValidationMessageKey` |
| datasets | `datasets.<n>.{label,description,dimensions.<d>.label,measures.<m>.label}` | `translateDataset` |

Three exclusions are measured rather than assumed, because the schema declares
no slot for them and `.strict()` would reject a key: a bulk def's
`successMessage` and `description`, and per-param `options`. A bulk param's hint
is spelled `help` (an ACTION param spells the same idea `helpText`). A
`conditional` validation rule contributes no key of its own — `checkConditional`
returns the BRANCH's violation, so the wrapper's `message` never reaches a user.

`datasets` gets its own coverage bucket, so a gap reports as
`i18n/missing-dataset` rather than folding into a neighbouring noun; bulk-action
copy reports under `view` and a rule message under `object`, the buckets whose
namespace each key lives in.
