---
'@objectstack/spec': patch
---

fix(spec): the stored-filter conversion's TODO for a null-valued key is true on every block, and no longer tells the operator to drop the key

The ADR-0087 D2 conversion `page-component-filter-record-to-rule-array` leaves a record-form filter with a `null`-valued key as stored and reports it as a TODO, which `os migrate meta --stored` lists. The TODO's reason used to say the renderer skips that key, so it "constrains nothing", and to "Drop the key". That holds only where the block queries an object. Where the block's rows are inline (`data: { provider: 'value' }` or `staticData`), the objectui version this repository pins matches the key against the rows and selects the rows whose value is null, so following the advice there widened what the block shows.

The reason now states both behaviours, says no one rule keeps both, and leaves the choice to the operator. For a stored `{ owner_id: null }` it names the rule `{"field":"owner_id","operator":"is_null"}` for the rows with no `owner_id` value, and says that a filter leaving `owner_id` unconstrained has no rule for it. The protocol-18 migration entry `element-data-source-and-object-block-filter-rule-array` says the same.

The TODO for a key set to an empty operator object (`{ amount: {} }`) also said it "constrains nothing". The renderer refuses it instead: where the block queries an object it refuses the filter with `INVALID_FILTER` (400), and where the block's rows are inline it shows no rows. The reason now says that, and keeps its advice to drop the key, which is the renderer's own remedy.

Nothing else changes. Both filters are still left exactly as stored and still reported as a TODO, on any block. No schema, conversion verdict or exit code moves.

Clause-②: no
