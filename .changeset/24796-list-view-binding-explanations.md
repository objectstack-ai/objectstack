---
'@objectstack/lint': patch
---

docs(lint): `os explain` covers `list-view-object-unknown` and `list-view-object-outside-closure`, and the `packageScope` docblock says what a whole-collection miss now means

Clause-②: no (no verdict, severity, accept set or served body moves: explanation text and comments only)

- **`os explain list-view-object-outside-closure`** explains the package closure a write into a package is judged against (the package's own objects, its declared `dependencies`' objects, platform objects and provenance-less tenant objects), why a list view bound outside it is refused, and the remedy: declare the dependency, or bind the view inside the closure.
- **`os explain list-view-object-unknown`** explains why a write that names no package can say an object exists nowhere (it is judged against the whole collection the deployment serves), why an empty collection is not judged, and why `os validate` / `os build` / `os lint` still skip the binding.
- **`os explain list-view-field-unknown`** no longer says an unresolvable binding always skips the list view: it does on the CLI, and the runtime save door refuses it under one of the two ids above.
- **`AuthoringRuleContext.packageScope`** (in the published `.d.ts`) no longer says an object missing from a whole snapshot "may come from another package": that is true only on the CLI. At the runtime door with no closure in force the snapshot is the whole served collection, and such a binding is refused `list-view-object-unknown`.
