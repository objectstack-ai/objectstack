---
'@objectstack/spec': patch
---

Correct the `EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT` docblock so it stops promising coverage the lookup does not deliver.

The `button` row cited two objectui renderers as its evidence — `form/button.tsx` and `action/action-button.tsx` — but the map is keyed on the type string exactly as authored, and `action-button.tsx` registers under `action:button`, a different key with no row. Prose only: the map, `expressionBindableTextKeysFor` and every exported type are byte-identical, `action:button` still answers the empty set, and no accept surface widens.

- The `button` row now cites `form/button.tsx` alone.
- A new docblock section records that the table is keyed on the authored type string, so namespace-prefixed spellings (`action:button`, `ui:button`, the `mcp:` family) answer the empty set by construction rather than by oversight — and that prefix-stripping is the wrong repair, because it would in the same motion grant rows to `element:button` and `page:card`, whose renderers never read these keys at the node's top level.
- `action:button` and `ui:button` are recorded as deliberately out on two measured grounds — zero pull in the objectui corpus, and the module's own admission rule that each row arrives with its own measurement — alongside the unchanged reopen path for a named requirement.
