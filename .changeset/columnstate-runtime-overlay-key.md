---
"@objectstack/spec": minor
---

Admit `columnState` to the view-metadata surface as an explicitly runtime-only overlay key (#9933).

The console grid persists per-user column order/widths as a `columnState` personalization
overlay, but the key was declared nowhere in the spec: a `columnState`-only patch carried no
key any `ViewMetadataSchema` member recognized, so the identity precondition refused it and a
patch-only write for a column drag 422'd (`INVALID_METADATA`) — it survived only inside a fat
write's copied base. The two flattened overlay members and the ViewItem wire member now
declare `columnState: { order?: string[]; widths?: Record<string, number> }` (inner shape
validated, deliberately not `.strict()` — the console owns the internals), so the ruled
patch-only personalization write (objectui#5233) parses.

NOT authorable, by ruling: the authoring faces (`ViewItemSchema`, `ListViewSchema`) continue
to reject `columnState` by name, now with a located runtime-only prescription instead of a
typo suggestion. Author-writability remains a separate, unshipped spec change.
