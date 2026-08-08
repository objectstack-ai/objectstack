---
'@objectstack/spec': patch
---

**`IMetadataService.getObject` now declares what it answers with (#6505).**

`getObject` was the only member of the convenience family without a stated
relationship to the generic reader it wraps — `getView` and `getDashboard` both
say "Equivalent to `get('view'|'dashboard', name)`", `getObject` said nothing.
Consumers paid for that silence: #6055 needed the ADR-0110 D3 verdict for the
`objectstack://objects/{objectName}` MCP resource, could not presume
`getObject(name)` and `get('object', name)` resolve the same item, and bought a
second read on the miss path rather than invent the equivalence at a consumer
(Prime Directive #12).

Two facts are now written on the member, both measured against `main`:

- **The equivalence holds.** Every implementation the repo ships resolves the
  pair through one lookup. `MetadataManager.getObject` delegates to its own
  `get`; `createMemoryMetadata` reads the same `object` map from both; and
  `MetadataFacade.getObject` calls `SchemaRegistry.getObject`, which is also
  what `SchemaRegistry.getItem('object', …)` — and therefore the facade's own
  `get` — special-cases to. On the facade the two return the *identical object
  reference*, and both answer `undefined` on a miss.
- **What the pair answers is the runtime-effective object**, not the stored
  document. On a `SchemaRegistry`-backed host the answer has been through the
  registry's materialization seam (system columns, primary-title designation,
  protection/provenance stamping) and carries every `extend` contribution from
  other packages. On a plain-store host there is no contribution layer, so the
  effective object and the stored item coincide — which is exactly why a
  consumer must read the answer as the effective object on both, instead of
  inferring the stored one from whichever host it happens to run on. The raw
  per-package contributions are not reachable through this contract at all.

Documentation only — no implementation changed, and the doc comment ships in the
package's `.d.ts`. The effective-over-stored rule is the contract-layer
statement of the same fork #6562 rules on for the HTTP meta read surface.
