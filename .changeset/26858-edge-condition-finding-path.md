---
'@objectstack/lint': patch
---

fix(lint): a flow edge condition's `expression-invalid` finding carries the slot's key path (`flows[0].edges[1].condition`) beside its `where` text

Clause-②: no
Metadata-protocol: none

An `expression-invalid` finding on a top-level flow edge's `condition` used to be located by its `where` prose alone (`flow 'f' · edge 'e2' (decide→end) condition`), which a reader keyed on paths could not address. Its `path` is now the key path in the spelling the other rules' findings use, so a draft's `_diagnostics` reports it item-relative (`edges.1.condition`) and Studio's edge condition field shows the refusal under itself.

- `where`, the message and the verdict are unchanged: nothing is accepted or refused differently.
- The edge is indexed in the list as authored (a `null` member before it does not renumber it).
- A nested region's edge, and a flow in a map-form `flows` collection, keep `where` as their `path`, as before.
- `ExprIssue` gains the optional `path`.
