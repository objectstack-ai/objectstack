---
'@objectstack/spec': patch
---

fix(spec): `composeStacks` says why a top-level connector beside a package body's same-named entry is ambiguous (#28006)

Clause-②: no (message text only: every composition `composeStacks` refused it still refuses, under the same `STACK_CROSS_REFERENCE_INVALID` envelope, and every one it accepted it still accepts)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, no export or type changes, and no verdict moves: only the wording of one refusal changes. There is nothing for `objectstack migrate meta` to rewrite. -->

A datasource whose `external.connector` names a connector that a package body and the composed artifact's top level both declare, one able to lend and the other not, was already refused as ambiguous. The refusal gave the reason that holds between two package bodies ("the runtime keeps one entry per package and lends from whichever registers first"), which is not what happens here. The boot does not register a top-level entry whose name a package body declares, so the body's entry lends, and a dev reload replaces it with the artifact's top-level entries of the name, the first of which lends. The finding now says that, and opens with "which the composed artifact declares both in a package body and at its top level".

- **Where it applies.** A `last` composition with a nested multi-package input, where another input's top level declares the same name as one of its bodies. A `preserve` composition with an input that carries `packages` beside its own top-level collections, where another package declares the same name.
- **Top-level entries only.** Two inputs' top-level entries that disagree, beside package bodies that do not declare the name, get a sentence of their own: no door registers either as a package body's entry, and a dev reload lends from the first top-level entry of the name.
- **Unchanged.** Two package bodies that disagree keep the first-registered wording. The remedy is the same: rename or remove the entry that cannot lend.
