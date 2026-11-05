---
'@object-ui/core': patch
'@object-ui/components': patch
---

fix(ui): the record Edit form judges a field's `requiredWhen` as the engine does, a transition gate against the stored record, so a record already inside the gate without the value saves an unrelated edit

Clause-②: no
Metadata-protocol: none

- **`@object-ui/components` form renderer:** on an Edit form (`previousValues` set), a field's `requiredWhen` is required only when the stored record complied with it. A stored record that already violates it (the predicate holds over the stored record and its value is missing, as with a contract activated before its signed-copy rule existed) is not blocked any more: it saves an edit that leaves the field empty, as the engine and REST `PATCH` already accept. This follows `Field.requiredWhen`: the write is refused only when the merged record violates the requirement AND the pre-write record complied. Still refused: the edit that moves a record into the gate without the value, and clearing the value of a record that held it. A Create form enforces as before. The "Required to run" note under an empty field (the update-action heads-up) is no longer shown for such a stored record, because the engine judges the action's write against the same stored record.
- **`@object-ui/core`:** `resolveFieldRuleState` takes `statics.name` (the field's name) and returns `requiredWhenAtRest`. With `previous` and `statics.name` given, a stored record already violating `requiredWhen` resolves `required: false` and `requiredWhenAtRest: true`. A caller that passes no `name` keeps the plain verdict. New export `requiredWhenRestsOnStoredRecord(pred, name, stored, scope?)`, the stored-record check alone. A predicate that cannot be evaluated over the stored record counts it as compliant, as on the server.
