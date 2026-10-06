---
'@objectstack/metadata-protocol': patch
---

The organization-scoped save check judges a view overlay against every package's environment-wide definition of its row

- An organization-scoped `view` save or publish in the organization the anonymous form endpoints read is refused when it would leave open a form the environment-wide definition withdraws. Its row anchor is now resolved per package, the way the list read resolves each package's item: each package's own environment-wide row, else the package-less environment-wide row (which stands in for every package), else that package's artifact. Before, with no environment-wide row stored, it judged only the first package's artifact in registry order, and a stored row of any one package hid every package's artifact of the name.
- The known limit stated with the public-form withdrawal ("it may over-close, never under-close") is narrowed. A withdrawal of a view name still closes that name in every package, so it may over-close. Both checks read every package's environment-wide definition of the name, except at the anonymous endpoints when two packages each have an environment-wide copy of the same view container saved: there the endpoints read one package's copy of each form those containers expand, and can miss the other package's withdrawal of that form until it is withdrawn in each package's copy. The organization-scoped save check still judges both copies.
