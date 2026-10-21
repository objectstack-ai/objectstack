---
"@objectstack/lint": minor
---

fix(lint)!: `os build`, `os validate`, `os lint` and the page save door refuse a page component whose `properties` is present but not an object, nested components included (#24991)

Clause-②: no (narrowing: `os lint --strict` refuses a nested page component whose `properties` is `null` or an array)

A page component's `properties` is a record on every node. `PageComponentSchema` refuses anything else, but that parse only reaches the top-level components (`regions[].components[]` and `slots.*`). A nested component, in a container's `children`, a tab or accordion panel's `items[].children` or a card's `footer`, sits in an untyped slot that no parse judges. The component-props rule (`validateComponentProps`) then skipped a nested node whose bag was `null`, an array or a scalar. So a nested `record:related_list` with `properties: null`, or a nested `object-metric` with `properties: []`, passed `os lint --strict`, `os validate` and `tsc`, and the page published a component that had lost every prop it was authored with. An absent bag was already judged as `{}`; this was the present-but-not-an-object residual of the same skip.

The rule now refuses such a bag on every walked node, whatever its `type`, with one `component-props-invalid` error located at the node's `properties` path (for example `pages[0].regions[0].components[0].properties.children[0].properties`). The message names what was received (`null`, an array, a string). No per-prop verdicts are added beside it.

**BREAKING — what moves for consumers.**

- `os build`, `os validate` and `os lint` fail on a page whose nested component carries `properties: null`, `properties: []` or a scalar `properties`. Before, they passed.
- A page write in publish mode that carries such a component answered 200. It now answers `422 INVALID_METADATA` with a `component-props-invalid` issue at that path, because the page save door runs this same rule.

**Remedy.** Write the bag as an object of the props the component reads (`properties: { … }`), or omit the key when the component needs none. An omitted bag is judged as `{}`, so a component with required props still has to name them.

**Unchanged.**

- A top-level component's non-object bag is refused by the page parse, as before, and that parse runs before any authoring rule at both doors, so no second finding appears beside it.
- An absent bag keeps its earlier verdict: it is judged as `{}`.
- A valid bag is judged exactly as before. An unregistered component `type` with an object bag is still skipped.
- The finding takes the rule's existing id and severity (`component-props-invalid`, `error`). No public export or signature moves.
- Stored pages are not migrated and are not refused on read. A stored page with such a component keeps loading until it is next saved, and that save is judged.
- Measured before crossing: no page this repository ships authors a non-object `properties` bag.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at the CLI doors and the page save door of a page component whose properties bag is present but not an object: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored page with such a component keeps loading until it is next saved, and the repair is the author restoring the props the component lost, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and the change is a lint verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
