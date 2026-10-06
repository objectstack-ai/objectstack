---
'@objectstack/metadata-protocol': patch
---

The organization-scoped save check judges a view overlay against every package's environment-wide definition of its row

- An organization-scoped `view` save or publish in the organization the anonymous form endpoints read is refused when it would leave open a form the environment-wide definition withdraws. Its row anchor is now resolved per package, the way the list read resolves each package's item: each package's own environment-wide row, else the package-less environment-wide row (which stands in for every package), else that package's artifact. Before, with no environment-wide row stored, it judged only the first package's artifact in registry order, and a stored row of any one package hid every package's artifact of the name.
- The known limit stated with the public-form withdrawal ("it may over-close, never under-close") is narrowed. A withdrawal of a view name still closes that name in every package, so it may over-close. The organization-scoped save check judges every package's environment-wide definition of the name. The anonymous endpoints do too, with one exception: where a package's environment-wide copy of a view container is saved, the endpoints read that copy's expansion alone for each form it expands, and can miss another package's withdrawal of that form, whether saved or shipped, until the form is withdrawn in every saved environment-wide copy of that container as well. Reading each package's expansion separately is tracked in #21967.
