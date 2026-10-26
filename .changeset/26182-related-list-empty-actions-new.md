---
'@object-ui/plugin-detail': minor
---

fix(plugin-detail): `record:related_list` with `actions: []` no longer draws the built-in New

Clause-②: no
Metadata-protocol: semantic

- **Before.** `actions: []` on a `record:related_list` hid the list's authored and default actions, but the built-in **New** stayed whenever the host offered create. The only way to drop it was the child object's `userActions.create`, which removes New from every list of that object. A page could not say that one list's children must be created through a process (a renewal through its flow, a version through upload), and the generic create form, with the relationship prefilled, bypassed that process.
- **Now.** An authored `actions: []` is the author's choice of no actions on that list, New included. It holds per list and does not depend on the child object's `userActions.create`. Every list that does not author `[]` keeps the host's verdict.
- **Unchanged.** A list with no `actions`, or with a non-empty `actions` list, draws New exactly as before. The row affordances (View, Edit, Delete) and the `add` (link existing) button are not governed by this key. No key is added and none is removed.
- **What to do.** Nothing for a list that should keep New. A page that authored `actions: []` and still wants New on that list deletes the key.
