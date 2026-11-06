---
'@objectstack/metadata-protocol': patch
---

refactor(metadata-protocol): nineteen more `protocol.ts` members hand their bodies to their facets

Clause-②: no
Metadata-protocol: none

- Nineteen members of `ObjectStackProtocolImplementation` that the facade gate still let keep a body (the overlay and runtime-create write gates, the code-only refusals, the registry hydration's view-expansion reconcile and four static type tables) now keep their signatures on the class and delegate in one line to their section's facet, which holds the body, moved unchanged. Four static tables moved to a new leaf module, `protocol-write-gates-tables.ts`. No behaviour changes and nothing to do on upgrade.
- The published `index.d.ts` and `index.d.cts` carry the same public surface; only docblocks of private members change, where a moved body took its docblock with it.
