---
"@objectstack/metadata-protocol": patch
"@objectstack/spec": patch
---

Refuse a non-canonical metadata `type` at the SchemaRegistry overlay mint door

`hydrateOverlayIntoRegistry` — the one choke point boot hydration, the read-side
hydration and the write-through all funnel through — minted registry entries under
whatever `type` spelling it was handed, with no fold and no assertion. It now asserts
the spelling is canonical and refuses with `REGISTRY_TYPE_NOT_CANONICAL` (status 500)
when it is not, so an entry can no longer be minted into a second registry namespace
that no canonical read, listing or declaration lookup can reach.

Four of the six producer routes already folded at the boundary. The two that did not
(boot hydration and `revertCommit`) fold through the manifest-collection map, which
omits the types that are not stack collections — so it resolved the plurals that were
never the hazard and passed through the ones that were. Reachable only from metadata
rows written before the `/meta` URL boundary began folding; such a row is now reported
loudly (counted and named at boot, warned on the write-through) instead of silently
registering under its stored spelling.

Deliberately an assertion rather than a fold: folding here would honour, process-wide,
the override that the canonical `/meta` door refuses.
