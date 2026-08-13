---
"@objectstack/spec": minor
---

The runtime metadata write door for `view` now refuses an inline view config that carries no object binding. The two flattened-overlay members of `ViewMetadataSchema` require `object` and `viewKind` — the pair every object-bound read path (`GET /meta/view?object=`, the view switcher) matches stored rows on — so a flat body like `{ name, type: 'grid', columns: [...] }` is rejected at save time (draft and active alike) with located guidance naming the missing binding and the `defineView({ list: { … } })` wrap remedy, instead of being stored, reported valid, and served by nothing. Console personalization PUTs are unaffected: the write path inherits the binding from the registry entry the overlay shadows before validation. Union membership is unchanged — four arms, same order, same JSON-Schema `anyOf` face; the inline arms' required set is the only change.
