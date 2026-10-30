---
'@objectstack/lint': patch
---

fix(lint): a dataset refused at the save door for a base object outside its package's closure prints the dependency declaration as the fix

Clause-②: no
Metadata-protocol: none

At the runtime save door a dataset written into a package is judged against that package's closure: its own objects, the objects of the packages its manifest declares in `dependencies`, platform objects, and tenant objects that belong to no package. A base object outside it is refused `422` with `object-reference-unknown`, and its fix line used to read "Point it at one of this stack's objects, or at a platform object by its full name", which sends the author away from the fix that works. Under a closure it now reads "Declare a dependency on the package that defines "OBJECT" in the `dependencies` of "PACKAGE"'s manifest, or point it at an object inside that closure", the prescription the flow trigger and list view doors print for the same closure (ADR-0141 D1).

- **One prescription.** The three doors build that line from one helper, so they cannot drift apart again. The list view door's line is unchanged. The flow trigger door's line now quotes the object and package with double quotes and names "PACKAGE's manifest" instead of "the manifest `dependencies` of package 'PACKAGE'"; its second remedy (`set config.objectName …` / `set config.timeRelative.object …`) is unchanged.
- **Only the fix line moves.** The verdict, the severity and the message are the same with or without a closure.
- **Unchanged without a closure.** A write that names no package, and `os validate`, `os build` and `os lint`, print the hint they printed before.
- `os explain object-reference-unknown` describes the closure case.
