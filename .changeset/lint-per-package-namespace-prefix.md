---
'@objectstack/cli': patch
---

`os lint`: evaluate the `naming/namespace-prefix` duplicate advisory per package.

The advisory read one flattened array per collection key with no package boundary, so on a
composed multi-package project two packages that each legitimately declare the same bare name
(e.g. `home`) were reported as one package declaring it twice — prescribing a rename of a name
that was already correct, with the OTHER package's namespace as the suggested prefix, under a
closing sentence saying distinct packages may reuse a name freely. Both ADR-0130 D4 stack shapes
were affected (flattened-plus-`packages[]`, and `packages[]`-only).

ADR-0130 D4/D5 registers artifacts per package, so the advisory now runs once per package —
the same shape `os build` has used for the author-time rule table — and a genuine duplicate
inside one package still warns, with the suggestion taken from that package's own namespace and
a path written whole (`packages[1].manifest.apps[1].name`) so it resolves in either shape. A
single-package project is judged exactly as before.
