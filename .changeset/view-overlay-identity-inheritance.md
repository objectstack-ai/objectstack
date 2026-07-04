---
"@objectstack/metadata-protocol": patch
---

Stop runtime view personalization from permanently removing views from the switcher.

A console personalization PUT (grid column sort, inline edit, …) sends only the raw
view config — no top-level `viewKind`/`object`. Persisted verbatim, the overlay row
replaced the flattened package entry wholesale on read, stripping the identity fields
every switcher-style consumer filters on (`viewKind && object`) — one sort click and
the view vanished until the DB row was deleted (#2555).

Two independent guards: `saveMetaItem` now inherits the missing `viewKind`/`object`/
`label` from the registry entry the overlay shadows before persisting, and
`getMetaItems` heals identity-less rows already in the DB the same way on read. The
overlay's own fields always win; `defineView` container bodies are untouched.
