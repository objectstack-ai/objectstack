---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the metadata save door stores an action as its `ActionSchema` parse, so a declared `requiresFeature` / `requiresMembershipReach` is lowered into `visible`

Clause-②: no — the save door refuses nothing it accepted before. It already judged the body by the same parse; what changes is only what it stores for an action that passed.

Metadata-protocol: none

`PUT /api/v1/meta/object/NAME` (draft and active) and a standalone `action` save judged an action by `ActionSchema`, then stored the request body as written. `ActionSchema`'s parse lowers `requiresMembershipReach` and `requiresFeature` into `visible`, and the console reads `visible` alone, so the stored action kept both gate keys raw, had no `visible`, and its button was offered to every user.

Now the door stores the parse it already ran:

- an object's own `actions` array is stored as the parsed array; every other key of the object body stays as written;
- a standalone `action` item is stored as the parsed action.

A stored action therefore carries the lowered `visible` (and its schema defaults, and a CEL shorthand wrapped in `{ dialect, source }`), the same shape a code package's action has been stored in since #25981. The parse is idempotent over its own output, so a GET then PUT round trip stores the same bytes.

Rows already saved before this fix are not rewritten. Saving the object (or action) again stores it lowered.
